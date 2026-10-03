import { sql } from 'kysely';
import { withTenant } from '@grids/db';
import { LOCALE_CODES } from '@grids/i18n';
import {
  DEFAULT_LOCALIZATION,
  DEFAULT_THEME,
  LocalizationDto,
  SCOPABLE_PERMISSIONS,
  Theme,
  uuidv7,
  type AuditPage,
  type LocalizationInput,
  type OrgInsightsDto,
  type PublicBranding,
  type GrantDto,
  type OrgUnitDto,
  type WorkspaceDto,
  type WorkspaceRoleDto,
} from '@grids/schema';
import type { z } from 'zod';
import type { GrantInput, OrgUnitInput, WorkspaceRoleInput } from '@grids/schema';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../errors.js';
import { requireTenantAccess } from './authz.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import type { LogService } from './logs.js';
import { ensureSystemRoles, unitLabel, workspacePolicy } from './policy.js';
import { iso, isUniqueViolation } from './util.js';

type UnitData = z.output<typeof OrgUnitInput>;
type RoleData = z.output<typeof WorkspaceRoleInput>;
type GrantData = z.output<typeof GrantInput>;

/** Organisation workspace: context, branding, structure, roles and grants (M2). */
export class WorkspaceService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly deps: { logs: LogService },
  ) {}

  private async cell(tenantId: string) {
    return this.ctx.cells.forTenant(tenantId);
  }

  /** What the signed-in member sees and can do in this workspace. */
  async context(actor: Actor, tenantId: string): Promise<WorkspaceDto> {
    const t = await this.ctx.db
      .selectFrom('tenant as t')
      .leftJoin('plan as p', 'p.id', 't.plan_id')
      .select(['t.id', 't.name', 't.slug', 't.status', 'p.name as plan_name', 'p.features'])
      .where('t.id', '=', tenantId)
      .executeTakeFirst();
    if (!t) throw notFound('Organisation');
    if (t.status !== 'active')
      throw forbidden(`This organisation is ${t.status.replace('_', ' ')}.`);
    await ensureSystemRoles(this.ctx, tenantId);
    const policy = await workspacePolicy(this.ctx, actor, tenantId);
    if (!policy) throw forbidden('You are not an active member of this organisation.');
    return {
      tenant: { id: t.id, name: t.name, slug: t.slug, status: t.status, planName: t.plan_name },
      theme: await this.theme(tenantId),
      localization: await this.localization(tenantId),
      features: (t.features as string[] | null) ?? [],
      me: {
        role: policy.role,
        permissions: [...policy.tenantWide].sort(),
        scoped: policy.scoped.map(({ permission, orgUnitId, orgUnitName }) => ({
          permission,
          orgUnitId,
          orgUnitName,
        })),
      },
    };
  }

  // ---------- languages ----------

  async localization(tenantId: string): Promise<LocalizationDto> {
    const row = await withTenant(await this.cell(tenantId), tenantId, (tx) =>
      tx.selectFrom('tenant_profile').select('localization').executeTakeFirst(),
    );
    const parsed = LocalizationDto.partial().safeParse(row?.localization ?? {});
    return { ...DEFAULT_LOCALIZATION, ...(parsed.success ? parsed.data : {}) };
  }

  async setLocalization(
    actor: Actor,
    tenantId: string,
    input: LocalizationInput,
  ): Promise<LocalizationDto> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'tenants.edit',
      workspace: 'languages.manage',
    });
    const unknown = input.languages.filter((l) => !(LOCALE_CODES as string[]).includes(l));
    if (unknown.length) throw badRequest(`Unsupported language: ${unknown.join(', ')}`);
    // Overrides only for enabled languages, and drop blank entries.
    const overrides: Record<string, Record<string, string>> = Object.fromEntries(
      Object.entries(input.overrides)
        .filter(([lng]) => input.languages.includes(lng))
        .map(([lng, keys]) => [lng, Object.fromEntries(Object.entries(keys).filter(([, v]) => v))])
        .filter(([, keys]) => Object.keys(keys as object).length),
    );
    const value: LocalizationDto = { ...input, overrides };
    await withTenant(await this.cell(tenantId), tenantId, (tx) =>
      tx
        .updateTable('tenant_profile')
        .set({ localization: JSON.stringify(value) })
        .execute(),
    );
    await audit(this.ctx, actor.id, tenantId, 'languages.updated', {
      languages: value.languages.join(', '),
      default: value.defaultLanguage,
      overrides: Object.values(overrides).reduce((n, o) => n + Object.keys(o).length, 0),
    });
    return value;
  }

  /** Branding and languages for the sign-in page (no authentication). */
  async publicBranding(tenantId: string): Promise<PublicBranding> {
    const t = await this.ctx.db
      .selectFrom('tenant')
      .select(['id', 'name', 'status'])
      .where('id', '=', tenantId)
      .executeTakeFirst();
    if (!t || t.status !== 'active') throw notFound('Organisation');
    const [theme, loc] = await Promise.all([this.theme(tenantId), this.localization(tenantId)]);
    return {
      tenantId: t.id,
      name: t.name,
      appName: theme.appName,
      primaryColor: theme.primaryColor,
      logo: theme.logo,
      welcomeMessage: theme.welcomeMessage,
      languages: loc.languages,
      defaultLanguage: loc.defaultLanguage,
      overrides: Object.fromEntries(
        Object.entries(loc.overrides).map(([lng, keys]) => [
          lng,
          Object.fromEntries(
            Object.entries(keys).filter(([k]) => k.startsWith('auth.') || k.startsWith('common.')),
          ),
        ]),
      ),
    };
  }

  // ---------- branding ----------

  async theme(tenantId: string): Promise<Theme> {
    const row = await withTenant(await this.cell(tenantId), tenantId, (tx) =>
      tx.selectFrom('tenant_profile').select('theme').executeTakeFirst(),
    );
    return Theme.parse({ ...DEFAULT_THEME, ...((row?.theme as object) ?? {}) });
  }

  async setTheme(actor: Actor, tenantId: string, theme: Theme): Promise<Theme> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'tenants.edit',
      workspace: 'branding.manage',
    });
    const plan = await this.ctx.db
      .selectFrom('tenant as t')
      .leftJoin('plan as p', 'p.id', 't.plan_id')
      .select('p.features')
      .where('t.id', '=', tenantId)
      .executeTakeFirst();
    const branded =
      theme.logo !== null || theme.primaryColor.toLowerCase() !== DEFAULT_THEME.primaryColor;
    if (branded && !((plan?.features as string[] | null) ?? []).includes('custom_branding')) {
      throw new HttpError(
        402,
        'Upgrade required',
        'Custom colours and logos need a plan with custom branding.',
      );
    }
    await withTenant(await this.cell(tenantId), tenantId, (tx) =>
      tx
        .updateTable('tenant_profile')
        .set({ theme: JSON.stringify(theme) })
        .execute(),
    );
    await audit(this.ctx, actor.id, tenantId, 'branding.updated', {
      primaryColor: theme.primaryColor,
      logo: theme.logo ? 'set' : 'none',
      appName: theme.appName || '—',
    });
    return this.theme(tenantId);
  }

  // ---------- structure ----------

  async units(actor: Actor, tenantId: string): Promise<OrgUnitDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'tenants.view' });
    const rows = await withTenant(await this.cell(tenantId), tenantId, (tx) =>
      sql<{
        id: string;
        parent_id: string | null;
        name: string;
        code: string | null;
        level_label: string | null;
        depth: number;
        members: string;
        children: string;
      }>`
        select u.id, u.parent_id, u.name, u.code, u.level_label, nlevel(u.path) - 1 as depth,
          (select count(*) from member_placement p where p.org_unit_id = u.id)::text as members,
          (select count(*) from org_unit c where c.parent_id = u.id)::text as children
        from org_unit u
        order by u.path
      `.execute(tx),
    );
    // Order depth-first with siblings by name.
    const byParent = new Map<string | null, typeof rows.rows>();
    for (const r of rows.rows) byParent.set(r.parent_id, [...(byParent.get(r.parent_id) ?? []), r]);
    const out: OrgUnitDto[] = [];
    const walk = (parent: string | null) => {
      for (const r of (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
        out.push({
          id: r.id,
          parentId: r.parent_id,
          name: r.name,
          code: r.code,
          levelLabel: r.level_label,
          depth: Number(r.depth),
          memberCount: Number(r.members),
          childCount: Number(r.children),
        });
        walk(r.id);
      }
    };
    walk(null);
    return out;
  }

  async createUnit(actor: Actor, tenantId: string, input: UnitData): Promise<OrgUnitDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'tenants.edit',
      workspace: 'structure.manage',
    });
    const id = uuidv7();
    try {
      await withTenant(await this.cell(tenantId), tenantId, async (tx) => {
        const parent = input.parentId
          ? await tx
              .selectFrom('org_unit')
              .select('path')
              .where('id', '=', input.parentId)
              .executeTakeFirst()
          : null;
        if (input.parentId && !parent) throw notFound('Parent unit');
        const path = parent ? `${parent.path}.${unitLabel(id)}` : unitLabel(id);
        await sql`insert into org_unit (id, tenant_id, parent_id, name, code, level_label, path)
                  values (${id}, ${tenantId}, ${input.parentId ?? null}, ${input.name}, ${input.code ?? null}, ${input.levelLabel ?? null}, ${path}::ltree)`.execute(
          tx,
        );
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw conflict('Name already used', `"${input.name}" already exists at this level.`);
      throw e;
    }
    await audit(this.ctx, actor.id, tenantId, 'structure.unit_created', {
      unit: input.name,
      level: input.levelLabel ?? '—',
    });
    return this.units(actor, tenantId);
  }

  /** Rename and/or move (re-parenting rewrites the subtree's paths). */
  async updateUnit(
    actor: Actor,
    tenantId: string,
    unitId: string,
    input: UnitData,
  ): Promise<OrgUnitDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'tenants.edit',
      workspace: 'structure.manage',
    });
    try {
      await withTenant(await this.cell(tenantId), tenantId, async (tx) => {
        const unit = await tx
          .selectFrom('org_unit')
          .selectAll()
          .where('id', '=', unitId)
          .executeTakeFirst();
        if (!unit) throw notFound('Org unit');
        await tx
          .updateTable('org_unit')
          .set({
            name: input.name,
            code: input.code ?? null,
            level_label: input.levelLabel ?? null,
          })
          .where('id', '=', unitId)
          .execute();
        if (input.parentId !== undefined && input.parentId !== unit.parent_id) {
          const parent = input.parentId
            ? await tx
                .selectFrom('org_unit')
                .select('path')
                .where('id', '=', input.parentId)
                .executeTakeFirst()
            : null;
          if (input.parentId && !parent) throw notFound('Parent unit');
          if (parent && (parent.path === unit.path || parent.path.startsWith(`${unit.path}.`))) {
            throw badRequest(
              'Invalid move',
              'A unit cannot be moved under itself or its descendants.',
            );
          }
          const newPath = parent ? `${parent.path}.${unitLabel(unitId)}` : unitLabel(unitId);
          // The unit itself has no suffix (subpath at nlevel would be out of range).
          await sql`update org_unit set path = case
                      when path = ${unit.path}::ltree then ${newPath}::ltree
                      else ${newPath}::ltree || subpath(path, nlevel(${unit.path}::ltree)) end
                    where path <@ ${unit.path}::ltree`.execute(tx);
          await tx
            .updateTable('org_unit')
            .set({ parent_id: input.parentId ?? null })
            .where('id', '=', unitId)
            .execute();
        }
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw conflict('Name already used', `"${input.name}" already exists at this level.`);
      throw e;
    }
    await audit(this.ctx, actor.id, tenantId, 'structure.unit_updated', { unit: input.name });
    return this.units(actor, tenantId);
  }

  async deleteUnit(actor: Actor, tenantId: string, unitId: string): Promise<OrgUnitDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'tenants.edit',
      workspace: 'structure.manage',
    });
    const name = await withTenant(await this.cell(tenantId), tenantId, async (tx) => {
      const unit = await tx
        .selectFrom('org_unit')
        .select(['id', 'name'])
        .where('id', '=', unitId)
        .executeTakeFirst();
      if (!unit) throw notFound('Org unit');
      const child = await tx
        .selectFrom('org_unit')
        .select('id')
        .where('parent_id', '=', unitId)
        .executeTakeFirst();
      if (child) throw conflict('Unit has sub-units', 'Move or delete its sub-units first.');
      const placed = await tx
        .selectFrom('member_placement')
        .select('user_id')
        .where('org_unit_id', '=', unitId)
        .executeTakeFirst();
      if (placed) throw conflict('Unit has members', 'Move its members to another unit first.');
      await tx.deleteFrom('org_unit').where('id', '=', unitId).execute();
      return unit.name;
    });
    await audit(this.ctx, actor.id, tenantId, 'structure.unit_deleted', { unit: name });
    return this.units(actor, tenantId);
  }

  // ---------- roles ----------

  async roles(actor: Actor, tenantId: string): Promise<WorkspaceRoleDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'members.view',
      workspace: 'roles.view',
    });
    await ensureSystemRoles(this.ctx, tenantId);
    const rows = await withTenant(await this.cell(tenantId), tenantId, (tx) =>
      tx
        .selectFrom('workspace_role as r')
        .selectAll('r')
        .select((eb) =>
          eb
            .selectFrom('role_grant as g')
            .whereRef('g.role_id', '=', 'r.id')
            .select(eb.fn.countAll<string>().as('n'))
            .as('grants'),
        )
        .orderBy('r.is_system', 'desc')
        .orderBy('r.name')
        .execute(),
    );
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
      isSystem: r.is_system,
      // Organisation admins always hold everything; that role can't be narrowed.
      locked: r.key === 'org_admin',
      grantCount: Number(r.grants ?? 0),
    }));
  }

  async createRole(actor: Actor, tenantId: string, input: RoleData): Promise<WorkspaceRoleDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'members.manage',
      workspace: 'roles.manage',
    });
    try {
      await withTenant(await this.cell(tenantId), tenantId, (tx) =>
        tx
          .insertInto('workspace_role')
          .values({
            id: uuidv7(),
            tenant_id: tenantId,
            key: null,
            name: input.name,
            description: input.description,
            permissions: input.permissions,
          })
          .execute(),
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Role name taken');
      throw e;
    }
    await audit(this.ctx, actor.id, tenantId, 'access.role_created', {
      role: input.name,
      permissions: input.permissions.join(', '),
    });
    return this.roles(actor, tenantId);
  }

  async updateRole(
    actor: Actor,
    tenantId: string,
    roleId: string,
    input: RoleData,
  ): Promise<WorkspaceRoleDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'members.manage',
      workspace: 'roles.manage',
    });
    await withTenant(await this.cell(tenantId), tenantId, async (tx) => {
      const role = await tx
        .selectFrom('workspace_role')
        .select(['key'])
        .where('id', '=', roleId)
        .executeTakeFirst();
      if (!role) throw notFound('Role');
      if (role.key === 'org_admin') throw conflict('Organisation admin is locked');
      await tx
        .updateTable('workspace_role')
        .set({
          name: input.name,
          description: input.description,
          permissions: input.permissions,
          updated_at: this.ctx.now(),
        })
        .where('id', '=', roleId)
        .execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'access.role_updated', {
      role: input.name,
      permissions: input.permissions.join(', '),
    });
    return this.roles(actor, tenantId);
  }

  async deleteRole(actor: Actor, tenantId: string, roleId: string): Promise<WorkspaceRoleDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'members.manage',
      workspace: 'roles.manage',
    });
    const name = await withTenant(await this.cell(tenantId), tenantId, async (tx) => {
      const role = await tx
        .selectFrom('workspace_role')
        .select(['name', 'is_system'])
        .where('id', '=', roleId)
        .executeTakeFirst();
      if (!role) throw notFound('Role');
      if (role.is_system) throw conflict('Built-in roles cannot be deleted');
      await tx.deleteFrom('workspace_role').where('id', '=', roleId).execute();
      return role.name;
    });
    await audit(this.ctx, actor.id, tenantId, 'access.role_deleted', { role: name });
    return this.roles(actor, tenantId);
  }

  // ---------- grants ----------

  async grants(actor: Actor, tenantId: string, userId?: string): Promise<GrantDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'members.view',
      workspace: 'roles.view',
    });
    const rows = await withTenant(await this.cell(tenantId), tenantId, (tx) => {
      let q = tx
        .selectFrom('role_grant as g')
        .innerJoin('workspace_role as r', 'r.id', 'g.role_id')
        .leftJoin('org_unit as u', 'u.id', 'g.org_unit_id')
        .select([
          'g.id',
          'g.user_id',
          'g.created_at',
          'r.id as role_id',
          'r.name as role_name',
          'u.id as unit_id',
          'u.name as unit_name',
        ])
        .orderBy('g.created_at');
      if (userId) q = q.where('g.user_id', '=', userId);
      return q.execute();
    });
    return rows.map((g) => ({
      id: g.id,
      userId: g.user_id,
      role: { id: g.role_id, name: g.role_name },
      orgUnit: g.unit_id ? { id: g.unit_id, name: g.unit_name! } : null,
      createdAt: iso(g.created_at),
    }));
  }

  async grant(actor: Actor, tenantId: string, input: GrantData): Promise<GrantDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'members.manage',
      workspace: 'roles.manage',
    });
    const member = await this.ctx.db
      .selectFrom('membership as m')
      .innerJoin('user_identity as u', 'u.id', 'm.user_id')
      .select('u.email')
      .where('m.tenant_id', '=', tenantId)
      .where('m.user_id', '=', input.userId)
      .executeTakeFirst();
    if (!member) throw notFound('Member');
    const detail = await withTenant(await this.cell(tenantId), tenantId, async (tx) => {
      const role = await tx
        .selectFrom('workspace_role')
        .select(['name', 'key', 'permissions'])
        .where('id', '=', input.roleId)
        .executeTakeFirst();
      if (!role) throw notFound('Role');
      if (role.key === 'org_admin')
        throw badRequest(
          'Use the member role',
          'Make someone an organisation admin by changing their member role to Administrator.',
        );
      const unit = input.orgUnitId
        ? await tx
            .selectFrom('org_unit')
            .select('name')
            .where('id', '=', input.orgUnitId)
            .executeTakeFirst()
        : null;
      if (input.orgUnitId && !unit) throw notFound('Org unit');
      if (unit && !role.permissions.some((p) => (SCOPABLE_PERMISSIONS as string[]).includes(p))) {
        throw badRequest(
          'Role cannot be scoped',
          `${role.name} has no permissions that apply within an org unit. Grant it for the whole organisation.`,
        );
      }
      try {
        await tx
          .insertInto('role_grant')
          .values({
            id: uuidv7(),
            tenant_id: tenantId,
            user_id: input.userId,
            role_id: input.roleId,
            org_unit_id: input.orgUnitId,
            created_by: actor.id,
          })
          .execute();
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict('Already granted');
        throw e;
      }
      return { role: role.name, unit: unit?.name ?? 'whole organisation' };
    });
    await audit(this.ctx, actor.id, tenantId, 'access.granted', {
      member: member.email,
      ...detail,
    });
    return this.grants(actor, tenantId, input.userId);
  }

  async revokeGrant(actor: Actor, tenantId: string, grantId: string): Promise<GrantDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'members.manage',
      workspace: 'roles.manage',
    });
    const g = await withTenant(await this.cell(tenantId), tenantId, async (tx) => {
      const row = await tx
        .selectFrom('role_grant as g')
        .innerJoin('workspace_role as r', 'r.id', 'g.role_id')
        .select(['g.user_id', 'r.name'])
        .where('g.id', '=', grantId)
        .executeTakeFirst();
      if (!row) throw notFound('Grant');
      await tx.deleteFrom('role_grant').where('id', '=', grantId).execute();
      return row;
    });
    await audit(this.ctx, actor.id, tenantId, 'access.revoked', { role: g.name });
    return this.grants(actor, tenantId, g.user_id);
  }

  // ---------- activity ----------

  async activity(
    actor: Actor,
    tenantId: string,
    page: { page: number; pageSize: number },
  ): Promise<AuditPage> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'logs.system',
      workspace: 'audit.view',
    });
    return this.deps.logs.audit({ tenantId, ...page });
  }

  /** Activity across the organisation: submissions, data volume, projects, people and tickets. */
  async insights(actor: Actor, tenantId: string): Promise<OrgInsightsDto> {
    const policy = await workspacePolicy(this.ctx, actor, tenantId);
    if (!policy) throw forbidden('You are not an active member of this organisation.');
    const since = new Date(this.ctx.now().getTime() - 30 * 86_400_000);
    const prev = new Date(since.getTime() - 30 * 86_400_000);
    const cell = await withTenant(await this.cell(tenantId), tenantId, async (tx) => {
      const days = await sql<{ day: string; n: number }>`
        select to_char(d, 'YYYY-MM-DD') as day, coalesce(count(s.id), 0)::int as n
        from generate_series(date_trunc('day', ${since}::timestamptz), date_trunc('day', ${this.ctx.now()}::timestamptz), interval '1 day') d
        left join submission s on date_trunc('day', s.submitted_at) = d
        group by d order by d
      `.execute(tx);
      const one = async (q: ReturnType<typeof sql<{ n: number }>>) => (await q.execute(tx)).rows[0]?.n ?? 0;
      const projects = await sql<{ status: string; n: number }>`select status, count(*)::int as n from project where archived_at is null group by status`.execute(tx);
      const stale = await one(sql<{ n: number }>`
        select count(distinct j.project_id)::int as n from job j
        where j.enabled and j.freshness_minutes is not null
          and coalesce((select max(finished_at) from run r where r.job_id = j.id and r.status = 'succeeded'), 'epoch') < now() - make_interval(mins => j.freshness_minutes * 3)
      `);
      return {
        days: days.rows,
        prev30: await one(sql<{ n: number }>`select count(*)::int as n from submission where submitted_at >= ${prev} and submitted_at < ${since}`),
        toReview: await one(sql<{ n: number }>`select count(*)::int as n from submission where status = 'in_review'`),
        entities: await one(sql<{ n: number }>`select count(*)::int as n from entity`),
        observations30: await one(sql<{ n: number }>`select count(*)::int as n from observation where recorded_at >= ${since}`),
        projects: projects.rows,
        stale,
      };
    });
    const members = await sql<{ status: string; n: number }>`select status, count(*)::int as n from membership where tenant_id = ${tenantId} group by status`.execute(this.ctx.db);
    const invited = await sql<{ n: number }>`
      select count(*)::int as n from invitation where tenant_id = ${tenantId} and accepted_at is null and revoked_at is null and expires_at > now()
    `.execute(this.ctx.db);
    const tickets = await sql<{ audience: string; n: number }>`
      select audience, count(*)::int as n from support_ticket where tenant_id = ${tenantId} and status in ('open','pending') group by audience
    `.execute(this.ctx.db);
    const by = <T extends { n: number }>(rows: T[], key: keyof T, v: string) => rows.find((r) => r[key] === v)?.n ?? 0;
    return {
      submissionsByDay: cell.days.map((d) => ({ day: d.day, count: d.n })),
      submissions30: cell.days.reduce((s, d) => s + d.n, 0),
      submissionsPrev30: cell.prev30,
      toReview: cell.toReview,
      entities: cell.entities,
      observations30: cell.observations30,
      projects: { live: by(cell.projects, 'status', 'live'), draft: by(cell.projects, 'status', 'draft'), stale: cell.stale },
      members: { active: by(members.rows, 'status', 'active'), suspended: by(members.rows, 'status', 'suspended'), invited: invited.rows[0]?.n ?? 0 },
      tickets: { internalOpen: by(tickets.rows, 'audience', 'organisation'), platformOpen: by(tickets.rows, 'audience', 'platform') },
    };
  }
}
