import { withTenant } from '@grids/db';
import { uuidv7 } from '@grids/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// Live change events (pg NOTIFY → SSE) and the query cache they invalidate.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let slug: string;
let admin: string;
let base: string;

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Live Data', 'business');
  slug = (await h.admin('GET', `/platform/tenants/${tenantId}`)).body.slug;
  admin = await h.join(tenantId, 'admin@live.org', { role: 'org_admin' });
  base = await h.app.listen({ host: '127.0.0.1', port: 0 });
}, 180_000);
afterAll(async () => h?.stop());

const api = (method: 'GET' | 'POST', url: string, body?: unknown) => h.call(admin, method, `/tenants/${tenantId}/projects${url}`, body);

/** Opens an SSE stream and collects its events until `until` matches (or times out). */
async function stream(path: string, opts: { token?: string; until: (events: { event: string; data: any }[]) => boolean; act?: () => Promise<unknown> }) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}${path}`, { headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {}, signal: ctrl.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const events: { event: string; data: any }[] = [];
  let buf = '';
  let acted = false;
  const deadline = Date.now() + 10_000;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
      }
      if (!acted && events.some((e) => e.event === 'ready')) {
        acted = true;
        await opts.act?.();
      }
      if (opts.until(events)) break;
    }
  } finally {
    ctrl.abort();
  }
  return events;
}

const waitFor = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
};

describe('change events', () => {
  let projectId: string;

  it('streams data and run changes to project members only', async () => {
    const p = (await api('POST', '', { name: 'Live', visibility: 'public', template: 'flight-tracker' })).body;
    projectId = p.id;
    expect((await fetch(`${base}/tenants/${tenantId}/projects/live/events`)).status).toBe(401);

    const events = await stream(`/tenants/${tenantId}/projects/live/events`, {
      token: admin,
      act: async () => {
        await api('POST', '/live/entities', { typeKey: 'country', code: 'FJ', name: 'Fiji' });
        await api('POST', '/live/jobs/opensky_positions/run');
      },
      until: (ev) => ev.some((e) => e.data.kind === 'data') && ev.some((e) => e.data.kind === 'run'),
    });
    expect(events[0]!.event).toBe('ready');
    expect(events).toContainEqual({ event: 'change', data: { kind: 'data', table: 'entity' } });
    expect(events).toContainEqual({ event: 'change', data: { kind: 'run', run: expect.objectContaining({ status: 'queued' }) } });
    await waitFor(async () => h.services.events.subscriberCount === 0); // the stream unsubscribed on disconnect
  });

  it('streams public project changes anonymously', async () => {
    expect((await fetch(`${base}/public/projects/${slug}/nope/events`)).status).toBe(404);
    const events = await stream(`/public/projects/${slug}/live/events`, {
      act: () => api('POST', '/live/entities', { typeKey: 'country', code: 'TO', name: 'Tonga' }),
      until: (ev) => ev.some((e) => e.event === 'change'),
    });
    expect(events.at(-1)).toEqual({ event: 'change', data: { kind: 'data', table: 'entity' } });
  });

  it('caches query results until a change event arrives from any writer', async () => {
    const count = async () => (await api('POST', '/live/query', { kind: 'kpi', entityType: 'country' })).body.rows[0].value as number;
    await waitFor(() => h.services.events.ensure(tenantId));
    const before = await count();
    expect(await count()).toBe(before);
    expect((h.services.query as unknown as { cache: Map<string, unknown> }).cache.size).toBeGreaterThan(0);

    // A write outside this API process (like the worker's) reaches the cache through NOTIFY.
    await withTenant(await h.cells.forTenant(tenantId), tenantId, async (tx) => {
      const type = await tx.selectFrom('entity_type').select('id').where('project_id', '=', projectId).where('key', '=', 'country').executeTakeFirstOrThrow();
      await tx
        .insertInto('entity')
        .values({ id: uuidv7(), tenant_id: tenantId, project_id: projectId, type_id: type.id, code: 'WS', name: 'Samoa', path: 'x' })
        .execute();
    });
    await waitFor(async () => (await count()) === before + 1);

    // Writes through this API invalidate before responding (read-your-writes).
    await api('POST', '/live/entities', { typeKey: 'country', code: 'VU', name: 'Vanuatu' });
    expect(await count()).toBe(before + 2);
  });
});
