import pg from 'pg';

/** Channel the change triggers (tenant migration 0009) notify on. */
export const CHANGE_CHANNEL = 'grids_events';

/** A change notified by the database (see migration 0009_change_events). */
export type ChangeEvent =
  | { tenantId: string; projectId: string; kind: 'data'; table: string }
  | { tenantId: string; projectId: string; kind: 'run'; table: 'run'; run: { id: string; jobId: string; status: string } };

/** Parses a notification payload; null for anything unexpected. */
export function parseChange(payload: string | undefined): ChangeEvent | null {
  try {
    const p = JSON.parse(payload ?? '') as Record<string, string>;
    if (!p.t || !p.p) return null;
    if (p.k === 'run') return { tenantId: p.t, projectId: p.p, kind: 'run', table: 'run', run: { id: p.r!, jobId: p.j!, status: p.s! } };
    if (p.k === 'data') return { tenantId: p.t, projectId: p.p, kind: 'data', table: p.s ?? '' };
  } catch {
    /* ignore malformed payloads */
  }
  return null;
}

export interface ChangeListener {
  /** True while LISTEN is active (events may be missed while false). */
  readonly connected: boolean;
  close(): Promise<void>;
}

/**
 * Holds one dedicated connection that LISTENs for change events, reconnecting
 * with backoff. `onReconnect` fires after a gap, when events may have been lost.
 */
export function listenForChanges(
  connectionString: string,
  handlers: { onEvent(e: ChangeEvent): void; onReconnect?(): void; onError?(e: Error): void },
): ChangeListener {
  let client: pg.Client | null = null;
  let closed = false;
  let connected = false;
  let attempt = 0;
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    if (closed || timer) return;
    const delay = Math.min(30_000, 500 * 2 ** attempt++);
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, delay);
    timer.unref?.();
  };

  const connect = async () => {
    const c = new pg.Client({ connectionString });
    client = c;
    const lost = (e?: Error) => {
      if (client !== c) return;
      connected = false;
      client = null;
      if (e) handlers.onError?.(e);
      c.removeAllListeners();
      void c.end().catch(() => undefined);
      schedule();
    };
    c.on('error', lost);
    c.on('end', () => lost());
    c.on('notification', (n) => {
      if (n.channel !== CHANGE_CHANNEL) return;
      const e = parseChange(n.payload);
      if (e) handlers.onEvent(e);
    });
    try {
      await c.connect();
      await c.query(`listen ${CHANGE_CHANNEL}`);
      if (closed) return void (await c.end());
      const reconnected = attempt > 0;
      connected = true;
      attempt = 0;
      if (reconnected) handlers.onReconnect?.();
    } catch (e) {
      lost(e as Error);
    }
  };
  void connect();

  return {
    get connected() {
      return connected;
    },
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      const c = client;
      client = null;
      connected = false;
      if (c) {
        c.removeAllListeners();
        c.on('error', () => undefined);
        await c.end().catch(() => undefined);
      }
    },
  };
}
