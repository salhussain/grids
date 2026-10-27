import { uuidv7, WorkScheduleInput, type WorkScheduleDto } from '@grids/schema';
import type { z } from 'zod';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import type { ProjectService } from './projects.js';
import { insertWork } from './work.js';
import { isoOrNull } from './util.js';

type Tx = Parameters<Parameters<ProjectService['cellTx']>[1]>[0];
type Row = Awaited<ReturnType<typeof dueSchedules>>[number];
const dueSchedules = (tx: Tx) => tx.selectFrom('work_schedule as s').innerJoin('work_type as t', 't.id', 's.type_id').selectAll('s').select('t.key as type_key').where('s.active', '=', true).execute();
const DAY = 86_400_000;
const fill = (text: string, e: { name: string; code: string }) => text.replaceAll('${name}', e.name).replaceAll('${code}', e.code);

/** Recurring work: what comes round again, for which things, and the pass that opens it when it falls due. */
export class WorkScheduleService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
  ) {}

  async list(actor: Actor, tenantId: string, project: string): Promise<WorkScheduleDto[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, async (tx) => {
      const rows = await tx
        .selectFrom('work_schedule as s')
        .innerJoin('work_type as t', 't.id', 's.type_id')
        .leftJoin('entity as e', 'e.id', 's.entity_id')
        .select(['s.id', 's.key', 's.name', 's.title', 's.description', 's.priority', 's.assignee_id', 's.entity_id', 's.entity_type', 's.every_days', 's.meter_attribute', 's.meter_every', 's.lead_days', 's.active', 't.key as type', 'e.name as entity_name'])
        .select((eb) => [
          eb.selectFrom('work_schedule_target as g').select((x) => x.fn.countAll<string>().as('n')).whereRef('g.schedule_id', '=', 's.id').as('targets'),
          eb.selectFrom('work_schedule_target as g').select((x) => x.fn.min('g.next_due_at').as('d')).whereRef('g.schedule_id', '=', 's.id').as('next_due'),
        ])
        .where('s.project_id', '=', a.project.id)
        .orderBy('s.name')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        type: r.type,
        title: r.title,
        description: r.description,
        priority: r.priority,
        assigneeId: r.assignee_id,
        entityId: r.entity_id,
        entityName: r.entity_name,
        entityType: r.entity_type,
        everyDays: r.every_days,
        meterAttribute: r.meter_attribute,
        meterEvery: r.meter_every,
        leadDays: r.lead_days,
        active: r.active,
        targets: Number(r.targets ?? 0),
        nextDueAt: isoOrNull(r.next_due),
      }));
    });
  }

  async save(actor: Actor, tenantId: string, project: string, input: z.output<typeof WorkScheduleInput>, existingKey?: string): Promise<WorkScheduleDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, async (tx) => {
      const type = await tx.selectFrom('work_type').select('id').where('project_id', '=', a.project.id).where('key', '=', input.type).executeTakeFirst();
      if (!type) throw badRequest(`Unknown work type "${input.type}"`);
      if (input.entityId) {
        const e = await tx.selectFrom('entity').select('id').where('id', '=', input.entityId).where((eb) => eb.or([eb('project_id', '=', a.project.id), eb('project_id', 'is', null)])).executeTakeFirst();
        if (!e) throw badRequest('That place or thing is not in this project');
      }
      if (input.entityType) {
        const t = await tx.selectFrom('entity_type').select('id').where('key', '=', input.entityType).where((eb) => eb.or([eb('project_id', '=', a.project.id), eb('project_id', 'is', null)])).executeTakeFirst();
        if (!t) throw badRequest(`Unknown type "${input.entityType}"`);
      }
      const values = {
        type_id: type.id,
        name: input.name,
        title: input.title,
        description: input.description,
        priority: input.priority,
        assignee_id: input.assigneeId,
        entity_id: input.entityId,
        entity_type: input.entityType,
        every_days: input.everyDays,
        meter_attribute: input.meterAttribute,
        meter_every: input.meterEvery,
        lead_days: input.leadDays,
        active: input.active,
      };
      if (!existingKey) {
        try {
          await tx.insertInto('work_schedule').values({ id: uuidv7(), tenant_id: tenantId, project_id: a.project.id, key: input.key, ...values }).execute();
        } catch (e) {
          if ((e as { code?: string }).code === '23505') throw conflict(`There is already a schedule "${input.key}"`);
          throw e;
        }
        return;
      }
      const cur = await tx.selectFrom('work_schedule').select('id').where('project_id', '=', a.project.id).where('key', '=', existingKey).executeTakeFirst();
      if (!cur) throw notFound('Schedule');
      await tx.updateTable('work_schedule').set(values).where('id', '=', cur.id).execute();
      // New rhythm, new baseline: the dates are worked out afresh.
      await tx.deleteFrom('work_schedule_target').where('schedule_id', '=', cur.id).where('item_id', 'is', null).execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'work.schedule_saved', { project, schedule: input.key });
    return this.list(actor, tenantId, project);
  }

  async remove(actor: Actor, tenantId: string, project: string, key: string): Promise<WorkScheduleDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, async (tx) => {
      const r = await tx.deleteFrom('work_schedule').where('project_id', '=', a.project.id).where('key', '=', key).returning('id').executeTakeFirst();
      if (!r) throw notFound('Schedule');
    });
    return this.list(actor, tenantId, project);
  }

  /** One pass: opens the work that has fallen due, and re-arms schedules whose work has been finished. Returns how many it opened. */
  async run(tenantId: string): Promise<number> {
    const now = this.ctx.now();
    return this.projects.cellTx(tenantId, async (tx) => {
      const schedules = await dueSchedules(tx);
      let opened = 0;
      for (const s of schedules) opened += await this.runOne(tx, tenantId, s, now);
      return opened;
    });
  }

  private async runOne(tx: Tx, tenantId: string, s: Row, now: Date): Promise<number> {
    const targets = s.entity_id
      ? await tx.selectFrom('entity').select(['id', 'name', 'code', 'attributes']).where('id', '=', s.entity_id).execute()
      : await tx
          .selectFrom('entity')
          .select(['id', 'name', 'code', 'attributes'])
          .where((eb) => eb.or([eb('project_id', '=', s.project_id), eb('project_id', 'is', null)]))
          .where('type_id', 'in', (eb) => eb.selectFrom('entity_type').select('id').where('key', '=', s.entity_type!).where((x) => x.or([x('project_id', '=', s.project_id), x('project_id', 'is', null)])))
          .execute();
    let opened = 0;
    for (const e of targets) {
      const meter = s.meter_attribute ? Number((e.attributes as Record<string, unknown>)[s.meter_attribute]) : NaN;
      const reading = Number.isFinite(meter) ? meter : null;
      let st = await tx.selectFrom('work_schedule_target').selectAll().where('schedule_id', '=', s.id).where('entity_id', '=', e.id).executeTakeFirst();
      if (!st) {
        st = { schedule_id: s.id, entity_id: e.id, tenant_id: tenantId, next_due_at: s.every_days ? new Date(now.getTime() + s.every_days * DAY) : null, last_meter: reading, item_id: null };
        await tx.insertInto('work_schedule_target').values(st).execute();
        continue;
      }
      if (st.item_id) {
        const item = await tx.selectFrom('work_item as i').innerJoin('work_type as t', 't.id', 'i.type_id').select(['i.resolved_at', 'i.state', 't.states']).where('i.id', '=', st.item_id).executeTakeFirst();
        const done = !item || item.resolved_at || item.states.find((x) => x.key === item.state)?.kind === 'done';
        if (!done) continue;
        // The next cycle counts from when the work was finished.
        const from = item?.resolved_at ?? now;
        st = { ...st, item_id: null, next_due_at: s.every_days ? new Date(from.getTime() + s.every_days * DAY) : null, last_meter: reading ?? st.last_meter };
        await tx.updateTable('work_schedule_target').set({ item_id: null, next_due_at: st.next_due_at, last_meter: st.last_meter }).where('schedule_id', '=', s.id).where('entity_id', '=', e.id).execute();
      }
      const byDate = st.next_due_at && now.getTime() >= st.next_due_at.getTime() - s.lead_days * DAY;
      const byMeter = s.meter_every && reading !== null && st.last_meter !== null && reading >= st.last_meter + s.meter_every;
      if (!byDate && !byMeter) continue;
      const made = await insertWork(this.ctx, tx, {
        tenantId,
        projectId: s.project_id,
        type: s.type_key,
        title: fill(s.title, e),
        description: s.description,
        priority: s.priority,
        assigneeId: s.assignee_id,
        entityId: e.id,
        dueAt: byDate && st.next_due_at ? st.next_due_at : now,
        source: 'schedule',
      });
      await tx.updateTable('work_schedule_target').set({ item_id: made.id }).where('schedule_id', '=', s.id).where('entity_id', '=', e.id).execute();
      opened++;
    }
    return opened;
  }

}
