import type { NextRequest } from 'next/server';
import { callBackendJson } from '../_utils';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return callBackendJson({
    path: '/v1/sessions/bootstrap',
    method: 'POST',
    body,
  });
}
