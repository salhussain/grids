import { describe, expect, it } from 'vitest';
import { Outbox, SyncError, backoff, localRef, syncPlaces, type OutboxApi, type OutboxBlob, type OutboxItem, type OutboxStore, type PlaceRow, type PlacesApi, type PlacesStore } from '../src/index.js';

const item = (id: string, over: Partial<OutboxItem> = {}): OutboxItem => ({
  id,
  target: { kind: 'project', tenantId: 't', project: 'p', form: 'f' },
  formName: 'Visit',
  version: 1,
  entityId: null,
  answers: {},
  collectedAt: '2026-01-01T00:00:00Z',
  location: null,
  status: 'queued',
  attempts: 0,
  nextAttemptAt: null,
  lastError: null,
  createdAt: Number(id.replace(/\D/g, '')) || 0,
  sentAt: null,
  ...over,
});

class MemStore implements OutboxStore {
  items = new Map<string, OutboxItem>();
  blobs: OutboxBlob[] = [];
  add(i: OutboxItem) {
    this.items.set(i.id, i);
    return this;
  }
  async due(now: number, ignoreBackoff: boolean) {
    return [...this.items.values()].filter((i) => i.status === 'queued' && (ignoreBackoff || i.nextAttemptAt === null || i.nextAttemptAt <= now)).sort((a, b) => a.createdAt - b.createdAt);
  }
  async get(id: string) {
    return this.items.get(id);
  }
  async update(id: string, patch: Partial<OutboxItem>) {
    this.items.set(id, { ...this.items.get(id)!, ...patch });
  }
  async blobsOf(itemId: string) {
    return this.blobs.filter((b) => b.itemId === itemId);
  }
  async setBlobRemote(blobId: string, remoteId: string) {
    this.blobs = this.blobs.map((b) => (b.id === blobId ? { ...b, remoteId } : b));
  }
  async recoverInterrupted() {
    for (const [id, i] of this.items) if (i.status === 'sending') this.items.set(id, { ...i, status: 'queued' });
  }
}

const apiOf = (fn: (i: OutboxItem, answers: Record<string, unknown>) => void | Promise<void>, uploads: string[] = []): OutboxApi => ({
  upload: async (_i, b) => {
    uploads.push(b.id);
    return { id: `remote-${b.id}` };
  },
  submit: async (i, answers) => fn(i, answers),
});

describe('outbox', () => {
  it('sends the queue oldest first and marks it sent', async () => {
    const store = new MemStore().add(item('i2')).add(item('i1'));
    const order: string[] = [];
    const r = await new Outbox(store, apiOf((i) => void order.push(i.id))).sync();
    expect(order).toEqual(['i1', 'i2']);
    expect(r).toMatchObject({ sent: 2, failed: 0, waiting: 0, stopped: null });
    expect(store.items.get('i1')?.status).toBe('sent');
  });

  it('uploads pictures first and swaps their ids into the answers, once', async () => {
    const store = new MemStore().add(item('i1', { answers: { photo: localRef('b1'), many: [localRef('b2'), localRef('b3')], nested: { s: localRef('b2') }, n: 3 } }));
    store.blobs = ['b1', 'b2', 'b3'].map((id) => ({ id, itemId: 'i1', name: id, contentType: 'image/jpeg', uri: `file:///${id}`, size: 1, remoteId: id === 'b3' ? 'already' : null }));
    const uploads: string[] = [];
    let sent: Record<string, unknown> = {};
    await new Outbox(store, apiOf((_i, a) => void (sent = a), uploads)).sync();
    expect(uploads).toEqual(['b1', 'b2']);
    expect(sent).toEqual({ photo: 'remote-b1', many: ['remote-b2', 'already'], nested: { s: 'remote-b2' }, n: 3 });
  });

  it('keeps what was uploaded when the submission itself fails, and does not upload again', async () => {
    const store = new MemStore().add(item('i1', { answers: { photo: localRef('b1') } }));
    store.blobs = [{ id: 'b1', itemId: 'i1', name: 'p', contentType: 'image/jpeg', uri: 'x', size: 1, remoteId: null }];
    const uploads: string[] = [];
    let fail = true;
    const box = new Outbox(store, apiOf(() => { if (fail) throw new SyncError('x', 503); }, uploads));
    await box.sync();
    fail = false;
    await box.sync(true);
    expect(uploads).toEqual(['b1']);
    expect(store.items.get('i1')?.status).toBe('sent');
  });

  it('goes offline: stops at the first failure and tries again straight away next time', async () => {
    const store = new MemStore().add(item('i1')).add(item('i2'));
    let calls = 0;
    const box = new Outbox(store, apiOf(() => { calls++; throw new SyncError('Network request failed'); }));
    const r = await box.sync();
    expect(calls).toBe(1);
    expect(r).toMatchObject({ sent: 0, waiting: 2, stopped: 'offline' });
    expect(store.items.get('i1')).toMatchObject({ status: 'queued', nextAttemptAt: null });
    const again = new Outbox(store, apiOf(() => {}));
    expect((await again.sync()).sent).toBe(2);
  });

  it('server trouble waits with a growing delay, unless the person asks', async () => {
    const t = 1_000_000;
    const store = new MemStore().add(item('i1'));
    let ok = false;
    const box = new Outbox(store, apiOf(() => { if (!ok) throw new SyncError('Bad gateway', 502); }), { now: () => t });
    expect(await box.sync()).toMatchObject({ waiting: 1, stopped: null });
    expect(store.items.get('i1')?.nextAttemptAt).toBe(t + backoff(1));
    expect(await box.sync()).toMatchObject({ sent: 0, waiting: 0 }); // not due yet
    ok = true;
    expect(await box.sync(true)).toMatchObject({ sent: 1 }); // manual ignores the wait
  });

  it('a rejection needs attention and is not retried until the person says so', async () => {
    const store = new MemStore().add(item('i1'));
    let reject = true;
    const box = new Outbox(store, apiOf(() => { if (reject) throw new SyncError('Bad request', 400, 'Beds must be a number'); }));
    expect(await box.sync()).toMatchObject({ failed: 1 });
    expect(store.items.get('i1')).toMatchObject({ status: 'needs_attention', lastError: 'Beds must be a number' });
    expect(await box.sync(true)).toMatchObject({ sent: 0, failed: 0 });
    reject = false;
    await box.retry('i1');
    expect(await box.sync()).toMatchObject({ sent: 1 });
  });

  it('a sign-in problem stops the run and keeps everything queued', async () => {
    const store = new MemStore().add(item('i1')).add(item('i2'));
    const r = await new Outbox(store, apiOf(() => { throw new SyncError('Unauthorized', 401); })).sync();
    expect(r.stopped).toBe('signed_out');
    expect([...store.items.values()].every((i) => i.status === 'queued')).toBe(true);
  });

  it('not being allowed to fill a form is a rejection of that one, not a sign-out', async () => {
    const store = new MemStore().add(item('i1')).add(item('i2'));
    const r = await new Outbox(store, apiOf((i) => { if (i.id === 'i1') throw new SyncError('Forbidden', 403, 'You are not allowed to fill in this form.'); })).sync();
    expect(r).toMatchObject({ sent: 1, failed: 1, stopped: null });
  });

  it('puts back what a crash left half sent, and runs once at a time', async () => {
    const store = new MemStore().add(item('i1', { status: 'sending' }));
    let calls = 0;
    const box = new Outbox(store, apiOf(async () => { calls++; await new Promise((r) => setTimeout(r, 5)); }));
    const [a, b] = await Promise.all([box.sync(), box.sync()]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    expect(store.items.get('i1')?.status).toBe('sent');
  });
});

describe('backoff', () => {
  it('doubles from 30 seconds up to an hour', () => {
    expect([1, 2, 3, 20].map(backoff)).toEqual([30_000, 60_000, 120_000, 3_600_000]);
  });
});

describe('places', () => {
  const row = (id: string): PlaceRow => ({ id, code: id, name: id, type: 'facility', parentId: null, attributes: {}, point: null, shared: false, updatedAt: '' });
  class Places implements PlacesStore {
    rows = new Map<string, PlaceRow>();
    cur: string | null = null;
    async cursor() { return this.cur; }
    async upsert(_s: string, rs: PlaceRow[]) { for (const r of rs) this.rows.set(r.id, r); }
    async prune(_s: string, keep: Set<string>) { let n = 0; for (const id of [...this.rows.keys()]) if (!keep.has(id)) { this.rows.delete(id); n++; } return n; }
    async setCursor(_s: string, t: string) { this.cur = t; }
  }

  it('downloads every page, drops what disappeared and remembers where it got to', async () => {
    const store = new Places();
    store.rows.set('gone', row('gone'));
    const pages = [{ items: [row('a'), row('b')], next: 'b', serverTime: 'T1', ids: null }, { items: [row('c')], next: null, serverTime: 'T2', ids: ['a', 'b', 'c'] }];
    const seen: [string | null, string | null][] = [];
    const api: PlacesApi = { page: async (since, after) => { seen.push([since, after]); return pages[after ? 1 : 0]!; } };
    expect(await syncPlaces(store, api, 'p')).toEqual({ changed: 3, removed: 1 });
    expect([...store.rows.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(store.cur).toBe('T1');
    expect(seen).toEqual([[null, null], [null, 'b']]);
  });

  it('does not move the cursor when a download is interrupted', async () => {
    const store = new Places();
    store.cur = 'OLD';
    let n = 0;
    const api: PlacesApi = { page: async () => { if (n++) throw new SyncError('offline'); return { items: [row('a')], next: 'a', serverTime: 'T', ids: null }; } };
    await expect(syncPlaces(store, api, 'p')).rejects.toThrow();
    expect(store.cur).toBe('OLD');
  });
});
