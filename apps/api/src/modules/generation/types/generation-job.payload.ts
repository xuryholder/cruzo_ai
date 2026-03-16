export type GenerateImageJobPayload = {
  generationId: string;
  sessionId: string;
  prompt: string;
  style: string;
  aspectRatio: '1:1' | '4:5' | '9:16';
};
