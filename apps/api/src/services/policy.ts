import { sql } from 'kysely';
import { withTenant } from '@grids/db';
import {
  SCOPABLE_PERMISSIONS,
  SYSTEM_WORKSPACE_ROLES,
  WORKSPACE_PERMISSIONS,
  uuidv7,
  type WorkspacePermission,
} from '@grids/schema';
import type { Actor, ServiceContext } from './context.js';

export interface ScopedGrant {
  permission: string;
  orgUnitId: string;
  orgUnitName: string;
  path: string;
}

/**
 * A member's effective workspace access (spec §3, ADR 0004): tenant-wide
 * permissions plus scopable permissions held within org-unit subtrees.
 * Organisation admins (membership role) hold everything tenant-wide.
 */
export class WorkspacePolicy {
  constructor(
    readonly role: 'org_admin' | 'member',
    readonly tenantWide: ReadonlySet<string>,
    readonly scoped: readonly ScopedGrant[],
  ) {}

  /** Held tenant-wide, or (given the target's unit path) within a covering subtree. */
  has(permission: WorkspacePermission, unitPath?: string | null): boolean {
    if (this.tenantWide.has(permission)) return true;
    if (!unitPath) return false;
    return this.scoped.some(
      (s) =>
        s.permission === permission && (unitPath === s.path || unitPath.startsWith(`${s.path}.`)),
    );
  }

  /** Held anywhere (tenant-wide or in at least one subtree). */
  hasAnywhere(permission: WorkspacePermission): boolean {
    return this.tenantWide.has(permission) || this.scoped.some((s) => s.permission === permission);
  }

  /** `'all'` or the subtree paths where `permission` applies. */
  scope(permission: WorkspacePermission): 'all' | string[] {
    if (this.tenantWide.has(permission)) return 'all';
    return this.scoped.filter((s) => s.permission === permission).map((s) => s.path);
  }
}

/** ltree label for an org unit id. */
export const unitLabel = (id: string) => `u${id.replace(/-/g, '')}`;

/** Seeds the built-in workspace roles for a tenant (idempotent). */
export async function ensureSystemRoles(
  ctx: Pick<ServiceContext, 'cells'>,
  tenantId: string,
): Promise<void> {
  const cell = await ctx.cells.forTenant(tenantId);
  await withTenant(cell, tenantId, async (tx) => {
    for (const r of SYSTEM_WORKSPACE_ROLES) {
      await tx
        .insertInto('workspace_role')
        .values({
          id: uuidv7(),
          tenant_id: tenantId,
          key: r.key,
          name: r.name,
          description: r.description,
          permissions: r.permissions,
          is_system: true,
        })
        .onConflict((oc) => {
          const target = oc.columns(['tenant_id', 'key']).where('key', 'is not', null);
          // Organisation admins keep full control as new permissions ship; other built-in
          // roles may have been tailored by the organisation, so they are left alone.
          return r.key === 'org_admin'
            ? target.doUpdateSet({ permissions: r.permissions })
            : target.doNothing();
        })
        .execute();
    }
  });
}

/**
 * Resolves the actor's policy in a tenant, or null when they aren't an active
 * member. Grants live in the tenant cell; the membership in the control plane.
 */
export async function workspacePolicy(
  ctx: Pick<ServiceContext, 'db' | 'cells'>,
  actor: Actor,
  tenantId: string,
): Promise<WorkspacePolicy | null> {
  const m = await ctx.db
    .selectFrom('membership')
    .select(['role', 'status'])
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', actor.id)
    .executeTakeFirst();
  if (!m || m.status !== 'active') return null;
  if (m.role === 'org_admin')
    return new WorkspacePolicy('org_admin', new Set(WORKSPACE_PERMISSIONS), []);

  const cell = await ctx.cells.forTenant(tenantId);
  const rows = await withTenant(cell, tenantId, async (tx) => {
    const baseline = await tx
      .selectFrom('workspace_role')
      .select('permissions')
      .where('key', '=', 'member')
      .executeTakeFirst();
    const grants = await sql<{
      permissions: string[];
      org_unit_id: string | null;
      path: string | null;
      name: string | null;
    }>`
      select r.permissions, g.org_unit_id, u.path::text as path, u.name
      from role_grant g
      join workspace_role r on r.id = g.role_id
      left join org_unit u on u.id = g.org_unit_id
      where g.user_id = ${actor.id}
    `.execute(tx);
    return { baseline: baseline?.permissions ?? ['org.view'], grants: grants.rows };
  });

  const tenantWide = new Set<string>(rows.baseline);
  const scoped: ScopedGrant[] = [];
  for (const g of rows.grants) {
    if (!g.org_unit_id) g.permissions.forEach((p) => tenantWide.add(p));
    else {
      // Only scopable permissions apply within a subtree; others need a tenant-wide grant.
      for (const p of g.permissions) {
        if ((SCOPABLE_PERMISSIONS as string[]).includes(p))
          scoped.push({
            permission: p,
            orgUnitId: g.org_unit_id,
            orgUnitName: g.name ?? '',
            path: g.path!,
          });
      }
    }
  }
  return new WorkspacePolicy('member', tenantWide, scoped);
}
