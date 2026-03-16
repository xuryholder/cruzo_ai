import { NextResponse } from 'next/server';

function resolveBackendBaseUrl(): string {
  return process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
}

export async function callBackendJson(params: {
  path: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<NextResponse> {
  try {
    const url = new URL(params.path, resolveBackendBaseUrl());
    const response = await fetch(url, {
      method: params.method || 'GET',
      headers: {
        'content-type': 'application/json',
        ...(params.headers || {}),
      },
      body: params.body === undefined ? undefined : JSON.stringify(params.body),
      cache: 'no-store',
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : { message: await response.text() };

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        message: 'Live backend is unavailable',
        error: (error as Error).message,
      },
      { status: 503 },
    );
  }
}
