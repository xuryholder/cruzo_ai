import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { MANUAL_DEV_USER_EMAIL, MANUAL_DEV_USER_ID } from './manual.constants.js';

@Injectable()
export class ManualUserService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveUserId(): Promise<string> {
    await this.prisma.user.upsert({
      where: { id: MANUAL_DEV_USER_ID },
      create: {
        id: MANUAL_DEV_USER_ID,
        email: MANUAL_DEV_USER_EMAIL,
        timezone: 'UTC',
      },
      update: {},
    });

    return MANUAL_DEV_USER_ID;
  }
}
