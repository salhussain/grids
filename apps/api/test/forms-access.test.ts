import { uuidv7 } from '@grids/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// Who reads a form's answers, and the history of its published versions.
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
    del: (url: string) => h.call(who, 'DELETE', `${base}${url}`),
  };
};

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Island Access', 'business');
  admin = await h.join(tenantId, 'admin@ia.org', { role: 'org_admin' });
  ed = await h.join(tenantId, 'ed@ia.org');
  ed2 = await h.join(tenantId, 'ed2@ia.org');
  key = (await h.call(admin, 'POST', `/tenants/${tenantId}/projects`, { name: 'Surveillance', template: 'health-surveillance' })).body.key;
  for (const e of ['ed@ia.org', 'ed2@ia.org']) await api(admin).put(`/${key}/members`, { userId: await h.userId(tenantId, e) });
  facility = (await api(ed).get(`/${key}/entities?type=facility&pageSize=5`)).body.items[0];
  form = (await api(admin).get(`/${key}/forms`)).body.find((f: { key: string }) => f.key === 'weekly_report');
}, 180_000);
afterAll(async () => h?.stop());

const save = (settings: object, definition: unknown = form.draft) =>
  api(admin).put(`/${key}/forms/weekly_report`, { key: form.key, name: form.name, subjectType: 'facility', definition, groupId: form.groupId, settings });
const send = (who: string) =>
  api(who).post(`/${key}/forms/weekly_report/submissions`, {
    id: uuidv7(),
    version: 1,
    entityId: facility.id,
    collectedAt: '2026-08-05T10:00:00Z',
    answers: { malaria: 1, ili: 2, diarrhoea: 0, measles: 0, deaths: 0, outbreak: false, stockout: 0 },
  });
const count = async (who: string) => (await api(who).get(`/${key}/forms/weekly_report/submissions`)).body.total as number;

describe('who can see the answers', () => {
  it('shows fillers everything in their part of the project by default', async () => {
    expect((await send(ed)).status).toBe(201);
    expect(await count(ed)).toBe(1);
    expect(await count(ed2)).toBe(1);
  });

  it('limits fillers to their own when asked, but never managers', async () => {
    expect((await save({ seeAnswers: 'own' })).status).toBe(200);
    expect(await count(ed2)).toBe(0);
    expect(await count(ed)).toBe(1);
    expect(await count(admin)).toBe(1);
    expect((await send(ed2)).status).toBe(201);
    expect(await count(ed2)).toBe(1);
    const mine = (await api(ed2).get(`/${key}/forms/weekly_report/submissions`)).body.items[0];
    const theirs = (await api(admin).get(`/${key}/forms/weekly_report/submissions`)).body.items.find((s: { id: string }) => s.id !== mine.id);
    expect((await api(ed2).get(`/${key}/submissions/${theirs.id}`)).status).toBe(404);
    expect((await api(ed2).get(`/${key}/submissions/${mine.id}`)).status).toBe(200);
  });
});

describe('version history', () => {
  it('lists every published version to managers only', async () => {
    // A form about a facility needs the question that says which one before it can be published.
    expect((await api(admin).post(`/${key}/forms/weekly_report/publish`)).status).toBe(400);
    const withMain = structuredClone(form.draft) as { sections: { questions: object[] }[] };
    withMain.sections[0]!.questions.unshift({ key: 'main_entity', type: 'entity', label: 'Which facility?', entityType: 'facility', primary: true, required: true });
    expect((await save({ seeAnswers: 'own' }, withMain)).status).toBe(200);
    expect((await api(admin).post(`/${key}/forms/weekly_report/publish`)).status).toBe(200);
    const versions = (await api(admin).get(`/${key}/forms/weekly_report/versions`)).body;
    expect(versions.map((v: { version: number }) => v.version)).toEqual([...versions.map((v: { version: number }) => v.version)].sort((a, b) => b - a));
    expect(versions[0]).toMatchObject({ definition: { sections: expect.any(Array) } });
    expect([403, 404]).toContain((await api(ed).get(`/${key}/forms/weekly_report/versions`)).status);
  });

describe('data groups', () => {
  it('unlink the form questions that record into a group\'s indicators when the group is removed with them', async () => {
    expect((await api(admin).post(`/${key}/data-groups`, { key: 'weekly', name: 'Weekly' })).status).toBe(200);
    expect((await api(admin).post(`/${key}/elements`, { group: 'weekly', key: 'cases', name: 'Cases' })).status).toBe(200);
    const def = structuredClone(form.draft) as { sections: { questions: { bind?: { element?: string } }[] }[] };
    def.sections[0]!.questions[0]!.bind = { element: 'weekly.cases' };
    expect((await save({ seeAnswers: 'scope' }, def)).status).toBe(200);
    // While a question records into it, the group cannot go without asking for everything to go.
    expect((await api(admin).del(`/${key}/data-groups/weekly`)).status).toBe(409);
    expect((await api(admin).del(`/${key}/data-groups/weekly?cascade=true`)).status).toBe(200);
    const now = ((await api(admin).get(`/${key}/forms`)).body as { key: string; draft: typeof def }[]).find((f) => f.key === 'weekly_report')!;
    expect(now.draft.sections[0]!.questions[0]!.bind?.element).toBeUndefined();
    expect(((await api(admin).get(`/${key}/elements`)).body as { ref: string }[]).some((e) => e.ref === 'weekly.cases')).toBe(false);
  });
});
});
