import type { StaffPermission, WorkspacePermission } from '@grids/schema';
import { forbidden } from '../errors.js';
import type { Actor, ServiceContext } from './context.js';
import { workspacePolicy, type WorkspacePolicy } from './policy.js';

/** True when the actor is active platform staff holding `permission`. */
export const can = (actor: Actor, permission: StaffPermission) =>
  actor.isPlatformAdmin && actor.permissions.has(permission);

/** Console actions: active staff with the specific permission. */
export function requireStaff(actor: Actor, permission: StaffPermission): void {
  if (!actor.isPlatformAdmin) throw forbidden('Platform staff only.');
  if (!actor.permissions.has(permission))
    throw forbidden(`Requires the "${permission}" permission.`);
}

/**
 * Organisation-scoped actions: staff holding `staff`, or active members holding
 * `workspace`, either tenant-wide or, with `unitPath`, in a subtree containing
 * that org unit. `anywhere` accepts a permission held in any scope (the caller
 * then filters results by `policy.scope()`). Returns the member's policy, or
 * null for staff.
 */
export async function requireTenantAccess(
  ctx: Pick<ServiceContext, 'db' | 'cells'>,
  actor: Actor,
  tenantId: string,
  opts: {
    staff: StaffPermission;
    workspace?: WorkspacePermission;
    unitPath?: string | null;
    anywhere?: boolean;
  },
): Promise<WorkspacePolicy | null> {
  if (can(actor, opts.staff)) return null;
  const policy = await workspacePolicy(ctx, actor, tenantId);
  if (!policy) throw forbidden();
  const permission = opts.workspace ?? 'org.view';
  const ok = opts.anywhere ? policy.hasAnywhere(permission) : policy.has(permission, opts.unitPath);
  if (!ok) throw forbidden(`Requires the "${permission}" permission.`);
  return policy;
}
