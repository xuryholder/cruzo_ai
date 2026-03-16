import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../../config/env.js';
import type {
  GenerateImageInput,
  GenerateImageOutput,
  ImageProvider,
} from '../types/image-provider.interface.js';

@Injectable()
export class FalImageProvider implements ImageProvider {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  async generate(input: GenerateImageInput): Promise<GenerateImageOutput> {
    if (!this.env.FAL_API_KEY) {
      throw new InternalServerErrorException('FAL_API_KEY is not configured');
    }

    const response = await fetch(`https://fal.run/${this.env.FAL_IMAGE_MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${this.env.FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `${input.prompt}\nStyle: ${input.style}`,
        image_size: mapAspectToFalSize(input.aspectRatio),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new InternalServerErrorException(
        `fal image generation failed: ${response.status} ${text}`,
      );
    }

    const payload = (await response.json()) as {
      images?: Array<{ url?: string }>;
      image?: { url?: string };
      output?: Array<{ url?: string }>;
    };

    const url = payload.images?.[0]?.url ?? payload.image?.url ?? payload.output?.[0]?.url;
    if (!url) {
      throw new InternalServerErrorException('fal image response has no URL output');
    }

    return { kind: 'url', url };
  }
}

function mapAspectToFalSize(aspectRatio: '1:1' | '4:5' | '9:16'): string {
  switch (aspectRatio) {
    case '1:1':
      return 'square_hd';
    case '4:5':
      return 'portrait_4_5';
    case '9:16':
      return 'portrait_16_9';
    default:
      return 'square_hd';
  }
}
