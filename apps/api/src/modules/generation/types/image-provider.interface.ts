export type GenerateImageInput = {
  prompt: string;
  style: string;
  aspectRatio: '1:1' | '4:5' | '9:16';
};

export type GenerateImageOutput =
  | { kind: 'url'; url: string }
  | { kind: 'base64'; base64Png: string };

export interface ImageProvider {
  generate(input: GenerateImageInput): Promise<GenerateImageOutput>;
}

export const IMAGE_PROVIDER = Symbol('IMAGE_PROVIDER');
