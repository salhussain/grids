import type { Selectable } from 'kysely';
import { z } from 'zod';
import type { IdentityDB } from '@grids/db';
import type { Sealer } from './crypto.js';
import { randomToken } from './crypto.js';

export type OrgClientRow = Selectable<IdentityDB['org_client']>;

/** https everywhere; plain http only for a developer's own machine. */
const redirect = z
  .url()
  .max(500)
  .refine((u) => {
    const url = new URL(u);
    if (url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  }, 'Use an https address (http is only allowed for localhost) without a #fragment');

export const MAX_CLIENTS_PER_ORG = 20;

export const ClientInput = z.object({
  name: z.string().trim().min(1).max(80),
  redirectUris: z.array(redirect).min(1).max(10),
  postLogoutRedirectUris: z.array(redirect).max(10).default([]),
  /** Server-side apps keep a client secret; browser and mobile apps use PKCE alone. */
  confidential: z.boolean().default(false),
});
export const ClientPatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  redirectUris: z.array(redirect).min(1).max(10).optional(),
  postLogoutRedirectUris: z.array(redirect).max(10).optional(),
  disabled: z.boolean().optional(),
});

export const newClientId = () => `gc_${randomToken(12)}`;
export const newClientSecret = () => randomToken(32);

/** What the admin API shows (never the secret). */
export function clientDto(r: OrgClientRow) {
  return {
    clientId: r.client_id,
    name: r.name,
    redirectUris: r.redirect_uris as string[],
    postLogoutRedirectUris: r.post_logout_redirect_uris as string[],
    confidential: r.secret_enc !== null,
    disabled: r.disabled,
    createdAt: r.created_at.toISOString(),
  };
}

/** The client as oidc-provider wants it. `org_id` ties it to one organisation. */
export function clientMetadata(r: OrgClientRow, sealer: Sealer): Record<string, unknown> {
  return {
    client_id: r.client_id,
    client_name: r.name,
    org_id: r.org_id,
    ...(r.secret_enc ? { client_secret: sealer.open(r.secret_enc), token_endpoint_auth_method: 'client_secret_basic' } : { token_endpoint_auth_method: 'none' }),
    application_type: 'web',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    redirect_uris: r.redirect_uris,
    post_logout_redirect_uris: r.post_logout_redirect_uris,
  };
}
