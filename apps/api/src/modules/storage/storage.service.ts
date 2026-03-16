import { Storage } from '@google-cloud/storage';
import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import type { GenerateImageOutput } from '../generation/types/image-provider.interface.js';

type SaveImageInput = {
  sessionId: string;
  generationId: string;
  image: GenerateImageOutput;
};

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly gcsClient: Storage | null;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {
    if (env.USE_MOCK_STORAGE_PROVIDER) {
      this.gcsClient = null;
      return;
    }

    if (env.GCS_BUCKET) {
      this.gcsClient = new Storage();
      return;
    }

    throw new InternalServerErrorException('Storage is not configured but USE_MOCK_STORAGE_PROVIDER=false');
  }

  async saveGeneratedImage(input: SaveImageInput): Promise<string> {
    if (this.env.USE_MOCK_STORAGE_PROVIDER) {
      this.logger.log(`saveGeneratedImage mock=true imageKind=${input.image.kind}`);
      if (input.image.kind === 'url') {
        return input.image.url;
      }

      return `data:image/png;base64,${input.image.base64Png}`;
    }

    if (this.gcsClient && this.env.GCS_BUCKET) {
      const key = `images/${input.sessionId}/${input.generationId}.png`;
      const payload = await this.resolveImagePayload(input.image);
      this.logger.log(
        `saveGeneratedImage mock=false backend=gcs bucket=${this.env.GCS_BUCKET} key=${key} imageKind=${input.image.kind}`,
      );
      await this.gcsClient.bucket(this.env.GCS_BUCKET).file(key).save(Buffer.from(payload.body), {
        contentType: payload.contentType,
        resumable: false,
      });
      return toGsUri(this.env.GCS_BUCKET, key);
    }

    throw new InternalServerErrorException('Storage backend is not configured.');
  }

  async resolveAssetUrl(storedUrl: string): Promise<string> {
    if (this.env.USE_MOCK_STORAGE_PROVIDER) {
      this.logger.log(`resolveAssetUrl mock=true url=${storedUrl.slice(0, 120)}`);
      return storedUrl;
    }

    const gsParsed = parseGsUri(storedUrl);
    if (gsParsed && this.gcsClient) {
      this.logger.log(`resolveAssetUrl backend=gcs bucket=${gsParsed.bucket} key=${gsParsed.key}`);
      const [signedUrl] = await this.gcsClient.bucket(gsParsed.bucket).file(gsParsed.key).getSignedUrl({
        action: 'read',
        expires: Date.now() + this.env.ASSETS_SIGNED_URL_TTL_SECONDS * 1000,
      });
      return signedUrl;
    }

    this.logger.log(`resolveAssetUrl passthrough url=${storedUrl.slice(0, 120)}`);
    return storedUrl;
  }

  private async resolveImagePayload(image: GenerateImageOutput): Promise<{
    body: Uint8Array;
    contentType: string;
  }> {
    if (image.kind === 'base64') {
      return {
        body: Buffer.from(image.base64Png, 'base64'),
        contentType: 'image/png',
      };
    }

    const response = await fetch(image.url);
    if (!response.ok) {
      const text = await response.text();
      throw new InternalServerErrorException(
        `Failed to fetch generated image URL: ${response.status} ${text}`,
      );
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const body = new Uint8Array(await response.arrayBuffer());
    return { body, contentType };
  }
}

function toGsUri(bucket: string, key: string): string {
  return `gs://${bucket}/${key}`;
}

function parseGsUri(value: string): { bucket: string; key: string } | null {
  if (!value.startsWith('gs://')) {
    return null;
  }

  const withoutScheme = value.slice('gs://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex <= 0 || slashIndex === withoutScheme.length - 1) {
    return null;
  }

  return {
    bucket: withoutScheme.slice(0, slashIndex),
    key: withoutScheme.slice(slashIndex + 1),
  };
}
