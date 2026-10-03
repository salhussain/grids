import { sql, type Transaction } from 'kysely';
import { withTenant, type CellDB } from '@grids/db';
import {
  DataError,
  entityType,
  freshness,
  moveEntity,
  upsertEntities,
  worstFreshness,
  writeObservations,
} from '@grids/data';
import {
  PROJECT_ROLES,
  roleAtLeast,
  uuidv7,
  type AttributeDef,
  type DataElementDto,
  type EntityDetail,
  type EntitySummary,
  type EntityTypeDto,
  type Freshness,
  type Geometry,
  type LimitKey,
  type Page,
  type PlanLimits,
  type ProjectDto,
  type ProjectMemberDto,
  type ProjectRole,
} from '@grids/schema';
import type { z } from 'zod';
import type {
  DataElementInput,
  EntityInput,
  EntityQuery,
  EntityTypeInput,
  EntityUpdate,
  GeoQuery,
  ImportRowsInput,
  ObservationBatch,
  ProjectInput,
  ProjectMemberInput,
  ProjectUpdate,
} from '@grids/schema';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../errors.js';
import { can } from './authz.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { assertWithinLimit } from './entitlements.js';
import { workspacePolicy } from './policy.js';
import { iso, isUniqueViolation } from './util.js';

type Tx = Transaction<CellDB>;
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
};

/** The caller's effective access to one project. */
export interface ProjectAccess {
  project: ProjectRow;
  role: ProjectRole;
  /** Entity subtree the caller is limited to (scoped members), else null. */
  rootPath: string | null;
}

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
      let rootPath: string | null = null;
      if (policy && (policy.role === 'org_admin' || policy.has('projects.manage'))) role = 'manager';
      else {
        const m = policy
          ? await tx
              .selectFrom('project_member as m')
              .leftJoin('entity as e', 'e.id', 'm.root_entity_id')
              .select(['m.role', sql<string | null>`e.path::text`.as('root_path')])
              .where('m.project_id', '=', p.id)
              .where('m.user_id', '=', actor.id)
              .executeTakeFirst()
          : undefined;
        if (m) {
          role = m.role;
          rootPath = m.root_path;
        } else if (staffView || p.visibility !== 'private') role = 'viewer';
      }
      if (!role) throw notFound('Project');
      if (!roleAtLeast(role, need)) throw forbidden(`Requires the project ${need} role.`);
      return { project: p as ProjectRow, role, rootPath };
    });
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
        .where('archived_at', 'is', null)
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
    const count = async (table: 'entity' | 'project_member' | 'job' | 'dashboard' | 'form') =>
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
    const [entities, members, jobs, dashboards, forms, fresh] = await Promise.all([
      count('entity'),
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
  async list(actor: Actor, tenantId: string, opts: { archived?: boolean } = {}): Promise<ProjectDto[]> {
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
      q = opts.archived ? q.where('archived_at', 'is not', null) : q.where('archived_at', 'is', null);
      if (!all)
        q = q.where((eb) =>
          eb.or([eb('visibility', '<>', 'private'), ...(mine.size ? [eb('id', 'in', [...mine.keys()])] : [])]),
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
            created_by: actor.id,
          })
          .execute();
        await tx.insertInto('project_member').values({ project_id: id, tenant_id: tenantId, user_id: actor.id, role: 'manager' }).execute();
        if (input.template !== 'blank')
          await dataCall(() => this.installTemplate(tx, { tenantId, projectId: id, actorId: actor.id, template: input.template }));
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
    await this.cellTx(tenantId, (tx) =>
      tx
        .updateTable('project')
        .set({ ...input, updated_at: this.ctx.now() })
        .where('id', '=', a.project.id)
        .execute(),
    );
    await audit(this.ctx, actor.id, tenantId, 'project.updated', { project: a.project.key, ...input });
    return this.get(actor, tenantId, a.project.id);
  }

  async setArchived(actor: Actor, tenantId: string, project: string, archived: boolean): Promise<ProjectDto> {
    const a = await this.access(actor, tenantId, project, 'manager');
    if (!archived) assertWithinLimit(await this.planLimits(tenantId), 'projects' as LimitKey, await this.projectCount(tenantId));
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
        .leftJoin('entity as e', 'e.id', 'm.root_entity_id')
        .leftJoin('entity_type as t', 't.id', 'e.type_id')
        .select(['m.user_id', 'm.role', 'e.id as root_id', 'e.name as root_name', 't.name as root_type'])
        .where('m.project_id', '=', a.project.id)
        .execute(),
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
      rootEntity: m.root_id ? { id: m.root_id, name: m.root_name!, type: m.root_type! } : null,
      implicit: false,
    }));
    for (const ad of admins)
      if (!explicit.some((m) => m.user_id === ad.user_id))
        out.push({
          userId: ad.user_id,
          name: people.get(ad.user_id)?.display_name ?? null,
          email: people.get(ad.user_id)?.email ?? null,
          role: 'manager',
          rootEntity: null,
          implicit: true,
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
    await this.cellTx(tenantId, async (tx) => {
      if (input.rootEntityId) {
        const root = await tx.selectFrom('entity').select('id').where('id', '=', input.rootEntityId).where('project_id', '=', a.project.id).executeTakeFirst();
        if (!root) throw badRequest('That entity is not in this project');
      }
      await tx
        .insertInto('project_member')
        .values({ project_id: a.project.id, tenant_id: tenantId, user_id: input.userId, role: input.role, root_entity_id: input.rootEntityId })
        .onConflict((oc) => oc.columns(['project_id', 'user_id']).doUpdateSet({ role: input.role, root_entity_id: input.rootEntityId }))
        .execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'project.member_set', { project: a.project.key, user: input.userId, role: input.role });
    return this.members(actor, tenantId, project);
  }

  async removeMember(actor: Actor, tenantId: string, project: string, userId: string): Promise<ProjectMemberDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    await this.cellTx(tenantId, async (tx) => {
      const managers = await tx
        .selectFrom('project_member')
        .select('user_id')
        .where('project_id', '=', a.project.id)
        .where('role', '=', 'manager')
        .execute();
      if (managers.length === 1 && managers[0]!.user_id === userId)
        throw conflict('Last manager', 'Make someone else a manager before removing the last one.');
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
        .select((eb) =>
          eb
            .selectFrom('entity as e')
            .select((e2) => e2.fn.countAll<string>().as('n'))
            .whereRef('e.type_id', '=', 't.id')
            .as('count'),
        )
        .where('t.project_id', '=', a.project.id)
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
        attributes: t.attributes as AttributeDef[],
        parentTypes: t.parent_types,
        count: Number(t.count ?? 0),
      }));
    });
  }

  async saveType(actor: Actor, tenantId: string, project: string, input: z.output<typeof EntityTypeInput>, existingKey?: string): Promise<EntityTypeDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    const keys = input.attributes.map((x) => x.key);
    if (new Set(keys).size !== keys.length) throw badRequest('Attribute keys must be unique');
    try {
      await this.cellTx(tenantId, async (tx) => {
        const others = await tx.selectFrom('entity_type').select('key').where('project_id', '=', a.project.id).execute();
        const unknownParents = input.parentTypes.filter((p) => !others.some((o) => o.key === p) && p !== input.key);
        if (unknownParents.length) throw badRequest(`Unknown parent type: ${unknownParents.join(', ')}`);
        const values = {
          key: input.key,
          name: input.name,
          plural: input.plural,
          icon: input.icon,
          color: input.color,
          geometry: input.geometry,
          attributes: JSON.stringify(input.attributes),
          parent_types: input.parentTypes,
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

  async deleteType(actor: Actor, tenantId: string, project: string, key: string): Promise<EntityTypeDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    await this.cellTx(tenantId, async (tx) => {
      const t = await tx.selectFrom('entity_type').select('id').where('project_id', '=', a.project.id).where('key', '=', key).executeTakeFirst();
      if (!t) throw notFound('Entity type');
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
      return rows.map((d) => ({
        id: d.id,
        key: d.key,
        name: d.name,
        description: d.description,
        valueType: d.value_type,
        unit: d.unit,
        aggregation: d.aggregation,
        observationCount: Number(d.n ?? 0),
        lastAt: d.last_at ? iso(d.last_at as Date) : null,
      }));
    });
  }

  async saveElement(actor: Actor, tenantId: string, project: string, input: z.output<typeof DataElementInput>, existingKey?: string): Promise<DataElementDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    const values = {
      key: input.key,
      name: input.name,
      description: input.description,
      value_type: input.valueType,
      unit: input.unit,
      aggregation: input.aggregation,
    };
    try {
      await this.cellTx(tenantId, async (tx) => {
        if (existingKey) {
          const r = await tx.updateTable('data_element').set(values).where('project_id', '=', a.project.id).where('key', '=', existingKey).executeTakeFirst();
          if (!r.numUpdatedRows) throw notFound('Data element');
        } else await tx.insertInto('data_element').values({ id: uuidv7(), tenant_id: tenantId, project_id: a.project.id, ...values }).execute();
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Key taken', `A data element with key "${input.key}" already exists.`);
      throw e;
    }
    return this.elements(actor, tenantId, project);
  }

  async deleteElement(actor: Actor, tenantId: string, project: string, key: string): Promise<DataElementDto[]> {
    const a = await this.access(actor, tenantId, project, 'manager');
    await this.cellTx(tenantId, (tx) => tx.deleteFrom('data_element').where('project_id', '=', a.project.id).where('key', '=', key).execute());
    return this.elements(actor, tenantId, project);
  }

  // ---------- entities ----------

  private entityBase(tx: Tx, a: ProjectAccess) {
    let q = tx
      .selectFrom('entity as e')
      .innerJoin('entity_type as t', 't.id', 'e.type_id')
      .leftJoin('entity as p', 'p.id', 'e.parent_id')
      .where('e.project_id', '=', a.project.id);
    if (a.rootPath) q = q.where(sql<boolean>`e.path <@ ${a.rootPath}::ltree`);
    return q;
  }

  private summarySelect = [
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
    sql<boolean>`e.geom is not null`.as('has_geom'),
    sql<number>`(select count(*) from entity c where c.parent_id = e.id)::int`.as('child_count'),
  ] as const;

  private toSummary(r: {
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
      updatedAt: iso(r.updated_at),
    };
  }

  async entities(actor: Actor, tenantId: string, project: string, query: EntityQuery): Promise<Page<EntitySummary>> {
    const a = await this.access(actor, tenantId, project);
    return this.cellTx(tenantId, async (tx) => {
      let q = this.entityBase(tx, a);
      if (query.type) q = q.where('t.key', '=', query.type);
      if (query.parentId === 'root') q = q.where('e.parent_id', 'is', null);
      else if (query.parentId) q = q.where('e.parent_id', '=', query.parentId);
      if (query.ancestorId)
        q = q.where(sql<boolean>`e.path <@ (select path from entity where id = ${query.ancestorId})`).where('e.id', '<>', query.ancestorId);
      if (query.q) {
        const like = `%${query.q.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`;
        q = q.where((eb) => eb.or([eb(sql`lower(e.name)`, 'like', like), eb(sql`lower(e.code)`, 'like', like)]));
      }
      const [items, total] = await Promise.all([
        q
          .select([...this.summarySelect])
          .orderBy('e.name')
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize)
          .execute(),
        q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
      ]);
      return { items: items.map((r) => this.toSummary(r as never)), total: Number(total.n), page: query.page, pageSize: query.pageSize };
    });
  }

  async entity(actor: Actor, tenantId: string, project: string, id: string): Promise<EntityDetail> {
    const a = await this.access(actor, tenantId, project);
    const detail = await this.cellTx(tenantId, async (tx) => {
      const r = await this.entityBase(tx, a)
        .select([...this.summarySelect, 'e.version', 'e.created_at', sql<string | null>`ST_AsGeoJSON(e.geom, 6)`.as('geo'), sql<string>`e.path::text`.as('path')])
        .where('e.id', '=', id)
        .executeTakeFirst();
      if (!r) throw notFound('Entity');
      const ancestors = await sql<{ id: string; name: string; type_name: string }>`
        select a.id, a.name, t.name as type_name from entity a join entity_type t on t.id = a.type_id
        where a.path @> ${r.path}::ltree and a.id <> ${id} order by nlevel(a.path)
      `.execute(tx);
      const latest = await sql<{ key: string; name: string; unit: string; value_num: number | null; value_text: string | null; at: Date }>`
        select distinct on (d.id) d.key, d.name, d.unit, o.value_num, o.value_text, o.at
        from observation o join data_element d on d.id = o.element_id
        where o.entity_id = ${id}
        order by d.id, o.at desc
      `.execute(tx);
      const history = await tx
        .selectFrom('entity_change')
        .select(['at', 'source', 'actor_id', 'changes'])
        .where('entity_id', '=', id)
        .orderBy('at', 'desc')
        .limit(25)
        .execute();
      return { r, ancestors: ancestors.rows, latest: latest.rows, history };
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
      ancestors: detail.ancestors.map((x) => ({ id: x.id, name: x.name, typeName: x.type_name })),
      latest: detail.latest
        .map((l) => ({ element: l.key, name: l.name, unit: l.unit, value: l.value_num ?? l.value_text, at: iso(l.at) }))
        .sort((x, y) => x.name.localeCompare(y.name)),
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
    const a = await this.access(actor, tenantId, project, 'editor');
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
        this.checkRequired(type.attributes, input.attributes);
        if (!input.parentId && type.parentTypes.length && a.rootPath) throw forbidden('Choose a parent within your part of the project.');
        return upsertEntities(tx, {
          tenantId,
          projectId: a.project.id,
          typeKey: input.typeKey,
          rows: [{ code: input.code, name: input.name, parentId: input.parentId, attributes: input.attributes, geometry: input.geometry }],
          source: 'user',
          actorId: actor.id,
          scopePath: a.rootPath,
        });
      }),
    );
    return this.entity(actor, tenantId, project, res.ids.get(input.code)!);
  }

  private checkRequired(defs: AttributeDef[], attrs: Record<string, unknown>) {
    const missing = defs.filter((d) => d.required && (attrs[d.key] === undefined || attrs[d.key] === null || attrs[d.key] === ''));
    if (missing.length) throw badRequest(`Required: ${missing.map((m) => m.label).join(', ')}`);
  }

  async updateEntity(actor: Actor, tenantId: string, project: string, id: string, input: z.output<typeof EntityUpdate>): Promise<EntityDetail> {
    const a = await this.access(actor, tenantId, project, 'editor');
    await dataCall(() =>
      this.cellTx(tenantId, async (tx) => {
        const cur = await this.entityBase(tx, a)
          .select(['e.id', 'e.code', 'e.name', 'e.version', 'e.parent_id', 't.key as type_key', sql<string>`e.path::text`.as('path')])
          .where('e.id', '=', id)
          .executeTakeFirst();
        if (!cur) throw notFound('Entity');
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
          scopePath: a.rootPath,
        });
        if (input.parentId !== undefined && input.parentId !== cur.parent_id) {
          const parent = input.parentId
            ? await tx
                .selectFrom('entity as e')
                .innerJoin('entity_type as t', 't.id', 'e.type_id')
                .select(['e.id', sql<string>`e.path::text`.as('path'), 't.key'])
                .where('e.id', '=', input.parentId)
                .where('e.project_id', '=', a.project.id)
                .executeTakeFirst()
            : null;
          if (input.parentId && !parent) throw badRequest('Parent not found');
          const type = await entityType(tx, a.project.id, cur.type_key);
          if (parent && !type.parentTypes.includes(parent.key)) throw badRequest(`A ${type.name} can't be placed under a ${parent.key}`);
          if (a.rootPath && (!parent || !(parent.path === a.rootPath || parent.path.startsWith(`${a.rootPath}.`))))
            throw forbidden('You can only move entities within your part of the project.');
          await moveEntity(tx, id, cur.path, parent ?? null);
          await tx
            .insertInto('entity_change')
            .values({ tenant_id: tenantId, entity_id: id, changes: JSON.stringify({ parent: parent?.id ?? null }), source: 'user', actor_id: actor.id })
            .execute();
        }
      }),
    );
    return this.entity(actor, tenantId, project, id);
  }

  async deleteEntity(actor: Actor, tenantId: string, project: string, id: string): Promise<void> {
    const a = await this.access(actor, tenantId, project, 'editor');
    await this.cellTx(tenantId, async (tx) => {
      const cur = await this.entityBase(tx, a).select('e.id').where('e.id', '=', id).executeTakeFirst();
      if (!cur) throw notFound('Entity');
      const child = await tx.selectFrom('entity').select('id').where('parent_id', '=', id).executeTakeFirst();
      if (child) throw conflict('Has children', 'Move or delete the entities under it first.');
      await tx.deleteFrom('entity').where('id', '=', id).execute();
    });
  }

  /** GeoJSON features for the map (optionally with each entity's latest value of an element). */
  async geo(actor: Actor, tenantId: string, project: string, query: z.output<typeof GeoQuery>) {
    const a = await this.access(actor, tenantId, project);
    return this.cellTx(tenantId, (tx) => this.geoFeatures(tx, a.project.id, a.rootPath, query));
  }

  async geoFeatures(tx: Tx, projectId: string, rootPath: string | null, query: { type?: string; ancestorId?: string; bbox?: string; element?: string; limit: number; since?: Date }) {
    const bbox = query.bbox?.split(',').map(Number);
    const rows = await sql<{ id: string; code: string; name: string; type_key: string; color: string; attributes: Record<string, unknown>; geo: string; value: number | null; at: Date | null }>`
      select e.id, e.code, e.name, t.key as type_key, t.color, e.attributes, ST_AsGeoJSON(e.geom, 6) as geo,
        ${query.element ? sql`lv.value_num` : sql`null::float8`} as value,
        ${query.element ? sql`lv.at` : sql`null::timestamptz`} as at
      from entity e
      join entity_type t on t.id = e.type_id
      ${
        query.element
          ? sql`left join lateral (
              select o.value_num, o.at from observation o
              join data_element d on d.id = o.element_id and d.key = ${query.element} and d.project_id = ${projectId}
              where o.entity_id = e.id order by o.at desc limit 1
            ) lv on true`
          : sql``
      }
      where e.project_id = ${projectId} and e.geom is not null
        ${query.type ? sql`and t.key = ${query.type}` : sql``}
        ${rootPath ? sql`and e.path <@ ${rootPath}::ltree` : sql``}
        ${query.ancestorId ? sql`and e.path <@ (select path from entity where id = ${query.ancestorId})` : sql``}
        ${bbox ? sql`and e.geom && ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)` : sql``}
        ${query.since && query.element ? sql`and lv.at >= ${query.since}` : sql``}
      limit ${query.limit}
    `.execute(tx);
    return {
      type: 'FeatureCollection' as const,
      features: rows.rows.map((r) => ({
        type: 'Feature' as const,
        id: r.id,
        geometry: JSON.parse(r.geo) as Geometry,
        properties: { id: r.id, code: r.code, name: r.name, type: r.type_key, color: r.color, value: r.value, at: r.at ? iso(r.at) : null, ...r.attributes },
      })),
    };
  }

  // ---------- observations & import ----------

  async writeObservations(actor: Actor, tenantId: string, project: string, input: z.output<typeof ObservationBatch>) {
    const a = await this.access(actor, tenantId, project, 'editor');
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

  async series(actor: Actor, tenantId: string, project: string, entityId: string, element: string, limit = 200) {
    const a = await this.access(actor, tenantId, project);
    return this.cellTx(tenantId, async (tx) => {
      const allowed = await this.entityBase(tx, a).select('e.id').where('e.id', '=', entityId).executeTakeFirst();
      if (!allowed) throw notFound('Entity');
      const rows = await tx
        .selectFrom('observation as o')
        .innerJoin('data_element as d', 'd.id', 'o.element_id')
        .select(['o.at', 'o.value_num', 'o.value_text', 'o.source'])
        .where('o.entity_id', '=', entityId)
        .where('d.key', '=', element)
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
    const a = await this.access(actor, tenantId, project, 'editor');
    const res = await dataCall(() =>
      this.cellTx(tenantId, async (tx) => {
        const type = await entityType(tx, a.project.id, input.typeKey);
        const rows = input.rows.map((r, i) => {
          const code = String(r.code ?? '').trim();
          if (!code) throw badRequest(`Row ${i + 2}: "code" is empty`);
          const lat = Number(r.lat);
          const lon = Number(r.lon);
          const hasPoint = r.lat !== undefined && r.lat !== '' && r.lon !== '' && Number.isFinite(lat) && Number.isFinite(lon);
          return {
            code,
            name: String(r.name ?? code).trim() || code,
            parentCode: r.parent_code ? String(r.parent_code).trim() : null,
            attributes: Object.fromEntries(type.attributes.filter((d) => d.key in r).map((d) => [d.key, r[d.key]])),
            ...(hasPoint && { geometry: { type: 'Point' as const, coordinates: [lon, lat] } }),
          };
        });
        return upsertEntities(tx, { tenantId, projectId: a.project.id, typeKey: input.typeKey, rows, source: 'import', actorId: actor.id, scopePath: a.rootPath });
      }),
    );
    await audit(this.ctx, actor.id, tenantId, 'project.imported', { project: a.project.key, type: input.typeKey, created: res.created, updated: res.updated });
    return { created: res.created, updated: res.updated, unchanged: res.unchanged, skipped: res.skipped };
  }
}

