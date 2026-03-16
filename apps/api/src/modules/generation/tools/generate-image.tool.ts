import { Inject, Injectable } from '@nestjs/common';
import { IMAGE_PROVIDER, type GenerateImageInput, type GenerateImageOutput, type ImageProvider } from '../types/image-provider.interface.js';

@Injectable()
export class GenerateImageTool {
  constructor(
    @Inject(IMAGE_PROVIDER)
    private readonly imageProvider: ImageProvider,
  ) {}

  async execute(input: GenerateImageInput): Promise<GenerateImageOutput> {
    return this.imageProvider.generate(input);
  }
}
