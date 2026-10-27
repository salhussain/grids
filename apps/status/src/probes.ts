import { connect } from 'node:net';

export type Status = 'up' | 'degraded' | 'down';

export interface Probe {
  id: string;
  name: string;
  group: string;
  /** Key into the page's icon set. */
  icon: string;
  what: string;
  /** What "Open" links to, when the service has something to look at. */
  open?: string;
  /** Probed over HTTP (`ready`: parse the `/readyz` body) or by connecting to a port. */
  http?: { url: string; ready?: boolean };
  tcp?: { host: string; port: number };
}

export interface Result {
  id: string;
  status: Status;
  ms: number | null;
  detail: string;
  checkedAt: string;
}

const env = (name: string, fallback: string) => process.env[name] || fallback;

export function buildProbes(): Probe[] {
  const api = `http://localhost:${env('API_PORT', '4000')}`;
  const identity = `http://localhost:${env('IDENTITY_PORT', '4100')}`;
  const worker = `http://localhost:${env('WORKER_PORT', '4200')}`;
  const pg = new URL(env('DATABASE_URL_PLATFORM', 'postgres://localhost:55432/grids_platform'));
  // Mail is only a dependency when SMTP_URL names a server (`log` keeps it inside the platform).
  const smtp = /^smtps?:/.test(env('SMTP_URL', 'log')) ? new URL(env('SMTP_URL', 'log')) : null;
  const web = (id: string, name: string, icon: string, what: string, url: string): Probe => ({ id, name, group: 'Apps', icon, what, open: url, http: { url } });
  return [
    { id: 'api', name: 'API', group: 'Services', icon: 'server', what: 'Control-plane and project API', open: `${api}/readyz`, http: { url: `${api}/readyz`, ready: true } },
    { id: 'identity', name: 'Identity', group: 'Services', icon: 'shield', what: 'Sign-in and accounts (OIDC)', open: `${identity}/readyz`, http: { url: `${identity}/readyz`, ready: true } },
    { id: 'worker', name: 'Worker', group: 'Services', icon: 'cpu', what: 'Scheduled and queued jobs', open: `${worker}/healthz`, http: { url: `${worker}/healthz` } },
    web('console', 'Console', 'dashboard', 'Platform staff console', env('CONSOLE_URL', 'http://localhost:5173')),
    web('web', 'Workspace', 'briefcase', 'Organisation workspace', env('WEB_URL', 'http://localhost:5174')),
    // The sign-in screens are built into the identity service and served at /ui (5175 is only the dev server).
    web('login', 'Login', 'login', 'Sign-in screens (served by Identity)', env('LOGIN_URL', `${identity}/ui/`)),
    web('portal', 'Portal', 'globe', 'Public project portal', env('PORTAL_URL', 'http://localhost:5176')),
    web('site', 'Site', 'megaphone', 'Marketing and pricing site', env('SITE_URL', 'http://localhost:5177')),
    { id: 'postgres', name: 'Postgres', group: 'Infrastructure', icon: 'database', what: 'Platform and tenant databases', tcp: { host: pg.hostname, port: Number(pg.port || 5432) } },
    { id: 'storage', name: 'Object storage', group: 'Infrastructure', icon: 'drive', what: 'S3-compatible file store', tcp: { host: 'localhost', port: 8333 } },
    ...(smtp ? [{ id: 'mail', name: 'Mail (SMTP)', group: 'Infrastructure', icon: 'mail', what: 'Outgoing email', tcp: { host: smtp.hostname, port: Number(smtp.port || 25) } }] : []),
  ];
}

const timeoutMs = Number(env('STATUS_TIMEOUT_MS', '4000'));

export async function probe(p: Probe): Promise<Result> {
  const base = { id: p.id, checkedAt: new Date().toISOString() };
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  try {
    if (p.tcp) {
      const { host, port } = p.tcp;
      await new Promise<void>((resolve, reject) => {
        const s = connect({ host, port, timeout: timeoutMs });
        s.once('connect', () => (s.destroy(), resolve()));
        s.once('timeout', () => (s.destroy(), reject(new Error('timed out'))));
        s.once('error', reject);
      });
      return { ...base, status: 'up', ms: ms(), detail: 'Accepting connections' };
    }
    const res = await fetch(p.http!.url, { signal: AbortSignal.timeout(timeoutMs) });
    if (p.http!.ready) {
      if (res.ok) return { ...base, status: 'up', ms: ms(), detail: 'Ready' };
      const body = (await res.json().catch(() => ({}))) as { checks?: Record<string, string> };
      const failed = Object.entries(body.checks ?? {}).filter(([, v]) => v !== 'ok');
      return { ...base, status: 'degraded', ms: ms(), detail: failed.length ? `Failing: ${failed.map(([k]) => k).join(', ')}` : `HTTP ${res.status}` };
    }
    return { ...base, status: res.status < 500 ? 'up' : 'degraded', ms: ms(), detail: `HTTP ${res.status}` };
  } catch (e) {
    const err = e as Error & { code?: string; cause?: { code?: string } };
    const code = err.code ?? err.cause?.code;
    const why = err.name === 'TimeoutError' || err.message === 'timed out' ? 'Timed out' : code === 'ECONNREFUSED' ? 'Connection refused' : err.message;
    return { ...base, status: 'down', ms: null, detail: why };
  }
}
