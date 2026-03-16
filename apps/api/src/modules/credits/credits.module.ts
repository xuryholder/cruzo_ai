import { Module } from '@nestjs/common';
import { CreditsController } from './credits.controller.js';
import { CreditsService } from './credits.service.js';

@Module({
  providers: [CreditsService],
  controllers: [CreditsController],
  exports: [CreditsService],
})
export class CreditsModule {}
