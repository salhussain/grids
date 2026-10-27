import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// The activity log: what is written, where it can be read, and who can read it.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let member: string;
let key: string;

const log = (who: string, query = '') => h.call(who, 'GET', `/tenants/${tenantId}/projects/${key}/activity${query}`);
// The log is written without holding the answer up, so give it a moment.
const settle = () => new Promise((r) => setTimeout(r, 300));

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Island Health', 'business');
  admin = await h.join(tenantId, 'admin@ih.org', { role: 'org_admin' });
  member = await h.join(tenantId, 'ana@ih.org');
  key = (await h.call(admin, 'POST', `/tenants/${tenantId}/projects`, { name: 'Clinics' })).body.key;
  await h.call(admin, 'PUT', `/tenants/${tenantId}/projects/${key}/members`, { userId: await h.userId(tenantId, 'ana@ih.org') });
}, 180_000);
afterAll(async () => h?.stop());

describe('project activity', () => {
  it('records changes and views with where they came from, for managers only', async () => {
    await h.call(admin, 'POST', `/tenants/${tenantId}/projects/${key}/types`, { key: 'clinic', name: 'Clinic', plural: 'Clinics' });
    await h.call(admin, 'GET', `/tenants/${tenantId}/projects/${key}`);
    await settle();
    const r = await log(admin);
    expect(r.status).toBe(200);
    const actions = r.body.items.map((e: { action: string }) => e.action);
    expect(actions).toContain('types.created'); // a change nothing described itself
    expect(actions).toContain('project.viewed');
    const created = r.body.items.find((e: { action: string }) => e.action === 'types.created');
    expect(created).toMatchObject({ project: key, category: 'change', actorEmail: 'admin@ih.org' });
    expect(created.ip).toBeTruthy();
    expect(created.location).toBe('Local network');
    expect(r.body.items.find((e: { action: string }) => e.action === 'project.viewed').category).toBe('view');
    expect((await log(member)).status).toBe(403);
  });

  it('names the place an address is in, as city and country', async () => {
    const res = await h.app.inject({ method: 'POST', url: `/tenants/${tenantId}/projects/${key}/types`, headers: { authorization: `Bearer ${admin}` }, payload: { key: 'ward', name: 'Ward', plural: 'Wards' }, remoteAddress: '27.32.0.1' });
    expect(res.statusCode).toBe(200);
    await settle();
    const seen = (await log(admin, '?q=27.32.0.1')).body.items[0];
    expect(seen).toMatchObject({ ip: '27.32.0.1', location: 'Epping, Australia' });
  });

  it('keeps what a change was, before and after', async () => {
    const base = `/tenants/${tenantId}/projects/${key}`;
    const made = await h.call(admin, 'POST', `${base}/entities`, { typeKey: 'clinic', code: 'C1', name: 'Bexon Clinic' });
    expect(made.status).toBe(201);
    expect((await h.call(admin, 'PATCH', `${base}/entities/${made.body.id}`, { name: 'Bexon Health Centre', version: made.body.version })).status).toBe(200);
    await settle();
    const list = (await log(admin, '?category=entity')).body.items;
    const edit = list.find((e: { action: string }) => e.action === 'entity.updated');
    expect(edit.details.changes).toEqual([{ field: 'Name', before: 'Bexon Clinic', after: 'Bexon Health Centre' }]);
    expect(list.find((e: { action: string }) => e.action === 'entity.created').details.changes).toContainEqual({ field: 'Name', before: null, after: 'Bexon Clinic' });
    const role = await h.call(admin, 'PUT', `${base}/members`, { userId: await h.userId(tenantId, 'ana@ih.org'), permissionGroups: [] });
    expect(role.status).toBe(200);
    await settle();
    const access = (await log(admin, '?category=access')).body.items.find((e: { action: string }) => e.action === 'project.member_set');
    expect(access.details.member).toBe('ana@ih.org');
  });

  it('summarises the week for the project and the organisation', async () => {
    const mine = await h.call(admin, 'GET', `/tenants/${tenantId}/projects/${key}/activity/summary`);
    expect(mine.status).toBe(200);
    expect(mine.body.days).toHaveLength(14);
    expect(mine.body.tiles.events.now).toBeGreaterThan(0);
    expect(mine.body.places[0].label).toBeTruthy();
    const long = await h.call(admin, 'GET', `/tenants/${tenantId}/projects/${key}/activity/summary?days=90&limit=200&span=90`);
    expect(long.body.days).toHaveLength(90);
    expect(long.body.tiles.events.now).toBe(mine.body.tiles.events.now); // the tiles are always this week
    expect((await h.call(admin, 'GET', `/tenants/${tenantId}/projects/${key}/activity/summary?days=9999`)).status).toBe(400);
    expect((await h.call(member, 'GET', `/tenants/${tenantId}/projects/${key}/activity/summary`)).status).toBe(403);
    const org = await h.call(admin, 'GET', `/tenants/${tenantId}/activity/summary`);
    expect(org.status).toBe(200);
    expect(org.body.tiles.events.now).toBeGreaterThanOrEqual(mine.body.tiles.events.now);
  });

  it('filters by kind and search', async () => {
    const views = await log(admin, '?category=view');
    expect(views.body.items.length).toBeGreaterThan(0);
    expect(views.body.items.every((e: { category: string }) => e.category === 'view')).toBe(true);
    const both = (await log(admin, '?category=view,access')).body.items;
    expect(both.length).toBeGreaterThan(0);
    expect(both.every((e: { category: string }) => ['view', 'access'].includes(e.category))).toBe(true);
    expect((await log(admin, '?category=nonsense!')).status).toBe(400);
    expect((await log(admin, '?q=clinic')).body.items.some((e: { action: string }) => e.action === 'types.created')).toBe(true);
  });

  it('shows only this project, and the organisation sees it all', async () => {
    const other = (await h.call(admin, 'POST', `/tenants/${tenantId}/projects`, { name: 'Schools' })).body.key;
    await h.call(admin, 'POST', `/tenants/${tenantId}/projects/${other}/types`, { key: 'school', name: 'School', plural: 'Schools' });
    await settle();
    expect((await log(admin)).body.items.some((e: { details: { project?: string } }) => e.details.project === other)).toBe(false);
    const org = await h.call(admin, 'GET', `/tenants/${tenantId}/activity?category=change&pageSize=100`);
    expect(org.status).toBe(200);
    expect(org.body.items.filter((e: { action: string }) => e.action === 'types.created').map((e: { project: string }) => e.project).sort()).toEqual([key, key, other].sort());
  });
});
