import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { InvitationPreview, MeDto, PreferencesInput, PublicBranding, ResolvedHost } from '@grids/schema';
import { actorOf, authenticate, type AuthDeps } from '../auth/plugin.js';

/** Signed-in user, invitation landing, and edge routing endpoints. */
export const publicRoutes: FastifyPluginAsyncZod<AuthDeps> = async (app, deps) => {
  const { services } = deps;
  const auth = authenticate(deps);

  app.get('/me', { preHandler: auth, schema: { response: { 200: MeDto } } }, (req) =>
    services.identity.me(actorOf(req)),
  );

  app.put(
    '/me/preferences',
    { preHandler: auth, schema: { body: PreferencesInput, response: { 200: MeDto } } },
    (req) => services.identity.setPreferences(actorOf(req), req.body),
  );

  // Sign-in page branding (read by the identity service; safe to cache briefly).
  app.get(
    '/public/branding/:tenantId',
    {
      schema: {
        params: z.object({ tenantId: z.uuid() }),
        response: { 200: PublicBranding },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'public, max-age=60');
      return services.workspace.publicBranding(req.params.tenantId);
    },
  );

  const TokenParams = z.object({ token: z.string().min(20).max(100) });
  app.get(
    '/invitations/:token',
    { schema: { params: TokenParams, response: { 200: InvitationPreview } } },
    (req) => services.members.preview(req.params.token),
  );
  app.post(
    '/invitations/:token/accept',
    { preHandler: auth, schema: { params: TokenParams, response: { 200: MeDto } } },
    (req) => services.members.accept(actorOf(req), req.params.token),
  );

  // Called by the edge proxy: Host → tenant (+ redirect to the primary domain).
  app.get(
    '/edge/resolve',
    {
      schema: {
        querystring: z.object({ host: z.string().min(1).max(253) }),
        response: { 200: ResolvedHost },
      },
    },
    (req) => services.domains.resolve(req.query.host),
  );
  // Caddy on-demand TLS `ask` endpoint: 200 = issue a certificate for this domain.
  app.get(
    '/edge/tls-allowed',
    { schema: { querystring: z.object({ domain: z.string().min(1).max(253) }) } },
    async (req, reply) =>
      reply.status((await services.domains.tlsAllowed(req.query.domain)) ? 200 : 404).send(),
  );
};
