import { uuidv7 } from '@grids/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// When a form can be filled in, and how much can be sent.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let ed: string;
let ed2: string;
let key: string;
let facility: { id: string };
let form: { key: string; name: string; draft: unknown; groupId: string | null };

const api = (who: string) => {
  const base = `/tenants/${tenantId}/projects`;
  return {
    get: (url = '') => h.call(who, 'GET', `${base}${url}`),
    post: (url: string, body?: unknown) => h.call(who, 'POST', `${base}${url}`, body),
    put: (url: string, body?: unknown) => h.call(who, 'PUT', `${base}${url}`, body),
  };
};

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Island Hours', 'business');
  admin = await h.join(tenantId, 'admin@ih.org', { role: 'org_admin' });
  ed = await h.join(tenantId, 'ed@ih.org');
  ed2 = await h.join(tenantId, 'ed2@ih.org');
  key = (await h.call(admin, 'POST', `/tenants/${tenantId}/projects`, { name: 'Surveillance', template: 'health-surveillance' })).body.key;
  for (const e of ['ed@ih.org', 'ed2@ih.org']) await api(admin).put(`/${key}/members`, { userId: await h.userId(tenantId, e) });
  facility = (await api(ed).get(`/${key}/entities?type=facility&pageSize=5`)).body.items[0];
  form = (await api(admin).get(`/${key}/forms`)).body.find((f: { key: string }) => f.key === 'weekly_report');
}, 180_000);
afterAll(async () => h?.stop());

const save = (settings: object) =>
  api(admin).put(`/${key}/forms/weekly_report`, { key: form.key, name: form.name, subjectType: 'facility', definition: form.draft, groupId: form.groupId, settings });
const send = (who: string) =>
  api(who).post(`/${key}/forms/weekly_report/submissions`, {
    id: uuidv7(),
    version: 1,
    entityId: facility.id,
    collectedAt: '2026-08-05T10:00:00Z',
    answers: { malaria: 1, ili: 2, diarrhoea: 0, measles: 0, deaths: 0, outbreak: false, stockout: 0 },
  });
const state = async (who: string) => (await api(who).get(`/${key}/forms`)).body.find((f: { key: string }) => f.key === 'weekly_report').availability;
const window = (a: object) => ({ availability: { opensAt: null, closesAt: null, timezone: 'UTC', beforeMessage: '', afterMessage: '', ...a } });
const limits = (l: object) => ({ limits: { maxSubmissions: null, perPerson: null, fullMessage: '', ...l } });

describe('opening and closing', () => {
  it('is open until a window says otherwise', async () => {
    expect((await state(ed)).state).toBe('open');
    expect((await send(ed)).status).toBe(201);
  });

  it('refuses before it opens, with the author’s message', async () => {
    expect((await save(window({ opensAt: '2099-01-01T09:00', timezone: 'Pacific/Auckland', beforeMessage: 'Opens in 2099.' }))).status).toBe(200);
    expect(await state(ed)).toMatchObject({ state: 'not_yet', message: 'Opens in 2099.' });
    const r = await send(ed);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('Opens in 2099.');
  });

  it('refuses after it closes, with a standard sentence when none was written', async () => {
    expect((await save(window({ opensAt: '2020-01-01T09:00', closesAt: '2020-02-01T09:00' }))).status).toBe(200);
    const s = await state(ed);
    expect(s.state).toBe('closed');
    expect(s.message).toContain('This form closed on');
    expect((await send(ed)).status).toBe(403);
  });

  it('rejects a zone that does not exist and a close before the open', async () => {
    expect((await save(window({ timezone: 'Not/AZone' }))).status).toBe(400);
    expect((await save(window({ opensAt: '2030-02-01T09:00', closesAt: '2030-01-01T09:00' }))).status).toBe(400);
  });
});

describe('limits', () => {
  it('stops one person after their share, but not others', async () => {
    expect((await save(limits({ perPerson: 1 }))).status).toBe(200);
    expect((await send(ed2)).status).toBe(201);
    expect((await send(ed2)).status).toBe(403);
    expect((await state(ed2)).state).toBe('limit');
    expect((await send(admin)).status).toBe(201);
  });

  it('stops everyone once the total is reached', async () => {
    expect((await save(limits({ maxSubmissions: 1, fullMessage: 'We have enough.' }))).status).toBe(200);
    expect(await state(admin)).toMatchObject({ state: 'full', message: 'We have enough.' });
    expect((await send(admin)).status).toBe(403);
    expect((await save(limits({}))).status).toBe(200);
    expect((await send(admin)).status).toBe(201);
  });
});
