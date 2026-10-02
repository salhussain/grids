import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthError, type Accounts } from '../accounts.js';
import { hashPassword, safeEqual } from '../crypto.js';
import type { IdentityConfig } from '../config.js';
import { originOf } from '../config.js';

/**
 * Service-to-service API used by the platform (the IdentityProvider port):
 * organisations and their policy, linking members, account provisioning.
 * Authenticated with a shared bearer token; never exposed to browsers.
 */
export function internalRoutes(app: FastifyInstance, deps: { accounts: Accounts; config: IdentityConfig }) {
  const { accounts, config } = deps;
  const origin = originOf(config.IDENTITY_ISSUER);

  app.register(async (scope) => {
    scope.addHook('onRequest', async (req) => {
      const header = req.headers.authorization ?? '';
      if (!safeEqual(header, `Bearer ${config.IDENTITY_SERVICE_TOKEN}`)) throw new AuthError('generic', 401);
    });

    scope.put<{ Params: { id: string } }>('/internal/orgs/:id', async (req) => {
      const body = z.object({ name: z.string().min(1), mfaRequired: z.boolean().optional(), allowRegistration: z.boolean().optional() }).parse(req.body);
      await accounts.upsertOrg(req.params.id, body.name, body);
      return { id: req.params.id };
    });

    /** Policy change for an existing organisation. */
    scope.patch<{ Params: { id: string } }>('/internal/orgs/:id', async (req) => {
      const body = z.object({ mfaRequired: z.boolean().optional(), allowRegistration: z.boolean().optional() }).parse(req.body);
      const org = await accounts.findOrg(req.params.id);
      if (!org) throw new AuthError('generic', 404);
      await accounts.upsertOrg(org.id, org.name, body);
      return { id: org.id };
    });

    scope.post<{ Params: { id: string } }>('/internal/orgs/:id/members', async (req) => {
      const { accountId } = z.object({ accountId: z.uuid() }).parse(req.body);
      if (!(await accounts.findOrg(req.params.id))) throw new AuthError('generic', 404);
      await accounts.linkToOrg(accountId, req.params.id);
      return { ok: true };
    });

    scope.get<{ Params: { id: string } }>('/internal/accounts/:id', async (req) => {
      const a = z.uuid().safeParse(req.params.id).success ? await accounts.find(req.params.id) : undefined;
      if (!a) throw new AuthError('generic', 404);
      return { id: a.id, email: a.email, emailVerified: a.email_verified, givenName: a.given_name, familyName: a.family_name, locale: a.locale, status: a.status };
    });

    scope.get<{ Params: { id: string } }>('/internal/accounts/:id/factors', async (req) => {
      const status = await accounts.totpStatus(req.params.id);
      return { methods: status.enabled ? ['totp'] : [] };
    });

    /** Creates (or finds) an account and optionally emails a set-password link. */
    scope.post('/internal/accounts', async (req) => {
      const body = z
        .object({ email: z.email(), givenName: z.string().min(1), familyName: z.string().min(1), orgId: z.string().optional(), sendSetupEmail: z.boolean().default(true), locale: z.string().optional() })
        .parse(req.body);
      let account = await accounts.findByEmail(body.email);
      if (!account) {
        account = await accounts.createInvited({ email: body.email, givenName: body.givenName, familyName: body.familyName, locale: body.locale });
      }
      if (body.orgId) await accounts.linkToOrg(account.id, body.orgId);
      if (body.sendSetupEmail && !account.password_hash) await accounts.sendPasswordLink(body.email, 'setup', origin);
      return { accountId: account.id };
    });

    scope.put<{ Params: { id: string } }>('/internal/accounts/:id/status', async (req) => {
      const { active } = z.object({ active: z.boolean() }).parse(req.body);
      await accounts.setStatus(req.params.id, active ? 'active' : 'disabled');
      return { ok: true };
    });

    // Development bootstrap only: set a password and verify the email directly.
    if (config.NODE_ENV !== 'production') {
      scope.post<{ Params: { id: string } }>('/internal/accounts/:id/dev-password', async (req) => {
        const { password } = z.object({ password: z.string().min(8) }).parse(req.body);
        await accounts.setPasswordDirect(req.params.id, await hashPassword(password));
        return { ok: true };
      });
    }
  });
}
