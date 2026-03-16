import { Module } from '@nestjs/common';
import { EnvModule } from './config/env.module.js';
import { CreditsModule } from './modules/credits/credits.module.js';
import { DatabaseModule } from './modules/database/database.module.js';
import { GenerationModule } from './modules/generation/generation.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { LiveModule } from './modules/live/live.module.js';
import { ManualModule } from './modules/manual/manual.module.js';
import { QueueModule } from './modules/queue/queue.module.js';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module.js';
import { SessionsModule } from './modules/sessions/sessions.module.js';
import { StorageModule } from './modules/storage/storage.module.js';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    QueueModule,
    StorageModule,
    RateLimitModule,
    HealthModule,
    LiveModule,
    ManualModule,
    SessionsModule,
    CreditsModule,
    GenerationModule,
  ],
})
export class AppModule {}
