export const RELATIONSHIPS = [
  'family',
  'friend',
  'colleague',
  'client',
  'partner',
  'acquaintance',
  'other',
] as const;

export const TONES = ['formal', 'semi_formal', 'friendly', 'warm', 'playful', 'neutral'] as const;

export const SOURCES = [
  'manual_test',
  'manual',
  'google_contacts',
  'google_calendar',
  'gmail_parse',
  'linkedin_extension',
  'facebook_extension',
  'import_csv',
] as const;

export const DRAFT_STATUSES = ['draft', 'approved', 'sent', 'failed'] as const;

export const CHANNELS = ['email', 'telegram', 'whatsapp', 'instagram', 'facebook', 'manual'] as const;

export type ContactRelationship = (typeof RELATIONSHIPS)[number];
export type ContactTone = (typeof TONES)[number];
export type ContactSource = (typeof SOURCES)[number];
export type MessageDraftStatus = (typeof DRAFT_STATUSES)[number];
export type MessageChannel = (typeof CHANNELS)[number];

export type ContactItem = {
  id: string;
  name: string | null;
  email: string | null;
  birthdayDate: string;
  relationship: ContactRelationship;
  tone: ContactTone;
  source: ContactSource;
  createdAt: string;
  updatedAt: string;
};

export type MessageDraftItem = {
  id: string;
  contactId: string;
  subject: string;
  text: string;
  status: MessageDraftStatus;
  channel: MessageChannel | null;
  language: string;
  tone: ContactTone;
  maxWords: number;
  createdAt: string;
  updatedAt: string;
};

export type MessageLogItem = {
  id: string;
  action: string;
  status: string;
  channel: MessageChannel | null;
  externalMessageId: string | null;
  error: string | null;
  notes: string | null;
  timestamp: string;
};

export type ListResult<T> = {
  items: T[];
  nextCursor: string | null;
};

export type ApiResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  errorMessage: string | null;
};

export async function apiRequest<T>(
  path: string,
  options?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<ApiResult<T>> {
  const method = options?.method || 'GET';
  const hasBody = options?.body !== undefined;

  const response = await fetch(path, {
    method,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(options?.headers || {}),
    },
    body: hasBody ? JSON.stringify(options?.body) : undefined,
    cache: 'no-store',
  });

  const text = await response.text();
  const payload = parseUnknown(text);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: null,
      errorMessage: extractErrorMessage(payload, text, response.status),
    };
  }

  return {
    ok: true,
    status: response.status,
    data: (payload as T) || null,
    errorMessage: null,
  };
}

export function labelEnum(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createIdempotencyKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseUnknown(text: string): unknown {
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractErrorMessage(payload: unknown, rawText: string, status: number): string {
  if (typeof payload === 'object' && payload !== null) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }

    if (Array.isArray(message) && message.length > 0) {
      return message.map((item) => String(item)).join(', ');
    }

    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim().length > 0) {
      return error;
    }
  }

  if (rawText.trim().length > 0) {
    return rawText;
  }

  return `Request failed with status ${status}`;
}
