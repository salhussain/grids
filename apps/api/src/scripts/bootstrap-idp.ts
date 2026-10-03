/**
 * Idempotent dev bootstrap for the Grids identity service (apps/identity, ADR 0009):
 *  1. registers every tenant as an IdP organisation (id = tenant id) with its 2FA policy,
 *  2. ensures a sign-in account for every known person, re-pointing `idp_subject`
 *     (also migrates identities created by the previous IdP) and linking org members,
 *  3. gives the platform admin a password and the console Super admin role,
 *  4. writes the OIDC settings into apps/console/.env.local and apps/web/.env.local.
 * Requires the identity service to be running (`pnpm --filter @grids/identity start`).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDb, type PlatformDB } from '@grids/db';
import { uuidv7 } from '@grids/schema';
import { GridsIdpClient } from '../idp/grids.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const internalUrl = process.env.IDENTITY_INTERNAL_URL ?? 'http://localhost:4100';
const issuer = process.env.IDENTITY_ISSUER ?? 'http://localhost:4100/oidc';
const adminEmail = process.env.PLATFORM_ADMIN_EMAIL ?? 'admin@grids.local';
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD ?? 'Password1!';
const apiUrl = `http://localhost:${process.env.API_PORT ?? 4000}`;
const token = env('IDENTITY_SERVICE_TOKEN');
const idp = new GridsIdpClient(internalUrl, token);

async function internal<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(new URL(path, internalUrl), {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const ensureAccount = (email: string, givenName: string, familyName: string) =>
  internal<{ accountId: string }>('POST', '/internal/accounts', {
    email,
    givenName,
    familyName,
    sendSetupEmail: false,
  }).then((r) => r.accountId);

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function upsertEnv(file: string, values: Record<string, string | null>): void {
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*\\n?`, 'm');
    if (v === null) text = text.replace(re, '');
    else if (re.test(text)) text = text.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);
    else text = `${text.replace(/\n?$/, '\n')}${k}=${v}\n`;
  }
  writeFileSync(file, text.replace(/^\n/, ''));
}

console.log('Bootstrapping the Grids identity service…');
const db = createDb<PlatformDB>(env('DATABASE_URL_PLATFORM'));
try {
  // 1. Organisations
  const tenants = await db
    .selectFrom('tenant')
    .select(['id', 'name', 'mfa_required', 'idp_org_id'])
    .where('status', '=', 'active')
    .execute();
  for (const t of tenants) {
    await idp.createOrganization(t.id, t.name);
    await idp.setOrganizationMfaRequired(t.id, t.mfa_required);
    if (t.idp_org_id !== t.id)
      await db.updateTable('tenant').set({ idp_org_id: t.id }).where('id', '=', t.id).execute();
  }
  console.log(`  ${tenants.length} organisations`);

  // 2. People
  const users = await db
    .selectFrom('user_identity')
    .select(['id', 'email', 'given_name', 'family_name', 'display_name', 'idp_subject'])
    .where('email', 'is not', null)
    .execute();
  for (const u of users) {
    const [given, ...rest] = (u.display_name ?? u.email!.split('@')[0]!).split(' ');
    const accountId = await ensureAccount(
      u.email!,
      u.given_name ?? given ?? 'User',
      u.family_name ?? (rest.join(' ') || '-'),
    );
    if (u.idp_subject !== accountId)
      await db
        .updateTable('user_identity')
        .set({ idp_subject: accountId })
        .where('id', '=', u.id)
        .execute();
    const orgs = await db
      .selectFrom('membership')
      .select('tenant_id')
      .where('user_id', '=', u.id)
      .where('status', '=', 'active')
      .execute();
    for (const m of orgs) await idp.linkUserToOrganization(m.tenant_id, accountId);
  }
  console.log(`  ${users.length} people`);

  // 3. Platform admin
  const adminId = await ensureAccount(adminEmail, 'Platform', 'Admin');
  await internal('POST', `/internal/accounts/${adminId}/dev-password`, { password: adminPassword });
  await db
    .insertInto('user_identity')
    .values({
      id: uuidv7(),
      idp_subject: adminId,
      email: adminEmail,
      display_name: 'Platform Admin',
      given_name: 'Platform',
      family_name: 'Admin',
      is_platform_admin: true,
    })
    .onConflict((oc) =>
      oc.column('idp_subject').doUpdateSet({ is_platform_admin: true, email: adminEmail }),
    )
    .execute();
  const { id } = await db
    .selectFrom('user_identity')
    .select('id')
    .where('idp_subject', '=', adminId)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('staff_member')
    .values({ user_id: id })
    .onConflict((oc) => oc.column('user_id').doNothing())
    .execute();
  await db
    .insertInto('staff_member_role')
    .values({ user_id: id, role_id: 'super_admin' })
    .onConflict((oc) => oc.columns(['user_id', 'role_id']).doNothing())
    .execute();
  console.log(`  platform admin: ${adminEmail} / ${adminPassword}`);
} finally {
  await db.destroy();
}

// 4. App settings
for (const [app, clientId] of [
  ['console', 'grids-console'],
  ['web', 'grids-web'],
  ['portal', 'grids-portal'],
] as const) {
  upsertEnv(resolve(ROOT, `apps/${app}/.env.local`), {
    VITE_API_URL: apiUrl,
    VITE_OIDC_AUTHORITY: issuer,
    VITE_OIDC_CLIENT_ID: clientId,
    VITE_OIDC_PROJECT_ID: null,
  });
}
upsertEnv(resolve(ROOT, '.env'), { ZITADEL_PROJECT_ID: null, ZITADEL_ISSUER: null });
console.log('Done. Wrote apps/console/.env.local and apps/web/.env.local');
