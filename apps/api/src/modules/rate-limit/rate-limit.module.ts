import { Global, Module } from '@nestjs/common';
import { GenerationRateLimitGuard } from './generation-rate-limit.guard.js';
import { RateLimitService } from './rate-limit.service.js';

@Global()
@Module({
  providers: [RateLimitService, GenerationRateLimitGuard],
  exports: [RateLimitService, GenerationRateLimitGuard],
})
export class RateLimitModule {}
