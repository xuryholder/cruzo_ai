import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreditLedgerType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { PrismaService } from '../database/prisma.service.js';

export type BootstrapSessionResult = {
  sessionId: string;
  balance: number;
};

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async bootstrapSession(fingerprintHash?: string): Promise<BootstrapSessionResult> {
    const sessionId = randomUUID();

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.session.create({
        data: {
          id: sessionId,
          fingerprintHash: fingerprintHash?.trim() || null,
        },
      });

      await tx.credit.create({
        data: {
          sessionId,
          balance: this.env.DEFAULT_FREE_CREDITS,
        },
      });

      await tx.creditLedger.create({
        data: {
          sessionId,
          type: CreditLedgerType.grant,
          amount: this.env.DEFAULT_FREE_CREDITS,
          idempotencyKey: `grant:${sessionId}`,
        },
      });

      return {
        sessionId,
        balance: this.env.DEFAULT_FREE_CREDITS,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return result;
  }

  async touchSession(sessionId: string): Promise<void> {
    const updated = await this.prisma.session.updateMany({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Session not found');
    }
  }
}
