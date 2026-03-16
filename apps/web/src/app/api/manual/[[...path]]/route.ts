import type { NextRequest } from 'next/server';
import { forwardManualRequest } from '../_utils';

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

async function handle(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  const suffix = path.join('/');
  const query = request.nextUrl.search || '';
  const backendPathWithQuery = suffix.length > 0
    ? `/v1/manual/${suffix}${query}`
    : `/v1/manual${query}`;

  return forwardManualRequest({
    request,
    backendPathWithQuery,
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}
