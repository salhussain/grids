import type { Kysely } from 'kysely';
import type { CellDB, PlatformDB, TenantRouter } from '@grids/db';
import type { IdentityProvider } from '../idp/types.js';
import { categoryOf } from '@grids/schema';
import { currentOrigin } from '../request-context.js';
import type { EmailService } from './email.js';

/** Shared dependencies for control-plane services. */
import type { PaymentGateway } from '../pay/types.js';

export interface ServiceContext {
  db: Kysely<PlatformDB>;
  cells: TenantRouter<CellDB>;
  idp: IdentityProvider;
  /** GridPay, the payment service (not needed by the seed scripts). */
  pay?: PaymentGateway;
  email: EmailService;
  consoleUrl: string;
  /** Organisation workspace (web app): invitation and notification links. */
  workspaceUrl: string;
  /** Tenants get `{slug}.{baseDomain}`; custom domains CNAME to `edge.{baseDomain}`. */
  baseDomain: string;
  supportEmail: string;
  /** Encrypts stored variables (AES-256-GCM). */
  secretsKey: Buffer;
  /** Whether connections may reach private network addresses (development, or an explicit choice). */
  allowPrivateConnections: boolean;
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

/**
 * Writes to the activity log. It takes the address, place and browser of the request being handled, and the project
 * from `details.project`, so callers say only what happened.
 */
export async function audit(
  ctx: Pick<ServiceContext, 'db'>,
  actorId: string | null,
  tenantId: string | null,
  action: string,
  details: object = {},
): Promise<void> {
  const origin = await currentOrigin();
  if (origin) origin.logged = true;
  const project = (details as { project?: unknown }).project;
  await ctx.db
    .insertInto('platform_audit_log')
    .values({
      actor_id: actorId,
      tenant_id: tenantId,
      action,
      details: JSON.stringify(details),
      category: categoryOf(action),
      project_key: typeof project === 'string' ? project : null,
      ip: origin?.ip ?? null,
      country: origin?.country ?? null,
      region: origin?.region ?? null,
      city: origin?.city ?? null,
      user_agent: origin?.userAgent ?? null,
    })
    .execute();
}
