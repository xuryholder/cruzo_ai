import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import { APP_ENV, type AppEnv } from '../../config/env.js';

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  reason: 'ok' | 'session' | 'ip';
};

@Injectable()
export class RateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private redis: RedisClientType | null = null;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  async onModuleInit(): Promise<void> {
    this.redis = createClient({
      url: this.env.REDIS_URL,
    });

    this.redis.on('error', (error) => {
      this.logger.error(`Redis client error: ${error.message}`);
    });

    await this.redis.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis?.isOpen) {
      await this.redis.quit();
    }

    this.redis = null;
  }

  async consumeGenerationLimit(sessionId: string, ip: string): Promise<RateLimitDecision> {
    if (!this.redis?.isOpen) {
      return {
        allowed: true,
        reason: 'ok',
        retryAfterSeconds: 0,
      };
    }

    try {
      const now = new Date();
      const minuteBucket = Math.floor(now.getTime() / 60_000);
      const hourBucket = Math.floor(now.getTime() / 3_600_000);

      const sessionKey = `rl:gen:session:${sessionId}:${minuteBucket}`;
      const ipKey = `rl:gen:ip:${ip}:${hourBucket}`;

      const sessionCount = await this.redis.incr(sessionKey);
      if (sessionCount === 1) {
        await this.redis.expire(sessionKey, 61);
      }

      const ipCount = await this.redis.incr(ipKey);
      if (ipCount === 1) {
        await this.redis.expire(ipKey, 3601);
      }

      if (sessionCount > this.env.RATE_LIMIT_SESSION_PER_MINUTE) {
        return {
          allowed: false,
          reason: 'session',
          retryAfterSeconds: secondsUntilNextMinute(now),
        };
      }

      if (ipCount > this.env.RATE_LIMIT_IP_PER_HOUR) {
        return {
          allowed: false,
          reason: 'ip',
          retryAfterSeconds: secondsUntilNextHour(now),
        };
      }

      return {
        allowed: true,
        reason: 'ok',
        retryAfterSeconds: 0,
      };
    } catch (error) {
      this.logger.error(
        `Rate limit check failed, allowing request: ${(error as Error).message}`,
      );

      return {
        allowed: true,
        reason: 'ok',
        retryAfterSeconds: 0,
      };
    }
  }
}

function secondsUntilNextMinute(now: Date): number {
  return Math.max(1, 60 - now.getUTCSeconds());
}

function secondsUntilNextHour(now: Date): number {
  const elapsed = now.getUTCMinutes() * 60 + now.getUTCSeconds();
  return Math.max(1, 3600 - elapsed);
}
