import type { NextRequest } from 'next/server';
import { callBackendJson } from '../_utils';

export async function POST(request: NextRequest) {
  const sessionId = request.headers.get('x-session-id') || '';
  const idempotencyKey = request.headers.get('x-idempotency-key') || '';
  const body = await request.json().catch(() => ({}));

  return callBackendJson({
    path: '/v1/generations',
    method: 'POST',
    headers: {
      'x-session-id': sessionId,
      ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
    },
    body,
  });
}
