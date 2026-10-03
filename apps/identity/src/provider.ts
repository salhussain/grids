import Provider, { type Configuration } from 'oidc-provider';
import type { JWK } from 'jose';
import type { Kysely } from 'kysely';
import type { IdentityDB } from '@grids/db';
import type { Accounts } from './accounts.js';
import { createAdapterClass } from './adapter.js';
import type { IdentityConfig } from './config.js';

/** First-party clients: public SPAs using authorization code + PKCE. */
export function clients(config: IdentityConfig) {
  const spa = (client_id: string, client_name: string, origin: string) => ({
    client_id,
    client_name,
    token_endpoint_auth_method: 'none' as const,
    application_type: 'web' as const,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code' as const],
    redirect_uris: [`${origin}/auth/callback`],
    post_logout_redirect_uris: [`${origin}/`],
  });
  return [spa('grids-console', 'Grids Console', config.CONSOLE_URL), spa('grids-web', 'Grids Workspace', config.WEB_URL)];
}

export function createProvider(config: IdentityConfig, db: Kysely<IdentityDB>, accounts: Accounts, keys: JWK[]) {
  const audience = config.API_AUDIENCE;
  const configuration: Configuration = {
    adapter: createAdapterClass(db) as never,
    clients: clients(config),
    findAccount: async (_ctx, sub) => {
      const a = await accounts.find(sub);
      if (!a || a.status !== 'active') return undefined;
      return {
        accountId: a.id,
        claims: async () => ({
          sub: a.id,
          email: a.email,
          email_verified: a.email_verified,
          name: [a.given_name, a.family_name].filter(Boolean).join(' ') || a.email,
          given_name: a.given_name ?? undefined,
          family_name: a.family_name ?? undefined,
          locale: a.locale ?? undefined,
        }),
      };
    },
    claims: {
      openid: ['sub'],
      email: ['email', 'email_verified'],
      profile: ['name', 'given_name', 'family_name', 'locale'],
    },
    scopes: ['openid', 'offline_access', 'email', 'profile'],
    // Tenant id: branded login, registration into the organisation, its 2FA policy.
    extraParams: ['organization'],
    pkce: { required: () => true },
    cookies: { keys: [config.IDENTITY_COOKIE_KEY], long: { signed: true, sameSite: 'lax' }, short: { signed: true, sameSite: 'lax' } },
    jwks: { keys: keys as never },
    interactions: { url: (_ctx, interaction) => `/ui/interaction/${interaction.uid}` },
    features: {
      devInteractions: { enabled: false },
      revocation: { enabled: true },
      userinfo: { enabled: true },
      rpInitiatedLogout: {
        enabled: true,
        // Sign out immediately (no extra confirmation page) for our own apps.
        logoutSource: async (ctx, form) => {
          ctx.type = 'html';
          ctx.body = `<!doctype html><html><head><meta charset="utf-8"><title>Signing out…</title></head><body>${form}<script>document.forms[0].submit()</script></body></html>`;
        },
        postLogoutSuccessSource: async (ctx) => {
          ctx.type = 'html';
          ctx.body = '<!doctype html><html><head><meta charset="utf-8"><title>Signed out</title></head><body><p>You have been signed out.</p></body></html>';
        },
      },
      // Access tokens for the Grids API are JWTs with audience `grids-api`.
      resourceIndicators: {
        enabled: true,
        defaultResource: () => audience,
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, resourceIndicator) => {
          if (resourceIndicator !== audience) throw new Error('unknown resource');
          return { scope: 'api', audience, accessTokenTTL: 15 * 60, accessTokenFormat: 'jwt', jwt: { sign: { alg: 'RS256' } } };
        },
      },
    },
    ttl: {
      AccessToken: 15 * 60,
      AuthorizationCode: 60,
      IdToken: 60 * 60,
      Interaction: 60 * 60,
      Session: 14 * 24 * 3600,
      Grant: 14 * 24 * 3600,
      RefreshToken: 14 * 24 * 3600,
    },
    rotateRefreshToken: true,
    clientBasedCORS: (_ctx, origin, client) => (client.redirectUris ?? []).some((u: string) => new URL(u).origin === origin),
    renderError: async (ctx, out) => {
      ctx.type = 'html';
      const msg = String(out.error_description ?? out.error).replace(/[<>&"]/g, '');
      ctx.body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign-in error</title>
<style>body{font-family:system-ui,sans-serif;background:#161616;color:#f4f4f4;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:420px;padding:32px;border-top:4px solid #da1e28;background:#262626}h1{font-size:18px}p{color:#c6c6c6;font-size:14px}</style>
</head><body><main><h1>We couldn’t sign you in</h1><p>${msg}</p><p>Return to the app and try again.</p></main></body></html>`;
    },
  };
  const provider = new Provider(config.IDENTITY_ISSUER, configuration);
  provider.proxy = true;
  return provider;
}

export type GridsProvider = ReturnType<typeof createProvider>;
