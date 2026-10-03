import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ServerResponse } from 'node:http';
import QRCode from 'qrcode';
import { z } from 'zod';
import { AuthError, type Accounts } from '../accounts.js';
import type { IdentityConfig } from '../config.js';
import { originOf } from '../config.js';
import type { GridsProvider } from '../provider.js';

const Forgot = z.object({ email: z.email() });
const Reset = z.object({ token: z.string().min(20).max(100), password: z.string().min(1).max(200) });

/** Password reset/setup and account settings (the latter use the IdP session cookie). */
export function selfServiceRoutes(app: FastifyInstance, deps: { provider: GridsProvider; accounts: Accounts; config: IdentityConfig }) {
  const { provider, accounts, config } = deps;
  const origin = originOf(config.IDENTITY_ISSUER);
  const appUrl = async (accountId: string) => ((await accounts.homeApp(accountId)) === 'web' ? config.WEB_URL : config.CONSOLE_URL);

  app.post('/ui/api/password/forgot', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const { email } = Forgot.parse(req.body);
    await accounts.sendPasswordLink(email, 'reset', origin);
    return { ok: true }; // never reveal whether the account exists
  });

  app.get<{ Params: { token: string } }>('/ui/api/password/check/:token', async (req) => {
    const row = await accounts.checkPasswordToken(req.params.token);
    return { kind: row.kind, email: row.email, locale: row.locale, appUrl: await appUrl(row.account_id) };
  });

  app.post('/ui/api/password/reset', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { token, password } = Reset.parse(req.body);
    const row = await accounts.resetPassword(token, password);
    return { ok: true, kind: row.kind, appUrl: await appUrl(row.account_id) };
  });

  async function sessionAccount(req: FastifyRequest, reply: { raw: ServerResponse }) {
    const ctx = provider.createContext(req.raw, reply.raw);
    const session = await provider.Session.get(ctx);
    if (!session.accountId) throw new AuthError('session_expired', 401);
    const account = await accounts.find(session.accountId);
    if (!account || account.status !== 'active') throw new AuthError('session_expired', 401);
    return account;
  }

  app.get('/ui/api/account', async (req, reply) => {
    const a = await sessionAccount(req, reply);
    return {
      email: a.email,
      givenName: a.given_name,
      familyName: a.family_name,
      locale: a.locale,
      mfa: await accounts.totpStatus(a.id),
      mfaRequired: await accounts.mfaRequired(a.id),
    };
  });

  app.post('/ui/api/account/password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const a = await sessionAccount(req, reply);
    const body = z.object({ current: z.string().max(200), next: z.string().max(200) }).parse(req.body);
    await accounts.changePassword(a.id, body.current, body.next);
    return { ok: true };
  });

  app.post('/ui/api/account/mfa/start', async (req, reply) => {
    const a = await sessionAccount(req, reply);
    const { secret, uri } = await accounts.startTotp(a, 'Grids');
    return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
  });

  app.post('/ui/api/account/mfa/confirm', async (req, reply) => {
    const a = await sessionAccount(req, reply);
    const { code } = z.object({ code: z.string().max(20) }).parse(req.body);
    return { recoveryCodes: await accounts.confirmTotp(a.id, code) };
  });

  app.delete('/ui/api/account/mfa', async (req, reply) => {
    const a = await sessionAccount(req, reply);
    if (await accounts.mfaRequired(a.id)) throw new AuthError('mfa_required', 403);
    await accounts.disableTotp(a.id);
    return { ok: true };
  });

  app.post('/ui/api/account/recovery-codes', async (req, reply) => {
    const a = await sessionAccount(req, reply);
    if (!(await accounts.totpStatus(a.id)).enabled) throw new AuthError('generic', 400);
    return { recoveryCodes: await accounts.regenerateRecoveryCodes(a.id) };
  });
}
