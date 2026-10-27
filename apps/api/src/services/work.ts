import { sql } from 'kysely';
import { interpolate } from '@grids/forms';
import {
  DEFAULT_WORK_STATES,
  uuidv7,
  WORK_PRIORITIES,
  WorkItemInput,
  WorkItemUpdate,
  WorkQuery,
  WorkTypeInput,
  type FormWork,
  type WorkComment,
  type WorkDetailDto,
  type WorkEventDto,
  type WorkItemDto,
  type WorkMineDto,
  type WorkPageDto,
  type WorkPriority,
  type WorkState,
  type WorkTypeDto,
} from '@grids/schema';
import type { z } from 'zod';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { workspacePolicy } from './policy.js';
import type { ProjectAccess, ProjectService } from './projects.js';
import { iso, isoOrNull } from './util.js';

type Tx = Parameters<Parameters<ProjectService['cellTx']>[1]>[0];
type Sla = { respondHours?: Partial<Record<string, number>>; resolveHours?: Partial<Record<string, number>> };
const HOUR = 3_600_000;

/** Whether people in this part of the project may work with it: members, and managers. */
const canWork = (a: Pick<ProjectAccess, 'member' | 'role'>) => a.member || a.role === 'manager';
const kindOf = (states: WorkState[], key: string): WorkState['kind'] => states.find((s) => s.key === key)?.kind ?? 'active';
const firstOf = (states: WorkState[], kind: WorkState['kind']) => states.find((s) => s.kind === kind)!;

/** When a piece of work is due to be answered and finished, from the type's service levels. */
function deadlines(sla: Sla, priority: WorkPriority, from: Date) {
  const at = (h: number | undefined) => (h ? new Date(from.getTime() + h * HOUR) : null);
  return { respondBy: at(sla.respondHours?.[priority]), resolveBy: at(sla.resolveHours?.[priority]) };
}

/** Everything needed to open a piece of work (by a person, or by a form's submission). */
export interface NewWork {
  tenantId: string;
  projectId: string;
  type: string;
  title: string;
  description?: string;
  priority?: WorkPriority;
  assigneeId?: string | null;
  entityId?: string | null;
  dueAt?: Date | null;
  requesterId?: string | null;
  requesterName?: string | null;
  submissionId?: string | null;
  createdBy?: string | null;
  source: 'manual' | 'form' | 'public' | 'schedule';
}

/** Whether someone may be given work in a project: a member of it, or an administrator of the organisation. */
async function assignable(ctx: Pick<ServiceContext, 'db'>, tx: Tx, tenantId: string, projectId: string, userId: string): Promise<boolean> {
  const m = await tx.selectFrom('project_member').select('user_id').where('project_id', '=', projectId).where('user_id', '=', userId).executeTakeFirst();
  if (m) return true;
  const org = await ctx.db.selectFrom('membership').select('user_id').where('tenant_id', '=', tenantId).where('user_id', '=', userId).where('role', '=', 'org_admin').executeTakeFirst();
  return !!org;
}

/** Opens a piece of work: numbers it, sets its service deadlines, and records that it began. */
export async function insertWork(ctx: Pick<ServiceContext, 'db' | 'now'>, tx: Tx, w: NewWork): Promise<{ id: string; ref: string }> {
  const type = await tx.selectFrom('work_type').selectAll().where('project_id', '=', w.projectId).where('key', '=', w.type).executeTakeFirst();
  if (!type) throw badRequest(`Unknown work type "${w.type}"`);
  if (w.assigneeId && !(await assignable(ctx, tx, w.tenantId, w.projectId, w.assigneeId))) throw badRequest('That person is not part of this project');
  if (w.entityId) {
    const e = await tx.selectFrom('entity').select('id').where('id', '=', w.entityId).where((eb) => eb.or([eb('project_id', '=', w.projectId), eb('project_id', 'is', null)])).executeTakeFirst();
    if (!e) throw badRequest('That place or thing is not in this project');
  }
  const now = ctx.now();
  const n = await tx.updateTable('work_type').set({ next_number: sql`next_number + 1` }).where('id', '=', type.id).returning(sql<number>`next_number - 1`.as('number')).executeTakeFirstOrThrow();
  const priority = w.priority ?? 'normal';
  const { respondBy, resolveBy } = deadlines(type.sla as Sla, priority, now);
  const id = uuidv7();
  await tx
    .insertInto('work_item')
    .values({
      id,
      tenant_id: w.tenantId,
      project_id: w.projectId,
      type_id: type.id,
      number: n.number,
      title: w.title,
      description: w.description ?? '',
      state: firstOf(type.states, 'open').key,
      priority,
      assignee_id: w.assigneeId ?? null,
      requester_id: w.requesterId ?? null,
      requester_name: w.requesterName ?? null,
      entity_id: w.entityId ?? null,
      submission_id: w.submissionId ?? null,
      due_at: w.dueAt ?? null,
      respond_by: respondBy,
      resolve_by: resolveBy,
      source: w.source,
      created_by: w.createdBy ?? null,
      created_at: now,
      updated_at: now,
    })
    .execute();
  await tx.insertInto('work_event').values({ id: uuidv7(), tenant_id: w.tenantId, item_id: id, actor_id: w.createdBy ?? null, kind: 'created', data: JSON.stringify({ source: w.source, ...(w.assigneeId && { assignee: w.assigneeId }) }), created_at: now }).execute();
  return { id, ref: `${type.prefix}-${n.number}` };
}

/** What a form's submission turns into, when the form asks for work: filled from the answers. */
export async function openWorkFromSubmission(
  ctx: Pick<ServiceContext, 'db' | 'now'>,
  tx: Tx,
  s: { tenantId: string; projectId: string; formName: string; work: FormWork; answers: Record<string, unknown>; submissionId: string; entityId: string | null; requesterId: string | null; requesterName: string | null; source: 'form' | 'public' },
): Promise<{ id: string; ref: string } | null> {
  if (!s.work.type) return null;
  const exists = await tx.selectFrom('work_type').select('id').where('project_id', '=', s.projectId).where('key', '=', s.work.type).executeTakeFirst();
  if (!exists) return null; // the type was removed: the submission is still kept
  const title = interpolate(s.work.title, s.answers).trim() || s.formName;
  const description = interpolate(s.work.description, s.answers).trim();
  const assignee = s.work.assigneeId && (await assignable(ctx, tx, s.tenantId, s.projectId, s.work.assigneeId)) ? s.work.assigneeId : null;
  return insertWork(ctx, tx, {
    tenantId: s.tenantId,
    projectId: s.projectId,
    type: s.work.type,
    title: title.slice(0, 200),
    description,
    priority: (WORK_PRIORITIES as readonly string[]).includes(String(s.answers[s.work.priorityFrom ?? ''] ?? '').toLowerCase()) ? (String(s.answers[s.work.priorityFrom!]).toLowerCase() as WorkPriority) : s.work.priority,
    assigneeId: assignee,
    entityId: s.entityId,
    dueAt: s.work.dueInHours ? new Date(ctx.now().getTime() + s.work.dueInHours * HOUR) : null,
    requesterId: s.requesterId,
    requesterName: s.requesterName,
    submissionId: s.submissionId,
    createdBy: s.requesterId,
    source: s.source,
  });
}

/** Tickets, tasks, visits and maintenance jobs: who has what, by when, and what has been said about it. */
export class WorkService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
  ) {}

  // ---------- types ----------

  async types(actor: Actor, tenantId: string, project: string): Promise<WorkTypeDto[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, (tx) => this.typesIn(tx, a.project.id));
  }

  private async typesIn(tx: Tx, projectId: string): Promise<WorkTypeDto[]> {
    const rows = await tx
      .selectFrom('work_type as t')
      .selectAll('t')
      .select((eb) => eb.selectFrom('work_item as i').select((e) => e.fn.countAll<string>().as('n')).whereRef('i.type_id', '=', 't.id').where('i.resolved_at', 'is', null).as('open'))
      .where('t.project_id', '=', projectId)
      .orderBy('t.created_at')
      .execute();
    return rows.map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      description: t.description,
      icon: t.icon,
      color: t.color,
      prefix: t.prefix,
      states: t.states,
      sla: { respondHours: (t.sla as Sla).respondHours ?? {}, resolveHours: (t.sla as Sla).resolveHours ?? {} },
      openCount: Number(t.open ?? 0),
    }));
  }

  async saveType(actor: Actor, tenantId: string, project: string, input: z.output<typeof WorkTypeInput>, existingKey?: string): Promise<WorkTypeDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, async (tx) => {
      if (!existingKey) {
        try {
          await tx.insertInto('work_type').values({ id: uuidv7(), tenant_id: tenantId, project_id: a.project.id, key: input.key, name: input.name, description: input.description, icon: input.icon, color: input.color, prefix: input.prefix, states: JSON.stringify(input.states), sla: JSON.stringify(input.sla) }).execute();
        } catch (e) {
          if ((e as { code?: string }).code === '23505') throw conflict(`There is already a type "${input.key}"`);
          throw e;
        }
        return;
      }
      const cur = await tx.selectFrom('work_type').select(['id', 'states']).where('project_id', '=', a.project.id).where('key', '=', existingKey).executeTakeFirst();
      if (!cur) throw notFound('Work type');
      // A state still in use cannot be taken away.
      const kept = new Set(input.states.map((s) => s.key));
      const used = await tx.selectFrom('work_item').select('state').distinct().where('type_id', '=', cur.id).execute();
      const gone = used.map((u) => u.state).filter((s) => !kept.has(s));
      if (gone.length) throw badRequest(`Work is still in ${gone.join(', ')}. Move it first, then take that state away.`);
      await tx.updateTable('work_type').set({ name: input.name, description: input.description, icon: input.icon, color: input.color, prefix: input.prefix, states: JSON.stringify(input.states), sla: JSON.stringify(input.sla) }).where('id', '=', cur.id).execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'work.type_saved', { project, type: input.key });
    return this.types(actor, tenantId, project);
  }

  async deleteType(actor: Actor, tenantId: string, project: string, key: string): Promise<WorkTypeDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, async (tx) => {
      const t = await tx.selectFrom('work_type').select('id').where('project_id', '=', a.project.id).where('key', '=', key).executeTakeFirst();
      if (!t) throw notFound('Work type');
      const n = await tx.selectFrom('work_item').select((e) => e.fn.countAll<string>().as('n')).where('type_id', '=', t.id).executeTakeFirstOrThrow();
      if (Number(n.n) > 0) throw conflict('This type still has work. Delete or move that first.');
      await tx.deleteFrom('work_type').where('id', '=', t.id).execute();
    });
    return this.types(actor, tenantId, project);
  }

  // ---------- reading ----------

  private base(tx: Tx) {
    return tx
      .selectFrom('work_item as i')
      .innerJoin('work_type as t', 't.id', 'i.type_id')
      .leftJoin('entity as e', 'e.id', 'i.entity_id')
      .select([
        'i.id', 'i.number', 'i.title', 'i.description', 'i.state', 'i.priority', 'i.assignee_id', 'i.requester_id', 'i.requester_name', 'i.entity_id', 'i.submission_id',
        'i.due_at', 'i.respond_by', 'i.resolve_by', 'i.first_response_at', 'i.resolved_at', 'i.source', 'i.created_at', 'i.updated_at', 'i.project_id',
        't.key as type_key', 't.name as type_name', 't.icon as type_icon', 't.color as type_color', 't.prefix', 't.states',
        'e.code as entity_code', 'e.name as entity_name',
        (eb) => eb.selectFrom('work_event as v').select((x) => x.fn.countAll<string>().as('n')).whereRef('v.item_id', '=', 'i.id').where('v.kind', '=', 'comment').as('comments'),
      ]);
  }

  private async names(ids: (string | null)[]): Promise<Map<string, string>> {
    const set = [...new Set(ids.filter((x): x is string => !!x))];
    if (!set.length) return new Map();
    const rows = await this.ctx.db.selectFrom('user_identity').select(['id', 'display_name', 'email']).where('id', 'in', set).execute();
    return new Map(rows.map((r) => [r.id, r.display_name || r.email || 'Someone']));
  }

  private dto(r: Awaited<ReturnType<ReturnType<WorkService['base']>['execute']>>[number], names: Map<string, string>): WorkItemDto {
    const now = this.ctx.now();
    const kind = kindOf(r.states, r.state);
    const open = kind !== 'done';
    const label = r.states.find((s) => s.key === r.state)?.label ?? r.state;
    return {
      id: r.id,
      number: r.number,
      ref: `${r.prefix}-${r.number}`,
      type: { key: r.type_key, name: r.type_name, icon: r.type_icon, color: r.type_color },
      title: r.title,
      description: r.description,
      state: { key: r.state, label, kind },
      priority: r.priority,
      assignee: r.assignee_id ? { id: r.assignee_id, name: names.get(r.assignee_id) ?? 'Someone' } : null,
      requester: { id: r.requester_id, name: r.requester_id ? (names.get(r.requester_id) ?? r.requester_name) : r.requester_name },
      entity: r.entity_id ? { id: r.entity_id, code: r.entity_code!, name: r.entity_name! } : null,
      submissionId: r.submission_id,
      dueAt: isoOrNull(r.due_at),
      respondBy: isoOrNull(r.respond_by),
      resolveBy: isoOrNull(r.resolve_by),
      firstResponseAt: isoOrNull(r.first_response_at),
      resolvedAt: isoOrNull(r.resolved_at),
      overdue: open && !!r.due_at && r.due_at < now,
      breached: open && ((!!r.resolve_by && r.resolve_by < now) || (!r.first_response_at && !!r.respond_by && r.respond_by < now)),
      source: r.source,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      commentCount: Number(r.comments ?? 0),
    };
  }

  async list(actor: Actor, tenantId: string, project: string, query: z.output<typeof WorkQuery>): Promise<WorkPageDto> {
    const a = await this.projects.access(actor, tenantId, project);
    if (!canWork(a)) throw forbidden('You are not part of this project.');
    const now = this.ctx.now();
    return this.projects.cellTx(tenantId, async (tx) => {
      let qb = this.base(tx).where('i.project_id', '=', a.project.id);
      let count = tx.selectFrom('work_item as i').innerJoin('work_type as t', 't.id', 'i.type_id').leftJoin('entity as e', 'e.id', 'i.entity_id').select((e) => e.fn.countAll<string>().as('n')).where('i.project_id', '=', a.project.id);
      const apply = (cond: ReturnType<typeof sql<boolean>>) => {
        qb = qb.where(cond);
        count = count.where(cond);
      };
      // Members limited to part of the project see work about that part, and work about nothing in particular.
      if (a.roots) apply(sql<boolean>`(i.entity_id is null or e.path <@ any(${a.roots}::ltree[]))`);
      if (query.type) apply(sql<boolean>`t.key = ${query.type}`);
      if (query.state === 'open') apply(sql<boolean>`i.resolved_at is null`);
      else if (query.state === 'done') apply(sql<boolean>`i.resolved_at is not null`);
      else if (query.state) apply(sql<boolean>`i.state = ${query.state}`);
      if (query.assignee === 'me') apply(sql<boolean>`i.assignee_id = ${actor.id}`);
      else if (query.assignee === 'none') apply(sql<boolean>`i.assignee_id is null`);
      else if (query.assignee) apply(sql<boolean>`i.assignee_id = ${query.assignee}`);
      if (query.requester === 'me') apply(sql<boolean>`i.requester_id = ${actor.id}`);
      if (query.entityId) apply(sql<boolean>`i.entity_id = ${query.entityId}`);
      if (query.priority) apply(sql<boolean>`i.priority = ${query.priority}`);
      if (query.q) apply(sql<boolean>`(i.title ilike ${`%${query.q.replace(/[%_]/g, '\\$&')}%`} or (t.prefix || '-' || i.number::text) ilike ${`${query.q.replace(/[%_]/g, '\\$&')}%`})`);
      if (query.overdue) apply(sql<boolean>`(i.resolved_at is null and i.due_at < ${now})`);
      const order = { updated: sql`i.updated_at desc`, created: sql`i.created_at desc`, due: sql`i.due_at asc nulls last, i.updated_at desc`, priority: sql`array_position(array['urgent','high','normal','low'], i.priority), i.updated_at desc` }[query.sort];
      const rows = await qb.orderBy(order).limit(query.pageSize).offset((query.page - 1) * query.pageSize).execute();
      const total = Number((await count.executeTakeFirstOrThrow()).n);
      const names = await this.names(rows.flatMap((r) => [r.assignee_id, r.requester_id]));
      return { items: rows.map((r) => this.dto(r, names)), total, page: query.page, pageSize: query.pageSize };
    });
  }

  async get(actor: Actor, tenantId: string, project: string, id: string): Promise<WorkDetailDto> {
    const a = await this.projects.access(actor, tenantId, project);
    if (!canWork(a)) throw forbidden('You are not part of this project.');
    return this.projects.cellTx(tenantId, async (tx) => {
      const r = await this.base(tx).where('i.id', '=', id).where('i.project_id', '=', a.project.id).executeTakeFirst();
      if (!r) throw notFound('Work');
      const events = await tx.selectFrom('work_event').selectAll().where('item_id', '=', id).orderBy('created_at').execute();
      const names = await this.names([r.assignee_id, r.requester_id, ...events.map((e) => e.actor_id)]);
      const ev: WorkEventDto[] = events.map((e) => ({ id: e.id, kind: e.kind, actor: e.actor_id ? { id: e.actor_id, name: names.get(e.actor_id) ?? 'Someone' } : null, body: e.body, internal: e.internal, data: e.data, createdAt: iso(e.created_at) }));
      return { ...this.dto(r, names), events: ev };
    });
  }

  /** What is waiting on the caller, from every project. */
  async mine(actor: Actor, tenantId: string): Promise<WorkMineDto> {
    if (!(await workspacePolicy(this.ctx, actor, tenantId))) throw forbidden('You are not a member of this organisation.');
    return this.projects.cellTx(tenantId, async (tx) => {
      const rows = await this.base(tx)
        .innerJoin('project as p', 'p.id', 'i.project_id')
        .select(['p.key as project_key', 'p.name as project_name', 'p.color as project_color'])
        .where('i.assignee_id', '=', actor.id)
        .where('i.resolved_at', 'is', null)
        .where('p.archived_at', 'is', null)
        .orderBy(sql`i.due_at asc nulls last`)
        .orderBy('i.updated_at', 'desc')
        .limit(200)
        .execute();
      const names = await this.names(rows.flatMap((r) => [r.assignee_id, r.requester_id]));
      return rows.map((r) => ({ ...this.dto(r, names), project: { key: r.project_key, name: r.project_name, color: r.project_color } }));
    });
  }

  // ---------- changing ----------

  private notify(tenantId: string, projectKey: string, to: string | null, subject: string, text: string, itemId: string) {
    if (!to) return;
    const link = `${this.ctx.workspaceUrl}/o/${tenantId}/p/${projectKey}/work?item=${itemId}`;
    void this.ctx.email.send('work_update', tenantId, { to, subject, text: `${text}\n\n${link}` }).catch(() => undefined);
  }

  private async emailOf(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    return (await this.ctx.db.selectFrom('user_identity').select('email').where('id', '=', userId).executeTakeFirst())?.email ?? null;
  }

  async create(actor: Actor, tenantId: string, project: string, input: z.output<typeof WorkItemInput>): Promise<WorkDetailDto> {
    const a = await this.projects.access(actor, tenantId, project);
    if (!canWork(a)) throw forbidden('You are not part of this project.');
    if (input.assigneeId && input.assigneeId !== actor.id && a.role !== 'manager') throw forbidden('Only a project manager can give work to someone else.');
    const made = await this.projects.cellTx(tenantId, (tx) =>
      insertWork(this.ctx, tx, { tenantId, projectId: a.project.id, type: input.type, title: input.title, description: input.description, priority: input.priority, assigneeId: input.assigneeId, entityId: input.entityId, dueAt: input.dueAt ? new Date(input.dueAt) : null, requesterId: actor.id, createdBy: actor.id, source: 'manual' }),
    );
    if (input.assigneeId && input.assigneeId !== actor.id) this.notify(tenantId, a.project.key, await this.emailOf(input.assigneeId), `${made.ref}: ${input.title}`, `${actor.email ?? 'Someone'} gave you ${made.ref}: ${input.title}`, made.id);
    return this.get(actor, tenantId, project, made.id);
  }

  async update(actor: Actor, tenantId: string, project: string, id: string, patch: z.output<typeof WorkItemUpdate>): Promise<WorkDetailDto> {
    const a = await this.projects.access(actor, tenantId, project);
    if (!canWork(a)) throw forbidden('You are not part of this project.');
    const now = this.ctx.now();
    let assignedTo: string | null = null;
    let resolvedRef: { requester: string | null; ref: string; title: string } | null = null;
    await this.projects.cellTx(tenantId, async (tx) => {
      const cur = await tx.selectFrom('work_item as i').innerJoin('work_type as t', 't.id', 'i.type_id').selectAll('i').select(['t.states', 't.sla', 't.prefix']).where('i.id', '=', id).where('i.project_id', '=', a.project.id).executeTakeFirst();
      if (!cur) throw notFound('Work');
      const mine = cur.assignee_id === actor.id || cur.created_by === actor.id || cur.requester_id === actor.id;
      if (a.role !== 'manager' && !mine) throw forbidden('Only a project manager, or whoever it is assigned to or was asked by, can change it.');
      if (patch.assigneeId && patch.assigneeId !== actor.id && a.role !== 'manager') throw forbidden('Only a project manager can give work to someone else.');
      const set: Record<string, unknown> = { updated_at: now };
      const events: { kind: string; body?: string; data?: Record<string, unknown> }[] = [];
      if (patch.title !== undefined && patch.title !== cur.title) (set.title = patch.title), events.push({ kind: 'edited', data: { field: 'title', from: cur.title, to: patch.title } });
      if (patch.description !== undefined && patch.description !== cur.description) (set.description = patch.description), events.push({ kind: 'edited', data: { field: 'description' } });
      if (patch.entityId !== undefined && patch.entityId !== cur.entity_id) {
        if (patch.entityId) {
          const e = await tx.selectFrom('entity').select('id').where('id', '=', patch.entityId).where((eb) => eb.or([eb('project_id', '=', a.project.id), eb('project_id', 'is', null)])).executeTakeFirst();
          if (!e) throw badRequest('That place or thing is not in this project');
        }
        set.entity_id = patch.entityId;
        events.push({ kind: 'edited', data: { field: 'entity', to: patch.entityId } });
      }
      if (patch.dueAt !== undefined && (patch.dueAt ? new Date(patch.dueAt).getTime() : null) !== (cur.due_at?.getTime() ?? null)) (set.due_at = patch.dueAt ? new Date(patch.dueAt) : null), events.push({ kind: 'due', data: { from: isoOrNull(cur.due_at), to: patch.dueAt } });
      if (patch.priority && patch.priority !== cur.priority) {
        set.priority = patch.priority;
        // The deadlines follow the priority, counted from when it was opened.
        const d = deadlines(cur.sla as Sla, patch.priority, cur.created_at);
        set.respond_by = d.respondBy;
        set.resolve_by = d.resolveBy;
        events.push({ kind: 'priority', data: { from: cur.priority, to: patch.priority } });
      }
      if (patch.assigneeId !== undefined && patch.assigneeId !== cur.assignee_id) {
        if (patch.assigneeId && !(await assignable(this.ctx, tx, tenantId, a.project.id, patch.assigneeId))) throw badRequest('That person is not part of this project');
        set.assignee_id = patch.assigneeId;
        events.push({ kind: 'assign', data: { from: cur.assignee_id, to: patch.assigneeId } });
        if (patch.assigneeId && patch.assigneeId !== actor.id) assignedTo = patch.assigneeId;
      }
      if (patch.state && patch.state !== cur.state) {
        if (!cur.states.some((s) => s.key === patch.state)) throw badRequest(`"${patch.state}" is not a state of this type`);
        const from = kindOf(cur.states, cur.state);
        const to = kindOf(cur.states, patch.state);
        set.state = patch.state;
        if (to === 'done' && from !== 'done') set.resolved_at = now;
        if (to !== 'done' && from === 'done') set.resolved_at = null;
        // Taking it up counts as the first answer.
        if (!cur.first_response_at && from === 'open' && to !== 'open' && actor.id !== cur.requester_id) set.first_response_at = now;
        events.push({ kind: 'state', data: { from: cur.state, to: patch.state } });
        if (to === 'done' && from !== 'done') resolvedRef = { requester: cur.requester_id, ref: `${cur.prefix}-${cur.number}`, title: cur.title };
      }
      if (events.length) {
        await tx.updateTable('work_item').set(set as never).where('id', '=', id).execute();
        await tx.insertInto('work_event').values(events.map((e) => ({ id: uuidv7(), tenant_id: tenantId, item_id: id, actor_id: actor.id, kind: e.kind, body: e.body ?? '', data: JSON.stringify(e.data ?? {}), created_at: now }))).execute();
      }
    });
    const detail = await this.get(actor, tenantId, project, id);
    if (assignedTo) this.notify(tenantId, a.project.key, await this.emailOf(assignedTo), `${detail.ref}: ${detail.title}`, `${actor.email ?? 'Someone'} gave you ${detail.ref}: ${detail.title}`, id);
    const done = resolvedRef as { requester: string | null; ref: string; title: string } | null;
    if (done?.requester && done.requester !== actor.id) this.notify(tenantId, a.project.key, await this.emailOf(done.requester), `${done.ref} is resolved`, `${done.ref}: ${done.title} has been resolved.`, id);
    return detail;
  }

  async comment(actor: Actor, tenantId: string, project: string, id: string, input: z.output<typeof WorkComment>): Promise<WorkDetailDto> {
    const a = await this.projects.access(actor, tenantId, project);
    if (!canWork(a)) throw forbidden('You are not part of this project.');
    const now = this.ctx.now();
    let tell: string | null = null;
    let ref = '';
    await this.projects.cellTx(tenantId, async (tx) => {
      const cur = await tx.selectFrom('work_item as i').innerJoin('work_type as t', 't.id', 'i.type_id').select(['i.id', 'i.requester_id', 'i.assignee_id', 'i.title', 'i.first_response_at', 't.prefix', 'i.number']).where('i.id', '=', id).where('i.project_id', '=', a.project.id).executeTakeFirst();
      if (!cur) throw notFound('Work');
      await tx.insertInto('work_event').values({ id: uuidv7(), tenant_id: tenantId, item_id: id, actor_id: actor.id, kind: 'comment', body: input.body, internal: input.internal, created_at: now }).execute();
      // The first reply from anyone but the person who asked counts as answering.
      const answers = !input.internal && actor.id !== cur.requester_id && !cur.first_response_at;
      await tx.updateTable('work_item').set({ updated_at: now, ...(answers && { first_response_at: now }) }).where('id', '=', id).execute();
      ref = `${cur.prefix}-${cur.number}`;
      // Tell the other side: the assignee hears from the requester, the requester hears from the team.
      const other = actor.id === cur.assignee_id ? (input.internal ? null : cur.requester_id) : cur.assignee_id;
      if (other && other !== actor.id) tell = other;
    });
    const detail = await this.get(actor, tenantId, project, id);
    if (tell) this.notify(tenantId, a.project.key, await this.emailOf(tell), `New comment on ${ref}`, `${actor.email ?? 'Someone'} wrote on ${ref}: ${detail.title}\n\n${input.body}`, id);
    return detail;
  }
}

export { DEFAULT_WORK_STATES };
