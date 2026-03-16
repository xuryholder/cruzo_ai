import { NextResponse } from 'next/server';

function resolveBackendBaseUrl(): string {
  return (
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:4000'
  );
}

export async function forwardManualRequest(params: {
  request: Request;
  backendPathWithQuery: string;
}): Promise<NextResponse> {
  const baseUrl = resolveBackendBaseUrl();
  const url = new URL(params.backendPathWithQuery, baseUrl);
  const method = params.request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const rawBody = hasBody ? await params.request.text() : '';

  const idempotencyKey = params.request.headers.get('x-idempotency-key');
  const incomingContentType = params.request.headers.get('content-type');

  const response = await fetch(url.toString(), {
    method,
    headers: {
      ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
      ...(rawBody.length > 0
        ? { 'content-type': incomingContentType || 'application/json' }
        : {}),
    },
    body: rawBody.length > 0 ? rawBody : undefined,
    cache: 'no-store',
  });

  const contentType = response.headers.get('content-type') || '';
  const retryAfter = response.headers.get('retry-after');
  const text = await response.text();

  let payload: unknown = null;
  if (text.length > 0) {
    if (contentType.includes('application/json')) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
    } else {
      payload = { message: text };
    }
  }

  const nextResponse = isBodyForbiddenStatus(response.status)
    ? new NextResponse(null, { status: response.status })
    : NextResponse.json(payload, {
        status: response.status,
      });

  if (retryAfter) {
    nextResponse.headers.set('retry-after', retryAfter);
  }

  return nextResponse;
}

function isBodyForbiddenStatus(status: number): boolean {
  return status === 204 || status === 205 || status === 304;
}
