import type { ServerResponse } from 'node:http';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ServerResponse } from 'node:http';
import QRCode from 'qrcode';
import { z } from 'zod';
import { AuthError, type Accounts } from '../accounts.js';
import type { Branding } from '../branding.js';
import type { IdentityConfig } from '../config.js';
import type { GridsProvider } from '../provider.js';
import { ip } from './common.js';

interface Deps {
  provider: GridsProvider;
  accounts: Accounts;
  config: IdentityConfig;
  branding: (tenantId: string | null | undefined) => Promise<Branding | null>;
}

const Login = z.object({ email: z.email(), password: z.string().min(1).max(200), remember: z.boolean().default(true) });
const Register = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
  givenName: z.string().trim().min(1).max(80),
  familyName: z.string().trim().min(1).max(80),
  locale: z.string().max(10).optional(),
});
const Code = z.object({ code: z.string().trim().max(20).optional(), recoveryCode: z.string().trim().max(20).optional() });

/**
 * The login flow behind the branded login app. All routes live under the
 * interaction URL so oidc-provider's path-scoped interaction cookie is sent.
 */
export function interactionRoutes(app: FastifyInstance, deps: Deps) {
  const { provider, accounts, config } = deps;
  async function getDetails(req: FastifyRequest, reply: { raw: ServerResponse }) {
    try {
      return await provider.interactionDetails(req.raw, reply.raw);
    } catch {
      throw new AuthError('session_expired', 410);
    }
  }

  /** Completes the interaction: login (if needed) plus an automatic first-party consent grant. */
  async function finish(req: FastifyRequest, reply: { raw: ServerResponse }, accountId: string, remember: boolean, loggedIn = true) {
    const d = await getDetails(req, reply);
    let grant = d.grantId ? await provider.Grant.find(d.grantId) : undefined;
    grant ??= new provider.Grant({ accountId, clientId: String(d.params.client_id) });
    const scope = String(d.params.scope ?? 'openid');
    grant.addOIDCScope(scope);
    grant.addResourceScope(config.API_AUDIENCE, 'api');
    const grantId = await grant.save();
    const result = loggedIn ? { login: { accountId, remember }, consent: { grantId } } : { consent: { grantId } };
    const redirectTo = await provider.interactionResult(req.raw, reply.raw, result, { mergeWithLastSubmission: true });
    await accounts.clearPending(d.uid);
    if (loggedIn) await accounts.markLoggedIn(accountId, ip(req));
    return { redirectTo };
  }

  /** After password (and email verification): second factor, forced setup, or done. */
  async function afterPrimary(req: FastifyRequest, reply: { raw: ServerResponse }, accountId: string, remember: boolean) {
    const d = await getDetails(req, reply);
    const status = await accounts.totpStatus(accountId);
    if (status.enabled) {
      await accounts.setPending(d.uid, accountId, 'mfa', remember);
      return { step: 'mfa' as const };
    }
    const orgId = d.params.organization ? String(d.params.organization) : null;
    const org = orgId ? await accounts.findOrg(orgId) : undefined;
    if (org?.mfa_required || (await accounts.mfaRequired(accountId))) {
      await accounts.setPending(d.uid, accountId, 'mfa_setup', remember);
      return { step: 'mfa-setup' as const };
    }
    return finish(req, reply, accountId, remember);
  }

  app.get<{ Params: { uid: string } }>('/ui/interaction/:uid/details', async (req, reply) => {
    const d = await getDetails(req, reply);
    if (d.uid !== req.params.uid) throw new AuthError('session_expired', 410);
    const client = await provider.Client.find(String(d.params.client_id));
    const orgId = d.params.organization ? String(d.params.organization) : null;
    const [branding, org] = await Promise.all([deps.branding(orgId), orgId ? accounts.findOrg(orgId) : undefined]);

    // Already signed in: only consent is pending → grant it for our first-party apps.
    if (d.prompt.name === 'consent' && d.session?.accountId) {
      return finish(req, reply, d.session.accountId, true, false);
    }
    const pending = await accounts.getPending(d.uid).catch(() => null);
    const pendingAccount = pending ? await accounts.find(pending.account_id) : null;
    return {
      uid: d.uid,
      prompt: d.prompt.name,
      client: { id: client?.clientId ?? '', name: (client?.metadata().client_name as string | undefined) ?? 'Grids' },
      organization: branding,
      loginHint: d.params.login_hint ?? null,
      uiLocales: d.params.ui_locales ?? null,
      // Self-registration only into an organisation that allows it (e.g. invited members).
      registrationAllowed: !!org?.allow_registration,
      pending: pending ? { stage: pending.stage, email: pendingAccount?.email ?? null } : null,
    };
  });

  app.post<{ Params: { uid: string } }>('/ui/interaction/:uid/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = Login.parse(req.body);
    const account = await accounts.authenticate(body.email, body.password, ip(req));
    if (!account.email_verified) {
      await accounts.sendVerificationCode(account);
      const d = await getDetails(req, reply);
      await accounts.setPending(d.uid, account.id, 'verify_email', body.remember);
      return { step: 'verify', email: account.email };
    }
    return afterPrimary(req, reply, account.id, body.remember);
  });

  app.post<{ Params: { uid: string } }>('/ui/interaction/:uid/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = Register.parse(req.body);
    const d = await getDetails(req, reply);
    const orgId = d.params.organization ? String(d.params.organization) : null;
    const org = orgId ? await accounts.findOrg(orgId) : undefined;
    if (!org?.allow_registration) throw new AuthError('registration_closed', 403);
    const account = await accounts.register({ ...body, orgId });
    await accounts.event(account.id, account.email, ip(req), 'register', true);
    await accounts.sendVerificationCode(account);
    await accounts.setPending(d.uid, account.id, 'verify_email', true);
    return { step: 'verify', email: account.email };
  });

  app.post<{ Params: { uid: string } }>('/ui/interaction/:uid/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { code } = Code.parse(req.body);
    const pending = await accounts.getPending(req.params.uid);
    if (pending.stage !== 'verify_email') throw new AuthError('session_expired', 410);
    await accounts.verifyEmail(pending.account_id, code ?? '');
    return afterPrimary(req, reply, pending.account_id, pending.remember);
  });

  app.post<{ Params: { uid: string } }>('/ui/interaction/:uid/verify/resend', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (req) => {
    const pending = await accounts.getPending(req.params.uid);
    const account = await accounts.find(pending.account_id);
    if (pending.stage !== 'verify_email' || !account) throw new AuthError('session_expired', 410);
    await accounts.sendVerificationCode(account);
    return { ok: true };
  });

  app.post<{ Params: { uid: string } }>('/ui/interaction/:uid/mfa', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = Code.parse(req.body);
    const pending = await accounts.getPending(req.params.uid);
    if (pending.stage !== 'mfa') throw new AuthError('session_expired', 410);
    await accounts.checkSecondFactor(pending.account_id, body);
    return finish(req, reply, pending.account_id, pending.remember);
  });

  app.post<{ Params: { uid: string } }>('/ui/interaction/:uid/mfa-setup/start', async (req) => {
    const pending = await accounts.getPending(req.params.uid);
    const account = await accounts.find(pending.account_id);
    if (pending.stage !== 'mfa_setup' || !account) throw new AuthError('session_expired', 410);
    const { secret, uri } = await accounts.startTotp(account, 'Grids');
    return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
  });

  app.post<{ Params: { uid: string } }>('/ui/interaction/:uid/mfa-setup/confirm', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { code } = Code.parse(req.body);
    const pending = await accounts.getPending(req.params.uid);
    if (pending.stage !== 'mfa_setup') throw new AuthError('session_expired', 410);
    const recoveryCodes = await accounts.confirmTotp(pending.account_id, code ?? '');
    const { redirectTo } = await finish(req, reply, pending.account_id, pending.remember);
    return { recoveryCodes, redirectTo };
  });

  app.post<{ Params: { uid: string } }>('/ui/interaction/:uid/abort', async (req, reply) => {
    const redirectTo = await provider.interactionResult(req.raw, reply.raw, { error: 'access_denied', error_description: 'Sign-in cancelled' }, { mergeWithLastSubmission: false });
    return { redirectTo };
  });
}
