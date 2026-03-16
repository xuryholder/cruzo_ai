import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class CreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(sessionId: string): Promise<number> {
    const credits = await this.prisma.credit.findUnique({ where: { sessionId } });
    if (!credits) {
      throw new NotFoundException('Credits not found for session');
    }

    return credits.balance;
  }

  async resetBalance(sessionId: string, balance: number): Promise<number> {
    const updated = await this.prisma.credit.updateMany({
      where: { sessionId },
      data: { balance },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Credits not found for session');
    }

    return balance;
  }
}
