import type { FastifyRequest } from 'fastify';

export function resolveSessionId(request: FastifyRequest): string | null {
  const headerSessionId = request.headers['x-session-id'];
  const fromHeader = Array.isArray(headerSessionId)
    ? headerSessionId[0]
    : headerSessionId;

  if (typeof fromHeader === 'string' && fromHeader.trim().length > 0) {
    return fromHeader.trim();
  }

  const cookieSessionId = request.cookies?.cruzo_session_id;
  if (typeof cookieSessionId === 'string' && cookieSessionId.trim().length > 0) {
    return cookieSessionId.trim();
  }

  return null;
}
