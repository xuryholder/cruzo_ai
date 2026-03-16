import { Module } from '@nestjs/common';
import { AppModule } from './app.module.js';

@Module({
  imports: [AppModule],
})
export class WorkerModule {}
