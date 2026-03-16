import { z } from 'zod';

export const createLiveSessionSchema = z.object({
  locale: z.string().trim().min(2).max(16).default('en-US'),
  persona: z.string().trim().min(1).max(120).default('cruzo-live-birthday-agent'),
}).partial();

export const liveToneSchema = z.enum(['warm', 'friendly', 'formal', 'playful', 'neutral']);

export const createLiveTurnSchema = z.object({
  text: z.string().trim().min(3).max(2000),
  tone: liveToneSchema.default('friendly'),
  channel: z.enum(['voice', 'text']).default('voice'),
});

export const createLiveStreamSchema = createLiveTurnSchema;

export const createLiveTranscribeSchema = z.object({
  audioBase64: z.string().trim().min(1),
  mimeType: z.string().trim().min(3).max(128).default('audio/webm'),
});

export type CreateLiveSessionInput = z.infer<typeof createLiveSessionSchema>;
export type CreateLiveTurnInput = z.infer<typeof createLiveTurnSchema>;
export type CreateLiveStreamInput = z.infer<typeof createLiveStreamSchema>;
export type CreateLiveTranscribeInput = z.infer<typeof createLiveTranscribeSchema>;
export type LiveTone = z.infer<typeof liveToneSchema>;
