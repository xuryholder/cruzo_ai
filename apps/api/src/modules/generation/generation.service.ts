import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreditLedgerType, GenerationStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { GENERATE_IMAGE_QUEUE } from '../queue/queue.constants.js';
import { StorageService } from '../storage/storage.service.js';
import type { CreateGenerationInput } from './dto/create-generation.dto.js';
import { PromptModerationService } from './tools/prompt-moderation.service.js';
import type { GenerateImageJobPayload } from './types/generation-job.payload.js';

export type CreateGenerationResult = {
  generationId: string;
  status: GenerationStatus;
  remainingCredits: number;
  deduplicated: boolean;
};

@Injectable()
export class GenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly moderationService: PromptModerationService,
    @Inject(GENERATE_IMAGE_QUEUE)
    private readonly generateImageQueue: Queue<GenerateImageJobPayload>,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async createQueuedGeneration(params: {
    sessionId: string;
    input: CreateGenerationInput;
    idempotencyKey?: string;
  }): Promise<CreateGenerationResult> {
    const idempotencyKey = params.idempotencyKey ?? randomUUID();
    this.moderationService.assertSafe(params.input.prompt);

    const txResult = await this.prisma.$transaction(
      async (tx) => {
        const existingLedger = await tx.creditLedger.findUnique({
          where: { idempotencyKey },
        });

        if (existingLedger) {
          if (!existingLedger.generationId) {
            throw new ConflictException('Idempotency key already exists without generation');
          }

          const existingGeneration = await tx.generation.findUnique({
            where: { id: existingLedger.generationId },
          });

          if (!existingGeneration) {
            throw new ConflictException('Idempotency key points to missing generation');
          }

          if (existingGeneration.sessionId !== params.sessionId) {
            throw new ConflictException('Idempotency key belongs to another session');
          }

          const credits = await tx.credit.findUnique({
            where: { sessionId: params.sessionId },
          });

          return {
            generation: existingGeneration,
            remainingCredits: credits?.balance ?? 0,
            deduplicated: true,
          };
        }

        const session = await tx.session.findUnique({ where: { id: params.sessionId } });
        if (!session) {
          throw new NotFoundException('Session not found');
        }

        const [activeCount, queuedCount] = await Promise.all([
          tx.generation.count({
            where: {
              sessionId: params.sessionId,
              status: GenerationStatus.processing_image,
            },
          }),
          tx.generation.count({
            where: {
              sessionId: params.sessionId,
              status: GenerationStatus.queued,
            },
          }),
        ]);

        if (activeCount >= 1) {
          throw new HttpException(
            'Only one active generation is allowed per session',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        if (queuedCount >= 3) {
          throw new HttpException(
            'Maximum queued generations reached for this session',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        const debitUpdated = await tx.credit.updateMany({
          where: {
            sessionId: params.sessionId,
            balance: { gte: 1 },
          },
          data: {
            balance: { decrement: 1 },
          },
        });

        if (debitUpdated.count === 0) {
          throw new ForbiddenException('Insufficient credits');
        }

        const generation = await tx.generation.create({
          data: {
            sessionId: params.sessionId,
            prompt: params.input.prompt,
            style: params.input.style,
            aspectRatio: params.input.aspectRatio,
            status: GenerationStatus.queued,
          },
        });

        await tx.creditLedger.create({
          data: {
            sessionId: params.sessionId,
            generationId: generation.id,
            type: CreditLedgerType.debit,
            amount: 1,
            idempotencyKey,
          },
        });

        const credits = await tx.credit.findUnique({ where: { sessionId: params.sessionId } });

        return {
          generation,
          remainingCredits: credits?.balance ?? 0,
          deduplicated: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (txResult.deduplicated) {
      return {
        generationId: txResult.generation.id,
        status: txResult.generation.status,
        remainingCredits: txResult.remainingCredits,
        deduplicated: true,
      };
    }

    try {
      await this.generateImageQueue.add(
        'generate-image',
        {
          generationId: txResult.generation.id,
          sessionId: txResult.generation.sessionId,
          prompt: txResult.generation.prompt,
          style: txResult.generation.style,
          aspectRatio: txResult.generation.aspectRatio as '1:1' | '4:5' | '9:16',
        },
        {
          jobId: txResult.generation.id,
          attempts: 3,
          backoff: {
            type: 'custom',
            delay: 10000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (error) {
      await this.markFailedAndRefund(txResult.generation.id, 'queue_enqueue_failed');
      throw new InternalServerErrorException('Failed to enqueue generation job', {
        cause: error,
      });
    }

    return {
      generationId: txResult.generation.id,
      status: txResult.generation.status,
      remainingCredits: txResult.remainingCredits,
      deduplicated: false,
    };
  }

  async getGenerationForSession(sessionId: string, generationId: string) {
    const generation = await this.prisma.generation.findUnique({
      where: { id: generationId },
      select: {
        id: true,
        sessionId: true,
        prompt: true,
        style: true,
        aspectRatio: true,
        status: true,
        errorCode: true,
        imageUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!generation || generation.sessionId !== sessionId) {
      throw new NotFoundException('Generation not found');
    }

    return {
      ...generation,
      imageUrl: generation.imageUrl
        ? await this.storageService.resolveAssetUrl(generation.imageUrl)
        : null,
    };
  }

  async markProcessing(generationId: string): Promise<void> {
    await this.prisma.generation.updateMany({
      where: {
        id: generationId,
        status: { in: [GenerationStatus.queued, GenerationStatus.processing_image] },
      },
      data: {
        status: GenerationStatus.processing_image,
        errorCode: null,
      },
    });
  }

  async markCompleted(generationId: string, imageUrl: string): Promise<void> {
    await this.prisma.generation.update({
      where: { id: generationId },
      data: {
        status: GenerationStatus.completed,
        imageUrl,
        errorCode: null,
      },
    });
  }

  async markFailedAndRefund(generationId: string, errorCode: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const generation = await tx.generation.findUnique({ where: { id: generationId } });
        if (!generation) {
          return;
        }

        if (generation.status !== GenerationStatus.completed) {
          await tx.generation.update({
            where: { id: generationId },
            data: {
              status: GenerationStatus.failed,
              errorCode,
            },
          });
        }

        const refundKey = `refund:${generationId}`;
        const existingRefund = await tx.creditLedger.findUnique({
          where: { idempotencyKey: refundKey },
        });

        if (existingRefund) {
          return;
        }

        const debitLedger = await tx.creditLedger.findFirst({
          where: {
            generationId,
            type: CreditLedgerType.debit,
          },
        });

        if (!debitLedger) {
          return;
        }

        await tx.credit.update({
          where: { sessionId: debitLedger.sessionId },
          data: {
            balance: { increment: Math.max(debitLedger.amount, 1) },
          },
        });

        await tx.creditLedger.create({
          data: {
            sessionId: debitLedger.sessionId,
            generationId,
            type: CreditLedgerType.refund,
            amount: Math.max(debitLedger.amount, 1),
            idempotencyKey: refundKey,
          },
        });
      },
      {
        maxWait: 15_000,
        timeout: 20_000,
      },
    );
  }

  queueName(): string {
    return this.env.QUEUE_NAME_GENERATE_IMAGE;
  }
}
