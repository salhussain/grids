import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// Project profiles, groups, hand-made datasets, platform settings, internal support and insights.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let member: string;
let viewer: string; // member with no project role

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Reef Council', 'business');
  admin = await h.join(tenantId, 'admin@reef.org', { role: 'org_admin' });
  member = await h.join(tenantId, 'mel@reef.org');
  viewer = await h.join(tenantId, 'nia@reef.org');
}, 180_000);
afterAll(async () => h?.stop());

const p = (who: string) => {
  const base = `/tenants/${tenantId}/projects`;
  return {
    get: (u = '') => h.call(who, 'GET', `${base}${u}`),
    post: (u: string, b?: unknown) => h.call(who, 'POST', `${base}${u}`, b),
    put: (u: string, b?: unknown) => h.call(who, 'PUT', `${base}${u}`, b),
    patch: (u: string, b?: unknown) => h.call(who, 'PATCH', `${base}${u}`, b),
    del: (u: string) => h.call(who, 'DELETE', `${base}${u}`),
  };
};

describe('project profile', () => {
  it('creates with code, images, a manager and draft status; drafts stay hidden until live', async () => {
    const memberId = (await h.userId(tenantId, 'mel@reef.org'))!;
    const res = await p(admin).post('', {
      name: 'Reef Health',
      key: 'reef-health',
      description: 'Coral monitoring',
      visibility: 'public',
      status: 'draft',
      logo: LOGO,
      coverImage: LOGO,
      managerId: memberId,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ key: 'reef-health', status: 'draft', logo: LOGO, coverImage: LOGO, myRole: 'manager' });
    const members = (await p(admin).get('/reef-health/members')).body;
    expect(members.find((m: { email: string }) => m.email === 'mel@reef.org')).toMatchObject({ role: 'manager' });

    const tenant = (await h.admin('GET', `/platform/tenants/${tenantId}`)).body;
    expect((await h.call(null, 'GET', `/public/projects/${tenant.slug}/reef-health`)).status).toBe(404);
    expect((await h.call(null, 'GET', '/public/projects')).body).toEqual([]);

    const live = await p(admin).patch('/reef-health', { status: 'live' });
    expect(live.body).toMatchObject({ status: 'live', visibility: 'public', description: 'Coral monitoring' });
    expect((await h.call(null, 'GET', `/public/projects/${tenant.slug}/reef-health`)).status).toBe(200);
  });

  it('rejects a manager who is not a member and non-image logos', async () => {
    expect((await p(admin).post('', { name: 'X', managerId: '00000000-0000-7000-8000-000000000000' })).status).toBe(400);
    expect((await p(admin).post('', { name: 'Y', logo: 'javascript:alert(1)' })).status).toBe(400);
  });
});

describe('groups', () => {
  it('nests overlay groups as levels and shows the path on overlays', async () => {
    await p(admin).post('/reef-health/elements', { key: 'bleaching', name: 'Bleaching', aggregation: 'avg' });
    const health = (await p(admin).post('/reef-health/overlay-groups', { name: 'Health' })).body[0];
    const groups = (await p(admin).post('/reef-health/overlay-groups', { name: 'Coral', parentId: health.id })).body;
    const coral = groups.find((g: { name: string }) => g.name === 'Coral');
    expect(coral.path).toBe('Health › Coral');
    const saved = await p(admin).post('/reef-health/overlays', { key: 'bleach', name: 'Bleaching', element: 'bleaching', groupId: coral.id });
    expect(saved.body[0]).toMatchObject({ groupId: coral.id, group: 'Health › Coral' });
    expect((await p(admin).put(`/reef-health/overlay-groups/${health.id}`, { name: 'Health', parentId: coral.id })).status).toBe(400); // cycle
    expect((await p(admin).del(`/reef-health/overlay-groups/${health.id}`)).status).toBe(409); // has a sub-group
    expect((await p(viewer).post('/reef-health/overlay-groups', { name: 'Nope' })).status).toBe(403);
  });

  it('keeps form groups per project and puts forms in them', async () => {
    const g = (await p(admin).post('/reef-health/form-groups', { name: 'Field surveys' })).body[0];
    expect(g).toMatchObject({ name: 'Field surveys', formCount: 0 });
    const form = await p(admin).post('/reef-health/forms', {
      key: 'dive',
      name: 'Dive log',
      groupId: g.id,
      definition: { title: 'Dive log', sections: [{ key: 's', title: '', questions: [{ key: 'depth', type: 'decimal', label: 'Depth' }] }] },
    });
    expect(form.status).toBe(200);
    expect((await p(admin).get('/reef-health/form-groups')).body[0].formCount).toBe(1);
    await p(admin).post('/reef-health/forms/dive/publish');
    const menu = (await h.call(admin, 'GET', `/tenants/${tenantId}/forms/menu`)).body;
    expect(menu.forms[0]).toMatchObject({ key: 'dive', groupId: g.id, project: { key: 'reef-health' } });
    expect(menu.groups.find((x: { id: string }) => x.id === g.id).projectId).toBeTruthy();
  });
});

describe('datasets made by hand', () => {
  it('creates a dataset, loads CSV rows and charts it', async () => {
    const created = await p(admin).post('/reef-health/datasets', { key: 'surveys', name: 'Surveys', columns: ['site'] });
    expect(created.body[0]).toMatchObject({ key: 'surveys', rowCount: 0 });
    const rows = [
      { site: 'North', date: '2026-09-01', cover: '42' },
      { site: 'North', date: '2026-09-02', cover: '38' },
      { site: 'South', date: '2026-09-02', cover: '55.5' },
    ];
    expect((await p(admin).put('/reef-health/datasets/surveys/rows', { rows })).body).toEqual({ rows: 3, added: 3 });
    const ds = (await p(admin).get('/reef-health/datasets')).body[0];
    expect(ds.columns).toEqual(['site', 'date', 'cover']);

    const q = (spec: object) => p(admin).post('/reef-health/query', { kind: 'dataset', dataset: 'surveys', ...spec });
    expect((await q({ value: 'cover', aggregation: 'avg' })).body.rows[0].value).toBeCloseTo(45.1667, 3);
    expect((await q({ groupBy: 'site' })).body.rows).toEqual([
      { label: 'North', value: 2 },
      { label: 'South', value: 1 },
    ]);
    const series = (await q({ value: 'cover', aggregation: 'sum', timeColumn: 'date', interval: 'day' })).body;
    expect(series.kind).toBe('series');
    expect(series.rows.map((r: { value: number }) => r.value)).toEqual([42, 93.5]);
    expect((await q({ filter: { column: 'site', equals: 'South' } })).body.rows[0].value).toBe(1);

    await p(admin).put('/reef-health/datasets/surveys/rows', { mode: 'append', rows: [{ site: 'East', cover: 10 }] });
    expect((await p(admin).get('/reef-health/datasets')).body[0].rowCount).toBe(4);
    expect((await p(viewer).post('/reef-health/datasets', { key: 'x', name: 'X' })).status).toBe(403);
  });
});

describe('platform settings', () => {
  it('staff with settings.manage change branding and languages; new organisations get the defaults', async () => {
    expect((await h.call(member, 'PUT', '/platform/settings', { branding: { appName: 'Nope' } })).status).toBe(403);
    const res = await h.admin('PUT', '/platform/settings', {
      branding: { appName: 'Atoll Data', primaryColor: '#005d5d', logo: null, welcomeMessage: 'Kia ora', supportEmail: 'help@atoll.test' },
      localization: { consoleLanguages: ['en', 'fr'], consoleDefault: 'en', orgLanguages: ['en', 'sm'], orgDefault: 'sm' },
    });
    expect(res.status).toBe(200);
    expect((await h.call(null, 'GET', '/public/platform')).body.branding).toMatchObject({ appName: 'Atoll Data', primaryColor: '#005d5d' });
    expect((await h.admin('PUT', '/platform/settings', { localization: { consoleLanguages: ['en'], consoleDefault: 'fr', orgLanguages: ['en'], orgDefault: 'en' } })).status).toBe(400);

    const newId = await h.activeTenant('Lagoon Trust', 'team');
    const owner = await h.join(newId, 'owner@lagoon.org', { role: 'org_admin' });
    expect((await h.call(owner, 'GET', `/tenants/${newId}/workspace`)).body.localization).toMatchObject({ languages: ['en', 'sm'], defaultLanguage: 'sm' });
  });
});

describe('internal support and escalation', () => {
  it('keeps internal tickets inside the organisation until an admin escalates them', async () => {
    const t = await h.call(member, 'POST', `/tenants/${tenantId}/tickets`, { subject: 'Cannot see the map', body: 'Blank screen', audience: 'organisation', page: '/o/x/p/reef-health' });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ audience: 'organisation', escalatedAt: null });
    expect(t.body.messages[0].body).toContain('Sent from /o/x/p/reef-health');
    expect(h.mailer.to('admin@reef.org').some((m) => m.subject.includes('Cannot see the map'))).toBe(true);

    // Platform staff don't see it
    expect((await h.admin('GET', '/platform/support/tickets')).body.items.some((x: { id: string }) => x.id === t.body.id)).toBe(false);
    expect((await h.admin('GET', `/tickets/${t.body.id}`)).status).toBe(404);

    expect((await h.call(member, 'POST', `/tenants/${tenantId}/tickets/${t.body.id}/escalate`, {})).status).toBe(403);
    const st = await h.call(admin, 'PATCH', `/tenants/${tenantId}/tickets/${t.body.id}`, { status: 'pending' });
    expect(st.body.status).toBe('pending');
    const esc = await h.call(admin, 'POST', `/tenants/${tenantId}/tickets/${t.body.id}/escalate`, { note: 'Looks like a platform bug' });
    expect(esc.body).toMatchObject({ audience: 'platform', status: 'open' });
    expect(esc.body.escalatedAt).not.toBeNull();
    expect((await h.admin('GET', `/tickets/${t.body.id}`)).status).toBe(200);
    expect((await h.call(admin, 'PATCH', `/tenants/${tenantId}/tickets/${t.body.id}`, { status: 'closed' })).status).toBe(403);
  });
});

describe('organisation insights', () => {
  it('summarises submissions, projects, people and tickets', async () => {
    const i = (await h.call(admin, 'GET', `/tenants/${tenantId}/insights`)).body;
    expect(i.submissionsByDay).toHaveLength(31);
    expect(i.projects).toMatchObject({ live: 1 });
    expect(i.members.active).toBeGreaterThanOrEqual(2);
    expect(i.tickets.platformOpen).toBeGreaterThanOrEqual(1);
    expect((await h.call('stranger', 'GET', `/tenants/${tenantId}/insights`)).status).toBe(403);
  });
});
