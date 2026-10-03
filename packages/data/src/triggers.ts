import { createHash } from 'node:crypto';
import jsonata from 'jsonata';
import { sql, type Kysely } from 'kysely';
import { withTenant, type CellDB } from '@grids/db';
import { JobSensor, JobTriggers, type JobEvent } from '@grids/schema';
import type { CellTx } from './model.js';
import { enqueueRun } from './runs.js';

/**
 * Queues the project's jobs that listen for `event` (spec §7 triggers), inside
 * the transaction that caused it, so the event is never lost and never fires
 * for a write that rolled back. A job with a run already queued is skipped (that
 * run will see the change), and a job never triggers itself.
 */
export async function fireEvent(
  tx: CellTx,
  e: { tenantId: string; projectId: string; event: JobEvent; ref?: string | null; detail?: Record<string, unknown>; sourceJobId?: string; actorId?: string | null },
): Promise<string[]> {
  const jobs = await tx
    .selectFrom('job')
    .select(['id', 'triggers'])
    .where('project_id', '=', e.projectId)
    .where('enabled', '=', true)
    .where(sql<boolean>`triggers -> 'events' @> ${JSON.stringify([{ event: e.event }])}::jsonb`)
    .execute();
  const queued: string[] = [];
  for (const j of jobs) {
    if (j.id === e.sourceJobId) continue;
    const t = JobTriggers.parse(j.triggers);
    if (!t.events.some((x) => x.event === e.event && (!x.ref || x.ref === e.ref))) continue;
    const busy = await tx.selectFrom('run').select('id').where('job_id', '=', j.id).where('status', '=', 'queued').executeTakeFirst();
    if (busy) continue;
    queued.push(
      await enqueueRun(tx, {
        tenantId: e.tenantId,
        projectId: e.projectId,
        jobId: j.id,
        trigger: e.event,
        triggeredBy: e.actorId ?? null,
        context: { event: { name: e.event, ref: e.ref ?? null, ...e.detail } },
      }),
    );
  }
  return queued;
}

/** Keeps the cross-tenant sensor index in step with a job's sensor. */
export async function syncSensor(tx: CellTx, job: { id: string; tenantId: string; sensor: unknown; enabled: boolean }) {
  const sensor = job.sensor ? JobSensor.parse(job.sensor) : null;
  if (!sensor || !job.enabled) {
    await tx.deleteFrom('job_sensor').where('job_id', '=', job.id).execute();
    return;
  }
  await tx
    .insertInto('job_sensor')
    .values({ job_id: job.id, tenant_id: job.tenantId, every_minutes: sensor.everyMinutes })
    .onConflict((oc) => oc.column('job_id').doUpdateSet({ every_minutes: sensor.everyMinutes, next_check_at: sql`now()` }))
    .execute();
}

/** The sensor's cursor for a response: its JSONata expression, else a hash of the body. */
export async function sensorCursor(sensor: JobSensor, body: string): Promise<string> {
  if (!sensor.cursor) return createHash('sha256').update(body).digest('hex').slice(0, 32);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('response is not JSON (the cursor expression needs JSON)');
  }
  const v = await jsonata(sensor.cursor).evaluate(parsed);
  return JSON.stringify(v ?? null).slice(0, 500);
}

/**
 * Evaluates due sensors (any tenant in the cell): fetches each URL and queues a
 * run when the cursor differs from the last one seen (including the first
 * check). Returns the number of runs queued.
 */
export async function checkSensors(cell: Kysely<CellDB>, deps: { fetch?: typeof fetch; now?: Date } = {}): Promise<number> {
  const now = deps.now ?? new Date();
  const due = await cell.selectFrom('job_sensor').select(['job_id', 'tenant_id', 'every_minutes']).where('next_check_at', '<=', now).limit(100).execute();
  let queued = 0;
  for (const s of due) {
    // Claim this check (another worker may race us).
    const claimed = await cell
      .updateTable('job_sensor')
      .set({ next_check_at: new Date(now.getTime() + s.every_minutes * 60_000), last_checked_at: now })
      .where('job_id', '=', s.job_id)
      .where('next_check_at', '<=', now)
      .executeTakeFirst();
    if (!claimed.numUpdatedRows) continue;
    const job = await withTenant(cell, s.tenant_id, (tx) => tx.selectFrom('job').select(['id', 'project_id', 'sensor', 'enabled']).where('id', '=', s.job_id).executeTakeFirst());
    if (!job?.enabled || !job.sensor) continue;
    const sensor = JobSensor.parse(job.sensor);
    let cursor: string;
    try {
      const res = await (deps.fetch ?? fetch)(sensor.url, { headers: { 'user-agent': 'Grids/1.0 (+https://grids.local)', ...sensor.headers }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(sensor.url).host}`);
      cursor = await sensorCursor(sensor, await res.text());
    } catch (e) {
      await cell.updateTable('job_sensor').set({ last_error: (e as Error).message.slice(0, 500) }).where('job_id', '=', s.job_id).execute();
      continue;
    }
    const prev = await cell.selectFrom('job_sensor').select('cursor').where('job_id', '=', s.job_id).executeTakeFirst();
    await withTenant(cell, s.tenant_id, async (tx) => {
      if (prev?.cursor !== cursor) {
        const busy = await tx.selectFrom('run').select('id').where('job_id', '=', job.id).where('status', '=', 'queued').executeTakeFirst();
        if (!busy) {
          await enqueueRun(tx, { tenantId: s.tenant_id, projectId: job.project_id, jobId: job.id, trigger: 'sensor', context: { sensor: { cursor, previous: prev?.cursor ?? null } } });
          queued++;
        }
      }
    });
    await cell.updateTable('job_sensor').set({ cursor, last_error: null }).where('job_id', '=', s.job_id).execute();
  }
  return queued;
}
