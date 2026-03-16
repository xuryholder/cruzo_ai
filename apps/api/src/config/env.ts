import { z } from 'zod';

const booleanFromString = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  IMAGE_PROVIDER: z.enum(['openai', 'fal', 'gemini']).default('gemini'),
  FAL_API_KEY: z.string().default(''),
  FAL_IMAGE_MODEL: z.string().default('fal-ai/flux/dev'),
  GOOGLE_API_KEY: z.string().default(''),
  GEMINI_TEXT_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_LIVE_MODEL: z.string().default('gemini-2.5-flash-native-audio-preview-12-2025'),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-3.1-flash-image-preview'),
  GCP_PROJECT_ID: z.string().default(''),
  GCS_BUCKET: z.string().default(''),
  LIVE_SESSION_TTL_SEC: z.coerce.number().int().positive().default(3600),
  USE_MOCK_LIVE_AGENT: booleanFromString.default(true),
  USE_MOCK_STORAGE_PROVIDER: booleanFromString.default(true),
  R2_ENDPOINT: z.string().default(''),
  R2_REGION: z.string().default('auto'),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),
  R2_BUCKET: z.string().default('cruzo-ai-assets'),
  RATE_LIMIT_SESSION_PER_MINUTE: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_IP_PER_HOUR: z.coerce.number().int().positive().default(30),
  ENABLE_PROMPT_MODERATION: booleanFromString.default(true),
  DEFAULT_FREE_CREDITS: z.coerce.number().int().min(0).default(20),
  QUEUE_NAME_GENERATE_IMAGE: z.string().default('generate-image'),
  ASSETS_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  USE_MOCK_IMAGE_PROVIDER: booleanFromString.default(true),
});

export type AppEnv = z.infer<typeof envSchema>;

export const APP_ENV = Symbol('APP_ENV');

export function loadEnv(): AppEnv {
  return envSchema.parse(process.env);
}
