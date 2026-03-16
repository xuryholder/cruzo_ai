import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { HealthService } from './health.service.js';

@Controller('/health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('/live')
  live() {
    return this.healthService.live();
  }

  @Get('/ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.healthService.ready();
    if (!result.ready) {
      reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return result;
  }

  @Get('/metrics/queue')
  async queueMetrics() {
    return this.healthService.queueMetrics();
  }
}
