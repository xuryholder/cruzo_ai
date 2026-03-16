import { Inject, Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { SessionsService } from '../sessions/sessions.service.js';
import type {
  CreateLiveStreamInput,
  CreateLiveSessionInput,
  CreateLiveTranscribeInput,
  CreateLiveTurnInput,
  LiveTone,
} from './dto/live.dto.js';

type LiveTurnOutput = {
  greetingDraft: string;
  cardConcept: string;
  voiceSummary: string;
};

type LiveStreamEventName =
  | 'turn_started'
  | 'thinking'
  | 'draft_delta'
  | 'draft_complete'
  | 'card_concept'
  | 'voice_summary'
  | 'turn_completed'
  | 'interrupted'
  | 'error';

@Injectable()
export class LiveService {
  private readonly logger = new Logger(LiveService.name);
  private readonly ai: GoogleGenAI | null;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly sessionsService: SessionsService,
  ) {
    this.ai = this.env.GOOGLE_API_KEY ? new GoogleGenAI({ apiKey: this.env.GOOGLE_API_KEY }) : null;
  }

  async createSession(input: {
    existingSessionId: string | null;
    payload: CreateLiveSessionInput;
  }): Promise<{
    sessionId: string;
    liveSessionId: string;
    locale: string;
    persona: string;
    provider: 'gemini';
    mode: 'live' | 'fallback';
  }> {
    const locale = input.payload.locale || 'en-US';
    const persona = input.payload.persona || 'cruzo-live-birthday-agent';

    const sessionId = await this.resolveSessionId(input.existingSessionId);
    const liveSessionId = `${sessionId}.${randomUUID()}`;

    return {
      sessionId,
      liveSessionId,
      locale,
      persona,
      provider: 'gemini',
      mode: this.ai && !this.env.USE_MOCK_LIVE_AGENT ? 'live' : 'fallback',
    };
  }

  async createTurn(input: {
    liveSessionId: string;
    payload: CreateLiveTurnInput;
  }): Promise<LiveTurnOutput> {
    const sessionId = parseSessionIdFromLiveId(input.liveSessionId);
    if (sessionId) {
      await this.sessionsService.touchSession(sessionId).catch(() => undefined);
    }

    if (this.ai && !this.env.USE_MOCK_LIVE_AGENT) {
      const generated = await this.generateWithGemini(input.payload).catch((error) => {
        this.logger.warn(`Gemini fallback: ${(error as Error).message}`);
        return null;
      });

      if (generated) {
        return generated;
      }
    }

    return buildFallbackTurn(input.payload);
  }

  async streamTurn(input: {
    liveSessionId: string;
    payload: CreateLiveStreamInput;
    signal: { aborted: boolean };
    emit: (event: LiveStreamEventName, data: Record<string, unknown>) => void;
  }): Promise<void> {
    const sessionId = parseSessionIdFromLiveId(input.liveSessionId);
    if (sessionId) {
      await this.sessionsService.touchSession(sessionId).catch(() => undefined);
    }

    this.logLiveEvent('turn_started', {
      liveSessionId: input.liveSessionId,
      channel: input.payload.channel,
      tone: input.payload.tone,
    });
    input.emit('turn_started', {
      liveSessionId: input.liveSessionId,
    });
    input.emit('thinking', {
      liveSessionId: input.liveSessionId,
    });

    const turn = await this.createTurn({
      liveSessionId: input.liveSessionId,
      payload: input.payload,
    });

    const chunks = chunkText(turn.greetingDraft, 18);
    let assembled = '';

    for (const chunk of chunks) {
      if (input.signal.aborted) {
        this.logLiveEvent('turn_interrupted', {
          liveSessionId: input.liveSessionId,
        });
        input.emit('interrupted', { reason: 'client_abort' });
        return;
      }

      assembled += chunk;
      input.emit('draft_delta', { text: chunk });
      await sleep(45);
    }

    input.emit('draft_complete', { text: assembled.trim() });
    input.emit('card_concept', { text: turn.cardConcept });
    input.emit('voice_summary', { text: turn.voiceSummary });
    input.emit('turn_completed', {
      greetingDraft: turn.greetingDraft,
      cardConcept: turn.cardConcept,
      voiceSummary: turn.voiceSummary,
    });

    this.logLiveEvent('turn_completed', {
      liveSessionId: input.liveSessionId,
      draftChars: turn.greetingDraft.length,
    });
  }

  async createEphemeralToken(input: {
    liveSessionId: string;
  }): Promise<{
    liveSessionId: string;
    supported: boolean;
    token: string | null;
    message: string;
    expiresAt: string | null;
    newSessionExpiresAt: string | null;
    model: string;
  }> {
    const sessionId = parseSessionIdFromLiveId(input.liveSessionId);
    if (sessionId) {
      await this.sessionsService.touchSession(sessionId).catch(() => undefined);
    }

    if (!this.ai || this.env.USE_MOCK_LIVE_AGENT) {
      return {
        liveSessionId: input.liveSessionId,
        supported: false,
        token: null,
        message: 'Ephemeral token is unavailable in mock mode.',
        expiresAt: null,
        newSessionExpiresAt: null,
        model: this.env.GEMINI_LIVE_MODEL,
      };
    }

    const expireTime = new Date(Date.now() + 30 * 60 * 1000);
    const newSessionExpireTime = new Date(Date.now() + 60 * 1000);

    try {
      const token = await this.ai.authTokens.create({
        config: {
          uses: 1,
          expireTime: expireTime.toISOString(),
          newSessionExpireTime: newSessionExpireTime.toISOString(),
          liveConnectConstraints: {
            model: this.env.GEMINI_LIVE_MODEL,
          },
          httpOptions: {
            apiVersion: 'v1alpha',
          },
        },
      });

      const ephemeral = typeof token.name === 'string' ? token.name : null;
      const tokenRecord = token as unknown as {
        expireTime?: string;
        newSessionExpireTime?: string;
      };
      return {
        liveSessionId: input.liveSessionId,
        supported: ephemeral !== null,
        token: ephemeral,
        message: ephemeral
          ? 'Ephemeral token is ready.'
          : 'Token response was empty.',
        expiresAt:
          typeof tokenRecord.expireTime === 'string'
            ? tokenRecord.expireTime
            : expireTime.toISOString(),
        newSessionExpiresAt:
          typeof tokenRecord.newSessionExpireTime === 'string'
            ? tokenRecord.newSessionExpireTime
            : newSessionExpireTime.toISOString(),
        model: this.env.GEMINI_LIVE_MODEL,
      };
    } catch (error) {
      this.logger.warn(`Ephemeral token mint failed: ${(error as Error).message}`);
      return {
        liveSessionId: input.liveSessionId,
        supported: false,
        token: null,
        message: 'Ephemeral token mint failed.',
        expiresAt: null,
        newSessionExpiresAt: null,
        model: this.env.GEMINI_LIVE_MODEL,
      };
    }

  }

  async transcribeAudio(input: {
    liveSessionId: string;
    payload: CreateLiveTranscribeInput;
  }): Promise<{ text: string; provider: 'gemini' | 'fallback' }> {
    const sessionId = parseSessionIdFromLiveId(input.liveSessionId);
    if (sessionId) {
      await this.sessionsService.touchSession(sessionId).catch(() => undefined);
    }

    if (!this.ai) {
      return {
        text: '',
        provider: 'fallback',
      };
    }

    try {
      const response = await this.ai.models.generateContent({
        model: this.env.GEMINI_TEXT_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  'Transcribe this audio to English text.',
                  'Return only the transcription text with no markdown or metadata.',
                  'If speech is unclear, return your best short guess.',
                ].join(' '),
              },
              {
                inlineData: {
                  mimeType: input.payload.mimeType,
                  data: input.payload.audioBase64,
                },
              },
            ],
          },
        ],
      });

      const text = extractResponseText(response).trim();
      return {
        text,
        provider: 'gemini',
      };
    } catch (error) {
      this.logger.warn(`Audio transcription failed: ${(error as Error).message}`);
      return {
        text: '',
        provider: 'fallback',
      };
    }
  }

  private async resolveSessionId(existingSessionId: string | null): Promise<string> {
    if (existingSessionId) {
      const touched = await this.sessionsService
        .touchSession(existingSessionId)
        .then(() => true)
        .catch(() => false);
      if (touched) {
        return existingSessionId;
      }
    }

    const session = await this.sessionsService.bootstrapSession();
    return session.sessionId;
  }

  private logLiveEvent(event: string, data: Record<string, unknown>): void {
    this.logger.log(`[live_event] ${event} ${JSON.stringify(data)}`);
  }

  private async generateWithGemini(payload: CreateLiveTurnInput): Promise<LiveTurnOutput | null> {
    if (!this.ai) {
      return null;
    }

    const prompt = [
      SYSTEM_PROMPT,
      `Tone: ${payload.tone}`,
      `Channel: ${payload.channel}`,
      'Return strict JSON with keys: greetingDraft, cardConcept, voiceSummary.',
      `User request: ${payload.text}`,
    ].join('\n');

    const response = await this.ai.models.generateContent({
      model: this.env.GEMINI_TEXT_MODEL,
      contents: prompt,
    });

    const raw = extractResponseText(response);
    if (!raw) {
      return null;
    }

    const candidate = safeParseJson(raw);
    if (!candidate) {
      return null;
    }

    const greetingDraft = asBoundedString(candidate.greetingDraft, 2000);
    const cardConcept = normalizeCardConcept(
      asBoundedString(candidate.cardConcept, 2000),
      payload.text,
    );
    const voiceSummary = asBoundedString(candidate.voiceSummary, 1000);

    if (!greetingDraft || !cardConcept || !voiceSummary) {
      return null;
    }

    return {
      greetingDraft,
      cardConcept,
      voiceSummary,
    };
  }
}

const SYSTEM_PROMPT = [
  'You are Cruzo Live, a real-time celebration card and greeting agent.',
  'Support birthday cards, holiday cards, team appreciation messages, congratulations, and event greetings.',
  'Speak naturally, keep a warm premium tone, and avoid generic fluff.',
  'Return strict JSON with keys: greetingDraft, cardConcept, voiceSummary.',
  'cardConcept must be a short production-ready image prompt under 220 characters.',
  'cardConcept must be visual only: subject, style, palette, layout, typography, exclusions.',
  'Do not include explanations, questions, or meta commentary in cardConcept.',
  'Default to artwork-first visual direction: front-facing designed card-face composition, artwork fills the frame, minimal surrounding environment.',
  'Treat the output as finished greeting artwork, not a photographed object.',
  'Use illustration and editorial design language before mockup or product-shot language.',
  'Only use physical mockup styling if the user explicitly asks for a mockup, tabletop shot, printed card, or product photo.',
  'Prefer card/poster language such as: editorial greeting card, festive illustration, premium typography, direct front view, minimal background context.',
  'Avoid hallucinations. Use only user-provided facts.',
].join(' ');

function parseSessionIdFromLiveId(liveSessionId: string): string | null {
  const firstPart = liveSessionId.split('.')[0]?.trim();
  return firstPart && firstPart.length > 0 ? firstPart : null;
}

function buildFallbackTurn(payload: CreateLiveTurnInput): LiveTurnOutput {
  const recipient = extractRecipient(payload.text) || 'your teammate';
  const toneSentence = resolveToneSentence(payload.tone);
  const event = inferOccasion(payload.text);

  return {
    greetingDraft: `${resolveGreetingLead(event, recipient)} ${toneSentence}`,
    cardConcept: buildVisualBrief({
      occasion: event,
      recipient,
    }),
    voiceSummary: `Draft and visual concept are ready for ${recipient}. You can ask me to shorten, warm up the tone, or regenerate the visual.`,
  };
}

function extractRecipient(text: string): string | null {
  const match = text.match(/for\s+([A-Za-z][A-Za-z\-']{1,40})/i);
  return match?.[1] || null;
}

function chunkText(text: string, chunkSize: number): string[] {
  const cleaned = text.trim();
  if (!cleaned) {
    return [];
  }

  const words = cleaned.split(/\s+/);
  const chunks: string[] = [];
  let current = '';

  words.forEach((word) => {
    const next = current.length === 0 ? word : `${current} ${word}`;
    if (next.length > chunkSize && current.length > 0) {
      chunks.push(`${current} `);
      current = word;
      return;
    }

    current = next;
  });

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveToneSentence(tone: LiveTone): string {
  switch (tone) {
    case 'formal':
      return 'Wishing you excellent health, continued success, and meaningful achievements this year.';
    case 'playful':
      return 'Hope your day is packed with laughs, cake, and zero annoying notifications.';
    case 'warm':
      return 'Wishing you a day full of joy, gratitude, and people who truly value you.';
    case 'neutral':
      return 'Wishing you a great day and a strong year ahead.';
    case 'friendly':
    default:
      return 'Wishing you an amazing day and many bright moments this year.';
  }
}

function inferOccasion(text: string): 'birthday' | 'christmas' | 'holiday' | 'congrats' | 'celebration' {
  const normalized = text.toLowerCase();
  if (normalized.includes('christmas')) {
    return 'christmas';
  }

  if (normalized.includes('holiday')) {
    return 'holiday';
  }

  if (normalized.includes('congrat')) {
    return 'congrats';
  }

  if (normalized.includes('birthday')) {
    return 'birthday';
  }

  return 'celebration';
}

function resolveGreetingLead(
  occasion: 'birthday' | 'christmas' | 'holiday' | 'congrats' | 'celebration',
  recipient: string,
): string {
  switch (occasion) {
    case 'christmas':
      return `Merry Christmas, ${recipient}!`;
    case 'holiday':
      return `Warm holiday wishes, ${recipient}!`;
    case 'congrats':
      return `Congratulations, ${recipient}!`;
    case 'celebration':
      return `Celebrating you, ${recipient}!`;
    case 'birthday':
    default:
      return `Happy Birthday, ${recipient}!`;
  }
}

function buildVisualBrief(input: {
  occasion: 'birthday' | 'christmas' | 'holiday' | 'congrats' | 'celebration';
  recipient: string;
}): string {
  switch (input.occasion) {
    case 'christmas':
      return `front-facing Christmas greeting artwork for ${input.recipient}, festive editorial illustration, pine green and gold palette, premium typography, design fills the frame, subtle ornaments, minimal background context`;
    case 'holiday':
      return `front-facing holiday greeting artwork for ${input.recipient}, elegant festive illustration, midnight blue and champagne palette, clean premium typography, design fills the frame, minimal background context`;
    case 'congrats':
      return `front-facing congratulations artwork for ${input.recipient}, celebratory editorial design, bold premium typography, refined confetti accents, warm coral and gold palette, minimal background context`;
    case 'celebration':
      return `front-facing celebration artwork for ${input.recipient}, modern editorial layout, elegant premium typography, warm luminous palette, abstract festive elements, minimal background context`;
    case 'birthday':
    default:
      return `front-facing birthday greeting artwork for ${input.recipient}, modern editorial layout, warm gold and coral palette, elegant premium typography, abstract celebratory accents, minimal background context`;
  }
}

function extractResponseText(response: unknown): string {
  const asRecord = response as { text?: unknown };
  if (typeof asRecord.text === 'string' && asRecord.text.trim().length > 0) {
    return asRecord.text.trim();
  }

  return '';
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  const fencedMatch = raw.match(/\{[\s\S]*\}/);
  const jsonText = fencedMatch ? fencedMatch[0] : raw;

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asBoundedString(value: unknown, max: number): string {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim();
  if (normalized.length < 1) {
    return '';
  }

  return normalized.slice(0, max);
}

function normalizeCardConcept(raw: string, sourceText: string): string {
  const compact = raw.replace(/\s+/g, ' ').trim();
  const looksVerbose =
    compact.length > 240 ||
    compact.includes('?') ||
    /\b(i|we)\b/i.test(compact) ||
    /\bbackground could\b/i.test(compact);

  if (!compact || looksVerbose) {
    return buildVisualBrief({
      occasion: inferOccasion(sourceText),
      recipient: extractRecipient(sourceText) || 'your teammate',
    });
  }

  const hasArtworkBias = /\b(front-facing|fills the frame|minimal background|finished greeting artwork|editorial illustration)\b/i.test(
    compact,
  );

  if (hasArtworkBias) {
    return compact;
  }

  return `${compact}, front-facing artwork, design fills the frame, minimal background context`;
}
