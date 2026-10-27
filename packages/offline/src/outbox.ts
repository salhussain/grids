import { blobIdOf, isLocalRef, SyncError, type OutboxApi, type OutboxItem, type OutboxStore, type SyncReport } from './types.js';

const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60_000;

/** How long to wait after the n-th failed attempt: 30 s, 1 min, 2 min… up to an hour. */
export const backoff = (attempts: number) => Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);

type Outcome = 'sent' | 'retry' | 'rejected' | 'offline' | 'signed_out';

/** A problem that sending again, unchanged, cannot fix. */
const isRejection = (e: SyncError) => e.status !== undefined && e.status >= 400 && e.status < 500 && ![401, 408, 425, 429].includes(e.status);

const rewrite = (v: unknown, remote: Map<string, string>): unknown =>
  isLocalRef(v) ? (remote.get(blobIdOf(v)) ?? v) : Array.isArray(v) ? v.map((x) => rewrite(x, remote)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x, remote)])) : v;

export interface OutboxOptions {
  now?: () => number;
  onChange?: () => void;
}

/**
 * Sends the queue upwards. Pictures go first, their ids are put into the answers, then the
 * submission itself. Safe to call often: one run at a time, and a resend never duplicates.
 */
export class Outbox {
  private running: Promise<SyncReport> | null = null;
  private readonly now: () => number;

  constructor(
    private readonly store: OutboxStore,
    private readonly api: OutboxApi,
    private readonly opts: OutboxOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  /** `manual`: the person asked, so items waiting out a delay are tried too. */
  sync(manual = false): Promise<SyncReport> {
    this.running ??= this.run(manual).finally(() => {
      this.running = null;
      this.opts.onChange?.();
    });
    return this.running;
  }

  get busy() {
    return this.running !== null;
  }

  /** After a rejection the person fixed (or decided to resend as it is). */
  async retry(id: string) {
    await this.store.update(id, { status: 'queued', nextAttemptAt: null, lastError: null });
    this.opts.onChange?.();
  }

  private async run(manual: boolean): Promise<SyncReport> {
    const report: SyncReport = { sent: 0, failed: 0, waiting: 0, stopped: null };
    await this.store.recoverInterrupted();
    const queue = await this.store.due(this.now(), manual);
    for (const [n, item] of queue.entries()) {
      const outcome = await this.send(item);
      if (outcome === 'sent') report.sent++;
      else if (outcome === 'rejected') report.failed++;
      else if (outcome === 'retry') report.waiting++;
      else {
        // No connection or no sign-in: the rest would fail the same way.
        report.stopped = outcome;
        report.waiting += queue.length - n;
        break;
      }
    }
    return report;
  }

  private async send(item: OutboxItem): Promise<Outcome> {
    await this.store.update(item.id, { status: 'sending', attempts: item.attempts + 1 });
    this.opts.onChange?.();
    try {
      const remote = new Map<string, string>();
      for (const b of await this.store.blobsOf(item.id)) {
        if (b.remoteId) remote.set(b.id, b.remoteId);
        else {
          const { id } = await this.api.upload(item, b);
          await this.store.setBlobRemote(b.id, id);
          remote.set(b.id, id);
        }
      }
      await this.api.submit(item, rewrite(item.answers, remote) as Record<string, unknown>);
      await this.store.update(item.id, { status: 'sent', sentAt: this.now(), lastError: null, nextAttemptAt: null });
      return 'sent';
    } catch (e) {
      const err = e instanceof SyncError ? e : new SyncError(e instanceof Error ? e.message : 'Unknown error');
      if (isRejection(err)) {
        await this.store.update(item.id, { status: 'needs_attention', lastError: err.detail ?? err.message, nextAttemptAt: null });
        return 'rejected';
      }
      const attempts = item.attempts + 1;
      // No answer at all means no connection: try again as soon as there is one. Server trouble waits a while.
      if (err.status === undefined) {
        await this.store.update(item.id, { status: 'queued', lastError: null, nextAttemptAt: null });
        return 'offline';
      }
      await this.store.update(item.id, { status: 'queued', lastError: err.detail ?? err.message, nextAttemptAt: this.now() + backoff(attempts) });
      return err.status === 401 ? 'signed_out' : 'retry';
    }
  }
}
