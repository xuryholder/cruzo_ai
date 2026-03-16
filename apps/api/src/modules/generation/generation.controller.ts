import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { resolveSessionId } from '../common/session-id.js';
import { GenerationRateLimitGuard } from '../rate-limit/generation-rate-limit.guard.js';
import { createGenerationSchema } from './dto/create-generation.dto.js';
import { GenerationService } from './generation.service.js';

function resolveIdempotencyKey(request: FastifyRequest): string {
  const header = request.headers['x-idempotency-key'];
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim();
  }

  if (Array.isArray(header) && header.length > 0 && header[0].trim().length > 0) {
    return header[0].trim();
  }

  return randomUUID();
}

@Controller('/v1/generations')
export class GenerationController {
  constructor(private readonly generationService: GenerationService) {}

  @Post()
  @UseGuards(GenerationRateLimitGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@Req() request: FastifyRequest, @Body() body: unknown) {
    const sessionId = resolveSessionId(request);
    if (!sessionId) {
      throw new UnauthorizedException('Missing session id');
    }

    const input = createGenerationSchema.parse(body);
    const idempotencyKey = resolveIdempotencyKey(request);

    return this.generationService.createQueuedGeneration({
      sessionId,
      input,
      idempotencyKey,
    });
  }

  @Get('/:generationId')
  async getStatus(
    @Req() request: FastifyRequest,
    @Param('generationId') generationId: string,
  ) {
    const sessionId = resolveSessionId(request);
    if (!sessionId) {
      throw new UnauthorizedException('Missing session id');
    }

    return this.generationService.getGenerationForSession(sessionId, generationId);
  }
}
