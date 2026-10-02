import type { Kysely } from 'kysely';
import type { CellDB, PlatformDB, TenantRouter } from '@grids/db';
import type { IdentityProvider } from '../idp/types.js';
import type { EmailService } from './email.js';

/** Shared dependencies for control-plane services. */
export interface ServiceContext {
  db: Kysely<PlatformDB>;
  cells: TenantRouter<CellDB>;
  idp: IdentityProvider;
  email: EmailService;
  consoleUrl: string;
  /** Organisation workspace (web app): invitation and notification links. */
  workspaceUrl: string;
  /** Tenants get `{slug}.{baseDomain}`; custom domains CNAME to `edge.{baseDomain}`. */
  baseDomain: string;
  supportEmail: string;
  now: () => Date;
}

export interface Actor {
  id: string;
  email: string | null;
  /** Active platform staff (holds at least one console permission). */
  isPlatformAdmin: boolean;
  /** Effective console permissions: union of staff roles and individual grants. */
  permissions: ReadonlySet<string>;
}

export async function audit(
  ctx: Pick<ServiceContext, 'db'>,
  actorId: string | null,
  tenantId: string | null,
  action: string,
  details: object = {},
): Promise<void> {
  await ctx.db
    .insertInto('platform_audit_log')
    .values({ actor_id: actorId, tenant_id: tenantId, action, details: JSON.stringify(details) })
    .execute();
}
