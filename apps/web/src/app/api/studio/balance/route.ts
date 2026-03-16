import type { NextRequest } from 'next/server';
import { callBackendJson } from '../_utils';

export async function GET(request: NextRequest) {
  const sessionId = request.headers.get('x-session-id') || '';

  return callBackendJson({
    path: '/v1/credits/balance',
    method: 'GET',
    headers: {
      'x-session-id': sessionId,
    },
  });
}
