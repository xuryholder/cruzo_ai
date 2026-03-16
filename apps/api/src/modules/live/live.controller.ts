import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { resolveSessionId } from '../common/session-id.js';
import {
  createLiveSessionSchema,
  createLiveStreamSchema,
  createLiveTranscribeSchema,
  createLiveTurnSchema,
} from './dto/live.dto.js';
import { LiveService } from './live.service.js';

@Controller('/v1/live')
export class LiveController {
  constructor(private readonly liveService: LiveService) {}

  @Post('/session')
  @HttpCode(HttpStatus.CREATED)
  async createSession(@Req() request: FastifyRequest, @Body() body: unknown) {
    const payload = createLiveSessionSchema.parse(body ?? {});
    const existingSessionId = resolveSessionId(request);

    return this.liveService.createSession({
      existingSessionId,
      payload,
    });
  }

  @Post('/turn')
  @HttpCode(HttpStatus.OK)
  async createTurn(
    @Headers('x-live-session-id') liveSessionIdHeader: string | string[] | undefined,
    @Body() body: unknown,
  ) {
    const liveSessionId = resolveLiveSessionIdHeader(liveSessionIdHeader);
    if (!liveSessionId) {
      throw new UnauthorizedException('Missing x-live-session-id');
    }

    const payload = createLiveTurnSchema.parse(body ?? {});

    return this.liveService.createTurn({
      liveSessionId,
      payload,
    });
  }

  @Post('/token')
  @HttpCode(HttpStatus.OK)
  async createToken(
    @Headers('x-live-session-id') liveSessionIdHeader: string | string[] | undefined,
  ) {
    const liveSessionId = resolveLiveSessionIdHeader(liveSessionIdHeader);
    if (!liveSessionId) {
      throw new UnauthorizedException('Missing x-live-session-id');
    }

    return this.liveService.createEphemeralToken({ liveSessionId });
  }

  @Post('/transcribe')
  @HttpCode(HttpStatus.OK)
  async transcribe(
    @Headers('x-live-session-id') liveSessionIdHeader: string | string[] | undefined,
    @Body() body: unknown,
  ) {
    const liveSessionId = resolveLiveSessionIdHeader(liveSessionIdHeader);
    if (!liveSessionId) {
      throw new UnauthorizedException('Missing x-live-session-id');
    }

    const payload = createLiveTranscribeSchema.parse(body ?? {});
    return this.liveService.transcribeAudio({
      liveSessionId,
      payload,
    });
  }

  @Post('/stream')
  async streamTurn(
    @Headers('x-live-session-id') liveSessionIdHeader: string | string[] | undefined,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const liveSessionId = resolveLiveSessionIdHeader(liveSessionIdHeader);
    if (!liveSessionId) {
      throw new UnauthorizedException('Missing x-live-session-id');
    }

    const payload = createLiveStreamSchema.parse(body ?? {});
    const signal = request.raw as unknown as { aborted?: boolean };

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(':ok\n\n');

    const emit = (event: string, data: Record<string, unknown>) => {
      if (reply.raw.writableEnded) {
        return;
      }
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const onClose = () => {
      if (!reply.raw.writableEnded) {
        emit('interrupted', { reason: 'client_disconnect' });
        reply.raw.end();
      }
    };

    request.raw.on('close', onClose);

    try {
      await this.liveService.streamTurn({
        liveSessionId,
        payload,
        signal: {
          get aborted() {
            return signal.aborted === true || reply.raw.writableEnded;
          },
        },
        emit,
      });
    } catch (error) {
      emit('error', {
        message: (error as Error).message || 'stream_failed',
      });
    } finally {
      request.raw.off('close', onClose);
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  }
}

function resolveLiveSessionIdHeader(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || value.trim().length === 0) {
    return null;
  }

  return value.trim();
}
