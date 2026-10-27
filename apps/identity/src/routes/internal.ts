import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthError, type Accounts } from '../accounts.js';
import { hashPassword, safeEqual } from '../crypto.js';
import type { IdentityConfig } from '../config.js';
import { originOf } from '../config.js';
import { sql, type Kysely } from 'kysely';
import type { IdentityDB } from '@grids/db';
import { ClientInput, ClientPatch, MAX_CLIENTS_PER_ORG, clientDto, newClientId, newClientSecret } from '../clients.js';
import type { Sealer } from '../crypto.js';

/**
 * Service-to-service API used by the platform (the IdentityProvider port):
 * organisations and their policy, linking members, account provisioning.
 * Authenticated with a shared bearer token; never exposed to browsers.
 */
export function internalRoutes(app: FastifyInstance, deps: { accounts: Accounts; config: IdentityConfig; db: Kysely<IdentityDB>; seal: Sealer }) {
  const { accounts, config, db, seal } = deps;
  const origin = originOf(config.IDENTITY_ISSUER);

  app.register(async (scope) => {
    scope.addHook('onRequest', async (req) => {
      const header = req.headers.authorization ?? '';
      if (!safeEqual(header, `Bearer ${config.IDENTITY_SERVICE_TOKEN}`)) throw new AuthError('generic', 401);
    });

    scope.put<{ Params: { id: string } }>('/internal/orgs/:id', async (req) => {
      const body = z.object({ name: z.string().min(1), mfaRequired: z.boolean().optional(), allowRegistration: z.boolean().optional(), blocked: z.boolean().optional() }).parse(req.body);
      await accounts.upsertOrg(req.params.id, body.name, body);
      return { id: req.params.id };
    });

    /** Policy change for an existing organisation. */
    scope.patch<{ Params: { id: string } }>('/internal/orgs/:id', async (req) => {
      const body = z.object({ mfaRequired: z.boolean().optional(), allowRegistration: z.boolean().optional(), blocked: z.boolean().optional() }).parse(req.body);
      const org = await accounts.findOrg(req.params.id);
      if (!org) throw new AuthError('generic', 404);
      await accounts.upsertOrg(org.id, org.name, body);
      return { id: org.id };
    });

    // ----- who is signed in -----
    /** Sign-ins that are still running for the organisation's people, newest first. */
    scope.get<{ Params: { id: string } }>('/internal/orgs/:id/sessions', async (req) => {
      const rows = await sql<{ id: string; account_id: string; email: string; given_name: string | null; family_name: string | null; login_ts: string | null; expires_at: Date | null }>`
        select * from (
          -- A renewed session leaves its older copies behind (same uid): each sign-in is listed once, by its latest copy.
          select distinct on (m.uid) m.id, a.id as account_id, a.email, a.given_name, a.family_name,
                 m.payload->>'loginTs' as login_ts, m.expires_at
          from oidc_model m
          join account a on a.id::text = m.payload->>'accountId'
          join account_org ao on ao.account_id = a.id and ao.org_id = ${req.params.id}
          where m.kind = 'Session' and (m.expires_at is null or m.expires_at > now())
          order by m.uid, m.expires_at desc nulls first
        ) s
        order by s.expires_at desc nulls first
        limit 500`.execute(db);
      return {
        sessions: rows.rows.map((r) => ({
          id: r.id,
          accountId: r.account_id,
          email: r.email,
          givenName: r.given_name,
          familyName: r.family_name,
          signedInAt: r.login_ts ? new Date(Number(r.login_ts) * 1000).toISOString() : null,
          expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
        })),
      };
    });

    /** Sign-ins that are over (ended, signed out or expired), and failed attempts, for the organisation's people: the last 90 days. */
    scope.get<{ Params: { id: string } }>('/internal/orgs/:id/past-sessions', async (req) => {
      const rows = await sql<{ id: string; account_id: string | null; email: string | null; given_name: string | null; family_name: string | null; at: Date; ip: string | null; success: boolean }>`
        select le.id, a.id as account_id, coalesce(a.email, le.email) as email, a.given_name, a.family_name, le.at, le.ip, le.success
        from login_event le
        join account a on a.id = le.account_id or (le.account_id is null and a.email = le.email)
        join account_org ao on ao.account_id = a.id and ao.org_id = ${req.params.id}
        where le.event = 'login' and le.at > now() - interval '90 days'
          -- a sign-in that is still running is listed as active, not here
          and not exists (
            select 1 from oidc_model m
            where m.kind = 'Session' and m.payload->>'accountId' = a.id::text
              and (m.expires_at is null or m.expires_at > now())
              and abs(extract(epoch from le.at) - (m.payload->>'loginTs')::numeric) < 5
          )
        order by le.at desc
        limit 500`.execute(db);
      return {
        sessions: rows.rows.map((r) => ({
          id: r.id,
          email: r.email ?? '',
          givenName: r.given_name,
          familyName: r.family_name,
          at: r.at.toISOString(),
          ip: r.ip,
          success: r.success,
        })),
      };
    });

    /** Ends one sign-in: its session and the refresh tokens issued under it (access tokens run out within minutes). */
    scope.delete<{ Params: { id: string; sessionId: string } }>('/internal/orgs/:id/sessions/:sessionId', async (req) => {
      const found = await sql<{ uid: string | null }>`
        select m.uid from oidc_model m
        join account_org ao on ao.account_id::text = m.payload->>'accountId' and ao.org_id = ${req.params.id}
        where m.kind = 'Session' and m.id = ${req.params.sessionId}`.execute(db);
      const row = found.rows[0];
      if (!row) throw new AuthError('generic', 404);
      if (row.uid) await sql`delete from oidc_model where kind = 'RefreshToken' and payload->>'sessionUid' = ${row.uid}`.execute(db);
      // Every copy of the session goes, or an older one would bring the sign-in back.
      if (row.uid) await sql`delete from oidc_model where kind = 'Session' and uid = ${row.uid}`.execute(db);
      await sql`delete from oidc_model where kind = 'Session' and id = ${req.params.sessionId}`.execute(db);
      return { ok: true };
    });

    // ----- applications an organisation registers to sign its people in -----
    const orgClient = async (orgId: string, clientId: string) => {
      const row = await db.selectFrom('org_client').selectAll().where('org_id', '=', orgId).where('client_id', '=', clientId).executeTakeFirst();
      if (!row) throw new AuthError('generic', 404);
      return row;
    };

    scope.get<{ Params: { id: string } }>('/internal/orgs/:id/clients', async (req) => {
      const rows = await db.selectFrom('org_client').selectAll().where('org_id', '=', req.params.id).orderBy('created_at').execute();
      return { issuer: config.IDENTITY_ISSUER, clients: rows.map(clientDto) };
    });

    scope.post<{ Params: { id: string } }>('/internal/orgs/:id/clients', async (req) => {
      const body = ClientInput.parse(req.body);
      if (!(await accounts.findOrg(req.params.id))) throw new AuthError('generic', 404);
      const count = await db.selectFrom('org_client').select(db.fn.countAll<string>().as('n')).where('org_id', '=', req.params.id).executeTakeFirstOrThrow();
      if (Number(count.n) >= MAX_CLIENTS_PER_ORG) throw new AuthError('too_many_clients', 409);
      const secret = body.confidential ? newClientSecret() : null;
      const row = await db
        .insertInto('org_client')
        .values({
          client_id: newClientId(),
          org_id: req.params.id,
          name: body.name,
          secret_enc: secret ? seal.seal(secret) : null,
          redirect_uris: JSON.stringify(body.redirectUris) as never,
          post_logout_redirect_uris: JSON.stringify(body.postLogoutRedirectUris) as never,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { ...clientDto(row), clientSecret: secret };
    });

    scope.patch<{ Params: { id: string; clientId: string } }>('/internal/orgs/:id/clients/:clientId', async (req) => {
      const body = ClientPatch.parse(req.body);
      await orgClient(req.params.id, req.params.clientId);
      const row = await db
        .updateTable('org_client')
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.redirectUris && { redirect_uris: JSON.stringify(body.redirectUris) as never }),
          ...(body.postLogoutRedirectUris && { post_logout_redirect_uris: JSON.stringify(body.postLogoutRedirectUris) as never }),
          ...(body.disabled !== undefined && { disabled: body.disabled }),
        })
        .where('client_id', '=', req.params.clientId)
        .returningAll()
        .executeTakeFirstOrThrow();
      return clientDto(row);
    });

    /** A new secret for a server-side application; the old one stops working at once. */
    scope.post<{ Params: { id: string; clientId: string } }>('/internal/orgs/:id/clients/:clientId/secret', async (req) => {
      const existing = await orgClient(req.params.id, req.params.clientId);
      if (!existing.secret_enc) throw new AuthError('public_client', 400);
      const secret = newClientSecret();
      const row = await db.updateTable('org_client').set({ secret_enc: seal.seal(secret) }).where('client_id', '=', req.params.clientId).returningAll().executeTakeFirstOrThrow();
      return { ...clientDto(row), clientSecret: secret };
    });

    scope.delete<{ Params: { id: string; clientId: string } }>('/internal/orgs/:id/clients/:clientId', async (req) => {
      await orgClient(req.params.id, req.params.clientId);
      await db.deleteFrom('org_client').where('client_id', '=', req.params.clientId).execute();
      return { ok: true };
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
