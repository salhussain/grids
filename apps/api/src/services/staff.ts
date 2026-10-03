import { sql } from 'kysely';
import {
  STAFF_PERMISSIONS,
  SUPER_ADMIN_ROLE,
  uuidv7,
  type Page,
  type StaffListQuery,
  type StaffRoleDto,
  type StaffUserDto,
  type UpdateStaffInput,
} from '@grids/schema';
import type { z } from 'zod';
import type { InviteStaffInput, StaffRoleInput } from '@grids/schema';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { requireStaff } from './authz.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { iso, isoOrNull, isUniqueViolation, mapPage, paginate, slugify } from './util.js';

type InviteData = z.output<typeof InviteStaffInput>;
type RoleData = z.output<typeof StaffRoleInput>;

/** Platform console staff: users, roles (bundles of console permissions), grants. */
export class StaffService {
  constructor(private readonly ctx: ServiceContext) {}

  // ---------- roles ----------

  async listRoles(actor: Actor): Promise<StaffRoleDto[]> {
    requireStaff(actor, 'staff.view');
    const rows = await this.ctx.db
      .selectFrom('staff_role as r')
      .selectAll('r')
      .select((eb) =>
        eb
          .selectFrom('staff_member_role as mr')
          .whereRef('mr.role_id', '=', 'r.id')
          .select(eb.fn.countAll<string>().as('n'))
          .as('member_count'),
      )
      .orderBy('r.is_system', 'desc')
      .orderBy('r.name')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: r.id === SUPER_ADMIN_ROLE ? [...STAFF_PERMISSIONS] : r.permissions,
      isSystem: r.is_system,
      locked: r.id === SUPER_ADMIN_ROLE,
      memberCount: Number(r.member_count ?? 0),
    }));
  }

  async createRole(actor: Actor, input: RoleData): Promise<StaffRoleDto> {
    requireStaff(actor, 'staff.manage');
    const id = `${slugify(input.name).replace(/-/g, '_') || 'role'}_${uuidv7().slice(-6)}`;
    try {
      await this.ctx.db
        .insertInto('staff_role')
        .values({
          id,
          name: input.name,
          description: input.description,
          permissions: input.permissions,
        })
        .execute();
    } catch (e) {
      if (isUniqueViolation(e))
        throw conflict('Role name taken', `A role named "${input.name}" already exists.`);
      throw e;
    }
    await audit(this.ctx, actor.id, null, 'staff.role_created', {
      role: input.name,
      permissions: input.permissions.length,
    });
    return (await this.listRoles(actor)).find((r) => r.id === id)!;
  }

  async updateRole(actor: Actor, roleId: string, input: RoleData): Promise<StaffRoleDto> {
    requireStaff(actor, 'staff.manage');
    if (roleId === SUPER_ADMIN_ROLE)
      throw conflict('Super admin is locked', 'It always holds every permission.');
    const role = await this.ctx.db
      .selectFrom('staff_role')
      .selectAll()
      .where('id', '=', roleId)
      .executeTakeFirst();
    if (!role) throw notFound('Role');
    try {
      await this.ctx.db
        .updateTable('staff_role')
        .set({
          name: input.name,
          description: input.description,
          permissions: input.permissions,
          updated_at: this.ctx.now(),
        })
        .where('id', '=', roleId)
        .execute();
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Role name taken');
      throw e;
    }
    const added = input.permissions.filter((p) => !role.permissions.includes(p));
    const removed = role.permissions.filter((p) => !(input.permissions as string[]).includes(p));
    await audit(this.ctx, actor.id, null, 'staff.role_updated', {
      role: input.name,
      ...(added.length && { added: added.join(', ') }),
      ...(removed.length && { removed: removed.join(', ') }),
    });
    return (await this.listRoles(actor)).find((r) => r.id === roleId)!;
  }

  async deleteRole(actor: Actor, roleId: string): Promise<void> {
    requireStaff(actor, 'staff.manage');
    const role = await this.ctx.db
      .selectFrom('staff_role')
      .selectAll()
      .where('id', '=', roleId)
      .executeTakeFirst();
    if (!role) throw notFound('Role');
    if (role.is_system) throw conflict('Built-in roles cannot be deleted');
    await this.ctx.db.deleteFrom('staff_role').where('id', '=', roleId).execute();
    await audit(this.ctx, actor.id, null, 'staff.role_deleted', { role: role.name });
  }

  // ---------- users ----------

  async listUsers(actor: Actor, query: Partial<StaffListQuery> = {}): Promise<Page<StaffUserDto>> {
    requireStaff(actor, 'staff.view');
    let q = this.userQuery().orderBy('u.display_name');
    if (query.q) {
      const like = `%${query.q}%`;
      q = q.where((eb) =>
        eb.or([eb('u.email', 'ilike', like), eb('u.display_name', 'ilike', like)]),
      );
    }
    return mapPage(
      await paginate(q, { page: query.page ?? 1, pageSize: query.pageSize ?? 25 }),
      toUser,
    );
  }

  /** Creates the identity-provider account (emailed a set-password link) and the staff record. */
  async invite(actor: Actor, input: InviteData): Promise<StaffUserDto> {
    requireStaff(actor, 'staff.manage');
    await this.assertRolesExist(input.roleIds);
    if (!input.roleIds.length && !input.extraPermissions.length)
      throw badRequest('Assign at least one role or permission');
    const existing = await this.ctx.db
      .selectFrom('user_identity as u')
      .innerJoin('staff_member as m', 'm.user_id', 'u.id')
      .select('u.id')
      .where('u.email', '=', input.email)
      .executeTakeFirst();
    if (existing) throw conflict('Already staff', `${input.email} is already a staff member.`);

    const subject = await this.ctx.idp.createStaffUser({
      email: input.email,
      givenName: input.firstName,
      familyName: input.lastName,
    });
    const userId = uuidv7();
    await this.ctx.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('user_identity')
        .values({
          id: userId,
          idp_subject: subject,
          email: input.email,
          display_name: `${input.firstName} ${input.lastName}`,
          given_name: input.firstName,
          family_name: input.lastName,
        })
        .execute();
      await tx
        .insertInto('staff_member')
        .values({
          user_id: userId,
          extra_permissions: input.extraPermissions,
          invited_by: actor.id,
        })
        .execute();
      for (const roleId of input.roleIds)
        await tx
          .insertInto('staff_member_role')
          .values({ user_id: userId, role_id: roleId })
          .execute();
    });
    await audit(this.ctx, actor.id, null, 'staff.invited', {
      email: input.email,
      roles: input.roleIds.join(', '),
    });
    return this.getUser(userId);
  }

  async update(actor: Actor, userId: string, input: UpdateStaffInput): Promise<StaffUserDto> {
    requireStaff(actor, 'staff.manage');
    const before = await this.getUser(userId);
    if (
      userId === actor.id &&
      (input.status === 'suspended' || input.roleIds || input.extraPermissions)
    ) {
      throw forbidden('You cannot change your own access. Ask another administrator.');
    }
    if (input.roleIds) await this.assertRolesExist(input.roleIds);

    await this.ctx.db.transaction().execute(async (tx) => {
      if (input.roleIds) {
        await tx.deleteFrom('staff_member_role').where('user_id', '=', userId).execute();
        for (const roleId of input.roleIds)
          await tx
            .insertInto('staff_member_role')
            .values({ user_id: userId, role_id: roleId })
            .execute();
      }
      if (input.extraPermissions)
        await tx
          .updateTable('staff_member')
          .set({ extra_permissions: input.extraPermissions })
          .where('user_id', '=', userId)
          .execute();
      if (input.status)
        await tx
          .updateTable('staff_member')
          .set({ status: input.status })
          .where('user_id', '=', userId)
          .execute();
      // Never leave the platform without an active super admin.
      const supers = await sql<{ n: string }>`
        select count(*)::text as n from staff_member m join staff_member_role r using (user_id)
        where r.role_id = ${SUPER_ADMIN_ROLE} and m.status = 'active'`.execute(tx);
      if (Number(supers.rows[0]?.n) === 0)
        throw conflict('Last super admin', 'At least one active super admin is required.');
    });

    if (input.status && input.status !== before.status) {
      const { idp_subject } = await this.ctx.db
        .selectFrom('user_identity')
        .select('idp_subject')
        .where('id', '=', userId)
        .executeTakeFirstOrThrow();
      await this.ctx.idp.setUserActive(idp_subject, input.status === 'active');
    }
    const after = await this.getUser(userId);
    await audit(
      this.ctx,
      actor.id,
      null,
      input.status && input.status !== before.status
        ? `staff.${input.status === 'active' ? 'reactivated' : 'suspended'}`
        : 'staff.access_changed',
      {
        email: after.email,
        ...(input.roleIds && { roles: after.roles.map((r) => r.name).join(', ') || 'none' }),
        ...(input.extraPermissions && {
          extraPermissions: input.extraPermissions.join(', ') || 'none',
        }),
      },
    );
    return after;
  }

  private async getUser(userId: string): Promise<StaffUserDto> {
    const row = await this.userQuery().where('m.user_id', '=', userId).executeTakeFirst();
    if (!row) throw notFound('Staff member');
    return toUser(row);
  }

  private async assertRolesExist(roleIds: string[]) {
    if (!roleIds.length) return;
    const found = await this.ctx.db
      .selectFrom('staff_role')
      .select('id')
      .where('id', 'in', roleIds)
      .execute();
    if (found.length !== new Set(roleIds).size) throw badRequest('Unknown role');
  }

  private userQuery() {
    return this.ctx.db
      .selectFrom('staff_member as m')
      .innerJoin('user_identity as u', 'u.id', 'm.user_id')
      .select([
        'm.user_id',
        'm.status',
        'm.extra_permissions',
        'm.created_at',
        'u.email',
        'u.display_name',
        'u.last_seen_at',
      ])
      .select(() => [
        sql<{ id: string; name: string }[]>`coalesce((
          select json_agg(json_build_object('id', r.id, 'name', r.name) order by r.name)
          from staff_member_role mr join staff_role r on r.id = mr.role_id where mr.user_id = m.user_id), '[]')`.as(
          'roles',
        ),
        sql<string[]>`array(
          select unnest(m.extra_permissions)
          union select unnest(r.permissions) from staff_member_role mr join staff_role r on r.id = mr.role_id where mr.user_id = m.user_id
        )`.as('effective'),
        sql<boolean>`exists (select 1 from staff_member_role mr where mr.user_id = m.user_id and mr.role_id = ${SUPER_ADMIN_ROLE})`.as(
          'is_super',
        ),
      ]);
  }
}

function toUser(r: {
  user_id: string;
  status: 'active' | 'suspended';
  extra_permissions: string[];
  created_at: Date;
  email: string | null;
  display_name: string | null;
  last_seen_at: Date | null;
  roles: { id: string; name: string }[];
  effective: string[];
  is_super: boolean;
}): StaffUserDto {
  return {
    userId: r.user_id,
    email: r.email,
    name: r.display_name ?? r.email ?? 'Staff',
    // Never signed in yet = still completing the invitation.
    status: r.status === 'suspended' ? 'suspended' : r.last_seen_at ? 'active' : 'invited',
    roles: r.roles,
    extraPermissions: r.extra_permissions,
    effectivePermissions: r.is_super ? [...STAFF_PERMISSIONS] : [...r.effective].sort(),
    lastSeenAt: isoOrNull(r.last_seen_at),
    createdAt: iso(r.created_at),
  };
}
