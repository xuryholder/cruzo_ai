import type { NextRequest } from 'next/server';
import { callBackendJson } from '../../_utils';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ generationId: string }> },
) {
  const sessionId = request.headers.get('x-session-id') || '';
  const { generationId } = await context.params;

  return callBackendJson({
    path: `/v1/generations/${generationId}`,
    method: 'GET',
    headers: {
      'x-session-id': sessionId,
    },
  });
}
