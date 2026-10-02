import { listenForChanges, type ChangeEvent, type ChangeListener, type TenantRouter } from '@grids/db';

type Handler = (e: ChangeEvent) => void;

/**
 * Change events from every data cell (spec §9 live updates). One LISTEN
 * connection per cell, opened on first use, fans events out to SSE streams and
 * to cache invalidation. Events are best-effort: after a reconnect gap,
 * `onGap` handlers run so caches can drop what they may have missed.
 */
export class EventBus {
  private readonly listeners = new Map<string, ChangeListener>();
  private readonly subscribers = new Map<string, Set<Handler>>();
  private readonly global = new Set<Handler>();
  private readonly gaps = new Set<() => void>();
  private closed = false;

  constructor(
    private readonly cells: Pick<TenantRouter, 'placement'>,
    private readonly log: (msg: string, extra?: object) => void = () => undefined,
  ) {}

  /** Starts listening on the tenant's cell; resolves to whether events are flowing. */
  async ensure(tenantId: string): Promise<boolean> {
    if (this.closed) return false;
    const { cellId, connectionString } = await this.cells.placement(tenantId);
    let l = this.listeners.get(cellId);
    if (!l) {
      l = listenForChanges(connectionString, {
        onEvent: (e) => this.dispatch(e),
        onReconnect: () => this.gaps.forEach((fn) => fn()),
        onError: (e) => this.log('change listener lost', { cell: cellId, error: e.message }),
      });
      this.listeners.set(cellId, l);
    }
    return l.connected;
  }

  /** Events for one project; returns an unsubscribe function. */
  async subscribe(tenantId: string, projectId: string, fn: Handler): Promise<() => void> {
    await this.ensure(tenantId);
    const key = `${tenantId}:${projectId}`;
    let set = this.subscribers.get(key);
    if (!set) this.subscribers.set(key, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) this.subscribers.delete(key);
    };
  }

  /** Every event on every cell this process listens to. */
  onAny(fn: Handler) {
    this.global.add(fn);
  }

  /** Runs after a listener reconnects (events may have been missed). */
  onGap(fn: () => void) {
    this.gaps.add(fn);
  }

  dispatch(e: ChangeEvent) {
    for (const fn of this.global) fn(e);
    for (const fn of this.subscribers.get(`${e.tenantId}:${e.projectId}`) ?? []) fn(e);
  }

  get subscriberCount() {
    let n = 0;
    for (const s of this.subscribers.values()) n += s.size;
    return n;
  }

  async close() {
    this.closed = true;
    await Promise.all([...this.listeners.values()].map((l) => l.close()));
    this.listeners.clear();
  }
}
