import { z } from 'zod';

export const aspectRatioSchema = z.enum(['1:1', '4:5', '9:16']);

export const createGenerationSchema = z.object({
  prompt: z.string().min(3).max(2000),
  style: z.string().min(1).max(64),
  aspectRatio: aspectRatioSchema,
});

export type CreateGenerationInput = z.infer<typeof createGenerationSchema>;
