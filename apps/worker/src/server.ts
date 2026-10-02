/**
 * The orchestration worker: for each data cell it advances due schedules and
 * executes queued runs (up to WORKER_CONCURRENCY at a time). Several workers can
 * run side by side: claims use row locks (FOR UPDATE SKIP LOCKED) and leases.
 */
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { checkSensors, claimNext, processRun, scheduleDue } from '@grids/data';
import { createDb, type CellDB, type PlatformDB } from '@grids/db';
import type { Kysely } from 'kysely';

const env = (name: string, fallback?: string) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env ${name}`);
  return v;
};

const worker = `${hostname()}:${process.pid}`;
const concurrency = Number(env('WORKER_CONCURRENCY', '4'));
const tickMs = Number(env('WORKER_TICK_MS', '2000'));
const platform = createDb<PlatformDB>(env('DATABASE_URL_PLATFORM'), { max: 2 });
const cells = new Map<string, Kysely<CellDB>>();
const stats = { started: new Date().toISOString(), runs: 0, succeeded: 0, failed: 0, scheduled: 0, sensed: 0, lastTick: '' };
let active = 0;
let stopping = false;

function resolveSecret(ref: string): string {
  if (ref.startsWith('env:')) return env(ref.slice(4));
  throw new Error(`Unsupported secret reference: ${ref}`);
}

async function refreshCells() {
  const rows = await platform.selectFrom('cell').select(['id', 'connection_secret_ref']).execute();
  for (const r of rows) if (!cells.has(r.id)) cells.set(r.id, createDb<CellDB>(resolveSecret(r.connection_secret_ref), { max: concurrency + 2 }));
}

const log = (msg: string, extra: object = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), worker, msg, ...extra }));

async function work(cellId: string, cell: Kysely<CellDB>) {
  while (!stopping && active < concurrency) {
    const claim = await claimNext(cell, worker);
    if (!claim) return;
    active++;
    stats.runs++;
    void processRun(cell, claim, { worker })
      .then((status) => {
        if (status === 'succeeded') stats.succeeded++;
        if (status === 'failed') stats.failed++;
        log('run finished', { cell: cellId, run: claim.runId, tenant: claim.tenantId, status });
      })
      .catch((e: Error) => log('run crashed', { cell: cellId, run: claim.runId, error: e.message }))
      .finally(() => active--);
  }
}

async function tick() {
  stats.lastTick = new Date().toISOString();
  for (const [id, cell] of cells) {
    try {
      const n = await scheduleDue(cell);
      if (n) {
        stats.scheduled += n;
        log('scheduled runs', { cell: id, count: n });
      }
      const sensed = await checkSensors(cell);
      if (sensed) {
        stats.sensed += sensed;
        log('sensor runs', { cell: id, count: sensed });
      }
      await work(id, cell);
    } catch (e) {
      log('tick failed', { cell: id, error: (e as Error).message });
    }
  }
}

await refreshCells();
log('worker started', { cells: [...cells.keys()], concurrency });
const loop = setInterval(() => void tick(), tickMs);
const cellRefresh = setInterval(() => void refreshCells().catch(() => undefined), 60_000);
void tick();

const health = createServer((req, res) => {
  res.writeHead(req.url === '/healthz' ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', worker, active, ...stats }));
}).listen(Number(env('WORKER_PORT', '4200')));

async function shutdown() {
  stopping = true;
  clearInterval(loop);
  clearInterval(cellRefresh);
  health.close();
  // Let in-flight runs finish (leases expire if we are killed first, so runs are retried).
  for (let i = 0; i < 60 && active > 0; i++) await new Promise((r) => setTimeout(r, 1000));
  await Promise.all([platform.destroy(), ...[...cells.values()].map((c) => c.destroy())]);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
