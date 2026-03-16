import 'reflect-metadata';
import { createServer } from 'node:http';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { GenerationProcessor } from './modules/generation/generation.processor.js';
import { WorkerModule } from './worker.module.js';

async function bootstrapWorkerCloudRun(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'error', 'warn'],
  });

  const processor = app.get(GenerationProcessor);
  await processor.start();
  Logger.log('Worker started (Cloud Run mode)', 'WorkerCloudRun');

  const port = Number.parseInt(process.env.PORT || '8080', 10);
  const healthServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok');
  });

  await new Promise<void>((resolve) => {
    healthServer.listen(port, '0.0.0.0', () => {
      Logger.log(`Health server listening on :${port}`, 'WorkerCloudRun');
      resolve();
    });
  });

  const shutdown = async (signal: string): Promise<void> => {
    Logger.warn(`Received ${signal}. Shutting down...`, 'WorkerCloudRun');
    await new Promise<void>((resolve) => healthServer.close(() => resolve()));
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

bootstrapWorkerCloudRun().catch((error) => {
  Logger.error(error, 'WorkerCloudRun');
  process.exit(1);
});
