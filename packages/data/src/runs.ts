import { sql, type Kysely } from 'kysely';
import { withTenant, type CellDB } from '@grids/db';
import { JobStep, uuidv7 } from '@grids/schema';
import { nextRun } from './cron.js';
import { executeSteps, StepError } from './engine.js';
import type { CellTx } from './model.js';

/** Queues a run of a job (inside the tenant's transaction). */
export async function enqueueRun(
  tx: CellTx,
  opts: { tenantId: string; projectId: string; jobId: string; trigger: string; triggeredBy?: string | null; attempt?: number; availableAt?: Date },
): Promise<string> {
  const id = uuidv7();
  await tx
    .insertInto('run')
    .values({ id, tenant_id: opts.tenantId, project_id: opts.projectId, job_id: opts.jobId, trigger: opts.trigger, triggered_by: opts.triggeredBy ?? null, attempt: opts.attempt ?? 1 })
    .execute();
  // Database time (not the app's clock), so the claim query's now() sees it as available.
  await tx.insertInto('job_queue').values({ run_id: id, tenant_id: opts.tenantId, ...(opts.availableAt && { available_at: opts.availableAt }) }).execute();
  return id;
}

/** Keeps the cross-tenant schedule index in step with a job's cron. */
export async function syncSchedule(tx: CellTx, job: { id: string; tenantId: string; schedule: string | null; timezone: string; enabled: boolean }, now = new Date()) {
  if (!job.schedule || !job.enabled) {
    await tx.deleteFrom('job_schedule').where('job_id', '=', job.id).execute();
    return null;
  }
  const next = nextRun(job.schedule, job.timezone, now);
  await tx
    .insertInto('job_schedule')
    .values({ job_id: job.id, tenant_id: job.tenantId, cron: job.schedule, timezone: job.timezone, next_run_at: next })
    .onConflict((oc) => oc.column('job_id').doUpdateSet({ cron: job.schedule!, timezone: job.timezone, next_run_at: next }))
    .execute();
  return next;
}

/**
 * Enqueues runs for schedules that are due and advances them. A job that already
 * has a queued or running run is skipped this tick (no pile-up behind slow sources).
 */
export async function scheduleDue(cell: Kysely<CellDB>, now = new Date()): Promise<number> {
  const due = await cell.selectFrom('job_schedule').select(['job_id', 'tenant_id', 'cron', 'timezone']).where('next_run_at', '<=', now).limit(200).execute();
  let queued = 0;
  for (const s of due) {
    await withTenant(cell, s.tenant_id, async (tx) => {
      // Claim this tick's slot: only one scheduler wins the update.
      const advanced = await tx
        .updateTable('job_schedule')
        .set({ next_run_at: nextRun(s.cron, s.timezone, now) })
        .where('job_id', '=', s.job_id)
        .where('next_run_at', '<=', now)
        .executeTakeFirst();
      if (!advanced.numUpdatedRows) return;
      const job = await tx.selectFrom('job').select(['id', 'project_id', 'enabled']).where('id', '=', s.job_id).executeTakeFirst();
      if (!job?.enabled) return;
      const busy = await tx.selectFrom('run').select('id').where('job_id', '=', job.id).where('status', 'in', ['queued', 'running']).executeTakeFirst();
      if (busy) return;
      await enqueueRun(tx, { tenantId: s.tenant_id, projectId: job.project_id, jobId: job.id, trigger: 'schedule' });
      queued++;
    });
  }
  return queued;
}

/** Leases the next available run (any tenant in this cell). */
export async function claimNext(cell: Kysely<CellDB>, worker: string, leaseSeconds = 600): Promise<{ runId: string; tenantId: string } | null> {
  const row = await sql<{ run_id: string; tenant_id: string }>`
    update job_queue set locked_by = ${worker}, locked_until = now() + make_interval(secs => ${leaseSeconds})
    where run_id = (
      select run_id from job_queue
      where available_at <= now() and (locked_until is null or locked_until < now())
      order by available_at
      limit 1
      for update skip locked
    )
    returning run_id, tenant_id
  `.execute(cell);
  const r = row.rows[0];
  return r ? { runId: r.run_id, tenantId: r.tenant_id } : null;
}

export interface ProcessDeps {
  worker: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Exponential backoff with jitter: ~30 s, 60 s, 120 s … capped at 30 min. */
export const retryDelayMs = (attempt: number) => Math.min(30 * 60_000, 30_000 * 2 ** (attempt - 1)) * (0.8 + Math.random() * 0.4);

/**
 * Executes a claimed run. Data writes happen in one tenant transaction, so a
 * failed run leaves no partial data; status, logs and any retry are recorded in
 * a separate transaction afterwards.
 */
export async function processRun(cell: Kysely<CellDB>, claim: { runId: string; tenantId: string }, deps: ProcessDeps): Promise<'succeeded' | 'failed' | 'cancelled' | 'missing'> {
  const now = deps.now ?? (() => new Date());
  const logs: { at: Date; level: 'info' | 'warn' | 'error'; step: string | null; message: string }[] = [];
  const log = (level: 'info' | 'warn' | 'error', step: string | null, message: string) => void logs.push({ at: now(), level, step, message: message.slice(0, 2000) });

  const loaded = await withTenant(cell, claim.tenantId, async (tx) => {
    const run = await tx
      .selectFrom('run as r')
      .innerJoin('job as j', 'j.id', 'r.job_id')
      .select(['r.id', 'r.status', 'r.attempt', 'r.project_id', 'r.job_id', 'j.steps', 'j.max_retries', 'j.timeout_seconds', 'j.name'])
      .where('r.id', '=', claim.runId)
      .executeTakeFirst();
    if (!run) return null;
    if (run.status !== 'queued') return run;
    await tx.updateTable('run').set({ status: 'running', started_at: now(), worker: deps.worker }).where('id', '=', run.id).execute();
    return { ...run, status: 'running' as const };
  });
  if (!loaded) {
    await cell.deleteFrom('job_queue').where('run_id', '=', claim.runId).execute();
    return 'missing';
  }
  if (loaded.status !== 'running') {
    await cell.deleteFrom('job_queue').where('run_id', '=', claim.runId).execute();
    return loaded.status === 'cancelled' ? 'cancelled' : 'missing';
  }

  log('info', null, `Run started (attempt ${loaded.attempt} of ${loaded.max_retries + 1}) on ${deps.worker}`);
  const started = Date.now();
  let stats: Record<string, number> = {};
  let error: string | null = null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error('timeout')), loaded.timeout_seconds * 1000);
  try {
    const steps = (loaded.steps as unknown[]).map((s) => JobStep.parse(s));
    stats = await Promise.race([
      withTenant(cell, claim.tenantId, (tx) =>
        executeSteps(tx, steps, { tenantId: claim.tenantId, projectId: loaded.project_id, runId: loaded.id, now: now(), fetch: deps.fetch ?? fetch, log, signal: abort.signal }),
      ),
      new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(new Error(`Timed out after ${loaded.timeout_seconds} s`)))),
    ]);
  } catch (e) {
    error = e instanceof StepError || e instanceof Error ? e.message : String(e);
    log('error', e instanceof StepError ? e.step : null, error);
  } finally {
    clearTimeout(timer);
  }
  const durationMs = Date.now() - started;

  return withTenant(cell, claim.tenantId, async (tx) => {
    const current = await tx.selectFrom('run').select('status').where('id', '=', loaded.id).executeTakeFirst();
    const cancelled = current?.status === 'cancelled';
    const status = cancelled ? 'cancelled' : error ? 'failed' : 'succeeded';
    if (!error && !cancelled) log('info', null, `Run succeeded in ${durationMs} ms`);
    let retryAt: Date | null = null;
    if (status === 'failed' && loaded.attempt <= loaded.max_retries) {
      retryAt = new Date(now().getTime() + retryDelayMs(loaded.attempt));
      log('warn', null, `Retrying at ${retryAt.toISOString()} (attempt ${loaded.attempt + 1})`);
    }
    await tx
      .updateTable('run')
      .set({ status, finished_at: now(), error: cancelled ? 'Cancelled' : error, stats: JSON.stringify({ ...stats, duration_ms: durationMs }) })
      .where('id', '=', loaded.id)
      .execute();
    if (logs.length) await tx.insertInto('run_log').values(logs.map((l) => ({ tenant_id: claim.tenantId, run_id: loaded.id, ...l }))).execute();
    await tx.deleteFrom('job_queue').where('run_id', '=', loaded.id).execute();
    if (retryAt)
      await enqueueRun(tx, { tenantId: claim.tenantId, projectId: loaded.project_id, jobId: loaded.job_id, trigger: 'retry', attempt: loaded.attempt + 1, availableAt: retryAt });
    return status;
  });
}

/** Claims and processes runs until the queue is empty (tests, one-shot workers). */
export async function drainQueue(cell: Kysely<CellDB>, deps: ProcessDeps, limit = 100): Promise<number> {
  let n = 0;
  for (; n < limit; n++) {
    const claim = await claimNext(cell, deps.worker);
    if (!claim) break;
    await processRun(cell, claim, deps);
  }
  return n;
}
