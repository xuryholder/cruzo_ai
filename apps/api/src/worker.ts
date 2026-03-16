import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { GenerationProcessor } from './modules/generation/generation.processor.js';
import { WorkerModule } from './worker.module.js';

async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'error', 'warn'],
  });

  const processor = app.get(GenerationProcessor);
  await processor.start();
  Logger.log('Worker started', 'WorkerBootstrap');

  const shutdown = async (signal: string): Promise<void> => {
    Logger.warn(`Received ${signal}. Shutting down worker...`, 'WorkerBootstrap');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

bootstrapWorker().catch((error) => {
  Logger.error(error, 'WorkerBootstrap');
  process.exit(1);
});
