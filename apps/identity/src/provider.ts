import Provider, { type Configuration } from 'oidc-provider';
import type { JWK } from 'jose';
import type { Kysely } from 'kysely';
import type { IdentityDB } from '@grids/db';
import type { Accounts } from './accounts.js';
import { createAdapterClass } from './adapter.js';
import type { IdentityConfig } from './config.js';
import type { Sealer } from './crypto.js';

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
  // The mobile app: a native public client (PKCE) that returns to its own link scheme.
  const mobile = {
    client_id: 'grids-mobile',
    client_name: 'Grids Mobile',
    token_endpoint_auth_method: 'none' as const,
    application_type: 'native' as const,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code' as const],
    redirect_uris: ['grids://auth/callback', ...config.MOBILE_DEV_REDIRECTS.split(',').map((u) => u.trim()).filter(Boolean)],
    post_logout_redirect_uris: ['grids://auth/signed-out'],
  };
  return [
    mobile,
    spa('grids-console', 'Grids Console', config.CONSOLE_URL),
    spa('grids-web', 'Grids Workspace', config.WEB_URL),
    spa('grids-portal', 'Grids Portal', config.PORTAL_URL),
  ];
}

export function createProvider(config: IdentityConfig, db: Kysely<IdentityDB>, accounts: Accounts, keys: JWK[], sealer: Sealer) {
  const audience = config.API_AUDIENCE;
  const configuration: Configuration = {
    adapter: createAdapterClass(db, sealer) as never,
    clients: clients(config),
    // Applications registered by organisations carry the organisation they belong to.
    extraClientMetadata: { properties: ['org_id'], validator: () => undefined },
    findAccount: async (ctx, sub) => {
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
          // Which organisation's application is signing in (tenant-registered clients only).
          ...(ctx?.oidc?.client?.['org_id'] ? { org_id: String(ctx.oidc.client['org_id']) } : {}),
        }),
      };
    },
    claims: {
      openid: ['sub', 'org_id'],
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
        // Sign out immediately (no extra confirmation page) for our own apps. `logout=yes`
        // ends the identity-provider session too; without it only the app's session ends
        // and the next sign-in completes silently.
        logoutSource: async (ctx, form) => {
          ctx.type = 'html';
          const confirmed = form.replace('</form>', '<input type="hidden" name="logout" value="yes"/></form>');
          ctx.body = `<!doctype html><html><head><meta charset="utf-8"><title>Signing out…</title></head><body>${confirmed}<script>document.forms[0].submit()</script></body></html>`;
        },
        postLogoutSuccessSource: async (ctx) => {
          ctx.type = 'html';
          ctx.body = '<!doctype html><html><head><meta charset="utf-8"><title>Signed out</title></head><body><p>You have been signed out.</p></body></html>';
        },
      },
      // Access tokens for the Grids API are JWTs with audience `grids-api`.
      resourceIndicators: {
        enabled: true,
        // Organisation applications never get tokens for the Grids API: they sign people in (ID token, userinfo) only.
        defaultResource: (_ctx, client) => (client?.['org_id'] ? undefined : audience),
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, resourceIndicator, client) => {
          if (resourceIndicator !== audience || client?.['org_id']) throw new Error('unknown resource');
          return { scope: 'api', audience, accessTokenTTL: 15 * 60, accessTokenFormat: 'jwt', jwt: { sign: { alg: 'RS256' } } };
        },
      },
    },
    ttl: {
      AccessToken: 15 * 60,
      AuthorizationCode: 60,
      IdToken: 60 * 60,
      Interaction: 60 * 60,
      // One working day: the sign-in is forced again after 12 hours whatever the activity (see MAX_SESSION_SECONDS).
      Session: 12 * 3600,
      Grant: 12 * 3600,
      RefreshToken: 12 * 3600,
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
