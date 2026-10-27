import { sql, type Transaction } from 'kysely';
import { withTenant, type CellDB } from '@grids/db';
import {
  DataError,
  ensureProjectEntity,
  entityType,
  fireEvent,
  PROJECT_TYPE_KEY,
  freshness,
  moveEntity,
  upsertEntities,
  worstFreshness,
  writeObservations,
  inProject,
  importEntityRows,
} from '@grids/data';
import {
  DEFAULT_DATA_GROUP,
  elementRef,
  ExplorerConfig,
  Marker,
  ReportingConfig,
  PROJECT_ROLES,
  roleAtLeast,
  uuidv7,
  type AttributeDef,
  type DataElementDto,
  type DataGroupDto,
  type EntityDetail,
  type EntitySummary,
  type EntityTypeDto,
  type Freshness,
  type Geometry,
  type LimitKey,
  type Page,
  type PermissionGroupDto,
  type PlanLimits,
  type PointGeometry,
  type ProjectDto,
  type ProjectMemberDto,
  type ProjectRole,
  ROOT_PARENT,
  attributeProblem,
} from '@grids/schema';
import type { z } from 'zod';
import type {
  DataElementInput,
  DataGroupInput,
  EntityInput,
  EntityQuery,
  EntitySyncDto,
  EntitySyncQuery,
  EntityTypeInput,
  EntityUpdate,
  GeoQuery,
  ImportRowsInput,
  ObservationBatch,
  PermissionGroupInput,
  ProjectInput,
  ProjectMemberInput,
  ProjectUpdate,
} from '@grids/schema';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../errors.js';
import { can } from './authz.js';
import { changes, show } from './changes.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { assertWithinLimit } from './entitlements.js';
import { applyOrgTypes } from './org-types.js';
import { workspacePolicy } from './policy.js';
import { scopeAnd, within, type Scope } from './scope.js';
import { iso, isUniqueViolation } from './util.js';

type Tx = Transaction<CellDB>;

/** A place's map marker properties: its type's marker style and icon, rotation, and centre point. */
export function markerProps(r: {
  icon: string;
  marker: unknown;
  attributes: Record<string, unknown>;
  point: string | null;
}) {
  const m = Marker.parse(r.marker ?? {});
  const turn = m.rotateBy ? Number(r.attributes[m.rotateBy]) : NaN;
  return {
    marker: m.style,
    icon: r.icon,
    ...(Number.isFinite(turn) && { rotation: turn }),
    ...(r.point && { point: (JSON.parse(r.point) as PointGeometry).coordinates }),
  };
}

/** A project's explorer layout from its settings (defaults when never set). */
/** A project's reporting periods from its settings (the defaults when never set). */
export const reportingOf = (settings: unknown): ReportingConfig => {
  const r = ReportingConfig.safeParse((settings as { reporting?: unknown } | null)?.reporting ?? {});
  // Anything saved in an older shape falls back to the standard periods.
  return r.success ? r.data : ReportingConfig.parse({});
};
export const explorerOf = (settings: unknown): ExplorerConfig => ExplorerConfig.parse((settings as { explorer?: unknown } | null)?.explorer ?? {});

type ProjectRow = {
  id: string;
  key: string;
  name: string;
  description: string;
  visibility: 'private' | 'organisation' | 'public';
  template: string | null;
  color: string;
  icon: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  status: 'draft' | 'live';
  logo: string | null;
  cover_image: string | null;
  settings: unknown;
};

/** The caller's effective access to one project. */
const LABEL = { name: 'Name', description: 'Description', visibility: 'Visibility', color: 'Colour', icon: 'Icon', status: 'Status' } as const;

export interface ProjectAccess {
  project: ProjectRow;
  role: ProjectRole;
  /** Explicitly added to the project (or a manager): may fill in forms. */
  member: boolean;
  /** Entity subtree the caller is limited to (scoped members), else null. */
  roots: Scope;
  /** Permission groups whose visuals the caller sees ('all' for managers). */
  groups: Set<string> | 'all';
}

/** Whether a visual that needs `group` (none = unrestricted) is visible with this access. */
export const canSee = (a: Pick<ProjectAccess, 'groups'>, group: string | null | undefined) => !group || a.groups === 'all' || a.groups.has(group);

/** Shown when a project tries to change an entity the organisation owns. */
const SHARED_MESSAGE = 'This entity is shared across the organisation. Change it under the organisation’s shared entities.';

/** Hook that installs a project template (set by the composition root). */
export type TemplateInstaller = (
  tx: Tx,
  ctx: { tenantId: string; projectId: string; actorId: string; template: string },
) => Promise<void>;

/** Translates data-layer errors into HTTP errors. */
export async function dataCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DataError) throw new HttpError(e.status, e.message);
    throw e;
  }
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'project';

/** Projects and the canonical data model (M3). */
export class ProjectService {
  private installTemplate: TemplateInstaller = async () => undefined;

  constructor(private readonly ctx: ServiceContext) {}

  setTemplateInstaller(fn: TemplateInstaller) {
    this.installTemplate = fn;
  }

  async cellTx<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(await this.ctx.cells.forTenant(tenantId), tenantId, fn);
  }

  // ---------- access ----------

  /**
   * Resolves the caller's role in a project (by id or key). Organisation admins and
   * holders of `projects.manage` are managers everywhere; others need a project
   * membership, or the project must be visible to the whole organisation. Platform
   * staff with `tenants.view` get read access for support.
   */
  async access(actor: Actor, tenantId: string, project: string, need: ProjectRole = 'viewer'): Promise<ProjectAccess> {
    const policy = await workspacePolicy(this.ctx, actor, tenantId);
    const staffView = !policy && can(actor, 'tenants.view');
    if (!policy && !staffView) throw forbidden('You are not a member of this organisation.');
    return this.cellTx(tenantId, async (tx) => {
      const p = await tx
        .selectFrom('project')
        .selectAll()
        .where((eb) => (/^[0-9a-f-]{36}$/.test(project) ? eb('id', '=', project) : eb('key', '=', project)))
        .executeTakeFirst();
      if (!p) throw notFound('Project');
      let role: ProjectRole | null = null;
      let roots: Scope = null;
      let held: string[] = [];
      let member = false;
      if (policy && (policy.role === 'org_admin' || policy.has('projects.manage'))) role = 'manager';
      else {
        const m = policy
          ? await tx
              .selectFrom('project_member as m')
              .select(['m.role', 'm.permission_groups', 'm.root_entity_ids'])
              .where('m.project_id', '=', p.id)
              .where('m.user_id', '=', actor.id)
              .executeTakeFirst()
          : undefined;
        if (m) {
          member = true;
          role = m.role;
          // Limited to some entities: their subtrees. If none of them still exist the member sees nothing, not everything.
          if (m.root_entity_ids.length)
            roots = (await tx.selectFrom('entity').select(sql<string>`path::text`.as('path')).where(inProject('entity', p.id)).where('id', 'in', m.root_entity_ids).execute()).map((r) => r.path);
          held = m.permission_groups;
        } else if (staffView || (p.visibility !== 'private' && p.status === 'live')) role = 'viewer';
      }
      if (!role) throw notFound('Project');
      if (!roleAtLeast(role, need)) throw forbidden(`Requires the project ${need} role.`);
      const groups = role === 'manager' ? ('all' as const) : await this.groupsOf(tx, p.id, held);
      return { project: p as ProjectRow, role, member: member || role === 'manager', roots, groups };
    });
  }

  /** Every permission the given ones cover (each with everything below it). */
  async groupsOf(tx: Tx, projectId: string, groups: string[]): Promise<Set<string>> {
    const sets = await Promise.all(groups.map((g) => this.groupsBelow(tx, projectId, g)));
    return new Set(sets.flatMap((s) => [...s]));
  }

  /** A permission and every permission below it (what its members may see). */
  async groupsBelow(tx: Tx, projectId: string, group: string | null): Promise<Set<string>> {
    if (!group) return new Set();
    const g = await tx.selectFrom('permission_group').select('kind').where('project_id', '=', projectId).where('id', '=', group).executeTakeFirst();
    if (!g) return new Set();
    // The project admin permission sits above every other one.
    if (g.kind === 'admin')
      return new Set((await tx.selectFrom('permission_group').select('id').where('project_id', '=', projectId).execute()).map((r) => r.id));
    const rows = await sql<{ id: string }>`
      with recursive below as (
        select id from permission_group where project_id = ${projectId} and id = ${group}
        union
        select g.id from permission_group g join below b on g.parent_id = b.id where g.project_id = ${projectId}
      )
      select id from below
    `.execute(tx);
    return new Set(rows.rows.map((r) => r.id));
  }

  // ---------- permission groups ----------

  async permissionGroups(actor: Actor, tenantId: string, project: string): Promise<PermissionGroupDto[]> {
    const a = await this.access(actor, tenantId, project);
    return this.cellTx(tenantId, (tx) => this.groupTree(tx, a.project.id));
  }

  private async groupTree(tx: Tx, projectId: string): Promise<PermissionGroupDto[]> {
    const rows = await tx.selectFrom('permission_group').selectAll().where('project_id', '=', projectId).orderBy('name').execute();
    const counts = new Map(
      (
        await sql<{ g: string; n: string }>`
          select g, count(*)::text as n from project_member, unnest(permission_groups) as g
          where project_id = ${projectId} group by g
        `.execute(tx)
      ).rows.map((r) => [r.g, Number(r.n)]),
    );
    // Depth-first from the top so children follow their parent; the admin group comes first.
    const out: PermissionGroupDto[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const g of rows
        .filter((r) => r.parent_id === parent)
        .sort((x, y) => Number(y.system) - Number(x.system) || Number(y.kind === 'admin') - Number(x.kind === 'admin'))) {
        out.push({
          id: g.id,
          name: g.name,
          description: g.description,
          parent: g.parent_id,
          depth,
          memberCount: counts.get(g.id) ?? 0,
          system: g.system,
          kind: g.kind,
        });
        walk(g.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  async savePermissionGroup(actor: Actor, tenantId: string, project: string, input: z.output<typeof PermissionGroupInput>, id?: string): Promise<PermissionGroupDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    await this.cellTx(tenantId, async (tx) => {
      const existing = id ? await tx.selectFrom('permission_group').select(['id', 'system']).where('project_id', '=', a.project.id).where('id', '=', id).executeTakeFirst() : undefined;
      if (id && !existing) throw notFound('Permission');
      if (input.parent) {
        if (input.parent === id) throw badRequest('A permission cannot be its own parent');
        const parent = await tx.selectFrom('permission_group').select('kind').where('project_id', '=', a.project.id).where('id', '=', input.parent).executeTakeFirst();
        if (!parent) throw badRequest('Unknown parent permission');
        if (parent.kind === 'public') throw badRequest('The public permission cannot have subpermissions');
        if (id && (await this.groupsBelow(tx, a.project.id, id)).has(input.parent)) throw badRequest('A permission cannot sit below one of its own subpermissions');
      }
      if (existing?.system && input.parent) throw badRequest('Built-in permissions stay at the top');
      const taken = await tx.selectFrom('permission_group').select('id').where('project_id', '=', a.project.id).where(sql<string>`lower(name)`, '=', input.name.toLowerCase()).executeTakeFirst();
      if (taken && taken.id !== id) throw conflict('Name taken', `A permission named "${input.name}" already exists.`);
      const values = { name: input.name, description: input.description, parent_id: input.parent };
      if (id) await tx.updateTable('permission_group').set(values).where('project_id', '=', a.project.id).where('id', '=', id).execute();
      else await tx.insertInto('permission_group').values({ id: uuidv7(), tenant_id: tenantId, project_id: a.project.id, ...values }).execute();
    });
    await audit(this.ctx, actor.id, tenantId, id ? 'permission_group.updated' : 'permission_group.created', { project: a.project.key, group: id ?? input.name });
    return this.permissionGroups(actor, tenantId, project);
  }

  /** Deletes a group nothing refers to (members, subgroups, dashboards, widgets, overlays). */
  async deletePermissionGroup(actor: Actor, tenantId: string, project: string, id: string): Promise<PermissionGroupDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    await this.cellTx(tenantId, async (tx) => {
      const g = await tx.selectFrom('permission_group').select('system').where('project_id', '=', a.project.id).where('id', '=', id).executeTakeFirst();
      if (!g) throw notFound('Permission');
      if (g.system) throw conflict('Built-in permission', 'Built-in permissions can’t be deleted.');
      const used = await sql<{ what: string }>`
        select 'members' as what from project_member where project_id = ${a.project.id} and ${id} = any(permission_groups)
        union all select 'subpermissions' from permission_group where project_id = ${a.project.id} and parent_id = ${id}
        union all select 'dashboards' from dashboard where project_id = ${a.project.id}
          and (permission_group = ${id} or widgets @> ${JSON.stringify([{ permissionGroup: id }])}::jsonb)
        union all select 'map overlays' from map_overlay where project_id = ${a.project.id} and config ->> 'permissionGroup' = ${id}
        union all select 'forms' from form where project_id = ${a.project.id} and settings::text like ${`%${id}%`}
      `.execute(tx);
      if (used.rows.length) throw conflict('Permission in use', `Still used by ${[...new Set(used.rows.map((r) => r.what))].join(', ')}. Reassign them first.`);
      await tx.deleteFrom('permission_group').where('project_id', '=', a.project.id).where('id', '=', id).execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'permission_group.deleted', { project: a.project.key, group: id });
    return this.permissionGroups(actor, tenantId, project);
  }

  /** Throws unless `group` is null or a group of the project. */
  async assertGroup(tx: Tx, projectId: string, group: string | null | undefined) {
    if (!group) return;
    const g = await tx.selectFrom('permission_group').select('id').where('project_id', '=', projectId).where('id', '=', group).executeTakeFirst();
    if (!g) throw badRequest('Unknown permission');
  }

  /** Display names (or emails) of users, by id. */
  async userNames(ids: (string | null)[]): Promise<Map<string, string | null>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    return new Map(
      list.length
        ? (await this.ctx.db.selectFrom('user_identity').select(['id', 'display_name', 'email']).where('id', 'in', list).execute()).map((u) => [u.id, u.display_name ?? u.email])
        : [],
    );
  }

  private async planLimits(tenantId: string): Promise<PlanLimits> {
    const row = await this.ctx.db
      .selectFrom('tenant as t')
      .leftJoin('plan as p', 'p.id', 't.plan_id')
      .select('p.limits')
      .where('t.id', '=', tenantId)
      .executeTakeFirst();
    return (row?.limits as PlanLimits | null) ?? ({} as PlanLimits);
  }

  async projectCount(tenantId: string): Promise<number> {
    return this.cellTx(tenantId, async (tx) => {
      const r = await tx
        .selectFrom('project')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();
      return Number(r.n);
    });
  }

  // ---------- projects ----------

  private async projectFreshness(tx: Tx, projectIds: string[]): Promise<Map<string, Freshness>> {
    if (!projectIds.length) return new Map();
    const rows = await tx
      .selectFrom('job as j')
      .select([
        'j.project_id',
        'j.freshness_minutes',
        (eb) =>
          eb
            .selectFrom('run as r')
            .select((e2) => e2.fn.max('r.finished_at').as('f'))
            .whereRef('r.job_id', '=', 'j.id')
            .where('r.status', '=', 'succeeded')
            .as('last_success'),
      ])
      .where('j.project_id', 'in', projectIds)
      .where('j.freshness_minutes', 'is not', null)
      .where('j.enabled', '=', true)
      .execute();
    const now = this.ctx.now();
    const by = new Map<string, Freshness[]>();
    for (const r of rows)
      by.set(r.project_id, [...(by.get(r.project_id) ?? []), freshness(r.last_success as Date | null, r.freshness_minutes, now)]);
    return new Map(projectIds.map((id) => [id, worstFreshness(by.get(id) ?? [])]));
  }

  private async toDtos(tx: Tx, rows: ProjectRow[], roles: Map<string, ProjectRole | null>): Promise<ProjectDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const count = async (table: 'project_member' | 'job' | 'dashboard' | 'form') =>
      new Map(
        (
          await tx
            .selectFrom(table)
            .select(['project_id', (eb) => eb.fn.countAll<string>().as('n')])
            .where('project_id', 'in', ids)
            .groupBy('project_id')
            .execute()
        ).map((r) => [r.project_id, Number(r.n)]),
      );
    // A project's own entity is not data the people in it collected.
    const countEntities = async () =>
      new Map(
        (
          await tx
            .selectFrom('entity as e')
            .innerJoin('entity_type as t', 't.id', 'e.type_id')
            .select(['e.project_id', (eb) => eb.fn.countAll<string>().as('n')])
            .where('e.project_id', 'in', ids)
            .where('t.system', '=', false)
            .groupBy('e.project_id')
            .execute()
        ).map((r) => [r.project_id, Number(r.n)]),
      );
    const [entities, members, jobs, dashboards, forms, fresh] = await Promise.all([
      countEntities(),
      count('project_member'),
      count('job'),
      count('dashboard'),
      count('form'),
      this.projectFreshness(tx, ids),
    ]);
    return rows.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      visibility: p.visibility,
      color: p.color,
      icon: p.icon,
      template: p.template,
      status: p.status,
      logo: p.logo,
      coverImage: p.cover_image,
      explorer: explorerOf(p.settings),
      reporting: reportingOf(p.settings),
      myRole: roles.get(p.id) ?? null,
      counts: {
        entities: entities.get(p.id) ?? 0,
        members: members.get(p.id) ?? 0,
        jobs: jobs.get(p.id) ?? 0,
        dashboards: dashboards.get(p.id) ?? 0,
        forms: forms.get(p.id) ?? 0,
      },
      freshness: fresh.get(p.id)!,
      createdAt: iso(p.created_at),
      updatedAt: iso(p.updated_at),
      archived: !!p.archived_at,
    }));
  }

  /** Projects the caller can see. */
  async list(actor: Actor, tenantId: string, opts: { archived?: boolean | 'all' } = {}): Promise<ProjectDto[]> {
    const policy = await workspacePolicy(this.ctx, actor, tenantId);
    if (!policy && !can(actor, 'tenants.view')) throw forbidden();
    const all = !policy || policy.role === 'org_admin' || policy.has('projects.manage');
    return this.cellTx(tenantId, async (tx) => {
      const mine = new Map(
        (await tx.selectFrom('project_member').select(['project_id', 'role']).where('user_id', '=', actor.id).execute()).map((m) => [
          m.project_id,
          m.role,
        ]),
      );
      let q = tx.selectFrom('project').selectAll().orderBy('name');
      if (opts.archived !== 'all') q = opts.archived ? q.where('archived_at', 'is not', null) : q.where('archived_at', 'is', null);
      if (!all)
        q = q.where((eb) =>
          eb.or([eb.and([eb('visibility', '<>', 'private'), eb('status', '=', 'live')]), ...(mine.size ? [eb('id', 'in', [...mine.keys()])] : [])]),
        );
      const rows = (await q.execute()) as ProjectRow[];
      const roles = new Map(rows.map((p) => [p.id, policy && all ? ('manager' as const) : (mine.get(p.id) ?? 'viewer')]));
      return this.toDtos(tx, rows, roles);
    });
  }

  async get(actor: Actor, tenantId: string, project: string): Promise<ProjectDto> {
    const a = await this.access(actor, tenantId, project);
    return this.cellTx(tenantId, async (tx) => (await this.toDtos(tx, [a.project], new Map([[a.project.id, a.role]])))[0]!);
  }

  async create(actor: Actor, tenantId: string, input: z.output<typeof ProjectInput>): Promise<ProjectDto> {
    const policy = await workspacePolicy(this.ctx, actor, tenantId);
    if (!policy || !(policy.role === 'org_admin' || policy.has('projects.create')))
      throw forbidden('Requires the "projects.create" permission.');
    assertWithinLimit(await this.planLimits(tenantId), 'projects' as LimitKey, await this.projectCount(tenantId));
    const id = uuidv7();
    const managers = [...new Set(input.managerIds)].filter((m) => m !== actor.id);
    if (managers.length) {
      const active = await this.ctx.db
        .selectFrom('membership')
        .select('user_id')
        .where('tenant_id', '=', tenantId)
        .where('user_id', 'in', managers)
        .where('status', '=', 'active')
        .execute();
      if (active.length !== managers.length) throw badRequest('Every manager must be an active member of the organisation');
    }
    try {
      await this.cellTx(tenantId, async (tx) => {
        let key = input.key ?? slugify(input.name);
        if (!input.key) {
          for (let n = 2; await tx.selectFrom('project').select('id').where('key', '=', key).executeTakeFirst(); n++)
            key = `${slugify(input.name).slice(0, 45)}-${n}`;
        }
        await tx
          .insertInto('project')
          .values({
            id,
            tenant_id: tenantId,
            key,
            name: input.name,
            description: input.description,
            visibility: input.visibility,
            color: input.color,
            icon: input.icon,
            template: input.template === 'blank' ? null : input.template,
            status: input.status,
            logo: input.logo,
            cover_image: input.coverImage,
            settings: JSON.stringify({ explorer: input.explorer, reporting: input.reporting }),
            created_by: actor.id,
          })
          .execute();
        const adminGroup = uuidv7();
        await tx
          .insertInto('permission_group')
          .values([
            { id: adminGroup, tenant_id: tenantId, project_id: id, name: `${input.name} Admin`, description: 'Administers the project and sees everything in it.', parent_id: null, system: true, kind: 'admin' },
            { id: uuidv7(), tenant_id: tenantId, project_id: id, name: `${input.name} Public`, description: 'Open to anyone who can view the project’s public items.', parent_id: null, system: true, kind: 'public' },
          ])
          .execute();
        const manager = {
          project_id: id,
          tenant_id: tenantId,
          role: 'manager' as const,
          permission_groups: [adminGroup],
        };
        await tx
          .insertInto('project_member')
          .values({ ...manager, user_id: actor.id })
          .execute();
        if (managers.length)
          await tx
            .insertInto('project_member')
            .values(managers.map((user_id) => ({ ...manager, user_id })))
            .execute();
        await ensureProjectEntity(tx, { tenantId, projectId: id, key, name: input.name });
        if (input.template !== 'blank')
          await dataCall(() => this.installTemplate(tx, { tenantId, projectId: id, actorId: actor.id, template: input.template }));
        await applyOrgTypes(tx, tenantId, id);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Project key taken', `Another project already uses the key "${input.key}".`);
      throw e;
    }
    await audit(this.ctx, actor.id, tenantId, 'project.created', { name: input.name, template: input.template, visibility: input.visibility });
    return this.get(actor, tenantId, id);
  }

  async update(actor: Actor, tenantId: string, project: string, input: z.output<typeof ProjectUpdate>): Promise<ProjectDto> {
    const a = await this.access(actor, tenantId, project, 'manager');
    const { coverImage, explorer, reporting, ...rest } = input;
    await this.cellTx(tenantId, async (tx) => {
      await tx
        .updateTable('project')
        .set({
          ...rest,
          ...(coverImage !== undefined && { cover_image: coverImage }),
          ...((explorer || reporting) && { settings: sql`settings || ${JSON.stringify({ ...(explorer && { explorer: { ...explorerOf(a.project.settings), ...explorer } }), ...(reporting && { reporting }) })}::jsonb` }),
          updated_at: this.ctx.now(),
        })
        .where('id', '=', a.project.id)
        .execute();
      if (input.name && input.name !== a.project.name)
        await tx.updateTable('entity').set({ name: input.name }).where('project_id', '=', a.project.id).where('type_id', 'in', tx.selectFrom('entity_type').select('id').where('project_id', '=', a.project.id).where('key', '=', PROJECT_TYPE_KEY)).execute();
      // The built-in permissions follow the project's name unless they were renamed.
      if (input.name && input.name !== a.project.name)
        for (const [kind, suffix] of [['admin', 'Admin'], ['public', 'Public']] as const)
          await tx
            .updateTable('permission_group')
            .set({ name: `${input.name} ${suffix}` })
            .where('project_id', '=', a.project.id)
            .where('kind', '=', kind)
            .where('name', '=', `${a.project.name} ${suffix}`)
            .execute();
    });
    const was = a.project as unknown as Record<string, unknown>;
    const wasExplorer = explorerOf(a.project.settings) as Record<string, unknown>;
    await audit(this.ctx, actor.id, tenantId, 'project.updated', {
      project: a.project.key,
      ...rest,
      ...(rest.logo !== undefined && { logo: rest.logo ? 'set' : 'none' }),
      ...(coverImage !== undefined && { coverImage: coverImage ? 'set' : 'none' }),
      changes: changes([
        ...(['name', 'description', 'visibility', 'color', 'icon', 'status'] as const).flatMap((k): [string, unknown, unknown][] => (rest[k] !== undefined ? [[LABEL[k], was[k], rest[k]]] : [])),
        ...(rest.logo !== undefined ? ([['Logo', was.logo ? 'Set' : null, rest.logo ? 'Set' : null]] as [string, unknown, unknown][]) : []),
        ...(coverImage !== undefined ? ([['Cover picture', was.cover_image ? 'Set' : null, coverImage ? 'Set' : null]] as [string, unknown, unknown][]) : []),
        ...Object.entries(explorer ?? {}).map(([k, v]): [string, unknown, unknown] => [`Explorer: ${k}`, wasExplorer[k], v]),
      ]),
    });
    return this.get(actor, tenantId, a.project.id);
  }

  async setArchived(actor: Actor, tenantId: string, project: string, archived: boolean): Promise<ProjectDto> {
    const a = await this.access(actor, tenantId, project, 'manager');
    await this.cellTx(tenantId, async (tx) => {
      await tx
        .updateTable('project')
        .set({ archived_at: archived ? this.ctx.now() : null, updated_at: this.ctx.now() })
        .where('id', '=', a.project.id)
        .execute();
      // Archived projects stop running scheduled jobs.
      if (archived) await tx.deleteFrom('job_schedule').where('job_id', 'in', tx.selectFrom('job').select('id').where('project_id', '=', a.project.id)).execute();
    });
    await audit(this.ctx, actor.id, tenantId, archived ? 'project.archived' : 'project.restored', { project: a.project.key });
    return this.get(actor, tenantId, a.project.id);
  }

  // ---------- members ----------

  async members(actor: Actor, tenantId: string, project: string): Promise<ProjectMemberDto[]> {
    const a = await this.access(actor, tenantId, project);
    const explicit = await this.cellTx(tenantId, (tx) =>
      tx
        .selectFrom('project_member as m')
        .select(['m.user_id', 'm.role', 'm.permission_groups', 'm.root_entity_ids'])
        .where('m.project_id', '=', a.project.id)
        .execute(),
    );
    const rootIds = [...new Set(explicit.flatMap((m) => m.root_entity_ids))];
    const roots = new Map(
      rootIds.length
        ? (
            await this.cellTx(tenantId, (tx) =>
              tx.selectFrom('entity as e').innerJoin('entity_type as t', 't.id', 'e.type_id').select(['e.id', 'e.name', 't.name as type']).where('e.id', 'in', rootIds).execute(),
            )
          ).map((r) => [r.id, { id: r.id, name: r.name, type: r.type }])
        : [],
    );
    const admins = await this.ctx.db
      .selectFrom('membership')
      .select('user_id')
      .where('tenant_id', '=', tenantId)
      .where('role', '=', 'org_admin')
      .where('status', '=', 'active')
      .execute();
    const ids = [...new Set([...explicit.map((m) => m.user_id), ...admins.map((m) => m.user_id)])];
    const people = new Map(
      ids.length
        ? (await this.ctx.db.selectFrom('user_identity').select(['id', 'display_name', 'email']).where('id', 'in', ids).execute()).map((u) => [u.id, u])
        : [],
    );
    const out: ProjectMemberDto[] = explicit.map((m) => ({
      userId: m.user_id,
      name: people.get(m.user_id)?.display_name ?? null,
      email: people.get(m.user_id)?.email ?? null,
      role: m.role,
      rootEntities: m.root_entity_ids.flatMap((id) => roots.get(id) ?? []),
      implicit: false,
      permissionGroups: m.permission_groups,
    }));
    for (const ad of admins)
      if (!explicit.some((m) => m.user_id === ad.user_id))
        out.push({
          userId: ad.user_id,
          name: people.get(ad.user_id)?.display_name ?? null,
          email: people.get(ad.user_id)?.email ?? null,
          role: 'manager',
          rootEntities: [],
          implicit: true,
          permissionGroups: [],
        });
    return out.sort((x, y) => PROJECT_ROLES.indexOf(x.role) - PROJECT_ROLES.indexOf(y.role) || (x.name ?? '').localeCompare(y.name ?? ''));
  }

  async setMember(actor: Actor, tenantId: string, project: string, input: z.output<typeof ProjectMemberInput>): Promise<ProjectMemberDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    const member = await this.ctx.db
      .selectFrom('membership')
      .select('status')
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', input.userId)
      .executeTakeFirst();
    if (member?.status !== 'active') throw badRequest('Only active members of the organisation can join a project');
    let delta: ReturnType<typeof changes> = [];
    await this.cellTx(tenantId, async (tx) => {
      if (input.rootEntityIds.length) {
        const found = await tx.selectFrom('entity').select('id').where('id', 'in', input.rootEntityIds).where(inProject('entity', a.project.id)).execute();
        if (found.length !== new Set(input.rootEntityIds).size) throw badRequest('An entity is not in this project');
      }
      const held = [...new Set(input.permissionGroups)];
      for (const g of held) await this.assertGroup(tx, a.project.id, g);
      const admin = held.length
        ? await tx.selectFrom('permission_group').select('id').where('project_id', '=', a.project.id).where('id', 'in', held).where('kind', '=', 'admin').executeTakeFirst()
        : undefined;
      const role = admin ? ('manager' as const) : ('viewer' as const);
      if (role !== 'manager') await this.assertNotLastManager(tx, a.project.id, input.userId);
      // What they had before, to show beside what they have now.
      const prev = await tx.selectFrom('project_member').select(['role', 'root_entity_ids', 'permission_groups']).where('project_id', '=', a.project.id).where('user_id', '=', input.userId).executeTakeFirst();
      const gids = [...new Set([...(prev?.permission_groups ?? []), ...held])];
      const gname = new Map((gids.length ? await tx.selectFrom('permission_group').select(['id', 'name']).where('id', 'in', gids).execute() : []).map((g) => [g.id, g.name]));
      const roots = (n: number | undefined) => (n ? `${n} ${n === 1 ? 'place' : 'places'}` : prev || n === 0 ? 'Everywhere' : null);
      delta = changes([
        ['Role', prev?.role, role],
        ['Permission groups', (prev?.permission_groups ?? []).map((g) => gname.get(g) ?? g), held.map((g) => gname.get(g) ?? g)],
        ['Limited to', prev ? roots(prev.root_entity_ids.length) : null, roots(new Set(input.rootEntityIds).size)],
      ]);
      await tx
        .insertInto('project_member')
        .values({ project_id: a.project.id, tenant_id: tenantId, user_id: input.userId, role, root_entity_ids: [...new Set(input.rootEntityIds)], permission_groups: held })
        .onConflict((oc) => oc.columns(['project_id', 'user_id']).doUpdateSet({ role, root_entity_ids: [...new Set(input.rootEntityIds)], permission_groups: held }))
        .execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'project.member_set', { project: a.project.key, user: input.userId, member: (await this.ctx.db.selectFrom('user_identity').select('email').where('id', '=', input.userId).executeTakeFirst())?.email ?? undefined, permissions: input.permissionGroups, changes: delta });
    return this.members(actor, tenantId, project);
  }

  /** A project keeps at least one manager: its last one can't be removed or moved out of the Admin permission. */
  private async assertNotLastManager(tx: Tx, projectId: string, userId: string) {
    const managers = await tx.selectFrom('project_member').select('user_id').where('project_id', '=', projectId).where('role', '=', 'manager').execute();
    if (managers.length === 1 && managers[0]!.user_id === userId)
      throw conflict('Last manager', 'Put someone else in the Admin permission before changing the last one.');
  }

  async removeMember(actor: Actor, tenantId: string, project: string, userId: string): Promise<ProjectMemberDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    await this.cellTx(tenantId, async (tx) => {
      await this.assertNotLastManager(tx, a.project.id, userId);
      await tx.deleteFrom('project_member').where('project_id', '=', a.project.id).where('user_id', '=', userId).execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'project.member_removed', { project: a.project.key, user: userId });
    return this.members(actor, tenantId, project);
  }

  // ---------- entity types ----------

  async types(actor: Actor, tenantId: string, project: string): Promise<EntityTypeDto[]> {
    const a = await this.access(actor, tenantId, project);
    return this.cellTx(tenantId, async (tx) => {
      const rows = await tx
        .selectFrom('entity_type as t')
        .selectAll('t')
        .select(sql<string>`(select count(*) from entity e where e.type_id = t.id
            or (t.org_type_id is not null and e.type_id in (select s.id from entity_type s where s.org_type_id = t.org_type_id and s.project_id is null)))`.as('count'))
        .where('t.project_id', '=', a.project.id)
        .where('t.system', '=', false)
        .orderBy('t.sort')
        .orderBy('t.name')
        .execute();
      return rows.map((t) => ({
        id: t.id,
        key: t.key,
        name: t.name,
        plural: t.plural,
        icon: t.icon,
        color: t.color,
        geometry: t.geometry,
        marker: Marker.parse(t.marker ?? {}),
        attributes: t.attributes as AttributeDef[],
        parentTypes: t.parent_types,
        maxPerProject: t.max_per_project,
        orgId: t.org_type_id,
        count: Number(t.count ?? 0),
      }));
    });
  }

  async saveType(actor: Actor, tenantId: string, project: string, input: z.output<typeof EntityTypeInput>, existingKey?: string): Promise<EntityTypeDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    const keys = input.attributes.map((x) => x.key);
    if (new Set(keys).size !== keys.length) throw badRequest('Attribute keys must be unique');
    if (input.key === PROJECT_TYPE_KEY || existingKey === PROJECT_TYPE_KEY) throw badRequest(`"${PROJECT_TYPE_KEY}" is reserved for the project itself`);
    try {
      await this.cellTx(tenantId, async (tx) => {
        if (existingKey) await this.assertNotOrgManaged(tx, a.project.id, existingKey);
        const others = await tx.selectFrom('entity_type').select('key').where('project_id', '=', a.project.id).where('system', '=', false).execute();
        const unknownParents = input.parentTypes.filter((p) => p !== ROOT_PARENT && !others.some((o) => o.key === p) && p !== input.key);
        if (unknownParents.length) throw badRequest(`Unknown parent type: ${unknownParents.join(', ')}`);
        const values = {
          key: input.key,
          name: input.name,
          plural: input.plural,
          icon: input.icon,
          color: input.color,
          geometry: input.geometry,
          marker: JSON.stringify(input.marker),
          attributes: JSON.stringify(input.attributes),
          parent_types: input.parentTypes,
          max_per_project: input.maxPerProject,
        };
        if (existingKey) {
          const r = await tx.updateTable('entity_type').set(values).where('project_id', '=', a.project.id).where('key', '=', existingKey).executeTakeFirst();
          if (!r.numUpdatedRows) throw notFound('Entity type');
        } else {
          await tx
            .insertInto('entity_type')
            .values({ id: uuidv7(), tenant_id: tenantId, project_id: a.project.id, sort: others.length, ...values })
            .execute();
        }
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Key taken', `An entity type with key "${input.key}" already exists.`);
      throw e;
    }
    return this.types(actor, tenantId, project);
  }

  /** Types the organisation defines are edited and removed there, not in a project. */
  private async assertNotOrgManaged(tx: Tx, projectId: string, key: string) {
    const t = await tx.selectFrom('entity_type').select('org_type_id').where('project_id', '=', projectId).where('key', '=', key).executeTakeFirst();
    if (t?.org_type_id) throw forbidden('This type is managed by the organisation. Change it in the organisation’s entity types.');
  }

  async deleteType(actor: Actor, tenantId: string, project: string, key: string): Promise<EntityTypeDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    if (key === PROJECT_TYPE_KEY) throw badRequest('The project itself cannot be deleted as a type');
    await this.cellTx(tenantId, async (tx) => {
      const t = await tx.selectFrom('entity_type').select('id').where('project_id', '=', a.project.id).where('key', '=', key).executeTakeFirst();
      if (!t) throw notFound('Entity type');
      await this.assertNotOrgManaged(tx, a.project.id, key);
      const used = await tx.selectFrom('entity').select('id').where('type_id', '=', t.id).executeTakeFirst();
      if (used) throw conflict('Type in use', 'Delete or move its entities first.');
      await tx.deleteFrom('entity_type').where('id', '=', t.id).execute();
    });
    return this.types(actor, tenantId, project);
  }

  // ---------- data elements ----------

  async elements(actor: Actor, tenantId: string, project: string): Promise<DataElementDto[]> {
    const a = await this.access(actor, tenantId, project);
    return this.cellTx(tenantId, async (tx) => {
      const rows = await tx
        .selectFrom('data_element as d')
        .selectAll('d')
        .select((eb) => [
          eb.selectFrom('observation as o').select((e2) => e2.fn.countAll<string>().as('n')).whereRef('o.element_id', '=', 'd.id').as('n'),
          eb.selectFrom('observation as o').select((e2) => e2.fn.max('o.at').as('m')).whereRef('o.element_id', '=', 'd.id').as('last_at'),
        ])
        .where('d.project_id', '=', a.project.id)
        .orderBy('d.name')
        .execute();
      const linked = await this.formsUsing(tx, a.project.id);
      const groupNames = new Map((await tx.selectFrom('data_group').select(['key', 'name']).where('project_id', '=', a.project.id).execute()).map((g) => [g.key, g.name]));
      return rows.map((d) => ({
        id: d.id,
        group: d.group_key,
        groupName: d.group_key === DEFAULT_DATA_GROUP ? 'General' : (groupNames.get(d.group_key) ?? d.group_key),
        ref: d.ref,
        key: d.key,
        name: d.name,
        description: d.description,
        forms: linked.get(d.ref) ?? [],
        valueType: d.value_type,
        unit: d.unit,
        aggregation: d.aggregation,
        observationCount: Number(d.n ?? 0),
        lastAt: d.last_at ? iso(d.last_at as Date) : null,
      }));
    });
  }

  /** The forms that record a question as each indicator (by the question's `bind.element`), by indicator reference. */
  private async formsUsing(tx: Tx, projectId: string): Promise<Map<string, string[]>> {
    const forms = await tx.selectFrom('form').select(['name', 'draft']).where('project_id', '=', projectId).where('archived_at', 'is', null).execute();
    const out = new Map<string, string[]>();
    for (const f of forms) {
      const sections = (f.draft as { sections?: { questions?: { bind?: { element?: string } }[] }[] } | null)?.sections ?? [];
      for (const s of sections) for (const q of s.questions ?? []) if (q.bind?.element) out.set(q.bind.element, [...new Set([...(out.get(q.bind.element) ?? []), f.name])]);
    }
    return out;
  }

  /** `existingRef` is the indicator being edited, as other things refer to it (`key`, or `group.key`). */
  async saveElement(actor: Actor, tenantId: string, project: string, input: z.output<typeof DataElementInput>, existingRef?: string): Promise<DataElementDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    const values = {
      group_key: input.group,
      key: input.key,
      name: input.name,
      description: input.description,
      value_type: input.valueType,
      unit: input.unit,
      aggregation: input.aggregation,
    };
    const ref = elementRef(input.group, input.key);
    try {
      await this.cellTx(tenantId, async (tx) => {
        if (input.group !== DEFAULT_DATA_GROUP && !(await tx.selectFrom('data_group').select('id').where('project_id', '=', a.project.id).where('key', '=', input.group).executeTakeFirst()))
          throw badRequest(`Unknown data group "${input.group}"`);
        if (existingRef) {
          const cur = await tx.selectFrom('data_element').select(['id', 'value_type']).where('project_id', '=', a.project.id).where('ref', '=', existingRef).executeTakeFirst();
          if (!cur) throw notFound('Data element');
          // What a form records into, or what has already been recorded, keeps its key, group and type.
          const forms = (await this.formsUsing(tx, a.project.id)).get(existingRef) ?? [];
          const used = await tx.selectFrom('observation').select('element_id').where('element_id', '=', cur.id).limit(1).executeTakeFirst();
          if ((ref !== existingRef || input.valueType !== cur.value_type) && (forms.length || used))
            throw conflict('Locked', forms.length ? `Its key, group and type cannot change while ${forms.join(', ')} record${forms.length === 1 ? 's' : ''} into it.` : 'Its key, group and type cannot change once readings have been recorded.');
          await tx.updateTable('data_element').set(values).where('id', '=', cur.id).execute();
        } else await tx.insertInto('data_element').values({ id: uuidv7(), tenant_id: tenantId, project_id: a.project.id, ...values }).execute();
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Key taken', `A data element with key "${ref}" already exists.`);
      throw e;
    }
    return this.elements(actor, tenantId, project);
  }

  async deleteElement(actor: Actor, tenantId: string, project: string, ref: string): Promise<DataElementDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    await this.cellTx(tenantId, async (tx) => {
      const forms = (await this.formsUsing(tx, a.project.id)).get(ref) ?? [];
      if (forms.length) throw conflict('In use', `${forms.join(', ')} record${forms.length === 1 ? 's' : ''} into it. Unlink the question first.`);
      await tx.deleteFrom('data_element').where('project_id', '=', a.project.id).where('ref', '=', ref).execute();
    });
    return this.elements(actor, tenantId, project);
  }

  // ---------- data groups ----------

  /** The groups indicators are put in. The default group always exists and cannot be changed or removed. */
  async dataGroups(actor: Actor, tenantId: string, project: string): Promise<DataGroupDto[]> {
    const a = await this.access(actor, tenantId, project);
    return this.cellTx(tenantId, async (tx) => {
      const rows = await tx.selectFrom('data_group').selectAll().where('project_id', '=', a.project.id).orderBy('name').execute();
      const counts = new Map((await tx.selectFrom('data_element').select(['group_key']).select((eb) => eb.fn.countAll<string>().as('n')).where('project_id', '=', a.project.id).groupBy('group_key').execute()).map((r) => [r.group_key, Number(r.n)]));
      return [
        { key: DEFAULT_DATA_GROUP, name: 'General', description: 'Indicators not put in a group', elementCount: counts.get(DEFAULT_DATA_GROUP) ?? 0 },
        ...rows.map((g) => ({ key: g.key, name: g.name, description: g.description, elementCount: counts.get(g.key) ?? 0 })),
      ];
    });
  }

  async saveDataGroup(actor: Actor, tenantId: string, project: string, input: z.output<typeof DataGroupInput>, existingKey?: string): Promise<DataGroupDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    if (input.key === DEFAULT_DATA_GROUP || existingKey === DEFAULT_DATA_GROUP) throw conflict('Reserved', `"${DEFAULT_DATA_GROUP}" is the default group and cannot be changed.`);
    try {
      await this.cellTx(tenantId, async (tx) => {
        if (existingKey) {
          // The key is part of every indicator's reference, so only the wording can change.
          if (input.key !== existingKey) throw conflict('Locked', 'A group’s key cannot change.');
          const r = await tx.updateTable('data_group').set({ name: input.name, description: input.description }).where('project_id', '=', a.project.id).where('key', '=', existingKey).executeTakeFirst();
          if (!r.numUpdatedRows) throw notFound('Data group');
        } else await tx.insertInto('data_group').values({ id: uuidv7(), tenant_id: tenantId, project_id: a.project.id, key: input.key, name: input.name, description: input.description }).execute();
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Key taken', `A data group with key "${input.key}" already exists.`);
      throw e;
    }
    return this.dataGroups(actor, tenantId, project);
  }

  /**
   * Removes a group. One with indicators in it is refused, unless `cascade`: then its indicators go with it (and the
   * readings recorded for them), and the form questions that record into them are left without an indicator.
   */
  async deleteDataGroup(actor: Actor, tenantId: string, project: string, key: string, cascade = false): Promise<DataGroupDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    if (key === DEFAULT_DATA_GROUP) throw conflict('Reserved', 'The default group cannot be removed.');
    let removed = 0;
    await this.cellTx(tenantId, async (tx) => {
      const elements = await tx.selectFrom('data_element').select(['id', 'ref']).where('project_id', '=', a.project.id).where('group_key', '=', key).execute();
      if (elements.length) {
        if (!cascade) throw conflict('Not empty', 'Move or delete its indicators first.');
        const refs = new Set(elements.map((e) => e.ref));
        // The questions that record into these indicators stop doing so: in each form's draft and in the version people fill in now.
        const unlink = (def: unknown): { def: unknown; changed: boolean } => {
          let changed = false;
          for (const sec of (def as { sections?: { questions?: { bind?: { element?: string } }[] }[] } | null)?.sections ?? [])
            for (const q of sec.questions ?? [])
              if (q.bind?.element && refs.has(q.bind.element)) {
                delete q.bind.element;
                if (!Object.keys(q.bind).length) delete (q as { bind?: unknown }).bind;
                changed = true;
              }
          return { def, changed };
        };
        const forms = await tx.selectFrom('form').select(['id', 'draft', 'current_version']).where('project_id', '=', a.project.id).execute();
        for (const f of forms) {
          const d = unlink(structuredClone(f.draft));
          if (d.changed) await tx.updateTable('form').set({ draft: JSON.stringify(d.def) }).where('id', '=', f.id).execute();
          if (f.current_version !== null) {
            const v = await tx.selectFrom('form_version').select('definition').where('form_id', '=', f.id).where('version', '=', f.current_version).executeTakeFirst();
            const u = v && unlink(structuredClone(v.definition));
            if (u?.changed) await tx.updateTable('form_version').set({ definition: JSON.stringify(u.def) }).where('form_id', '=', f.id).where('version', '=', f.current_version).execute();
          }
        }
        removed = elements.length;
        await tx.deleteFrom('data_element').where('project_id', '=', a.project.id).where('group_key', '=', key).execute();
      }
      await tx.deleteFrom('data_group').where('project_id', '=', a.project.id).where('key', '=', key).execute();
    });
    if (removed) await audit(this.ctx, actor.id, tenantId, 'data_group.deleted', { project: a.project.key, group: key, elements: removed });
    return this.dataGroups(actor, tenantId, project);
  }

  // ---------- entities ----------

  private entityBase(tx: Tx, a: ProjectAccess) {
    let q = tx
      .selectFrom('entity as e')
      .innerJoin('entity_type as t', 't.id', 'e.type_id')
      .leftJoin('entity as p', 'p.id', 'e.parent_id')
      .where(inProject('e', a.project.id))
      .where('t.system', '=', false);
    if (a.roots) q = q.where(sql<boolean>`e.path <@ any(${a.roots}::ltree[])`);
    return q;
  }

  summarySelect = (projectId: string | null) => [
    'e.id',
    'e.code',
    'e.name',
    'e.attributes',
    'e.updated_at',
    't.key as type_key',
    't.name as type_name',
    't.icon as type_icon',
    't.color as type_color',
    'p.id as parent_id',
    'p.name as parent_name',
    sql<boolean>`(e.geom is not null or e.point is not null)`.as('has_geom'),
    sql<number>`(select count(*) from entity c where c.parent_id = e.id and ${projectId === null ? sql`c.project_id is null` : inProject('c', projectId)})::int`.as('child_count'),
    sql<boolean>`(e.project_id is null)`.as('shared'),
  ] as const;

  toSummary(r: {
    id: string;
    code: string;
    name: string;
    attributes: Record<string, unknown>;
    updated_at: Date;
    type_key: string;
    type_name: string;
    type_icon: string;
    type_color: string;
    parent_id: string | null;
    parent_name: string | null;
    has_geom: boolean;
    child_count: number;
    shared: boolean;
  }): EntitySummary {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      type: { key: r.type_key, name: r.type_name, icon: r.type_icon, color: r.type_color },
      parent: r.parent_id ? { id: r.parent_id, name: r.parent_name! } : null,
      attributes: r.attributes,
      hasGeometry: r.has_geom,
      childCount: r.child_count,
      shared: r.shared,
      updatedAt: iso(r.updated_at),
    };
  }

  async entities(actor: Actor, tenantId: string, project: string, query: EntityQuery): Promise<Page<EntitySummary>> {
    const a = await this.access(actor, tenantId, project);
    return this.cellTx(tenantId, async (tx) => {
      let q = this.entityBase(tx, a);
      if (query.type) q = q.where('t.key', 'in', query.type.split(','));
      if (query.parentId === 'root') q = q.where('e.parent_id', 'is', null);
      else if (query.parentId) q = q.where('e.parent_id', '=', query.parentId);
      if (query.ancestorId)
        q = q.where(sql<boolean>`e.path <@ (select path from entity where id = ${query.ancestorId})`).where('e.id', '<>', query.ancestorId);
      if (query.aboveId)
        q = q.where(sql<boolean>`e.path @> (select path from entity where id = ${query.aboveId})`).where('e.id', '<>', query.aboveId);
      if (query.parentOfId) q = q.where(sql<boolean>`e.id = (select parent_id from entity where id = ${query.parentOfId})`);
      if (query.q) {
        const like = `%${query.q.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`;
        q = q.where((eb) => eb.or([eb(sql`lower(e.name)`, 'like', like), eb(sql`lower(e.code)`, 'like', like)]));
      }
      const [items, total] = await Promise.all([
        q
          .select([...this.summarySelect(a.project.id)])
          .orderBy('t.sort')
          .orderBy('t.name')
          .orderBy('e.name')
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize)
          .execute(),
        q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
      ]);
      return { items: items.map((r) => this.toSummary(r as never)), total: Number(total.n), page: query.page, pageSize: query.pageSize };
    });
  }

  /** Places for the mobile app to keep on the device: what changed since the last sync, and (on the last page) every id still visible. */
  async entitySync(actor: Actor, tenantId: string, project: string, query: EntitySyncQuery): Promise<EntitySyncDto> {
    const a = await this.access(actor, tenantId, project);
    return this.cellTx(tenantId, async (tx) => {
      const now = (await sql<{ t: Date }>`select now() as t`.execute(tx)).rows[0]!.t;
      let q = this.entityBase(tx, a);
      if (query.since) q = q.where('e.updated_at', '>=', new Date(query.since));
      if (query.after) q = q.where('e.id', '>', query.after);
      const rows = await q
        .select(['e.id', 'e.code', 'e.name', 'e.attributes', 'e.updated_at', 'e.parent_id', 't.key as type_key', sql<boolean>`(e.project_id is null)`.as('shared'), sql<number | null>`ST_Y(e.point::geometry)`.as('lat'), sql<number | null>`ST_X(e.point::geometry)`.as('lon')])
        .orderBy('e.id')
        .limit(query.limit + 1)
        .execute();
      const more = rows.length > query.limit;
      const items = rows.slice(0, query.limit);
      const ids = more ? null : (await this.entityBase(tx, a).select('e.id').execute()).map((r) => r.id);
      return {
        items: items.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          type: r.type_key,
          parentId: r.parent_id,
          attributes: r.attributes as Record<string, unknown>,
          point: r.lat !== null && r.lon !== null ? { lat: Number(r.lat), lon: Number(r.lon) } : null,
          shared: r.shared,
          updatedAt: iso(r.updated_at),
        })),
        next: more ? items[items.length - 1]!.id : null,
        serverTime: iso(now),
        ids,
      };
    });
  }

  async entity(actor: Actor, tenantId: string, project: string, id: string): Promise<EntityDetail> {
    const a = await this.access(actor, tenantId, project);
    const detail = await this.cellTx(tenantId, async (tx) => {
      const r = await this.entityBase(tx, a)
        .select([
          ...this.summarySelect(a.project.id),
          'e.version',
          'e.created_at',
          sql<string | null>`ST_AsGeoJSON(e.geom, 6)`.as('geo'),
          sql<string | null>`ST_AsGeoJSON(e.point, 6)`.as('point'),
          sql<string>`e.path::text`.as('path'),
        ])
        .where('e.id', '=', id)
        .executeTakeFirst();
      if (!r) throw notFound('Entity');
      const ancestors = await sql<{ id: string; name: string; type_name: string }>`
        select a.id, a.name, t.name as type_name from entity a join entity_type t on t.id = a.type_id
        where a.path @> ${r.path}::ltree and a.id <> ${id} order by nlevel(a.path)
      `.execute(tx);
      const latest = await sql<{ key: string; name: string; unit: string; value_num: number | null; value_text: string | null; at: Date }>`
        select distinct on (d.id) d.ref as key, d.name, d.unit, o.value_num, o.value_text, o.at
        from observation o join data_element d on d.id = o.element_id
        where o.entity_id = ${id} and o.project_id = ${a.project.id}
        order by d.id, o.at desc
      `.execute(tx);
      // What the places under it have recorded, combined the way each indicator says (a total, an average…), for the
      // indicators nothing was recorded for here.
      const rolled = await sql<{ key: string; name: string; unit: string; aggregation: 'sum' | 'avg' | 'min' | 'max' | 'last' | 'count'; value: number | null; n: number; at: Date }>`
        with sub as (select id from entity where path <@ ${r.path}::ltree and id <> ${id} and (project_id = ${a.project.id} or project_id is null)),
        newest as (
          select distinct on (o.entity_id, o.element_id) o.entity_id, o.element_id, o.value_num, o.at
          from observation o join sub on sub.id = o.entity_id
          where o.project_id = ${a.project.id} and o.value_num is not null
          order by o.entity_id, o.element_id, o.at desc
        )
        select d.ref as key, d.name, d.unit, d.aggregation, count(*)::int as n, max(l.at) as at,
          case d.aggregation
            when 'sum' then sum(l.value_num) when 'avg' then avg(l.value_num) when 'min' then min(l.value_num)
            when 'max' then max(l.value_num) when 'count' then count(*)::float8
            else (array_agg(l.value_num order by l.at desc))[1] end::float8 as value
        from newest l join data_element d on d.id = l.element_id
        group by d.id, d.ref, d.name, d.unit, d.aggregation
      `.execute(tx);
      const history = await tx
        .selectFrom('entity_change')
        .select(['at', 'source', 'actor_id', 'changes'])
        .where('entity_id', '=', id)
        .orderBy('at', 'desc')
        .limit(25)
        .execute();
      return { r, ancestors: ancestors.rows, latest: latest.rows, rolled: rolled.rows, history };
    });
    const actorIds = [...new Set(detail.history.map((h) => h.actor_id).filter((x): x is string => !!x))];
    const names = new Map(
      actorIds.length
        ? (await this.ctx.db.selectFrom('user_identity').select(['id', 'display_name', 'email']).where('id', 'in', actorIds).execute()).map((u) => [
            u.id,
            u.display_name ?? u.email,
          ])
        : [],
    );
    return {
      ...this.toSummary(detail.r as never),
      version: detail.r.version,
      geometry: detail.r.geo ? (JSON.parse(detail.r.geo) as Geometry) : null,
      point: detail.r.point ? (JSON.parse(detail.r.point) as PointGeometry) : null,
      ancestors: detail.ancestors.map((x) => ({ id: x.id, name: x.name, typeName: x.type_name })),
      latest: [
        ...detail.latest.map((l) => ({ element: l.key, name: l.name, unit: l.unit, value: l.value_num ?? l.value_text, at: iso(l.at), rolledUp: false, places: null, aggregation: null })),
        ...detail.rolled
          .filter((l) => !detail.latest.some((own) => own.key === l.key))
          .map((l) => ({ element: l.key, name: l.name, unit: l.unit, value: l.value === null ? null : Math.round(Number(l.value) * 1e6) / 1e6, at: iso(l.at), rolledUp: true, places: l.n, aggregation: l.aggregation })),
      ].sort((x, y) => x.name.localeCompare(y.name)),
      history: detail.history.map((h) => ({
        at: iso(h.at),
        source: h.source,
        actor: h.actor_id ? (names.get(h.actor_id) ?? null) : null,
        changes: h.changes as Record<string, unknown>,
      })),
      createdAt: iso(detail.r.created_at),
    };
  }

  async createEntity(actor: Actor, tenantId: string, project: string, input: z.output<typeof EntityInput>): Promise<EntityDetail> {
    const a = await this.access(actor, tenantId, project, 'manager');
    const res = await dataCall(() =>
      this.cellTx(tenantId, async (tx) => {
        const exists = await tx
          .selectFrom('entity as e')
          .innerJoin('entity_type as t', 't.id', 'e.type_id')
          .select('e.id')
          .where('e.project_id', '=', a.project.id)
          .where('t.key', '=', input.typeKey)
          .where('e.code', '=', input.code)
          .executeTakeFirst();
        if (exists) throw conflict('Code taken', `Another ${input.typeKey} already has the code "${input.code}".`);
        const type = await entityType(tx, a.project.id, input.typeKey);
        // Attributes left out take their default value.
        const attributes: Record<string, unknown> = { ...input.attributes };
        for (const d of type.attributes) if (d.default !== undefined && (attributes[d.key] === undefined || attributes[d.key] === null || attributes[d.key] === '')) attributes[d.key] = d.default;
        this.checkRequired(type.attributes, attributes);
        if (!input.parentId && type.parentTypes.some((k) => k !== ROOT_PARENT) && a.roots) throw forbidden('Choose a parent within your part of the project.');
        await fireEvent(tx, { tenantId, projectId: a.project.id, event: 'entity.changed', ref: input.typeKey, actorId: actor.id, detail: { change: 'created', code: input.code } });
        return upsertEntities(tx, {
          tenantId,
          projectId: a.project.id,
          typeKey: input.typeKey,
          rows: [{ code: input.code, name: input.name, parentId: input.parentId, attributes, geometry: input.geometry }],
          source: 'user',
          actorId: actor.id,
          scope: a.roots,
        });
      }),
    );
    const id = res.ids.get(input.code)!;
    if (input.point) await this.cellTx(tenantId, (tx) => this.setPoint(tx, id, input.point));
    await audit(this.ctx, actor.id, tenantId, 'entity.created', { project: a.project.key, entity: input.name, type: input.typeKey, changes: changes([['Name', null, input.name], ['Code', null, input.code], ...Object.entries(input.attributes ?? {}).map(([k, v]): [string, unknown, unknown] => [k, null, v])]) });
    return this.entity(actor, tenantId, project, id);
  }

  /** Sets (or clears) an entity's centre point. */
  async setPoint(tx: Tx, id: string, point: PointGeometry | null) {
    await tx
      .updateTable('entity')
      .set({
        point: point ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(point)}), 4326)` : null,
        updated_at: this.ctx.now(),
      })
      .where('id', '=', id)
      .execute();
  }

  checkRequired(defs: AttributeDef[], attrs: Record<string, unknown>) {
    const missing = defs.filter((d) => d.required && (attrs[d.key] === undefined || attrs[d.key] === null || attrs[d.key] === ''));
    if (missing.length) throw badRequest(`Required: ${missing.map((m) => m.label).join(', ')}`);
    for (const d of defs) {
      const problem = attributeProblem(d, attrs[d.key]);
      if (problem) throw badRequest(`${d.label}: ${problem}`);
    }
  }

  async updateEntity(actor: Actor, tenantId: string, project: string, id: string, input: z.output<typeof EntityUpdate>): Promise<EntityDetail> {
    const a = await this.access(actor, tenantId, project, 'manager');
    let delta: ReturnType<typeof changes> = [];
    let label = '';
    await dataCall(() =>
      this.cellTx(tenantId, async (tx) => {
        const cur = await this.entityBase(tx, a)
          .select(['e.id', 'e.code', 'e.name', 'e.version', 'e.parent_id', 'e.project_id', 'e.attributes', 'p.name as parent_name', 't.key as type_key', sql<string>`e.path::text`.as('path')])
          .where('e.id', '=', id)
          .executeTakeFirst();
        if (!cur) throw notFound('Entity');
        if (cur.project_id === null) throw forbidden(SHARED_MESSAGE);
        if (input.version !== undefined && input.version !== cur.version)
          throw conflict('Edited elsewhere', 'Someone else changed this entity. Reload to see their changes.');
        if (input.code && input.code !== cur.code) {
          const dupe = await tx
            .selectFrom('entity')
            .select('id')
            .where('project_id', '=', a.project.id)
            .where('type_id', '=', tx.selectFrom('entity').select('type_id').where('id', '=', id))
            .where('code', '=', input.code)
            .executeTakeFirst();
          if (dupe) throw conflict('Code taken', `Another entity already has the code "${input.code}".`);
          await tx.updateTable('entity').set({ code: input.code }).where('id', '=', id).execute();
        }
        await fireEvent(tx, { tenantId, projectId: a.project.id, event: 'entity.changed', ref: cur.type_key, actorId: actor.id, detail: { change: 'updated', entity: id } });
        await upsertEntities(tx, {
          tenantId,
          projectId: a.project.id,
          typeKey: cur.type_key,
          rows: [
            {
              code: input.code ?? cur.code,
              name: input.name ?? cur.name,
              attributes: input.attributes,
              ...(input.geometry !== undefined && { geometry: input.geometry }),
            },
          ],
          source: 'user',
          actorId: actor.id,
          scope: a.roots,
        });
        if (input.point !== undefined) await this.setPoint(tx, id, input.point);
        label = input.name ?? cur.name;
        const was = (cur.attributes ?? {}) as Record<string, unknown>;
        delta = changes([
          ['Name', cur.name, input.name ?? cur.name],
          ['Code', cur.code, input.code ?? cur.code],
          ...Object.entries(input.attributes ?? {}).map(([k, v]): [string, unknown, unknown] => [k, was[k], v]),
          ...(input.geometry !== undefined ? ([['Shape', 'Previous', 'Changed']] as [string, unknown, unknown][]) : []),
          ...(input.point !== undefined ? ([['Centre point', 'Previous', input.point ? 'Changed' : null]] as [string, unknown, unknown][]) : []),
        ]);
        if (input.parentId !== undefined && input.parentId !== cur.parent_id) {
          const parent = input.parentId
            ? await tx
                .selectFrom('entity as e')
                .innerJoin('entity_type as t', 't.id', 'e.type_id')
                .select(['e.id', 'e.name', sql<string>`e.path::text`.as('path'), 't.key'])
                .where('e.id', '=', input.parentId)
                .where(inProject('e', a.project.id))
                .executeTakeFirst()
            : null;
          if (input.parentId && !parent) throw badRequest('Parent not found');
          const type = await entityType(tx, a.project.id, cur.type_key);
          if (parent && !type.parentTypes.includes(parent.key)) throw badRequest(`A ${type.name} can't be placed under a ${parent.key}`);
          if (a.roots && (!parent || !within(a.roots, parent.path)))
            throw forbidden('You can only move entities within your part of the project.');
          await moveEntity(tx, id, cur.path, parent ?? null);
          delta = [...delta, ...changes([['Placed under', cur.parent_name, parent?.name]])];
          await tx
            .insertInto('entity_change')
            .values({ tenant_id: tenantId, entity_id: id, changes: JSON.stringify({ parent: parent?.id ?? null }), source: 'user', actor_id: actor.id })
            .execute();
        }
      }),
    );
    await audit(this.ctx, actor.id, tenantId, 'entity.updated', { project: a.project.key, entity: label, type: undefined, changes: delta });
    return this.entity(actor, tenantId, project, id);
  }

  async deleteEntity(actor: Actor, tenantId: string, project: string, id: string): Promise<void> {
    const a = await this.access(actor, tenantId, project, 'manager');
    let deleted: { name: string; type: string; changes: ReturnType<typeof changes> } | undefined;
    await this.cellTx(tenantId, async (tx) => {
      const cur = await this.entityBase(tx, a).select(['e.id', 'e.code', 'e.name', 'e.project_id', 'e.attributes', 't.key as type_key']).where('e.id', '=', id).executeTakeFirst();
      if (!cur) throw notFound('Entity');
      if (cur.project_id === null) throw forbidden(SHARED_MESSAGE);
      const child = await tx.selectFrom('entity').select('id').where('parent_id', '=', id).executeTakeFirst();
      if (child) throw conflict('Has children', 'Move or delete the entities under it first.');
      await tx.deleteFrom('entity').where('id', '=', id).execute();
      await fireEvent(tx, { tenantId, projectId: a.project.id, event: 'entity.changed', ref: cur.type_key, actorId: actor.id, detail: { change: 'deleted', code: cur.code } });
      deleted = { name: cur.name, type: cur.type_key, changes: changes([['Name', cur.name, null], ['Code', cur.code, null], ...Object.entries((cur.attributes ?? {}) as Record<string, unknown>).map(([k, v]): [string, unknown, unknown] => [k, v, null])]) };
    });
    await audit(this.ctx, actor.id, tenantId, 'entity.deleted', { project: a.project.key, entity: deleted?.name, type: deleted?.type, changes: deleted?.changes });
  }

  /** GeoJSON features for the map (optionally with each entity's latest value of an element). */
  async geo(actor: Actor, tenantId: string, project: string, query: z.output<typeof GeoQuery>) {
    const a = await this.access(actor, tenantId, project);
    return this.cellTx(tenantId, (tx) => this.geoFeatures(tx, a.project.id, a.roots, query));
  }

  async geoFeatures(tx: Tx, projectId: string, roots: Scope, query: { type?: string; ancestorId?: string; bbox?: string; element?: string; limit: number; since?: Date }) {
    const bbox = query.bbox?.split(',').map(Number);
    const rows = await sql<{
      id: string;
      code: string;
      name: string;
      type_key: string;
      color: string;
      icon: string;
      marker: unknown;
      attributes: Record<string, unknown>;
      geo: string;
      pt: string | null;
      value: number | null;
      at: Date | null;
    }>`
      select e.id, e.code, e.name, t.key as type_key, t.color, t.icon, t.marker, e.attributes,
        ST_AsGeoJSON(coalesce(e.geom, e.point), 6) as geo, case when e.geom is not null then ST_AsGeoJSON(e.point, 6) end as pt,
        ${query.element ? sql`lv.value_num` : sql`null::float8`} as value,
        ${query.element ? sql`lv.at` : sql`null::timestamptz`} as at
      from entity e
      join entity_type t on t.id = e.type_id
      ${
        query.element
          ? sql`left join lateral (
              select o.value_num, o.at from observation o
              join data_element d on d.id = o.element_id and d.ref = ${query.element} and d.project_id = ${projectId}
              where o.entity_id = e.id order by o.at desc limit 1
            ) lv on true`
          : sql``
      }
      where ${inProject('e', projectId)} and (e.geom is not null or e.point is not null)
        ${query.type ? sql`and t.key = ${query.type}` : sql``}
        ${scopeAnd('e.path', roots)}
        ${query.ancestorId ? sql`and e.path <@ (select path from entity where id = ${query.ancestorId})` : sql``}
        ${bbox ? sql`and coalesce(e.geom, e.point) && ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)` : sql``}
        ${query.since && query.element ? sql`and lv.at >= ${query.since}` : sql``}
      limit ${query.limit}
    `.execute(tx);
    return {
      type: 'FeatureCollection' as const,
      features: rows.rows.map((r) => ({
        type: 'Feature' as const,
        id: r.id,
        geometry: JSON.parse(r.geo) as Geometry,
        properties: {
          ...r.attributes,
          ...markerProps({ icon: r.icon, marker: r.marker, attributes: r.attributes, point: r.pt }),
          id: r.id,
          code: r.code,
          name: r.name,
          type: r.type_key,
          color: r.color,
          value: r.value,
          at: r.at ? iso(r.at) : null,
        },
      })),
    };
  }

  // ---------- observations & import ----------

  async writeObservations(actor: Actor, tenantId: string, project: string, input: z.output<typeof ObservationBatch>) {
    const a = await this.access(actor, tenantId, project, 'manager');
    return dataCall(() =>
      this.cellTx(tenantId, async (tx) => {
        const ids = [...new Set(input.observations.map((o) => o.entityId))];
        const allowed = await this.entityBase(tx, a).select('e.id').where('e.id', 'in', ids).execute();
        if (allowed.length !== ids.length) throw forbidden('Some entities are not in your part of the project.');
        return writeObservations(tx, {
          tenantId,
          projectId: a.project.id,
          items: input.observations.map((o) => ({ entityId: o.entityId, element: o.element, at: new Date(o.at), value: o.value })),
          source: 'user',
          sourceRef: actor.id,
        });
      }),
    );
  }

  async series(actor: Actor, tenantId: string, project: string, entityId: string, element: string, limit = 200, rollup = false) {
    const a = await this.access(actor, tenantId, project);
    return this.cellTx(tenantId, async (tx) => {
      const allowed = await this.entityBase(tx, a).select(['e.id', sql<string>`e.path::text`.as('path')]).where('e.id', '=', entityId).executeTakeFirst();
      if (!allowed) throw notFound('Entity');
      if (rollup) {
        // The places under it, combined at each moment the way the indicator says.
        const rows = await sql<{ at: Date; value: number | null }>`
          select o.at, case d.aggregation
              when 'sum' then sum(o.value_num) when 'avg' then avg(o.value_num) when 'min' then min(o.value_num)
              when 'max' then max(o.value_num) when 'count' then count(*)::float8
              else (array_agg(o.value_num order by o.entity_id))[1] end::float8 as value
          from observation o
          join data_element d on d.id = o.element_id
          join entity e on e.id = o.entity_id
          where o.project_id = ${a.project.id} and d.ref = ${element} and o.value_num is not null
            and e.path <@ ${allowed.path}::ltree and e.id <> ${entityId}
          group by o.at, d.aggregation
          order by o.at desc
          limit ${limit}
        `.execute(tx);
        return rows.rows.reverse().map((r) => ({ at: iso(r.at), value: r.value === null ? null : Math.round(Number(r.value) * 1e6) / 1e6, source: 'rollup' }));
      }
      const rows = await tx
        .selectFrom('observation as o')
        .innerJoin('data_element as d', 'd.id', 'o.element_id')
        .select(['o.at', 'o.value_num', 'o.value_text', 'o.source'])
        .where('o.entity_id', '=', entityId)
        .where('o.project_id', '=', a.project.id)
        .where('d.ref', '=', element)
        .orderBy('o.at', 'desc')
        .limit(limit)
        .execute();
      return rows.reverse().map((r) => ({ at: iso(r.at), value: r.value_num ?? r.value_text, source: r.source }));
    });
  }

  /**
   * Imports rows (e.g. a parsed CSV). Columns: code, name, parent_code, lat, lon, and
   * attribute keys. Existing codes are updated, so re-importing a file is safe.
   */
  async importRows(actor: Actor, tenantId: string, project: string, input: z.output<typeof ImportRowsInput>) {
    const a = await this.access(actor, tenantId, project, 'manager');
    const res = await dataCall(() =>
      this.cellTx(tenantId, async (tx) => {
        const res = await importEntityRows(tx, { tenantId, projectId: a.project.id, defaultTypeKey: input.typeKey, rows: input.rows, source: 'import', actorId: actor.id, scope: a.roots });
        if (res.created + res.updated)
          await fireEvent(tx, { tenantId, projectId: a.project.id, event: 'entity.changed', ref: input.typeKey ?? Object.keys(res.byType)[0] ?? '', actorId: actor.id, detail: { change: 'imported', created: res.created, updated: res.updated } });
        return res;
      }),
    );
    await audit(this.ctx, actor.id, tenantId, 'project.imported', { project: a.project.key, type: input.typeKey ?? Object.keys(res.byType).join(','), created: res.created, updated: res.updated });
    return { created: res.created, updated: res.updated, unchanged: res.unchanged, skipped: res.skipped };
  }
}

