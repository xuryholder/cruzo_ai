import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../../config/env.js';
import type {
  GenerateImageInput,
  GenerateImageOutput,
  ImageProvider,
} from '../types/image-provider.interface.js';

@Injectable()
export class OpenAIImageProvider implements ImageProvider {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  async generate(input: GenerateImageInput): Promise<GenerateImageOutput> {
    if (this.env.USE_MOCK_IMAGE_PROVIDER) {
      const encodedPrompt = encodeURIComponent(input.prompt.slice(0, 60));
      return {
        kind: 'url',
        url: `https://picsum.photos/seed/${encodedPrompt}/1024/1024`,
      };
    }

    if (!this.env.OPENAI_API_KEY) {
      throw new InternalServerErrorException('OPENAI_API_KEY is not configured');
    }

    const size = mapAspectRatioToOpenAISize(input.aspectRatio);
    const prompt = `${input.prompt}\nStyle: ${input.style}`;

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.env.OPENAI_IMAGE_MODEL,
        prompt,
        size,
        response_format: 'b64_json',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new InternalServerErrorException(
        `OpenAI image generation failed: ${response.status} ${text}`,
      );
    }

    const payload = (await response.json()) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    };

    const first = payload.data?.[0];
    if (!first) {
      throw new InternalServerErrorException('OpenAI image response is empty');
    }

    if (first.url) {
      return { kind: 'url', url: first.url };
    }

    if (first.b64_json) {
      return { kind: 'base64', base64Png: first.b64_json };
    }

    throw new InternalServerErrorException('OpenAI image response has no usable output');
  }
}

function mapAspectRatioToOpenAISize(aspectRatio: '1:1' | '4:5' | '9:16'): string {
  switch (aspectRatio) {
    case '1:1':
      return '1024x1024';
    case '4:5':
      return '1024x1280';
    case '9:16':
      return '1024x1792';
    default:
      return '1024x1024';
  }
}
