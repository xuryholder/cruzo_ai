import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { QueueConnectionService } from '../queue/queue-connection.service.js';
import { StorageService } from '../storage/storage.service.js';
import { GenerateImageTool } from './tools/generate-image.tool.js';
import { GenerationService } from './generation.service.js';
import type { GenerateImageJobPayload } from './types/generation-job.payload.js';

@Injectable()
export class GenerationProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(GenerationProcessor.name);
  private worker: Worker<GenerateImageJobPayload> | null = null;

  constructor(
    private readonly generationService: GenerationService,
    private readonly generateImageTool: GenerateImageTool,
    private readonly storageService: StorageService,
    private readonly queueConnectionService: QueueConnectionService,
  ) {}

  async start(): Promise<void> {
    if (this.worker) {
      return;
    }

    this.worker = new Worker<GenerateImageJobPayload>(
      this.generationService.queueName(),
      async (job) => this.process(job),
      {
        connection: this.queueConnectionService.connection,
        concurrency: 1,
        lockDuration: 15 * 60 * 1000,
        stalledInterval: 60 * 1000,
        settings: {
          backoffStrategy: (attemptsMade, type) => {
            if (type !== 'custom') {
              return 0;
            }

            if (attemptsMade <= 1) {
              return 10_000;
            }

            if (attemptsMade === 2) {
              return 30_000;
            }

            return 90_000;
          },
        },
      },
    );

    this.worker.on('ready', () => {
      this.logger.log('Generation worker is ready');
    });

    this.worker.on('completed', (job) => {
      this.logger.log(`Completed generation job ${job.id}`);
    });

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Generation job failed ${job?.id ?? 'unknown'}: ${error.message}`,
      );
    });
  }

  async process(job: Job<GenerateImageJobPayload>): Promise<{ imageUrl: string }> {
    await this.generationService.markProcessing(job.data.generationId);

    try {
      this.logger.log(
        `Processing generationId=${job.data.generationId} sessionId=${job.data.sessionId} prompt=${job.data.prompt.slice(0, 160)}`,
      );
      const generated = await this.generateImageTool.execute({
        prompt: job.data.prompt,
        style: job.data.style,
        aspectRatio: job.data.aspectRatio,
      });
      this.logger.log(
        `Generated image output generationId=${job.data.generationId} kind=${generated.kind}`,
      );

      const imageUrl = await this.storageService.saveGeneratedImage({
        sessionId: job.data.sessionId,
        generationId: job.data.generationId,
        image: generated,
      });
      this.logger.log(
        `Stored generated image generationId=${job.data.generationId} imageUrl=${imageUrl.slice(0, 160)}`,
      );
      await this.generationService.markCompleted(job.data.generationId, imageUrl);
      return { imageUrl };
    } catch (error) {
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      if (isFinalAttempt) {
        await this.generationService.markFailedAndRefund(
          job.data.generationId,
          'image_generation_failed',
        );
      }

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}
