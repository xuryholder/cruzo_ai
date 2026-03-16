import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { APP_ENV, type AppEnv } from '../../../config/env.js';
import type {
  GenerateImageInput,
  GenerateImageOutput,
  ImageProvider,
} from '../types/image-provider.interface.js';

@Injectable()
export class GeminiImageProvider implements ImageProvider {
  private readonly logger = new Logger(GeminiImageProvider.name);
  private readonly ai: GoogleGenAI | null;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {
    this.ai = this.env.GOOGLE_API_KEY ? new GoogleGenAI({ apiKey: this.env.GOOGLE_API_KEY }) : null;
  }

  async generate(input: GenerateImageInput): Promise<GenerateImageOutput> {
    this.logger.log(
      `generate called provider=gemini mock=${this.env.USE_MOCK_IMAGE_PROVIDER} model=${this.env.GEMINI_IMAGE_MODEL}`,
    );
    if (this.env.USE_MOCK_IMAGE_PROVIDER) {
      const encodedPrompt = encodeURIComponent(input.prompt.slice(0, 60));
      return {
        kind: 'url',
        url: `https://picsum.photos/seed/${encodedPrompt}/1024/1024`,
      };
    }

    if (!this.ai) {
      throw new InternalServerErrorException('GOOGLE_API_KEY is not configured for Gemini image generation');
    }

    const response = await this.ai.models.generateContent({
      model: this.env.GEMINI_IMAGE_MODEL,
      contents: `${input.prompt}\nStyle: ${input.style}\nAspect ratio: ${input.aspectRatio}`,
    });

    const inlineData = extractInlineImage(response);
    if (!inlineData) {
      throw new InternalServerErrorException('Gemini image response has no inline image output');
    }

    this.logger.log(`generated inline image bytes=${inlineData.data.length} mime=${inlineData.mimeType}`);

    return {
      kind: 'base64',
      base64Png: inlineData.data,
    };
  }
}

function extractInlineImage(response: unknown): { data: string; mimeType: string } | null {
  const candidates = (response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: {
            data?: string;
            mimeType?: string;
          };
        }>;
      };
    }>;
  }).candidates;

  for (const candidate of candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inlineData = part.inlineData;
      if (
        inlineData &&
        typeof inlineData.data === 'string' &&
        inlineData.data.length > 0 &&
        typeof inlineData.mimeType === 'string' &&
        inlineData.mimeType.startsWith('image/')
      ) {
        return {
          data: inlineData.data,
          mimeType: inlineData.mimeType,
        };
      }
    }
  }

  return null;
}
