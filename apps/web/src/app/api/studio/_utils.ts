import { NextResponse } from 'next/server';

function resolveBackendBaseUrl(): string {
  return (
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:4000'
  );
}

export async function callBackendJson(params: {
  path: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<NextResponse> {
  const baseUrl = resolveBackendBaseUrl();
  const url = new URL(params.path, baseUrl);

  const response = await fetch(url.toString(), {
    method: params.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(params.headers || {}),
    },
    body:
      params.body === undefined ? undefined : JSON.stringify(params.body),
    cache: 'no-store',
  });

  const contentType = response.headers.get('content-type') || '';
  const retryAfter = response.headers.get('retry-after');

  let payload: unknown = null;
  if (contentType.includes('application/json')) {
    payload = await response.json();
  } else {
    payload = { message: await response.text() };
  }

  const nextResponse = NextResponse.json(payload, {
    status: response.status,
  });

  if (retryAfter) {
    nextResponse.headers.set('retry-after', retryAfter);
  }

  return nextResponse;
}
