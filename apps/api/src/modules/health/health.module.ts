import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  providers: [HealthService],
  controllers: [HealthController],
})
export class HealthModule {}
