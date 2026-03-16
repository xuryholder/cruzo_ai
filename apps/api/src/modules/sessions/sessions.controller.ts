import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { resolveSessionId } from '../common/session-id.js';
import { SessionsService } from './sessions.service.js';

const bootstrapSchema = z
  .object({
    fingerprintHash: z.string().max(256).optional(),
  })
  .optional();

@Controller('/v1/sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  @Post('/bootstrap')
  @HttpCode(HttpStatus.CREATED)
  async bootstrap(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ sessionId: string; balance: number }> {
    const parsed = bootstrapSchema.parse(body);
    const session = await this.sessionsService.bootstrapSession(parsed?.fingerprintHash);

    reply.setCookie('cruzo_session_id', session.sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.NODE_ENV === 'production',
    });

    return session;
  }

  @Get('/current')
  async current(@Req() request: FastifyRequest): Promise<{ sessionId: string }> {
    const sessionId = resolveSessionId(request);
    if (!sessionId) {
      return { sessionId: '' };
    }

    await this.sessionsService.touchSession(sessionId);
    return { sessionId };
  }
}
