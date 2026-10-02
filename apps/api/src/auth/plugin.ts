import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from '../errors.js';
import type { IdentityProvider } from '../idp/types.js';
import type { StaffPermission } from '@grids/schema';
import { requireStaff } from '../services/authz.js';
import type { Actor, Services } from '../services/index.js';
import type { TokenVerifier } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

export interface AuthDeps {
  verifier: TokenVerifier;
  idp: IdentityProvider;
  services: Services;
}

/** preHandler that requires a valid bearer token and attaches `request.actor`. */
export function authenticate(deps: AuthDeps) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('Missing bearer token');
    const token = header.slice('Bearer '.length);
    const { subject } = await deps.verifier.verify(token);
    req.actor = await deps.services.identity.resolve(subject, () => deps.idp.getUserProfile(subject));
  };
}

/** preHandler: active platform staff holding `permission`. */
export function need(permission: StaffPermission) {
  return async (req: FastifyRequest) => requireStaff(actorOf(req), permission);
}

export async function requireStaffHook(req: FastifyRequest) {
  if (!actorOf(req).isPlatformAdmin) throw forbidden('Platform staff only.');
}

export function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw unauthorized();
  return req.actor;
}
