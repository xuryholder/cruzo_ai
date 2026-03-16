import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { resolveSessionId } from '../common/session-id.js';
import { RateLimitService } from './rate-limit.service.js';

const RATE_LIMIT_MESSAGE = 'Request limit exceeded. Please try again in a minute.';

@Injectable()
export class GenerationRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimitService: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();
    const sessionId = resolveSessionId(request);

    if (!sessionId) {
      return true;
    }

    const ip = resolveClientIp(request);
    const decision = await this.rateLimitService.consumeGenerationLimit(sessionId, ip);
    if (decision.allowed) {
      return true;
    }

    response.header('Retry-After', String(decision.retryAfterSeconds));
    throw new HttpException(
      {
        message: RATE_LIMIT_MESSAGE,
        retryAfterSeconds: decision.retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

function resolveClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0]?.trim() || request.ip || 'unknown';
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]?.split(',')[0]?.trim() || request.ip || 'unknown';
  }

  const realIp = request.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim().length > 0) {
    return realIp.trim();
  }

  if (Array.isArray(realIp) && realIp.length > 0 && realIp[0].trim().length > 0) {
    return realIp[0].trim();
  }

  return request.ip || 'unknown';
}
