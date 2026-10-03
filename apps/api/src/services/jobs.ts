import { cronProblem, enqueueRun, freshness, syncSchedule, syncSensor } from '@grids/data';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import {
  FILE_MAX_BYTES,
  JobSensor,
  JobStep,
  JobTriggers,
  uuidv7,
  type FileDto,
  type UploadResult,
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

type Tx = Parameters<Parameters<ProjectService['cellTx']>[1]>[0];
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
      const sensors = new Map(
        (await tx.selectFrom('job_sensor').selectAll().where('job_id', 'in', ids).execute()).map((x) => [x.job_id, x]),
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
          runOnUpload: j.run_on_upload,
          triggers: JobTriggers.parse(j.triggers ?? {}),
          sensor: j.sensor ? JobSensor.parse(j.sensor) : null,
          webhookPath: a.role === 'manager' && j.webhook_token ? `/hooks/${j.webhook_token}` : null,
          sensorState: sensors.has(j.id)
            ? {
                lastCheckedAt: isoOrNull(sensors.get(j.id)!.last_checked_at),
                nextCheckAt: iso(sensors.get(j.id)!.next_check_at as Date),
                cursor: sensors.get(j.id)!.cursor,
                lastError: sensors.get(j.id)!.last_error,
              }
            : null,
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
    if (input.runOnUpload && !input.steps.some((s) => s.type === 'file.parse')) throw badRequest('Only jobs that parse a file can run on upload');
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
      run_on_upload: input.runOnUpload,
      triggers: JSON.stringify(input.triggers),
      sensor: input.sensor ? JSON.stringify(input.sensor) : null,
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
        await syncSensor(tx, { id, tenantId, sensor: a.project.archived_at ? null : input.sensor, enabled: input.enabled });
        // The webhook URL embeds the tenant (for routing) and a secret; it survives edits.
        const cur = await tx.selectFrom('job').select('webhook_token').where('id', '=', id).executeTakeFirstOrThrow();
        const token = input.triggers.webhook ? (cur.webhook_token ?? `${tenantId}.${randomBytes(24).toString('base64url')}`) : null;
        if (token !== cur.webhook_token) await tx.updateTable('job').set({ webhook_token: token }).where('id', '=', id).execute();
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
      return this.enqueueIdle(tx, tenantId, a.project.id, job.id, 'manual', actor.id);
    });
    return (await this.run(actor, tenantId, project, runId)) as RunDto;
  }

  /**
   * Re-runs a finished run's job with the current definition. A run's writes are
   * all-or-nothing (one transaction), so a failed run left no partial data and
   * re-running it whole is equivalent to resuming from the failed step.
   */
  async rerun(actor: Actor, tenantId: string, project: string, runId: string): Promise<RunDto> {
    const a = await this.projects.access(actor, tenantId, project, 'editor');
    const id = await this.projects.cellTx(tenantId, async (tx) => {
      const r = await tx.selectFrom('run').select(['job_id', 'status']).where('id', '=', runId).where('project_id', '=', a.project.id).executeTakeFirst();
      if (!r) throw notFound('Run');
      if (r.status === 'queued' || r.status === 'running') throw conflict('Run in progress', 'Wait for this run to finish, or cancel it first.');
      const next = await this.enqueueIdle(tx, tenantId, a.project.id, r.job_id, 'rerun', actor.id);
      await tx.insertInto('run_log').values({ tenant_id: tenantId, run_id: next, level: 'info', step: null, message: `Re-run of ${runId}` }).execute();
      return next;
    });
    await audit(this.ctx, actor.id, tenantId, 'job.rerun', { project: a.project.key, run: runId });
    return (await this.run(actor, tenantId, project, id)) as RunDto;
  }

  /** Queues a run unless the job already has one queued or in progress. */
  private async enqueueIdle(tx: Parameters<Parameters<ProjectService['cellTx']>[1]>[0], tenantId: string, projectId: string, jobId: string, trigger: string, actorId: string | null) {
    const busy = await tx.selectFrom('run').select('id').where('job_id', '=', jobId).where('status', 'in', ['queued', 'running']).executeTakeFirst();
    if (busy) throw conflict('Already running', 'This job already has a run queued or in progress.');
    return enqueueRun(tx, { tenantId, projectId, jobId, trigger, triggeredBy: actorId });
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

  /**
   * Inbound webhook (POST /hooks/:token): queues a run of the job whose secret
   * token this is, with the JSON body as its rows (an array, `rows`, or one object).
   */
  async webhook(token: string, body: unknown): Promise<{ runId: string }> {
    const tenantId = token.split('.')[0] ?? '';
    if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw notFound('Webhook');
    const tenant = await this.ctx.db.selectFrom('tenant').select('status').where('id', '=', tenantId).executeTakeFirst();
    if (tenant?.status !== 'active') throw notFound('Webhook');
    const rows = Array.isArray(body) ? body : body && typeof body === 'object' && Array.isArray((body as { rows?: unknown }).rows) ? (body as { rows: unknown[] }).rows : body ? [body] : [];
    if (rows.length > 10_000) throw badRequest('At most 10,000 rows per delivery');
    const runId = await this.projects.cellTx(tenantId, async (tx) => {
      const job = await tx.selectFrom('job').select(['id', 'project_id', 'enabled', 'triggers']).where('webhook_token', '=', token).executeTakeFirst();
      if (!job || !JobTriggers.parse(job.triggers ?? {}).webhook) throw notFound('Webhook');
      if (!job.enabled) throw conflict('Job paused', 'This job is paused, so its webhook is not accepting deliveries.');
      // Every delivery is its own run: payloads differ, so they are never coalesced.
      return enqueueRun(tx, { tenantId, projectId: job.project_id, jobId: job.id, trigger: 'webhook', context: { rows } });
    });
    return { runId };
  }

  // ---------- files ----------

  async files(actor: Actor, tenantId: string, project: string): Promise<FileDto[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, (tx) => this.fileList(tx, a.project.id));
  }

  private async fileList(tx: Tx, projectId: string, only?: string): Promise<FileDto[]> {
    let q = tx
      .selectFrom('project_file as f')
      .select(['f.id', 'f.key', 'f.name', 'f.content_type', 'f.size', 'f.sha256', 'f.uploaded_by', 'f.uploaded_at', sql<string>`count(*) over (partition by f.key)`.as('versions')])
      .where('f.project_id', '=', projectId)
      .orderBy('f.key')
      .orderBy('f.uploaded_at', 'desc');
    if (only) q = q.where('f.key', '=', only);
    const rows = await q.execute();
    const latest = rows.filter((r, i) => i === 0 || rows[i - 1]!.key !== r.key);
    const jobs = await this.parsingJobs(tx, projectId);
    const names = await this.projects.userNames(latest.map((r) => r.uploaded_by));
    return latest.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      contentType: r.content_type,
      size: r.size,
      sha256: r.sha256,
      uploadedBy: r.uploaded_by ? (names.get(r.uploaded_by) ?? null) : null,
      uploadedAt: iso(r.uploaded_at),
      versions: Number(r.versions),
      jobs: jobs.filter((j) => j.files.includes(r.key)).map(({ key, name, runOnUpload }) => ({ key, name, runOnUpload })),
    }));
  }

  /** Jobs with their file.parse inputs. */
  private async parsingJobs(tx: Tx, projectId: string) {
    const jobs = await tx.selectFrom('job').select(['id', 'key', 'name', 'steps', 'enabled', 'run_on_upload']).where('project_id', '=', projectId).orderBy('name').execute();
    return jobs
      .map((j) => ({
        id: j.id,
        key: j.key,
        name: j.name,
        enabled: j.enabled,
        runOnUpload: j.run_on_upload,
        files: (j.steps as { type?: string; file?: string }[]).filter((s) => s.type === 'file.parse' && s.file).map((s) => s.file!),
      }))
      .filter((j) => j.files.length);
  }

  /**
   * Stores a new version of a project file (editors) and queues the enabled jobs
   * that parse it and run on upload (the "file uploaded" trigger).
   */
  async upload(actor: Actor, tenantId: string, project: string, key: string, file: { name: string; contentType: string; content: Buffer }): Promise<UploadResult> {
    const a = await this.projects.access(actor, tenantId, project, 'editor');
    if (!/^[a-z][a-z0-9_]*$/.test(key) || key.length > 63) throw badRequest('File keys use lowercase letters, digits and underscores');
    if (!file.content.length) throw badRequest('The file is empty');
    if (file.content.length > FILE_MAX_BYTES) throw badRequest(`Files are limited to ${FILE_MAX_BYTES / 1024 / 1024} MB`);
    const name = [...file.name].filter((ch) => ch >= ' ' && ch !== '/' && ch !== '\\').join('').slice(0, 200) || key;
    const runs = await this.projects.cellTx(tenantId, async (tx) => {
      await tx
        .insertInto('project_file')
        .values({
          id: uuidv7(),
          tenant_id: tenantId,
          project_id: a.project.id,
          key,
          name,
          content_type: file.contentType.slice(0, 100) || 'application/octet-stream',
          size: file.content.length,
          sha256: createHash('sha256').update(file.content).digest('hex'),
          content: file.content,
          uploaded_by: actor.id,
          uploaded_at: this.ctx.now(),
        })
        .execute();
      const queued: { id: string; job: string }[] = [];
      for (const j of await this.parsingJobs(tx, a.project.id)) {
        if (!j.enabled || !j.runOnUpload || !j.files.includes(key)) continue;
        const busy = await tx.selectFrom('run').select('id').where('job_id', '=', j.id).where('status', '=', 'queued').executeTakeFirst();
        if (busy) continue; // a queued run will read this upload anyway
        queued.push({ id: await enqueueRun(tx, { tenantId, projectId: a.project.id, jobId: j.id, trigger: 'upload', triggeredBy: actor.id }), job: j.key });
      }
      return queued;
    });
    await audit(this.ctx, actor.id, tenantId, 'file.uploaded', { project: a.project.key, file: key, name, size: file.content.length, runs: runs.length });
    const [dto] = await this.projects.cellTx(tenantId, (tx) => this.fileList(tx, a.project.id, key));
    return { file: dto!, runs };
  }

  async deleteFile(actor: Actor, tenantId: string, project: string, key: string): Promise<FileDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const n = await this.projects.cellTx(tenantId, (tx) => tx.deleteFrom('project_file').where('project_id', '=', a.project.id).where('key', '=', key).executeTakeFirst());
    if (!n.numDeletedRows) throw notFound('File');
    await audit(this.ctx, actor.id, tenantId, 'file.deleted', { project: a.project.key, file: key });
    return this.files(actor, tenantId, project);
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
