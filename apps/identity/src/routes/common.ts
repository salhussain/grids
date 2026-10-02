import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthError } from '../accounts.js';

/**
 * CSRF guard for browser-facing state changes: same-origin requests only, and a
 * custom header that cross-site forms cannot send.
 */
export function sameOrigin(origin: string) {
  return async (req: FastifyRequest) => {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    const o = req.headers.origin;
    if ((o && o !== origin) || req.headers['x-grids-request'] !== '1') throw new AuthError('generic', 403);
  };
}

export const ip = (req: FastifyRequest) => req.ip ?? null;

export function sendAuthError(err: unknown, reply: FastifyReply) {
  if (err instanceof AuthError) return reply.status(err.status).send({ error: err.code, vars: err.vars });
  throw err;
}
