import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// Organisation-wide entity types, linked into every project, and per-project entity limits.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let member: string;

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Types Org', 'business');
  admin = await h.join(tenantId, 'admin@types.org', { role: 'org_admin' });
  member = await h.join(tenantId, 'member@types.org');
}, 180_000);
afterAll(async () => h?.stop());

const proj = (who: string) => (path = '') => ({
  get: () => h.call(who, 'GET', `/tenants/${tenantId}/projects${path}`),
  post: (body?: unknown, sub = '') => h.call(who, 'POST', `/tenants/${tenantId}/projects${path}${sub}`, body),
  put: (sub: string, body?: unknown) => h.call(who, 'PUT', `/tenants/${tenantId}/projects${path}${sub}`, body),
  del: (sub: string) => h.call(who, 'DELETE', `/tenants/${tenantId}/projects${path}${sub}`),
});
const org = (who: string) => ({
  list: () => h.call(who, 'GET', `/tenants/${tenantId}/entity-types`),
  post: (body: unknown) => h.call(who, 'POST', `/tenants/${tenantId}/entity-types`, body),
  put: (key: string, body: unknown) => h.call(who, 'PUT', `/tenants/${tenantId}/entity-types/${key}`, body),
  del: (key: string) => h.call(who, 'DELETE', `/tenants/${tenantId}/entity-types/${key}`),
});
const typesOf = async (key: string) => (await proj(admin)(`/${key}`).get()).status && (await h.call(admin, 'GET', `/tenants/${tenantId}/projects/${key}/types`)).body;

describe('organisation entity types', () => {
  it('appear in every project, new and existing, and are edited centrally', async () => {
    await proj(admin)().post({ name: 'Alpha' });
    expect((await org(member).post({ key: 'facility', name: 'Facility', plural: 'Facilities' })).status).toBe(403);
    const made = await org(admin).post({ key: 'facility', name: 'Facility', plural: 'Facilities' });
    expect(made.status).toBe(200);
    expect(made.body[0]).toMatchObject({ key: 'facility', maxPerProject: null });

    // Existing project got it; a new one does too.
    await proj(admin)().post({ name: 'Beta' });
    for (const k of ['alpha', 'beta']) expect((await typesOf(k)).find((t: { key: string }) => t.key === 'facility')).toMatchObject({ orgId: expect.any(String) });

    // Locked in the project…
    const put = await proj(admin)('/alpha').put('/types/facility', { key: 'facility', name: 'Mine', plural: 'Mines' });
    expect(put.status).toBe(403);
    expect((await proj(admin)('/alpha').del('/types/facility')).status).toBe(403);

    // …edited once in the organisation, and every project follows.
    await org(admin).put('facility', { key: 'facility', name: 'Site', plural: 'Sites' });
    for (const k of ['alpha', 'beta']) expect((await typesOf(k)).find((t: { key: string }) => t.key === 'facility')).toMatchObject({ name: 'Site', plural: 'Sites' });
  });

  it('refuses a key a project already uses for its own type', async () => {
    await proj(admin)().post({ name: 'Gamma' });
    await proj(admin)('/gamma').post({ key: 'clinic', name: 'Clinic', plural: 'Clinics' }, '/types');
    const clash = await org(admin).post({ key: 'clinic', name: 'Clinic', plural: 'Clinics' });
    expect(clash.status).toBe(409);
  });

  it('caps how many entities a project may hold of its own type', async () => {
    const p = proj(admin)('/alpha');
    await p.post({ key: 'depot', name: 'Depot', plural: 'Depots', maxPerProject: 2 }, '/types');
    const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ code: `D${from + i}`, name: `Depot ${from + i}` }));
    expect((await p.post({ typeKey: 'depot', rows: rows(2) }, '/import')).status).toBe(200);
    const over = await p.post({ typeKey: 'depot', rows: rows(1, 2) }, '/import');
    expect(over.status).toBe(422);
    expect(JSON.stringify(over.body)).toContain('at most 2');
    expect((await p.post({ typeKey: 'depot', rows: rows(2) }, '/import')).status).toBe(200); // updating is fine
  });

  it('shares entities of organisation types across projects', async () => {
    const shared = (who: string) => ({
      list: (q = '') => h.call(who, 'GET', `/tenants/${tenantId}/shared-entities${q}`),
      post: (body: unknown) => h.call(who, 'POST', `/tenants/${tenantId}/shared-entities`, body),
      patch: (id: string, body: unknown) => h.call(who, 'PATCH', `/tenants/${tenantId}/shared-entities/${id}`, body),
      del: (id: string) => h.call(who, 'DELETE', `/tenants/${tenantId}/shared-entities/${id}`),
    });
    // Only the organisation creates them; projects cannot.
    expect((await shared(member).post({ typeKey: 'facility', code: 'F1', name: 'Victoria Hospital' })).status).toBe(403);
    const direct = await proj(admin)('/alpha').post({ typeKey: 'facility', code: 'F1', name: 'Nope' }, '/entities');
    expect(direct.status).toBe(422);

    const made = await shared(admin).post({ typeKey: 'facility', code: 'F1', name: 'Victoria Hospital' });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ code: 'F1', shared: true });
    const id = made.body.id;
    expect((await shared(admin).post({ typeKey: 'facility', code: 'F1', name: 'Again' })).status).toBe(409);

    // Both projects see it, marked shared; neither can change it.
    for (const k of ['alpha', 'beta']) {
      const list = (await h.call(admin, 'GET', `/tenants/${tenantId}/projects/${k}/entities?type=facility`)).body;
      expect(list.items).toEqual([expect.objectContaining({ id, shared: true })]);
      expect((await h.call(admin, 'PATCH', `/tenants/${tenantId}/projects/${k}/entities/${id}`, { name: 'Mine' })).status).toBe(403);
      expect((await h.call(admin, 'DELETE', `/tenants/${tenantId}/projects/${k}/entities/${id}`)).status).toBe(403);
    }
    expect((await shared(admin).patch(id, { name: 'Victoria General' })).body.name).toBe('Victoria General');

    // A project's own entity can sit under a shared one.
    await proj(admin)('/alpha').post({ key: 'ward', name: 'Ward', plural: 'Wards', parentTypes: ['facility'] }, '/types');
    const ward = await proj(admin)('/alpha').post({ typeKey: 'ward', code: 'W1', name: 'Maternity', parentId: id }, '/entities');
    expect(ward.status).toBe(201);
    expect(ward.body.parent).toMatchObject({ id });
    // …and other projects don't see it, nor count it under the facility.
    const betaPlaces = (await h.call(admin, 'GET', `/tenants/${tenantId}/projects/beta/places?parent=${id}`)).body;
    expect(betaPlaces).toEqual([]);
    const alphaPlaces = (await h.call(admin, 'GET', `/tenants/${tenantId}/projects/alpha/places?parent=${id}`)).body;
    expect(alphaPlaces.map((x: { name: string }) => x.name)).toEqual(['Maternity']);

    // Each project records its own data against it.
    await proj(admin)('/alpha').post({ key: 'beds', name: 'Beds', unit: 'n' }, '/elements');
    await proj(admin)('/beta').post({ key: 'beds', name: 'Beds', unit: 'n' }, '/elements');
    const obs = (k: string, value: number) => h.call(admin, 'POST', `/tenants/${tenantId}/projects/${k}/observations`, { observations: [{ entityId: id, element: 'beds', at: '2026-09-01T00:00:00Z', value }] });
    expect((await obs('alpha', 10)).status).toBe(200);
    expect((await obs('beta', 99)).status).toBe(200);
    const series = async (k: string) => (await h.call(admin, 'GET', `/tenants/${tenantId}/projects/${k}/entities/${id}/series?element=beds`)).body.map((o: { value: number }) => o.value);
    expect(await series('alpha')).toEqual([10]);
    expect(await series('beta')).toEqual([99]);
    // Data recorded against it blocks deleting it.
    expect((await shared(admin).del(id)).status).toBe(409);
  });

  it('cannot be deleted while entities of the type exist', async () => {
    expect((await org(admin).del('facility')).status).toBe(409);
  });
});
