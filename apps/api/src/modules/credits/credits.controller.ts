import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { resolveSessionId } from '../common/session-id.js';
import { CreditsService } from './credits.service.js';

const resetCreditsSchema = z
  .object({
    balance: z.coerce.number().int().min(0).optional(),
  })
  .optional();

@Controller('/v1/credits')
export class CreditsController {
  constructor(
    private readonly creditsService: CreditsService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  @Get('/balance')
  async balance(@Req() request: FastifyRequest): Promise<{ balance: number }> {
    const sessionId = resolveSessionId(request);
    if (!sessionId) {
      throw new UnauthorizedException('Missing session id');
    }

    const balance = await this.creditsService.getBalance(sessionId);
    return { balance };
  }

  @Post('/dev/reset')
  @HttpCode(HttpStatus.OK)
  async resetForDev(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ balance: number }> {
    if (this.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev reset is disabled in production');
    }

    const sessionId = resolveSessionId(request);
    if (!sessionId) {
      throw new UnauthorizedException('Missing session id');
    }

    const parsed = resetCreditsSchema.parse(body);
    const nextBalance = parsed?.balance ?? this.env.DEFAULT_FREE_CREDITS;
    const balance = await this.creditsService.resetBalance(sessionId, nextBalance);
    return { balance };
  }
}
