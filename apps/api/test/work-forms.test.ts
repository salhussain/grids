import { uuidv7 } from '@grids/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// A form that opens work for each submission.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let ed: string;
let edId: string;
let key: string;
let facility: { id: string; name: string };
let form: { key: string; name: string; draft: unknown; groupId: string | null };

const api = (who: string) => {
  const base = `/tenants/${tenantId}/projects/${key}`;
  return { get: (url = '') => h.call(who, 'GET', `${base}${url}`), post: (url: string, body?: unknown) => h.call(who, 'POST', `${base}${url}`, body), put: (url: string, body?: unknown) => h.call(who, 'PUT', `${base}${url}`, body) };
};
const save = (settings: object) => api(admin).put('/forms/weekly_report', { key: form.key, name: form.name, subjectType: 'facility', definition: form.draft, groupId: form.groupId, settings });

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Island Forms Work', 'business');
  admin = await h.join(tenantId, 'admin@fw.org', { role: 'org_admin' });
  ed = await h.join(tenantId, 'ed@fw.org');
  edId = await h.userId(tenantId, 'ed@fw.org');
  key = (await h.call(admin, 'POST', `/tenants/${tenantId}/projects`, { name: 'Surveillance', template: 'health-surveillance' })).body.key;
  await api(admin).put('/members', { userId: edId });
  facility = (await api(ed).get('/entities?type=facility&pageSize=5')).body.items[0];
  form = (await api(admin).get('/forms')).body.find((f: { key: string }) => f.key === 'weekly_report');
}, 180_000);
afterAll(async () => h?.stop());

describe('a form that opens work', () => {
  it('needs a work type the project has', async () => {
    expect((await save({ work: { type: 'followup', title: 'x' } })).status).toBe(400);
    expect((await api(admin).post('/work/types', { key: 'followup', name: 'Follow-up', prefix: 'FU' })).status).toBe(200);
    expect((await save({ work: { type: 'followup', title: 'Report from ${malaria} cases', description: 'Check on ${malaria} cases', priority: 'high', assigneeId: edId, dueInHours: 48 } })).status).toBe(200);
  });

  it('opens an item for each submission, filled from its answers, about the place, and tied to the submission', async () => {
    const id = uuidv7();
    const sent = await api(ed).post('/forms/weekly_report/submissions', { id, version: 1, entityId: facility.id, collectedAt: new Date().toISOString(), answers: { malaria: 7, ili: 2, diarrhoea: 0, measles: 0, deaths: 0, outbreak: false, stockout: 0 } });
    expect(sent.status).toBe(201);
    const items = (await api(admin).get('/work')).body.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ref: 'FU-1', title: 'Report from 7 cases', description: 'Check on 7 cases', priority: 'high', source: 'form', submissionId: id, entity: { id: facility.id }, assignee: { id: edId }, requester: { id: edId } });
    const due = new Date(items[0].dueAt).getTime() - new Date(items[0].createdAt).getTime();
    expect(due / 3_600_000).toBeCloseTo(48, 0);
  });

  it('does nothing when the form does not ask for it', async () => {
    expect((await save({})).status).toBe(200);
    await api(ed).post('/forms/weekly_report/submissions', { id: uuidv7(), version: 1, entityId: facility.id, collectedAt: new Date().toISOString(), answers: { malaria: 1, ili: 1, diarrhoea: 0, measles: 0, deaths: 0, outbreak: false, stockout: 0 } });
    expect((await api(admin).get('/work')).body.total).toBe(1);
  });
});
