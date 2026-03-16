import type { NextRequest } from 'next/server';
import { callBackendJson } from '../_utils/route-utils';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const sessionId = request.headers.get('x-live-session-id') || '';

  return callBackendJson({
    path: '/v1/live/turn',
    method: 'POST',
    headers: sessionId ? { 'x-live-session-id': sessionId } : undefined,
    body,
  });
}
