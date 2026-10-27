import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// The helpdesk and fleet templates: they install, every dashboard widget answers, and fleet maintenance runs by itself.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
const p = (key = '') => `/tenants/${tenantId}/projects${key ? `/${key}` : ''}`;

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Island Fleet', 'business');
  admin = await h.join(tenantId, 'admin@if.org', { role: 'org_admin' });
}, 180_000);
afterAll(async () => h?.stop());

const install = async (name: string, template: string) => (await h.call(admin, 'POST', p(), { name, template })).body.key as string;

const widgetsAnswer = async (key: string) => {
  const dashboards = (await h.call(admin, 'GET', `${p(key)}/dashboards`)).body;
  expect(dashboards.length).toBeGreaterThan(0);
  for (const d of dashboards) for (const w of d.widgets) if (w.query) expect((await h.call(admin, 'POST', `${p(key)}/query`, w.query)).status, `${d.key}/${w.id}`).toBe(200);
};

describe('helpdesk', () => {
  it('installs with tickets, a request form and a dashboard that answers', async () => {
    const key = await install('Help desk', 'helpdesk');
    const work = (await h.call(admin, 'GET', `${p(key)}/work?type=ticket`)).body;
    expect(work.total).toBe(10);
    await widgetsAnswer(key);
  });
});

describe('fleet', () => {
  it('installs vehicles, drivers, forms, maintenance schedules and jobs', async () => {
    const key = await install('Fleet', 'fleet');
    const types = (await h.call(admin, 'GET', `${p(key)}/types`)).body;
    expect(types.map((t: { key: string; count: number }) => [t.key, t.count])).toEqual([['depot', 3], ['vehicle', 14], ['driver', 9]]);
    expect((await h.call(admin, 'GET', `${p(key)}/work/schedules`)).body.map((s: { key: string; targets: number }) => [s.key, s.targets])).toEqual([['safety_check', 13], ['service', 13]]);
    expect((await h.call(admin, 'GET', `${p(key)}/work?type=repair`)).body.total).toBe(5);
    await widgetsAnswer(key);
  });

  it('opens maintenance that has fallen due, once', async () => {
    const key = (await h.call(admin, 'GET', p())).body.find((x: { name: string }) => x.name === 'Fleet').key;
    const before = (await h.call(admin, 'GET', `${p(key)}/work?type=maintenance`)).body.total;
    const opened = await h.services.workSchedules.run(tenantId);
    expect(opened).toBeGreaterThan(0);
    expect((await h.call(admin, 'GET', `${p(key)}/work?type=maintenance`)).body.total).toBe(before + opened);
    expect(await h.services.workSchedules.run(tenantId)).toBe(0);
  });
});
