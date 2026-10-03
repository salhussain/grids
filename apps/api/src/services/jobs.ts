import { cronProblem, enqueueRun, freshness, syncSchedule } from '@grids/data';
import {
  JobStep,
  uuidv7,
  type DatasetDto,
  type JobDto,
  type Page,
  type RunDetail,
  type RunDto,
} from '@grids/schema';
import type { z } from 'zod';
import type { JobInput, RunQuery } from '@grids/schema';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import type { ProjectService } from './projects.js';
import { iso, isoOrNull, isUniqueViolation } from './util.js';

type RunRow = {
  id: string;
  job_id: string;
  job_name: string;
  status: RunDto['status'];
  trigger: string;
  attempt: number;
  queued_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error: string | null;
  stats: Record<string, number>;
};

const toRun = (r: RunRow): RunDto => ({
  id: r.id,
  jobId: r.job_id,
  jobName: r.job_name,
  status: r.status,
  trigger: r.trigger,
  attempt: r.attempt,
  queuedAt: iso(r.queued_at),
  startedAt: isoOrNull(r.started_at),
  finishedAt: isoOrNull(r.finished_at),
  durationMs: r.started_at && r.finished_at ? r.finished_at.getTime() - r.started_at.getTime() : null,
  error: r.error,
  stats: r.stats ?? {},
});

/** Jobs, runs and datasets of a project (M4). Execution happens in the worker. */
export class JobService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
  ) {}

  private runSelect = [
    'r.id',
    'r.job_id',
    'j.name as job_name',
    'r.status',
    'r.trigger',
    'r.attempt',
    'r.queued_at',
    'r.started_at',
    'r.finished_at',
    'r.error',
    'r.stats',
  ] as const;

  async list(actor: Actor, tenantId: string, project: string): Promise<JobDto[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, async (tx) => {
      const jobs = await tx.selectFrom('job').selectAll().where('project_id', '=', a.project.id).orderBy('name').execute();
      if (!jobs.length) return [];
      const ids = jobs.map((j) => j.id);
      const schedules = new Map(
        (await tx.selectFrom('job_schedule').select(['job_id', 'next_run_at']).where('job_id', 'in', ids).execute()).map((s) => [s.job_id, s.next_run_at]),
      );
      const recent = await tx
        .selectFrom('run as r')
        .innerJoin('job as j', 'j.id', 'r.job_id')
        .select([...this.runSelect])
        .where('r.job_id', 'in', ids)
        .where('r.queued_at', '>', new Date(this.ctx.now().getTime() - 7 * 86_400_000))
        .orderBy('r.queued_at', 'desc')
        .limit(ids.length * 25)
        .execute();
      const lastSuccess = new Map(
        (
          await tx
            .selectFrom('run')
            .select(['job_id', (eb) => eb.fn.max('finished_at').as('f')])
            .where('job_id', 'in', ids)
            .where('status', '=', 'succeeded')
            .groupBy('job_id')
            .execute()
        ).map((r) => [r.job_id, r.f as Date | null]),
      );
      return jobs.map((j) => {
        const runs = recent.filter((r) => r.job_id === j.id);
        const finished = runs.filter((r) => r.status === 'succeeded' || r.status === 'failed').slice(0, 20);
        return {
          id: j.id,
          key: j.key,
          name: j.name,
          description: j.description,
          steps: (j.steps as unknown[]).map((s) => JobStep.parse(s)),
          schedule: j.schedule,
          timezone: j.timezone,
          enabled: j.enabled,
          maxRetries: j.max_retries,
          timeoutSeconds: j.timeout_seconds,
          freshnessMinutes: j.freshness_minutes,
          nextRunAt: isoOrNull(schedules.get(j.id) ?? null),
          lastRun: runs[0] ? toRun(runs[0] as RunRow) : null,
          freshness: freshness(lastSuccess.get(j.id) ?? null, j.freshness_minutes, this.ctx.now()),
          successRate: finished.length ? finished.filter((r) => r.status === 'succeeded').length / finished.length : null,
        };
      });
    });
  }

  async save(actor: Actor, tenantId: string, project: string, input: z.output<typeof JobInput>, existingKey?: string): Promise<JobDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    if (input.schedule) {
      const problem = cronProblem(input.schedule, input.timezone);
      if (problem) throw badRequest(`Schedule: ${problem}`);
    }
    const ids = input.steps.map((s) => s.id);
    if (new Set(ids).size !== ids.length) throw badRequest('Step ids must be unique');
    const values = {
      key: input.key,
      name: input.name,
      description: input.description,
      steps: JSON.stringify(input.steps),
      schedule: input.schedule,
      timezone: input.timezone,
      enabled: input.enabled,
      max_retries: input.maxRetries,
      timeout_seconds: input.timeoutSeconds,
      freshness_minutes: input.freshnessMinutes,
      updated_at: this.ctx.now(),
    };
    try {
      await this.projects.cellTx(tenantId, async (tx) => {
        let id: string;
        if (existingKey) {
          const cur = await tx.selectFrom('job').select('id').where('project_id', '=', a.project.id).where('key', '=', existingKey).executeTakeFirst();
          if (!cur) throw notFound('Job');
          id = cur.id;
          await tx.updateTable('job').set(values).where('id', '=', id).execute();
        } else {
          id = uuidv7();
          await tx.insertInto('job').values({ id, tenant_id: tenantId, project_id: a.project.id, ...values }).execute();
        }
        await syncSchedule(tx, { id, tenantId, schedule: a.project.archived_at ? null : input.schedule, timezone: input.timezone, enabled: input.enabled }, this.ctx.now());
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Key taken', `A job with key "${input.key}" already exists.`);
      throw e;
    }
    await audit(this.ctx, actor.id, tenantId, existingKey ? 'job.updated' : 'job.created', { project: a.project.key, job: input.key, schedule: input.schedule });
    return this.list(actor, tenantId, project);
  }

  async remove(actor: Actor, tenantId: string, project: string, key: string): Promise<JobDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, (tx) => tx.deleteFrom('job').where('project_id', '=', a.project.id).where('key', '=', key).execute());
    await audit(this.ctx, actor.id, tenantId, 'job.deleted', { project: a.project.key, job: key });
    return this.list(actor, tenantId, project);
  }

  /** Queues a manual run (editors and managers). */
  async trigger(actor: Actor, tenantId: string, project: string, key: string): Promise<RunDto> {
    const a = await this.projects.access(actor, tenantId, project, 'editor');
    const runId = await this.projects.cellTx(tenantId, async (tx) => {
      const job = await tx.selectFrom('job').select(['id']).where('project_id', '=', a.project.id).where('key', '=', key).executeTakeFirst();
      if (!job) throw notFound('Job');
      const busy = await tx.selectFrom('run').select('id').where('job_id', '=', job.id).where('status', 'in', ['queued', 'running']).executeTakeFirst();
      if (busy) throw conflict('Already running', 'This job already has a run queued or in progress.');
      return enqueueRun(tx, { tenantId, projectId: a.project.id, jobId: job.id, trigger: 'manual', triggeredBy: actor.id });
    });
    return (await this.run(actor, tenantId, project, runId)) as RunDto;
  }

  async cancel(actor: Actor, tenantId: string, project: string, runId: string): Promise<RunDetail> {
    const a = await this.projects.access(actor, tenantId, project, 'editor');
    await this.projects.cellTx(tenantId, async (tx) => {
      const r = await tx.selectFrom('run').select(['status']).where('id', '=', runId).where('project_id', '=', a.project.id).executeTakeFirst();
      if (!r) throw notFound('Run');
      if (r.status !== 'queued' && r.status !== 'running') throw conflict('Run finished', 'Only queued or running runs can be cancelled.');
      await tx
        .updateTable('run')
        .set({ status: 'cancelled', finished_at: this.ctx.now(), error: 'Cancelled' })
        .where('id', '=', runId)
        .execute();
      if (r.status === 'queued') await tx.deleteFrom('job_queue').where('run_id', '=', runId).execute();
      await tx.insertInto('run_log').values({ tenant_id: tenantId, run_id: runId, level: 'warn', step: null, message: `Cancelled by ${actor.email ?? 'a user'}` }).execute();
    });
    return this.run(actor, tenantId, project, runId);
  }

  async runs(actor: Actor, tenantId: string, project: string, query: z.output<typeof RunQuery>): Promise<Page<RunDto>> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, async (tx) => {
      let q = tx.selectFrom('run as r').innerJoin('job as j', 'j.id', 'r.job_id').where('r.project_id', '=', a.project.id);
      if (query.jobId) q = q.where('r.job_id', '=', query.jobId);
      if (query.status) q = q.where('r.status', '=', query.status);
      const [items, total] = await Promise.all([
        q
          .select([...this.runSelect])
          .orderBy('r.queued_at', 'desc')
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize)
          .execute(),
        q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
      ]);
      return { items: items.map((r) => toRun(r as RunRow)), total: Number(total.n), page: query.page, pageSize: query.pageSize };
    });
  }

  async run(actor: Actor, tenantId: string, project: string, runId: string): Promise<RunDetail> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, async (tx) => {
      const r = await tx
        .selectFrom('run as r')
        .innerJoin('job as j', 'j.id', 'r.job_id')
        .select([...this.runSelect])
        .where('r.id', '=', runId)
        .where('r.project_id', '=', a.project.id)
        .executeTakeFirst();
      if (!r) throw notFound('Run');
      const logs = await tx.selectFrom('run_log').select(['at', 'level', 'step', 'message']).where('run_id', '=', runId).orderBy('id').limit(1000).execute();
      return { ...toRun(r as RunRow), logs: logs.map((l) => ({ ...l, at: iso(l.at) })) };
    });
  }

  // ---------- datasets ----------

  async datasets(actor: Actor, tenantId: string, project: string): Promise<DatasetDto[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, async (tx) => {
      const rows = await tx.selectFrom('dataset').selectAll().where('project_id', '=', a.project.id).orderBy('name').execute();
      // A dataset's expected cadence is that of the job that last materialised it.
      const runJobs = new Map(
        rows.some((r) => r.last_run_id)
          ? (
              await tx
                .selectFrom('run as r')
                .innerJoin('job as j', 'j.id', 'r.job_id')
                .select(['r.id', 'j.freshness_minutes'])
                .where('r.id', 'in', rows.map((r) => r.last_run_id).filter((x): x is string => !!x))
                .execute()
            ).map((r) => [r.id, r.freshness_minutes])
          : [],
      );
      return rows.map((d) => ({
        id: d.id,
        key: d.key,
        name: d.name,
        description: d.description,
        columns: d.columns as string[],
        rowCount: d.row_count,
        lastMaterialisedAt: isoOrNull(d.last_materialised_at),
        freshness: freshness(d.last_materialised_at, d.freshness_minutes ?? (d.last_run_id ? (runJobs.get(d.last_run_id) ?? null) : null), this.ctx.now()),
      }));
    });
  }

  async datasetRows(actor: Actor, tenantId: string, project: string, key: string, page: { page: number; pageSize: number }) {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, async (tx) => {
      const ds = await tx.selectFrom('dataset').select(['id', 'columns', 'row_count']).where('project_id', '=', a.project.id).where('key', '=', key).executeTakeFirst();
      if (!ds) throw notFound('Dataset');
      const rows = await tx
        .selectFrom('dataset_row')
        .select('data')
        .where('dataset_id', '=', ds.id)
        .orderBy('id')
        .limit(page.pageSize)
        .offset((page.page - 1) * page.pageSize)
        .execute();
      return { columns: ds.columns as string[], items: rows.map((r) => r.data as Record<string, unknown>), total: ds.row_count, page: page.page, pageSize: page.pageSize };
    });
  }
}
