import { Module } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { GenerationController } from './generation.controller.js';
import { GenerationProcessor } from './generation.processor.js';
import { GenerationService } from './generation.service.js';
import { FalImageProvider } from './tools/fal-image.provider.js';
import { GeminiImageProvider } from './tools/gemini-image.provider.js';
import { GenerateImageTool } from './tools/generate-image.tool.js';
import { OpenAIImageProvider } from './tools/openai-image.provider.js';
import { PromptModerationService } from './tools/prompt-moderation.service.js';
import { IMAGE_PROVIDER } from './types/image-provider.interface.js';

@Module({
  providers: [
    GenerationService,
    GenerationProcessor,
    GenerateImageTool,
    OpenAIImageProvider,
    FalImageProvider,
    GeminiImageProvider,
    PromptModerationService,
    {
      provide: IMAGE_PROVIDER,
      inject: [APP_ENV, OpenAIImageProvider, FalImageProvider, GeminiImageProvider],
      useFactory: (
        env: AppEnv,
        openAIImageProvider: OpenAIImageProvider,
        falImageProvider: FalImageProvider,
        geminiImageProvider: GeminiImageProvider,
      ) =>
        env.IMAGE_PROVIDER === 'fal'
          ? falImageProvider
          : env.IMAGE_PROVIDER === 'openai'
            ? openAIImageProvider
            : geminiImageProvider,
    },
  ],
  controllers: [GenerationController],
  exports: [GenerationService, GenerationProcessor],
})
export class GenerationModule {}
