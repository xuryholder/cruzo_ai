import type { NextRequest } from 'next/server';
import { callBackendJson } from '../_utils/route-utils';

export async function POST(request: NextRequest) {
  const liveSessionId = request.headers.get('x-live-session-id') || '';

  return callBackendJson({
    path: '/v1/live/token',
    method: 'POST',
    headers: liveSessionId ? { 'x-live-session-id': liveSessionId } : undefined,
    body: {},
  });
}
