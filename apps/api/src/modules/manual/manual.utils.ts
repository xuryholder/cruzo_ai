import { BadRequestException } from '@nestjs/common';

export type ManualSortField = 'created_at' | 'updated_at';

export function normalizeEmail(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseIsoDateOnly(value: string, fieldName: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${fieldName} must be in YYYY-MM-DD format`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${fieldName} is invalid`);
  }

  return date;
}

export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dayStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function dayEndUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

export function isLeapYear(year: number): boolean {
  if (year % 400 === 0) {
    return true;
  }

  if (year % 100 === 0) {
    return false;
  }

  return year % 4 === 0;
}

type CursorPayload = {
  ts: string;
  id: string;
};

export function encodeCursor(value: { timestamp: Date; id: string }): string {
  const payload: CursorPayload = {
    ts: value.timestamp.toISOString(),
    id: value.id,
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(value: string): CursorPayload {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const payload = JSON.parse(decoded) as CursorPayload;

    if (
      !payload ||
      typeof payload.ts !== 'string' ||
      typeof payload.id !== 'string' ||
      payload.id.trim().length === 0 ||
      Number.isNaN(new Date(payload.ts).getTime())
    ) {
      throw new Error('invalid cursor');
    }

    return payload;
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

export function resolveSortField(value?: string): ManualSortField {
  if (!value || value.trim().length === 0) {
    return 'created_at';
  }

  if (value === 'created_at' || value === 'updated_at') {
    return value;
  }

  throw new BadRequestException('sort must be created_at or updated_at');
}
