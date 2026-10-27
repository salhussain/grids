/**
 * Status service: probes every Grids service on an interval, keeps the history
 * (uptime for SLAs, status changes, incidents) and serves the page at `/` plus JSON under `/api`.
 * Depends on nothing but the services it watches, so it stays up when they are not.
 */
import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { buildProbes, probe, type Result } from './probes.js';
import { Store } from './store.js';

const env = (name: string, fallback: string) => process.env[name] || fallback;
const port = Number(env('STATUS_PORT', '4300'));
const host = env('STATUS_HOST', '127.0.0.1');
const intervalMs = Number(env('STATUS_INTERVAL_MS', '10000'));
const slaTarget = Number(env('STATUS_SLA_TARGET', '99.9'));
const dataFile = env('STATUS_DB', resolve(import.meta.dirname, '../data/status.db'));
const page = readFileSync(resolve(import.meta.dirname, '../public/index.html'), 'utf8');

const probes = buildProbes();
const store = new Store(dataFile, Number(env('STATUS_RETENTION_DAYS', '90')));
const latest = new Map<string, Result>();
const DAY = 86_400_000;
const WINDOWS = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY, '90d': 90 * DAY } as const;

async function check(ids?: string[]) {
  const results = await Promise.all(probes.filter((p) => !ids || ids.includes(p.id)).map(probe));
  for (const r of results) {
    latest.set(r.id, r);
    store.record(r);
  }
  return results;
}

const overall = () => {
  const all = [...latest.values()];
  return all.some((r) => r.status === 'down') ? 'down' : all.some((r) => r.status === 'degraded') ? 'degraded' : 'up';
};

/** Share of checks in the window where the service was fully up. Degraded counts against it. */
function uptimeOf(id: string) {
  return Object.fromEntries(
    Object.entries(WINDOWS).map(([k, span]) => {
      const w = store.window(id, Date.now() - span);
      return [k, { ...w, availability: w.total ? (w.up / w.total) * 100 : null, downtimeSeconds: Math.round(((w.total - w.up) * intervalMs) / 1000) }];
    }),
  );
}

const status = () => ({
  status: overall(),
  updated: [...latest.values()].map((r) => r.checkedAt).sort().at(-1) ?? null,
  intervalSeconds: Math.round(intervalMs / 1000),
  services: probes.map((p) => ({
    id: p.id,
    name: p.name,
    group: p.group,
    icon: p.icon,
    what: p.what,
    open: p.open ?? null,
    target: p.http?.url ?? `${p.tcp!.host}:${p.tcp!.port}`,
    ...latest.get(p.id),
    uptime30d: store.window(p.id, Date.now() - 30 * DAY),
    incident: store.openIncident(p.id),
  })),
});

const uptime = () => ({
  target: slaTarget,
  intervalSeconds: Math.round(intervalMs / 1000),
  services: probes.map((p) => ({ id: p.id, name: p.name, icon: p.icon, group: p.group, windows: uptimeOf(p.id) })),
});

function csv() {
  const rows = [['service', 'window', 'availability_pct', 'checks', 'up_checks', 'degraded_checks', 'down_checks', 'downtime_seconds']];
  for (const s of uptime().services)
    for (const [k, w] of Object.entries(s.windows)) rows.push([s.name, k, w.availability === null ? '' : w.availability.toFixed(4), ...[w.total, w.up, w.degraded, w.down, w.downtimeSeconds].map(String)]);
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
}

const json = (res: ServerResponse, body: unknown, code = 200) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = url.pathname;
  try {
    if (path === '/healthz') return json(res, { status: 'ok' });
    if (path === '/') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page);
    if (path === '/api/status') return json(res, status());
    if (path === '/api/uptime') return json(res, uptime());
    if (path === '/api/sla.csv') return void res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="grids-uptime.csv"' }).end(csv());
    if (path === '/api/history') {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 90)));
      return json(res, {
        days,
        services: probes.map((p) => ({ id: p.id, name: p.name, icon: p.icon, daily: store.daily(p.id, days) })),
        events: store.events(200, url.searchParams.get('service') ?? undefined),
      });
    }
    if (path === '/api/incidents') return json(res, { incidents: store.incidents(200), services: Object.fromEntries(probes.map((p) => [p.id, p.name])) });
    const m = path.match(/^\/api\/check\/([\w-]+)$/);
    if (m && req.method === 'POST') {
      // Browsers only: refuse cross-site requests.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, { error: 'forbidden' }, 403);
      if (!probes.some((p) => p.id === m[1])) return json(res, { error: 'unknown service' }, 404);
      const [r] = await check([m[1]!]);
      return json(res, r);
    }
    res.writeHead(404).end();
  } catch (e) {
    console.error(e);
    json(res, { error: 'internal error' }, 500);
  }
});

await check();
setInterval(() => void check().catch((e) => console.error(e)), intervalMs);
setInterval(() => store.prune(), 3_600_000);
server.listen(port, host, () => console.log(JSON.stringify({ time: new Date().toISOString(), msg: 'status listening', host, port })));
