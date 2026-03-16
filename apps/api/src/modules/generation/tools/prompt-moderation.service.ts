import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../../config/env.js';

const MODERATION_MESSAGE = 'Prompt violates safety policy. Please rephrase it.';

const CATEGORY_PATTERNS: Record<ModerationCategory, RegExp[]> = {
  sexual_explicit: [
    /\b(porn|pornography|explicit sex|hardcore|blowjob|anal sex|nude sex)\b/i,
  ],
  minors: [
    /\b(minor|underage|child porn|teen sex|loli|shota|preteens?)\b/i,
  ],
  hate: [
    /\b(hate speech|ethnic cleansing|genocide against|kill all (?:\w+\s*){1,3})\b/i,
  ],
  self_harm: [
    /\b(suicide|self-harm|self harm|kill myself|ways to die|cut myself)\b/i,
  ],
  extreme_violence: [
    /\b(beheading|dismemberment|gore|graphic violence|torture scene)\b/i,
  ],
  illegal_instructions: [
    /\b(make a bomb|build a bomb|phishing kit|counterfeit money|how to hack|bypass (?:law|police))\b/i,
  ],
};

type ModerationCategory =
  | 'sexual_explicit'
  | 'minors'
  | 'hate'
  | 'self_harm'
  | 'extreme_violence'
  | 'illegal_instructions';

@Injectable()
export class PromptModerationService {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  assertSafe(prompt: string): void {
    if (!this.env.ENABLE_PROMPT_MODERATION) {
      return;
    }

    const normalized = normalizePrompt(prompt);
    const triggeredCategories = Object.entries(CATEGORY_PATTERNS)
      .filter(([, patterns]) => patterns.some((pattern) => pattern.test(normalized)))
      .map(([category]) => category as ModerationCategory);

    if (triggeredCategories.length > 0) {
      throw new BadRequestException({
        message: MODERATION_MESSAGE,
        blockedCategories: triggeredCategories,
      });
    }
  }
}

function normalizePrompt(prompt: string): string {
  return prompt
    .replace(/\s+/g, ' ')
    .trim();
}
