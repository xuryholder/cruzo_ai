import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { GENERATE_IMAGE_QUEUE } from '../queue/queue.constants.js';

type HealthCheck = {
  name: 'database' | 'redis' | 'queue';
  ok: boolean;
  latencyMs: number;
  error?: string;
};

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(GENERATE_IMAGE_QUEUE) private readonly generationQueue: Queue,
  ) {}

  live(): {
    status: 'ok';
    timestamp: string;
    liveAgentMode: 'mock' | 'live';
    geminiModel: string;
    imageProvider: string;
    imageProviderMode: 'mock' | 'live';
    storageMode: 'mock' | 'live';
  } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      liveAgentMode: this.env.USE_MOCK_LIVE_AGENT ? 'mock' : 'live',
      geminiModel: this.env.GEMINI_TEXT_MODEL,
      imageProvider: this.env.IMAGE_PROVIDER,
      imageProviderMode: this.env.USE_MOCK_IMAGE_PROVIDER ? 'mock' : 'live',
      storageMode: this.env.USE_MOCK_STORAGE_PROVIDER ? 'mock' : 'live',
    };
  }

  async ready(): Promise<{
    ready: boolean;
    status: 'ok' | 'degraded';
    checks: HealthCheck[];
    queue: Awaited<ReturnType<Queue['getJobCounts']>>;
    timestamp: string;
  }> {
    const checks: HealthCheck[] = [];

    checks.push(
      await runCheck('database', async () => {
        await this.prisma.$queryRawUnsafe('SELECT 1');
      }),
    );

    checks.push(
      await runCheck('redis', async () => {
        const client = await this.generationQueue.client;
        const pong = await client.ping();
        if (pong !== 'PONG') {
          throw new Error(`Unexpected ping response: ${pong}`);
        }
      }),
    );

    let queue: Awaited<ReturnType<Queue['getJobCounts']>> = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    };

    const queueCheck = await runCheck('queue', async () => {
      await this.generationQueue.waitUntilReady();
      queue = await this.generationQueue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'paused',
      );
    });
    checks.push(queueCheck);

    const ready = checks.every((check) => check.ok);
    return {
      ready,
      status: ready ? 'ok' : 'degraded',
      checks,
      queue,
      timestamp: new Date().toISOString(),
    };
  }

  async queueMetrics(): Promise<{
    queueName: string;
    counts: Awaited<ReturnType<Queue['getJobCounts']>>;
    timestamp: string;
  }> {
    const counts = await this.generationQueue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused',
    );

    return {
      queueName: this.generationQueue.name,
      counts,
      timestamp: new Date().toISOString(),
    };
  }
}

async function runCheck(
  name: HealthCheck['name'],
  fn: () => Promise<void>,
): Promise<HealthCheck> {
  const startedAt = Date.now();

  try {
    await fn();
    return {
      name,
      ok: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: (error as Error).message,
    };
  }
}
