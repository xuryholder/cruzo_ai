import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionOptions } from 'bullmq';
import { APP_ENV, type AppEnv } from '../../config/env.js';

@Injectable()
export class QueueConnectionService {
  readonly connection: ConnectionOptions;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {
    const parsed = new URL(env.REDIS_URL);
    const isTls = parsed.protocol === 'rediss:';
    this.connection = {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      maxRetriesPerRequest: null,
      tls: isTls ? {} : undefined,
    };
  }
}
