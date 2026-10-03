import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createDb, type IdentityDB } from '@grids/db';
import { startTestDatabases, type TestDatabases } from '@grids/db/testing';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Kysely } from 'kysely';
import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIdentityApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Mailer } from '../src/mailer.js';

// Real OIDC authorization-code + PKCE flows over HTTP against real Postgres.

const sent: { to: string; template: string; vars: Record<string, string> }[] = [];
const mailer: Mailer = { async send(a, template, vars) { sent.push({ to: a.email, template, vars }); } };
const lastMail = (to: string, template: string) => [...sent].reverse().find((m) => m.to === to && m.template === template)!;

let dbs: TestDatabases;
let db: Kysely<IdentityDB>;
let base: string;
let close: () => Promise<void>;
const SERVICE = 'test-service-token-0123456789';

beforeAll(async () => {
  dbs = await startTestDatabases();
  db = createDb<IdentityDB>(dbs.identityAppUrl);
  // Bind first to learn the port, then build the issuer from it.
  const net = await import('node:net');
  const port = await new Promise<number>((r) => {
    const s = net.createServer().listen(0, () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => r(p));
    });
  });
  base = `http://127.0.0.1:${port}`;
  const config = loadConfig({
    IDENTITY_ISSUER: `${base}/oidc`,
    DATABASE_URL_IDENTITY_APP: dbs.identityAppUrl,
    IDENTITY_SERVICE_TOKEN: SERVICE,
    IDENTITY_SECRET_KEY: 'test-secret-key-0123456789abcdef',
    IDENTITY_COOKIE_KEY: 'test-cookie-key-0123456789',
    CONSOLE_URL: 'http://console.test',
    WEB_URL: 'http://web.test',
    LOGIN_DIST: '/nonexistent',
  });
  const built = await buildIdentityApp({ config, db, mailer, branding: async () => null });
  await built.app.listen({ port, host: '127.0.0.1' });
  close = () => built.app.close();
}, 180_000);

afterAll(async () => {
  await close?.();
  await db?.destroy();
  await dbs?.stop();
});

/** Minimal browser: cookie jar + manual redirects. */
class Browser {
  jar = new Map<string, string>();
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers as Record<string, string>), cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, ...v] = pair!.split('=');
      if (/expires=Thu, 01 Jan 1970/i.test(c)) this.jar.delete(k!);
      else this.jar.set(k!, v.join('='));
    }
    return res;
  }
  json(url: string, body: unknown, method = 'POST') {
    return this.fetch(url, { method, headers: { 'content-type': 'application/json', origin: base, 'x-grids-request': '1' }, body: JSON.stringify(body) });
  }
}

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

/** Starts an authorization request; returns the interaction uid. */
async function startAuth(b: Browser, extra: Record<string, string> = {}) {
  const p = pkce();
  const params = new URLSearchParams({
    client_id: 'grids-web',
    response_type: 'code',
    redirect_uri: 'http://web.test/auth/callback',
    scope: 'openid email profile offline_access',
    prompt: 'consent',
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    ...extra,
  });
  const res = await b.fetch(`${base}/oidc/auth?${params}`);
  expect(res.status).toBe(303);
  const loc = res.headers.get('location')!;
  const m = loc.match(/\/ui\/interaction\/([\w-]+)/);
  if (!m) throw new Error(`unexpected auth redirect: ${loc}`);
  return { uid: m[1]!, verifier: p.verifier };
}

/** Follows the redirect chain after an interaction result back to the client's code. */
async function codeFrom(b: Browser, redirectTo: string): Promise<string> {
  let url = redirectTo;
  for (let i = 0; i < 6; i++) {
    const res = await b.fetch(url);
    const loc = res.headers.get('location');
    if (!loc) throw new Error(`no redirect from ${url}: ${res.status} ${await res.text()}`);
    if (loc.startsWith('http://web.test/auth/callback')) return new URL(loc).searchParams.get('code')!;
    if (loc.includes('/ui/interaction/')) {
      // e.g. consent prompt for an existing session: the login app auto-grants it
      const uid = loc.match(/\/ui\/interaction\/([\w-]+)/)![1]!;
      const d = (await (await b.fetch(`${base}/ui/interaction/${uid}/details`)).json()) as { redirectTo?: string };
      url = d.redirectTo!;
      continue;
    }
    url = new URL(loc, base).toString();
  }
  throw new Error('too many redirects');
}

async function exchange(code: string, verifier: string) {
  const res = await fetch(`${base}/oidc/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://web.test/auth/callback', client_id: 'grids-web', code_verifier: verifier }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { access_token: string; refresh_token?: string; id_token: string };
}

const internal = (path: string, body?: unknown, method = 'POST') =>
  fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

async function createAccount(email: string, password = 'correct horse battery') {
  const res = await internal('/internal/accounts', { email, givenName: 'Test', familyName: 'User', sendSetupEmail: false });
  const { accountId } = (await res.json()) as { accountId: string };
  await internal(`/internal/accounts/${accountId}/dev-password`, { password });
  return accountId;
}

describe('sign in (authorization code + PKCE)', () => {
  it('issues a JWT access token for the API audience and a refresh token', async () => {
    const accountId = await createAccount('ana@example.org');
    const b = new Browser();
    const { uid, verifier } = await startAuth(b);

    const details = await (await b.fetch(`${base}/ui/interaction/${uid}/details`)).json();
    expect(details).toMatchObject({ prompt: 'login', client: { id: 'grids-web', name: 'Grids Workspace' }, registrationAllowed: false });

    const login = await b.json(`${base}/ui/interaction/${uid}/login`, { email: 'ana@example.org', password: 'correct horse battery', remember: true });
    const { redirectTo } = (await login.json()) as { redirectTo: string };
    const tokens = await exchange(await codeFrom(b, redirectTo), verifier);

    const jwks = createRemoteJWKSet(new URL(`${base}/oidc/jwks`));
    const { payload } = await jwtVerify(tokens.access_token, jwks, { issuer: `${base}/oidc`, audience: 'urn:grids:api' });
    expect(payload.sub).toBe(accountId);
    expect(tokens.refresh_token).toBeTruthy();

    const userinfo = await (await fetch(`${base}/oidc/me`, { headers: { authorization: `Bearer ${tokens.access_token}` } })).json().catch(() => null);
    void userinfo; // userinfo requires an opaque/OIDC token; the API reads identity from the JWT `sub`

    // Refresh token rotation
    const refreshed = await fetch(`${base}/oidc/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: 'grids-web' }),
    });
    expect(refreshed.status).toBe(200);

    // A second authorization with the existing session skips the password (auto consent)
    const second = await startAuth(b);
    const d2 = (await (await b.fetch(`${base}/ui/interaction/${second.uid}/details`)).json()) as { redirectTo?: string };
    expect(d2.redirectTo).toBeTruthy();
    await exchange(await codeFrom(b, d2.redirectTo!), second.verifier);
  });

  it('signing out ends the identity session (no silent sign-in afterwards)', async () => {
    await createAccount('out@example.org');
    const b = new Browser();
    const { uid, verifier } = await startAuth(b);
    const login = (await (await b.json(`${base}/ui/interaction/${uid}/login`, { email: 'out@example.org', password: 'correct horse battery' })).json()) as { redirectTo: string };
    const tokens = await exchange(await codeFrom(b, login.redirectTo), verifier);

    // RP-initiated logout renders an auto-submitting form; submit it like the browser would.
    const end = await b.fetch(
      `${base}/oidc/session/end?${new URLSearchParams({ id_token_hint: tokens.id_token, post_logout_redirect_uri: 'http://web.test/', client_id: 'grids-web' })}`,
    );
    const html = await end.text();
    const action = html.match(/<form[^>]*action="([^"]+)"/)![1]!;
    const fields = Object.fromEntries([...html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
    expect(fields.logout).toBe('yes');
    const done = await b.fetch(new URL(action, base).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    expect(done.headers.get('location')).toBe('http://web.test/');

    // The next authorization must ask for credentials again.
    const again = await startAuth(b);
    const d = (await (await b.fetch(`${base}/ui/interaction/${again.uid}/details`)).json()) as { prompt: string; redirectTo?: string };
    expect(d.redirectTo).toBeUndefined();
    expect(d.prompt).toBe('login');
  });

  it('rejects wrong passwords and locks after repeated failures', async () => {
    await createAccount('lock@example.org');
    const b = new Browser();
    const { uid } = await startAuth(b);
    for (let i = 0; i < 4; i++) {
      const r = await b.json(`${base}/ui/interaction/${uid}/login`, { email: 'lock@example.org', password: 'wrong password!' });
      expect(r.status).toBe(401);
      expect(await r.json()).toMatchObject({ error: 'invalid_credentials' });
    }
    const fifth = await b.json(`${base}/ui/interaction/${uid}/login`, { email: 'lock@example.org', password: 'wrong password!' });
    expect(fifth.status).toBe(423);
    const right = await b.json(`${base}/ui/interaction/${uid}/login`, { email: 'lock@example.org', password: 'correct horse battery' });
    expect(right.status).toBe(423); // still locked
    const unknown = await b.json(`${base}/ui/interaction/${uid}/login`, { email: 'nobody@example.org', password: 'whatever12345' });
    expect(await unknown.json()).toMatchObject({ error: 'invalid_credentials' }); // no account enumeration
  });

  it('blocks cross-site requests to the login API', async () => {
    const b = new Browser();
    const { uid } = await startAuth(b);
    const res = await b.fetch(`${base}/ui/interaction/${uid}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.test', 'x-grids-request': '1' },
      body: JSON.stringify({ email: 'ana@example.org', password: 'x' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('registration into an organisation, email verification and enforced 2FA', () => {
  it('registers, verifies the email, forces 2FA setup, then requires the code', async () => {
    await internal('/internal/orgs/tenant-1', { name: 'Atoll Health', mfaRequired: true }, 'PUT');
    const b = new Browser();
    const { uid, verifier } = await startAuth(b, { organization: 'tenant-1' });
    expect(((await (await b.fetch(`${base}/ui/interaction/${uid}/details`)).json()) as any).registrationAllowed).toBe(true);

    const weak = await b.json(`${base}/ui/interaction/${uid}/register`, { email: 'new@atoll.org', password: 'short', givenName: 'New', familyName: 'Person' });
    expect(await weak.json()).toMatchObject({ error: 'password_too_short' });

    const reg = await b.json(`${base}/ui/interaction/${uid}/register`, { email: 'new@atoll.org', password: 'atoll lagoon sunrise', givenName: 'New', familyName: 'Person' });
    expect(await reg.json()).toMatchObject({ step: 'verify', email: 'new@atoll.org' });
    expect((await b.json(`${base}/ui/interaction/${uid}/verify`, { code: '000000' })).status).toBe(400);
    const verified = await b.json(`${base}/ui/interaction/${uid}/verify`, { code: lastMail('new@atoll.org', 'verify').vars.code });
    expect(await verified.json()).toMatchObject({ step: 'mfa-setup' });

    const setup = (await (await b.json(`${base}/ui/interaction/${uid}/mfa-setup/start`, {})).json()) as { secret: string; qr: string };
    expect(setup.qr).toMatch(/^data:image\/png;base64,/);
    expect((await b.json(`${base}/ui/interaction/${uid}/mfa-setup/confirm`, { code: '123456' })).status).toBe(400);
    const confirmed = (await (await b.json(`${base}/ui/interaction/${uid}/mfa-setup/confirm`, { code: authenticator.generate(setup.secret) })).json()) as {
      recoveryCodes: string[];
      redirectTo: string;
    };
    expect(confirmed.recoveryCodes).toHaveLength(10);
    await exchange(await codeFrom(b, confirmed.redirectTo), verifier);

    // Next sign-in (new browser) asks for the code; a recovery code works once.
    const b2 = new Browser();
    const second = await startAuth(b2, { organization: 'tenant-1' });
    const login = await b2.json(`${base}/ui/interaction/${second.uid}/login`, { email: 'new@atoll.org', password: 'atoll lagoon sunrise' });
    expect(await login.json()).toMatchObject({ step: 'mfa' });
    const rc = confirmed.recoveryCodes[0]!;
    const ok = (await (await b2.json(`${base}/ui/interaction/${second.uid}/mfa`, { recoveryCode: rc })).json()) as { redirectTo: string };
    await exchange(await codeFrom(b2, ok.redirectTo), second.verifier);

    const b3 = new Browser();
    const third = await startAuth(b3);
    await b3.json(`${base}/ui/interaction/${third.uid}/login`, { email: 'new@atoll.org', password: 'atoll lagoon sunrise' });
    expect((await b3.json(`${base}/ui/interaction/${third.uid}/mfa`, { recoveryCode: rc })).status).toBe(400); // used
  });

  it('refuses self-registration where the organisation does not allow it', async () => {
    await internal('/internal/orgs/closed', { name: 'Closed Co', allowRegistration: false }, 'PUT');
    const b = new Browser();
    const { uid } = await startAuth(b, { organization: 'closed' });
    const res = await b.json(`${base}/ui/interaction/${uid}/register`, { email: 'x@closed.org', password: 'long enough password', givenName: 'X', familyName: 'Y' });
    expect(res.status).toBe(403);
  });
});

describe('password reset and account setup', () => {
  it('resets a password with an emailed link (single use)', async () => {
    await createAccount('reset@example.org');
    const b = new Browser();
    expect((await b.json(`${base}/ui/api/password/forgot`, { email: 'reset@example.org' })).status).toBe(200);
    expect((await b.json(`${base}/ui/api/password/forgot`, { email: 'ghost@example.org' })).status).toBe(200); // no enumeration
    const token = lastMail('reset@example.org', 'reset').vars.link!.split('/').pop()!;
    expect(await (await b.fetch(`${base}/ui/api/password/check/${token}`)).json()).toMatchObject({ kind: 'reset', appUrl: 'http://console.test' });
    expect((await b.json(`${base}/ui/api/password/reset`, { token, password: 'a brand new passphrase' })).status).toBe(200);
    expect((await b.json(`${base}/ui/api/password/reset`, { token, password: 'another passphrase!!' })).status).toBe(404);

    const { uid } = await startAuth(b);
    const login = await b.json(`${base}/ui/interaction/${uid}/login`, { email: 'reset@example.org', password: 'a brand new passphrase' });
    expect(((await login.json()) as any).redirectTo).toBeTruthy();
  });

  it('provisions invited accounts with a setup link', async () => {
    const res = await internal('/internal/accounts', { email: 'staff@grids.test', givenName: 'Sam', familyName: 'Staff' });
    expect(res.status).toBe(200);
    expect(lastMail('staff@grids.test', 'setup').vars.link).toMatch(/\/ui\/setup\//);
    expect((await fetch(`${base}/internal/accounts`, { method: 'POST', body: '{}' })).status).toBe(401);
  });
});
