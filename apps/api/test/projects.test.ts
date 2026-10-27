import { drainQueue } from '@grids/data';
import { uuidv7 } from '@grids/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// Projects and the data platform (M3–M6) through the HTTP API on real Postgres.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string; // organisation admin
let ed: string; // member, project editor scoped to one district
let vi: string; // member without project access

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Island Health', 'business');
  admin = await h.join(tenantId, 'admin@ih.org', { role: 'org_admin' });
  ed = await h.join(tenantId, 'ed@ih.org');
  vi = await h.join(tenantId, 'vi@ih.org');
}, 180_000);
afterAll(async () => h?.stop());

const api = (who: string) => {
  const base = `/tenants/${tenantId}/projects`;
  return {
    get: (url = '') => h.call(who, 'GET', `${base}${url}`),
    post: (url: string, body?: unknown) => h.call(who, 'POST', `${base}${url}`, body),
    put: (url: string, body?: unknown) => h.call(who, 'PUT', `${base}${url}`, body),
    patch: (url: string, body?: unknown) => h.call(who, 'PATCH', `${base}${url}`, body),
    del: (url: string) => h.call(who, 'DELETE', `${base}${url}`),
  };
};

/** Permission ids by name, shared by the tests that build on each other. */
const perm: Record<string, string> = {};

describe('projects and the data model', () => {
  it('admins create projects; members need permission; plans limit the count', async () => {
    expect((await api(ed).post('', { name: 'Nope' })).status).toBe(403);
    const res = await api(admin).post('', { name: 'Water Points', description: 'Rural water', visibility: 'private' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ key: 'water-points', myRole: 'manager', counts: { members: 1 }, freshness: { status: 'unknown' } });

    // Free plan: one project
    const freeId = await h.activeTenant('Tiny Org', 'free');
    const owner = await h.join(freeId, 'owner@tiny.org', { role: 'org_admin' });
    expect((await h.call(owner, 'POST', `/tenants/${freeId}/projects`, { name: 'One' })).status).toBe(201);
    const second = await h.call(owner, 'POST', `/tenants/${freeId}/projects`, { name: 'Two' });
    expect(second.status).toBe(402);
  });

  it('private projects are invisible to non-members', async () => {
    expect((await api(vi).get('')).body).toEqual([]);
    expect((await api(vi).get('/water-points')).status).toBe(404);
  });

  it('defines types with hierarchy rules, entities with geometry, and moves subtrees', async () => {
    const p = api(admin);
    await p.post('/water-points/types', { key: 'district', name: 'District', plural: 'Districts' });
    const types = await p.post('/water-points/types', {
      key: 'water_point',
      name: 'Water point',
      plural: 'Water points',
      geometry: 'point',
      parentTypes: ['district'],
      attributes: [
        { key: 'kind', label: 'Kind', type: 'select', options: ['Well', 'Tank', 'Tap'], required: true },
        { key: 'depth_m', label: 'Depth', type: 'number', unit: 'm' },
      ],
    });
    expect(types.body.map((t: { key: string }) => t.key)).toEqual(['district', 'water_point']);
    const north = (await p.post('/water-points/entities', { typeKey: 'district', code: 'N', name: 'North' })).body;
    const south = (await p.post('/water-points/entities', { typeKey: 'district', code: 'S', name: 'South' })).body;
    expect((await p.post('/water-points/entities', { typeKey: 'water_point', code: 'W1', name: 'Well 1', attributes: {} })).status).toBe(400); // kind required

    const w1 = await p.post('/water-points/entities', {
      typeKey: 'water_point',
      code: 'W1',
      name: 'Well 1',
      parentId: north.id,
      attributes: { kind: 'Well', depth_m: '12.5' },
      geometry: { type: 'Point', coordinates: [178.4, -18.1] },
    });
    expect(w1.status).toBe(201);
    expect(w1.body).toMatchObject({ parent: { name: 'North' }, attributes: { kind: 'Well', depth_m: 12.5 }, ancestors: [{ name: 'North' }], geometry: { type: 'Point' } });
    expect((await p.post('/water-points/entities', { typeKey: 'water_point', code: 'W1', name: 'Dupe', parentId: north.id, attributes: { kind: 'Tap' } })).status).toBe(409);

    // Edits are versioned; stale edits conflict; moves rewrite the subtree
    const upd = await p.patch(`/water-points/entities/${w1.body.id}`, { name: 'Well One', parentId: south.id, version: 1 });
    expect(upd.body).toMatchObject({ name: 'Well One', parent: { name: 'South' }, version: 2 });
    expect((await p.patch(`/water-points/entities/${w1.body.id}`, { name: 'Late', version: 1 })).status).toBe(409);
    expect((await p.del(`/water-points/entities/${south.id}`)).status).toBe(409); // has children
    expect(upd.body.history.length).toBeGreaterThanOrEqual(2);

    const list = await p.get('/water-points/entities?type=water_point&q=one');
    expect(list.body).toMatchObject({ total: 1, items: [{ code: 'W1', hasGeometry: true }] });
    const geo = await p.get('/water-points/geo?type=water_point');
    expect(geo.body.features[0]).toMatchObject({
      geometry: { coordinates: [178.4, -18.1] },
      properties: { name: 'Well One', kind: 'Well', marker: 'dot', icon: 'box' },
    });

    // Areas carry an optional boundary and an optional centre point
    const box = [
      [
        [178, -18],
        [179, -18],
        [179, -17],
        [178, -17],
        [178, -18],
      ],
    ];
    const east = await p.post('/water-points/entities', {
      typeKey: 'district',
      code: 'E',
      name: 'East',
      geometry: { type: 'Polygon', coordinates: box },
      point: { type: 'Point', coordinates: [178.5, -17.5] },
    });
    expect(east.body).toMatchObject({
      geometry: { type: 'Polygon' },
      point: { type: 'Point', coordinates: [178.5, -17.5] },
    });
    const west = await p.post('/water-points/entities', {
      typeKey: 'district',
      code: 'W',
      name: 'West',
      point: { type: 'Point', coordinates: [177.5, -17.5] },
    });
    expect(west.body).toMatchObject({ geometry: null, hasGeometry: true });
    const cleared = await p.patch(`/water-points/entities/${east.body.id}`, { point: null });
    expect(cleared.body.point).toBeNull();
    const areas = (await p.get('/water-points/geo?type=district')).body.features;
    expect(areas.map((f: { geometry: { type: string } }) => f.geometry.type).sort()).toEqual([
      'Point',
      'Polygon',
    ]);

    // Types choose how their places are drawn on maps
    const pinned = await p.put('/water-points/types/water_point', {
      ...types.body[1],
      marker: { style: 'icon', rotateBy: 'depth_m' },
    });
    expect(pinned.body[1].marker).toEqual({ style: 'icon', rotateBy: 'depth_m' });
    expect(
      (await p.get('/water-points/geo?type=water_point')).body.features[0].properties,
    ).toMatchObject({ marker: 'icon', rotation: 12.5 });
  });

  it('imports rows idempotently and records observations', async () => {
    const p = api(admin);
    const rows = [
      { code: 'W2', name: 'Tank 2', parent_code: 'N', kind: 'Tank', lat: -18.0, lon: 178.5 },
      { code: 'W3', name: 'Tap 3', parent_code: 'N', kind: 'Tap', lat: '', lon: '' },
    ];
    expect((await p.post('/water-points/import', { typeKey: 'water_point', rows })).body).toEqual({ created: 2, updated: 0, unchanged: 0, skipped: 0 });
    expect((await p.post('/water-points/import', { typeKey: 'water_point', rows })).body).toMatchObject({ created: 0, unchanged: 2 });

    await p.post('/water-points/elements', { key: 'flow_lpm', name: 'Flow', unit: 'L/min', aggregation: 'avg' });
    const w2 = (await p.get('/water-points/entities?q=tank')).body.items[0];
    const obs = await p.post('/water-points/observations', {
      observations: [
        { entityId: w2.id, element: 'flow_lpm', at: '2026-09-01T00:00:00Z', value: 10 },
        { entityId: w2.id, element: 'flow_lpm', at: '2026-09-02T00:00:00Z', value: 14 },
        { entityId: w2.id, element: 'flow_lpm', at: '2026-09-02T00:00:00Z', value: 15 }, // same time: last wins
      ],
    });
    expect(obs.body).toEqual({ written: 2, skipped: 0 });
    expect((await p.get(`/water-points/entities/${w2.id}/series?element=flow_lpm`)).body.map((o: { value: number }) => o.value)).toEqual([10, 15]);
    expect((await p.get(`/water-points/entities/${w2.id}`)).body.latest).toEqual([expect.objectContaining({ element: 'flow_lpm', value: 15 })]);
    // The district above it has recorded nothing itself, so it shows what is under it, combined the way the indicator says (an average).
    const north = (await p.get('/water-points/entities?type=district&q=north')).body.items[0];
    const above = (await p.get(`/water-points/entities/${north.id}`)).body.latest;
    expect(above).toEqual([expect.objectContaining({ element: 'flow_lpm', rolledUp: true, aggregation: 'avg', value: 15, places: 1 })]);
    expect((await p.get(`/water-points/entities/${north.id}/series?element=flow_lpm&rollup=1`)).body.map((o: { value: number }) => o.value)).toEqual([10, 15]);
    expect((await p.get(`/water-points/entities/${w2.id}`)).body.latest[0].rolledUp).toBe(false);
  });

  it('only lets an indicator be combined in ways its type allows, and keeps its key and type once readings exist', async () => {
    const p = api(admin);
    expect((await p.post('/water-points/elements', { key: 'notes', name: 'Notes', valueType: 'text', aggregation: 'sum' })).status).toBe(400);
    expect((await p.post('/water-points/elements', { key: 'notes', name: 'Notes', valueType: 'text', aggregation: 'count' })).status).toBe(200);
    expect((await p.post('/water-points/elements', { key: 'working', name: 'Working', valueType: 'boolean', aggregation: 'max' })).status).toBe(400);
    expect((await p.post('/water-points/elements', { key: 'working', name: 'Working', valueType: 'boolean', aggregation: 'avg' })).status).toBe(200);
    expect((await p.post('/water-points/elements', { key: 'flow_lpm', name: 'Again', aggregation: 'sum' })).status).toBe(409); // keys are unique
    // flow_lpm has readings (above): its type and key are held, the rest can change.
    expect((await p.put('/water-points/elements/flow_lpm', { key: 'flow_lpm', name: 'Flow rate', valueType: 'text', aggregation: 'count' })).status).toBe(409);
    expect((await p.put('/water-points/elements/flow_lpm', { key: 'flow_lpm', name: 'Flow rate', unit: 'L/min', aggregation: 'max' })).status).toBe(200);
  });

  it('keeps indicators in groups, so two groups can both have a `date`', async () => {
    const p = api(admin);
    expect((await p.post('/water-points/data-groups', { key: 'visits', name: 'Site visits' })).status).toBe(200);
    expect((await p.post('/water-points/data-groups', { key: 'visits', name: 'Again' })).status).toBe(409);
    expect((await p.post('/water-points/elements', { group: 'nope', key: 'date', name: 'Date' })).status).toBe(400);
    expect((await p.post('/water-points/elements', { group: 'visits', key: 'readings', name: 'Visit readings' })).status).toBe(200);
    // The same key in the default group and in another one.
    expect((await p.post('/water-points/elements', { key: 'readings', name: 'Readings' })).status).toBe(200);
    expect((await p.post('/water-points/elements', { group: 'visits', key: 'readings', name: 'Duplicate' })).status).toBe(409);
    const list = (await p.get('/water-points/elements')).body as { ref: string; group: string; groupName: string }[];
    expect(list.filter((e) => e.ref === 'readings' || e.ref === 'visits.readings').map((e) => [e.ref, e.group, e.groupName]).sort()).toEqual([
      ['readings', 'general', 'General'],
      ['visits.readings', 'visits', 'Site visits'],
    ]);
    // Readings go to the one the reference names.
    const w2 = (await p.get('/water-points/entities?q=tank')).body.items[0];
    expect((await p.post('/water-points/observations', { observations: [{ entityId: w2.id, element: 'visits.readings', at: '2026-09-03T00:00:00Z', value: 7 }] })).body).toEqual({ written: 1, skipped: 0 });
    expect((await p.get(`/water-points/entities/${w2.id}/series?element=visits.readings`)).body.map((o: { value: number }) => o.value)).toEqual([7]);
    expect((await p.get(`/water-points/entities/${w2.id}/series?element=readings`)).body).toEqual([]);
    // A group with indicators in it cannot be removed.
    expect((await p.del('/water-points/data-groups/visits')).status).toBe(409);
    expect((await p.del('/water-points/data-groups/general')).status).toBe(409);
    // Unless asked to take the indicators (and their readings) with it.
    expect((await p.del('/water-points/data-groups/visits?cascade=true')).status).toBe(200);
    const after = (await p.get('/water-points/elements')).body as { ref: string }[];
    expect(after.some((e) => e.ref === 'visits.readings')).toBe(false);
    expect(after.some((e) => e.ref === 'readings')).toBe(true); // the one in General stays
    expect(((await p.get('/water-points/data-groups')).body as { key: string }[]).some((g) => g.key === 'visits')).toBe(false);
  });

  it('scoped members only see and edit their subtree', async () => {
    const p = api(admin);
    const north = (await p.get('/water-points/entities?type=district&q=north')).body.items[0];
    await p.put('/water-points/members', { userId: (await h.userId(tenantId, 'ed@ih.org'))!, rootEntityIds: [north.id] });
    const mine = await api(ed).get('/water-points/entities?type=water_point');
    expect(mine.body.items.map((e: { code: string }) => e.code).sort()).toEqual(['W2', 'W3']); // W1 moved to South
    const w1 = (await p.get('/water-points/entities?q=one')).body.items[0];
    expect((await api(ed).get(`/water-points/entities/${w1.id}`)).status).toBe(404);
    expect((await api(ed).patch('/water-points/types/district', { key: 'district', name: 'X', plural: 'X' })).status).toBe(404);
    expect((await api(ed).put('/water-points/types/district', { key: 'district', name: 'X', plural: 'X' })).status).toBe(403); // members don't configure
    const members = (await p.get('/water-points/members')).body;
    expect(members).toContainEqual(expect.objectContaining({ email: 'ed@ih.org', rootEntities: [expect.objectContaining({ name: 'North' })] }));

    // Several entities at once: the member sees each subtree.
    const south = (await p.get('/water-points/entities?type=district&q=south')).body.items[0];
    await p.put('/water-points/members', { userId: (await h.userId(tenantId, 'ed@ih.org'))!, rootEntityIds: [north.id, south.id] });
    const both = await api(ed).get('/water-points/entities?type=water_point');
    expect(both.body.items.map((e: { code: string }) => e.code).sort()).toEqual(['W1', 'W2', 'W3']);
    expect((await api(ed).get(`/water-points/entities/${w1.id}`)).status).toBe(200);
    await p.put('/water-points/members', { userId: (await h.userId(tenantId, 'ed@ih.org'))!, rootEntityIds: [north.id] });
  });
});

describe('templates, queries and dashboards', () => {
  let key: string;
  it('installs the health surveillance template with seeded data', async () => {
    const res = await api(admin).post('', { name: 'Surveillance', template: 'health-surveillance' });
    expect(res.status).toBe(201);
    key = res.body.key;
    expect(res.body.counts).toMatchObject({ entities: 4 + 8 + 24, forms: 3, dashboards: 1 });
    const types = (await api(admin).get(`/${key}/types`)).body;
    expect(types.map((t: { key: string; count: number }) => [t.key, t.count])).toEqual([
      ['province', 4],
      ['district', 8],
      ['facility', 24],
    ]);
  });

  it('answers series, breakdown, kpi, geo and table queries', async () => {
    const q = (spec: unknown) => api(admin).post(`/${key}/query`, spec);
    const series = (await q({ kind: 'series', elements: ['ili_cases'], interval: 'week', range: { lastHours: 24 * 7 * 12 } })).body;
    expect(series.rows.length).toBeGreaterThanOrEqual(11);
    expect(series.freshness.status).toBe('fresh');
    const byDistrict = (await q({ kind: 'breakdown', element: 'ili_cases', by: 'parent', entityType: 'facility', range: { lastHours: 24 * 21 } })).body.rows;
    expect(byDistrict[0].label).toBe('Harbourside'); // the seeded ILI cluster
    const grouped = (await q({ kind: 'breakdown', elements: ['ili_cases', 'malaria_cases'], by: 'parent', entityType: 'facility', range: { lastHours: 24 * 21 }, limit: 3 })).body.rows;
    expect(grouped).toHaveLength(6); // 3 districts × 2 elements, element order kept
    expect(grouped.slice(0, 2).map((r: { key: string }) => r.key)).toEqual(['ili_cases', 'malaria_cases']);
    expect(grouped[0].label).toBe(grouped[1].label);
    const kpi = (await q({ kind: 'kpi', element: 'malaria_cases', range: { lastHours: 24 * 7 }, compare: true })).body.rows[0];
    expect(typeof kpi.value).toBe('number');
    expect(typeof kpi.previous).toBe('number');
    const count = (await q({ kind: 'kpi', entityType: 'facility', where: { attribute: 'facility_type', equals: 'Hospital' } })).body.rows[0].value;
    expect(count).toBe(4);
    const geo = (await q({ kind: 'geo', entityType: 'facility', element: 'ili_cases' })).body;
    expect(geo.features.features).toHaveLength(24);
    expect(typeof geo.features.features[0].properties.value).toBe('number');
    const table = (await q({ kind: 'table', entityType: 'facility', columns: ['name', 'parent', 'beds'], sort: 'beds', desc: true, limit: 3 })).body;
    expect(table.columns).toEqual(['name', 'parent', 'beds']);
    expect(table.rows[0].beds).toBeGreaterThanOrEqual(table.rows[1].beds);
    expect((await q({ kind: 'series', elements: ['nope'] })).body.rows).toEqual([]);
    expect((await q({ kind: 'breakdown', by: 'attribute' })).status).toBe(400);
  });

  it('lists dashboards and validates their widgets', async () => {
    const ds = (await api(admin).get(`/${key}/dashboards`)).body;
    expect(ds[0]).toMatchObject({ key: 'overview', isPublic: false, filters: { areaType: 'province', period: false } });
    expect(ds[0].widgets.length).toBeGreaterThan(5);
    const bad = await api(admin).post(`/${key}/dashboards`, { key: 'x', name: 'X', widgets: [{ id: 'a', type: 'kpi', query: { kind: 'kpi', aggregation: 'median' } }] });
    expect(bad.status).toBe(400);
    const badFilter = await api(admin).put(`/${key}/dashboards/overview`, { ...ds[0], filters: { areaType: 'planet', period: true } });
    expect(badFilter.status).toBe(400);
  });

  it('shows a widget only at the levels of the hierarchy it is set to', async () => {
    const p = api(admin);
    const ds = (await p.get(`/${key}/dashboards`)).body;
    const overview = ds.find((d: { key: string }) => d.key === 'overview');
    const widgets = overview.widgets.map((w: { id: string; options: object }) =>
      w.id === 'malaria' ? { ...w, options: { ...w.options, levels: ['district'] } } : w,
    );
    const saved = await p.put(`/${key}/dashboards/overview`, {
      ...overview,
      widgets,
      filters: { ...overview.filters, areaType: 'province', areaTypes: ['district'] },
    });
    expect(saved.status).toBe(200);
    expect((await p.put(`/${key}/dashboards/overview`, { ...overview, widgets, filters: { ...overview.filters, areaTypes: ['planet'] } })).status).toBe(400);
    const province = (await p.get(`/${key}/entities?type=province`)).body.items[0].id;
    const district = (await p.get(`/${key}/entities?type=district`)).body.items[0].id;
    const widget = (area?: string) => p.get(`/${key}/dashboards/overview/widgets/malaria${area ? `?area=${area}` : ''}`);
    expect((await widget()).status).toBe(404);
    expect((await widget(province)).status).toBe(404);
    expect((await widget(district)).status).toBe(200);
  });

  it('explores the hierarchy with overlays that roll up each place', async () => {
    const p = api(admin);
    const top = (await p.get(`/${key}/explore`)).body;
    expect(top).toMatchObject({ entity: null, ancestors: [], childLevel: 'Provinces', self: null });
    expect(top.children.features).toHaveLength(4);
    expect(top.children.features[0].geometry.type).toBe('MultiPolygon');
    expect(top.bounds).toHaveLength(4);

    const overlays = (await p.get(`/${key}/overlays`)).body;
    expect(overlays.map((o: { key: string }) => o.key)).toContain('ili_4w');
    expect(overlays.find((o: { key: string }) => o.key === 'ili_4w')).toMatchObject({ group: 'Disease surveillance', elementName: 'Influenza-like illness', palette: 'heat' });

    // Province values roll up their facilities' reports; the sum over provinces is the whole project.
    const provinces = (await p.get(`/${key}/overlays/ili_4w/values`)).body;
    const total = provinces.features.features.reduce((s: number, f: { properties: { value: number } }) => s + f.properties.value, 0);
    const kpi = (await p.post(`/${key}/query`, { kind: 'kpi', element: 'ili_cases', range: { lastHours: 24 * 28 } })).body.rows[0].value;
    expect(total).toBe(kpi);
    expect(provinces.max).toBeGreaterThanOrEqual(provinces.min);

    const central = top.children.features.find((f: { properties: { name: string } }) => f.properties.name === 'Central');
    const inCentral = (await p.get(`/${key}/explore?entity=${central.id}`)).body;
    expect(inCentral).toMatchObject({ entity: { name: 'Central', type: { key: 'province' } }, childLevel: 'Districts' });
    expect(inCentral.children.features.map((f: { properties: { name: string } }) => f.properties.name)).toEqual(['Harbourside', 'Highlands']);
    expect(inCentral.self.geometry.type).toBe('MultiPolygon');
    const harbour = inCentral.children.features[0];
    expect((await p.get(`/${key}/explore?entity=${harbour.id}`)).body.ancestors.map((a: { name: string }) => a.name)).toEqual(['Central']);

    // Overlays with a level show those places under the selection.
    const facilities = (await p.get(`/${key}/overlays/ili_facilities/values?entity=${central.id}`)).body.features.features;
    expect(facilities).toHaveLength(6);
    expect(facilities[0].geometry.type).toBe('Point');

    const hits = (await p.get(`/${key}/search?q=harbour`)).body;
    expect(hits[0]).toMatchObject({ name: 'Harbourside', path: 'Central' });
    const tops = (await p.get(`/${key}/places`)).body;
    expect(tops.map((n: { name: string }) => n.name)).toEqual(['Central', 'Eastern Islands', 'Northern', 'Western']);
    expect((await p.get(`/${key}/places?parent=${central.id}`)).body).toEqual([
      expect.objectContaining({ name: 'Harbourside', childCount: 3, hasChildren: true }),
      expect.objectContaining({ name: 'Highlands', childCount: 3 }),
    ]);

    // Scoped members start at their own place and can't leave it.
    await p.put(`/${key}/members`, { userId: await h.userId(tenantId, 'ed@ih.org'), rootEntityIds: [central.id] });
    expect((await api(ed).get(`/${key}/explore`)).body.entity.name).toBe('Central');
    expect((await api(ed).get(`/${key}/places`)).body.map((n: { name: string }) => n.name)).toEqual(['Central']);
    const other = top.children.features.find((f: { properties: { name: string } }) => f.properties.name === 'Northern');
    expect((await api(ed).get(`/${key}/explore?entity=${other.id}`)).status).toBe(404);
    expect((await api(ed).get(`/${key}/search?q=waimoana`)).body).toEqual([]);
    expect((await api(ed).post(`/${key}/overlays`, { key: 'x', name: 'X', element: 'ili_cases' })).status).toBe(403);
  });

  it('hides dashboards, widgets and overlays outside a member’s permission groups', async () => {
    const p = api(admin);
    const make = async (name: string, parent?: string) => {
      const body = (await p.post(`/${key}/permission-groups`, { name, parent: parent ?? null })).body;
      perm[name] = body.find((g: { name: string }) => g.name === name).id;
      return body;
    };
    await make('Admin');
    await make('Staff', perm.Admin);
    const tree = await make('Guest', perm.Staff);
    const builtIn = (kind: string) => tree.find((g: { kind: string }) => g.kind === kind);
    // Every project starts with its own admin and public permissions, first and built in.
    expect(tree.map((g: { name: string; depth: number }) => [g.name.replace(/^.* Admin$/, 'Project Admin').replace(/^.* Public$/, 'Project Public'), g.depth])).toEqual([
      ['Project Admin', 0],
      ['Project Public', 0],
      ['Admin', 0],
      ['Staff', 1],
      ['Guest', 2],
    ]);
    expect(tree[0]).toMatchObject({ system: true, kind: 'admin' });
    expect((await p.del(`/${key}/permission-groups/${builtIn('admin').id}`)).status).toBe(409); // built in
    expect((await p.del(`/${key}/permission-groups/${builtIn('public').id}`)).status).toBe(409);
    expect((await p.put(`/${key}/permission-groups/${builtIn('admin').id}`, { name: 'Admins', parent: perm.Staff })).status).toBe(400); // stays at the top
    expect((await p.post(`/${key}/permission-groups`, { name: 'Under public', parent: builtIn('public').id })).status).toBe(400); // public has no children
    expect((await p.post(`/${key}/permission-groups`, { name: 'staff', parent: perm.Admin })).status).toBe(409); // names are unique
    expect((await p.put(`/${key}/permission-groups/${perm.Admin}`, { name: 'Admin', parent: perm.Guest })).status).toBe(400); // no cycles

    const overview = (await p.get(`/${key}/dashboards`)).body[0];
    const widgets = overview.widgets.map((w: { id: string }) => (w.id === 'malaria' ? { ...w, permissionGroup: perm.Admin } : w));
    expect((await p.post(`/${key}/dashboards`, { key: 'bad', name: 'Bad', permissionGroup: '019e0000-0000-7000-8000-000000000000' })).status).toBe(400);
    await p.post(`/${key}/dashboards`, { key: 'staff_only', name: 'Staff only', permissionGroup: perm.Staff, widgets: [overview.widgets[1]] });
    await p.put(`/${key}/dashboards/overview`, { ...overview, widgets });
    await p.post(`/${key}/overlays`, { key: 'secret', name: 'Secret', element: 'deaths', permissionGroup: perm.Admin });

    // ed: a viewer (scoped to Central) without a group sees only unrestricted visuals.
    const ed_ = api(ed);
    const seen = async () => (await ed_.get(`/${key}/dashboards`)).body.map((d: { key: string; widgets: { id: string }[] }) => [d.key, d.widgets.some((w) => w.id === 'malaria')]);
    expect(await seen()).toEqual([['overview', false]]);
    expect((await ed_.get(`/${key}/dashboards/overview/widgets/malaria`)).status).toBe(404);
    expect((await ed_.get(`/${key}/dashboards/overview/widgets/ili`)).status).toBe(200);
    expect((await ed_.get(`/${key}/overlays`)).body.some((o: { key: string }) => o.key === 'secret')).toBe(false);
    expect((await ed_.get(`/${key}/overlays/secret/values`)).status).toBe(404);
    expect((await ed_.post(`/${key}/query`, { kind: 'kpi', element: 'malaria_cases' })).status).toBe(403); // no ad-hoc queries for viewers

    // In "staff": the staff dashboard and everything below; still not admin's widget.
    const userId = await h.userId(tenantId, 'ed@ih.org');
    expect((await p.put(`/${key}/members`, { userId, permissionGroups: ['019e0000-0000-7000-8000-000000000000'] })).status).toBe(400);
    const members = (await p.put(`/${key}/members`, { userId, permissionGroups: [perm.Staff] })).body;
    expect(members.find((m: { email: string }) => m.email === 'ed@ih.org').permissionGroups).toEqual([perm.Staff]);
    expect(await seen()).toEqual([['overview', false], ['staff_only', false]]);
    // In "admin": everything.
    await p.put(`/${key}/members`, { userId, permissionGroups: [perm.Admin] });
    expect(await seen()).toEqual([['overview', true], ['staff_only', false]]);
    expect((await ed_.get(`/${key}/overlays/secret/values`)).status).toBe(200);

    expect((await p.del(`/${key}/permission-groups/${perm.Staff}`)).status).toBe(409); // still used
    expect((await p.get(`/${key}/permission-groups`)).body.find((g: { id: string }) => g.id === perm.Admin).memberCount).toBe(1);
  });

  it('validates overlays', async () => {
    const p = api(admin);
    expect((await p.post(`/${key}/overlays`, { key: 'bad', name: 'Bad', element: 'nope' })).status).toBe(400);
    expect((await p.post(`/${key}/overlays`, { key: 'bad', name: 'Bad', element: 'deaths', level: 'planet' })).status).toBe(400);
    const saved = (await p.post(`/${key}/overlays`, { key: 'deaths_x', name: 'Deaths', element: 'deaths', thresholds: [5, 1] })).body;
    expect(saved.find((o: { key: string }) => o.key === 'deaths_x').thresholds).toEqual([1, 5]);
    expect((await p.post(`/${key}/overlays`, { key: 'deaths_x', name: 'Again', element: 'deaths' })).status).toBe(409);
    expect((await p.del(`/${key}/overlays/deaths_x`)).body.some((o: { key: string }) => o.key === 'deaths_x')).toBe(false);
  });
});

describe('forms', () => {
  let key: string;
  let facility: { id: string; name: string };
  beforeAll(async () => {
    key = (await api(admin).get('')).body.find((p: { template: string }) => p.template === 'health-surveillance').key;
    facility = (await api(admin).get(`/${key}/entities?type=facility&pageSize=5`)).body.items[0];
  });

  it('validates answers with the shared runtime, writes bound observations, and is idempotent', async () => {
    const forms = (await api(admin).get(`/${key}/forms`)).body;
    const weekly = forms.find((f: { key: string }) => f.key === 'weekly_report');
    expect(weekly).toMatchObject({ currentVersion: 1, hasUnpublishedChanges: false, subjectType: { key: 'facility' } });

    const id = uuidv7();
    const base = { id, version: 1, entityId: facility.id, collectedAt: '2026-09-30T10:00:00Z' };
    const invalid = await api(admin).post(`/${key}/forms/weekly_report/submissions`, { ...base, answers: { malaria: 3, ili: 1, diarrhoea: 0, measles: 0, deaths: 0, outbreak: true } });
    expect(invalid.status).toBe(422);
    expect(invalid.body.errors).toEqual([{ path: 'outbreak_details', message: 'This is a required field' }]);

    const ok = await api(admin).post(`/${key}/forms/weekly_report/submissions`, {
      ...base,
      answers: { malaria: 3, ili: 99, diarrhoea: 0, measles: 1, deaths: 0, outbreak: false, outbreak_details: 'dropped', stockout: 0 },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.answers).not.toHaveProperty('outbreak_details');
    expect((await api(admin).post(`/${key}/forms/weekly_report/submissions`, { ...base, answers: {} })).status).toBe(201); // retry: no-op

    const series = (await api(admin).get(`/${key}/entities/${facility.id}/series?element=ili_cases`)).body;
    expect(series).toContainEqual({ at: '2026-09-28T00:00:00.000Z', value: 99, source: 'form' }); // aligned to the epi week
    const subs = (await api(admin).get(`/${key}/forms/weekly_report/submissions`)).body;
    expect(subs).toMatchObject({ total: 1, items: [{ entity: { name: facility.name }, submittedBy: 'admin' }] });
  });

  it('binds answers to entity attributes and versions published definitions', async () => {
    const res = await api(admin).post(`/${key}/forms/facility_profile/submissions`, {
      id: uuidv7(),
      version: 1,
      entityId: facility.id,
      collectedAt: new Date().toISOString(),
      answers: { in_charge: 'Dr. Test Person', beds: 42, phone: 'call me' },
    });
    expect(res.body.errors).toEqual([{ path: 'phone', message: 'Enter a phone number' }]);
    await api(admin).post(`/${key}/forms/facility_profile/submissions`, {
      id: uuidv7(),
      version: 1,
      entityId: facility.id,
      collectedAt: new Date().toISOString(),
      answers: { in_charge: 'Dr. Test Person', beds: 42 },
    });
    const e = (await api(admin).get(`/${key}/entities/${facility.id}`)).body;
    expect(e.attributes).toMatchObject({ in_charge: 'Dr. Test Person', beds: 42 });
    expect(e.history[0]).toMatchObject({ source: 'form' });

    const form = (await api(admin).get(`/${key}/forms`)).body.find((f: { key: string }) => f.key === 'facility_profile');
    const draft = structuredClone(form.draft);
    draft.sections[0].questions.push({ key: 'notes', type: 'text', label: 'Notes', relevant: '${missing} = 1' });
    expect((await api(admin).put(`/${key}/forms/facility_profile`, { key: 'facility_profile', name: form.name, subjectType: 'facility', definition: draft })).status).toBe(200);
    const publish = await api(admin).post(`/${key}/forms/facility_profile/publish`);
    expect(publish.status).toBe(400);
    expect(publish.body.detail).toContain('unknown question ${missing}');
  });

  it('organises forms into a menu of groups and sub-groups, managed by admins', async () => {
    const g = (who: string) => ({
      get: () => h.call(who, 'GET', `/tenants/${tenantId}/form-groups`),
      post: (body: unknown) => h.call(who, 'POST', `/tenants/${tenantId}/form-groups`, body),
      put: (id: string, body: unknown) => h.call(who, 'PUT', `/tenants/${tenantId}/form-groups/${id}`, body),
      del: (id: string) => h.call(who, 'DELETE', `/tenants/${tenantId}/form-groups/${id}`),
    });
    expect((await g(vi).post({ name: 'Nope' })).status).toBe(403);
    const top = (await g(admin).post({ name: 'Surveillance', icon: 'activity' })).body[0];
    const sub = (await g(admin).post({ name: 'Weekly returns', parentId: top.id })).body.find((x: { name: string }) => x.name === 'Weekly returns');
    expect(sub.parentId).toBe(top.id);
    expect((await g(admin).put(top.id, { name: 'Surveillance', parentId: sub.id })).status).toBe(400); // no cycles
    expect((await g(admin).del(top.id)).status).toBe(409); // has a sub-group

    const form = (await api(admin).get(`/${key}/forms`)).body.find((f: { key: string }) => f.key === 'weekly_report');
    const save = (settings: unknown, groupId: string | null = sub.id) =>
      api(admin).put(`/${key}/forms/weekly_report`, { key: form.key, name: form.name, subjectType: 'facility', definition: form.draft, groupId, settings });
    expect((await save({ fillGroup: '019e0000-0000-7000-8000-000000000000' })).status).toBe(400);
    const saved = (await save({ fillGroup: perm.Staff })).body.find((f: { key: string }) => f.key === 'weekly_report');
    expect(saved).toMatchObject({ groupId: sub.id, settings: { fillGroup: perm.Staff, workflow: { enabled: false } }, canFill: true });
    expect((await g(admin).get()).body.find((x: { id: string }) => x.id === sub.id).formCount).toBe(1);

    // ed is a viewer in "admin", above "staff": the form shows up in their menu.
    const menu = (await h.call(ed, 'GET', `/tenants/${tenantId}/forms/menu`)).body;
    expect(menu.groups.map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(['Surveillance', 'Weekly returns']));
    expect(menu.forms.find((f: { key: string }) => f.key === 'weekly_report')).toMatchObject({ groupId: sub.id, project: { key }, layout: 'steps', hasWorkflow: false });

    // A form belongs to a permission group: members in that group, or above it, can see it and its submissions.
    const edId = await h.userId(tenantId, 'ed@ih.org');
    const place = (...permissionGroups: (string | undefined)[]) => api(admin).put(`/${key}/members`, { userId: edId, permissionGroups });
    const visible = async () => (await api(ed).get(`/${key}/forms`)).body.some((f: { key: string }) => f.key === 'weekly_report');
    expect((await save({ fillGroup: perm.Staff })).status).toBe(200);
    await place(perm.Guest); // below "staff"
    expect(await visible()).toBe(false);
    expect((await api(ed).get(`/${key}/forms/weekly_report/submissions`)).status).toBe(404);
    await place(perm.Staff);
    expect(await visible()).toBe(true);
    await place(perm.Guest, perm.Staff); // holding several: any one is enough
    expect(await visible()).toBe(true);
    await place(perm.Admin); // above "staff"
    expect(await visible()).toBe(true);
    expect((await api(ed).get(`/${key}/forms/weekly_report/submissions`)).status).toBe(200);
    expect((await save({})).status).toBe(200); // no group: everyone in the project
  });

  it('routes submissions through multi-stage approvals before their data takes effect', async () => {
    const form = (await api(admin).get(`/${key}/forms`)).body.find((f: { key: string }) => f.key === 'weekly_report');
    const settings = (stages: unknown[]) => ({ workflow: { enabled: true, stages } });
    const put = (stages: unknown[]) =>
      api(admin).put(`/${key}/forms/weekly_report`, { key: form.key, name: form.name, subjectType: 'facility', definition: form.draft, groupId: form.groupId, settings: settings(stages) });
    expect((await put([{ key: 'x', name: 'X', approvers: { role: null, group: null, users: [] } }])).status).toBe(400); // nobody can approve
    expect((await put([{ key: 'x', name: 'X', condition: '${nope} > 1' }])).status).toBe(400);
    expect(
      (
        await put([
          { key: 'district', name: 'District review', approvers: { group: perm.Admin } },
          { key: 'national', name: 'National sign-off', approvers: { role: 'manager' }, condition: '${deaths} > 0' },
        ])
      ).status,
    ).toBe(200);

    const mine = (await api(ed).get(`/${key}/entities?type=facility&pageSize=5`)).body.items[0];
    const answers = { malaria: 1, ili: 777, diarrhoea: 0, measles: 0, deaths: 0, outbreak: false, stockout: 0 };
    const sub = await api(ed).post(`/${key}/forms/weekly_report/submissions`, { id: uuidv7(), version: 1, entityId: mine.id, collectedAt: '2026-08-05T10:00:00Z', answers });
    expect(sub.status).toBe(201);
    expect(sub.body).toMatchObject({ status: 'in_review', stage: 0, stageName: 'District review', stages: ['District review'], canReview: false }); // no deaths: the national stage doesn't apply
    const id = sub.body.id;
    const series = async () => (await api(admin).get(`/${key}/entities/${mine.id}/series?element=ili_cases`)).body.map((x: { value: number }) => x.value);
    expect(await series()).not.toContain(777); // nothing takes effect while in review

    const review = (who: string, body: unknown) => api(who).post(`/${key}/submissions/${id}/review`, body);
    expect((await review(ed, { decision: 'approve' })).status).toBe(403); // not their own
    const inbox = (await h.call(admin, 'GET', `/tenants/${tenantId}/forms/inbox`)).body;
    expect(inbox.toReview.find((s: { id: string }) => s.id === id)).toMatchObject({ canReview: true, project: { key } });
    expect((await h.call(ed, 'GET', `/tenants/${tenantId}/forms/inbox`)).body.mine.map((s: { id: string }) => s.id)).toContain(id);

    expect((await review(admin, { decision: 'return' })).status).toBe(400); // needs a comment
    expect((await review(admin, { decision: 'return', comment: 'Check deaths' })).body).toMatchObject({ status: 'returned', canResubmit: false });
    expect((await review(admin, { decision: 'approve' })).status).toBe(409);
    const again = await api(ed).put(`/${key}/submissions/${id}`, { answers: { ...answers, deaths: 2 }, comment: 'Fixed' });
    expect(again.body).toMatchObject({ status: 'in_review', stage: 0, stages: ['District review', 'National sign-off'] });

    // Deaths > 0 now, so the national stage applies after the district one.
    expect((await review(admin, { decision: 'approve' })).body).toMatchObject({ status: 'in_review', stage: 1, stageName: 'National sign-off' });
    const done = (await review(admin, { decision: 'approve', comment: 'OK' })).body;
    expect(done).toMatchObject({ status: 'approved', stage: null });
    expect(done.decidedAt).not.toBeNull();
    expect(done.reviews.map((r: { decision: string }) => r.decision)).toEqual(['submitted', 'returned', 'resubmitted', 'approved', 'approved']);
    expect(await series()).toContain(777);

    // Without deaths the national stage is skipped; rejection is final.
    const quiet = await api(ed).post(`/${key}/forms/weekly_report/submissions`, { id: uuidv7(), version: 1, entityId: mine.id, collectedAt: '2026-08-12T10:00:00Z', answers });
    expect((await api(admin).post(`/${key}/submissions/${quiet.body.id}/review`, { decision: 'approve' })).body.status).toBe('approved');
    const third = await api(ed).post(`/${key}/forms/weekly_report/submissions`, { id: uuidv7(), version: 1, entityId: mine.id, collectedAt: '2026-08-19T10:00:00Z', answers });
    expect((await api(admin).post(`/${key}/submissions/${third.body.id}/review`, { decision: 'reject', comment: 'Duplicate' })).body.status).toBe('rejected');
    expect((await api(admin).get(`/${key}/forms/weekly_report/submissions?status=in_review`)).body.total).toBe(0);
  });
});

describe('jobs and public projects', () => {
  let key: string;
  const opensky = {
    time: 1790939041,
    states: [
      ['4ca9cc', 'RYR4QK  ', 'Ireland', 1790939041, 1790939041, -0.2, 51.47, 3048.0, false, 180.2, 270, 0, null, 3100, '2201'],
      ['406a3b', 'BAW23   ', 'United Kingdom', 1790939041, 1790939041, -0.45, 51.47, null, true, 0, 90, null, null, null, '7000'],
    ],
  };

  it('installs the flight tracker, runs its job and serves the public dashboard', async () => {
    const res = await api(admin).post('', { name: 'Flight tracker', template: 'flight-tracker', visibility: 'public' });
    key = res.body.key;
    const jobs = (await api(admin).get(`/${key}/jobs`)).body;
    expect(jobs[0]).toMatchObject({ key: 'opensky_positions', schedule: '*/5 * * * *', freshness: { status: 'unknown' } });
    expect(jobs[0].nextRunAt).not.toBeNull();

    expect((await api(vi).post(`/${key}/jobs/opensky_positions/run`)).status).toBe(403); // viewers can't run jobs
    const run = await api(admin).post(`/${key}/jobs/opensky_positions/run`);
    expect(run.status).toBe(202);
    expect((await api(admin).post(`/${key}/jobs/opensky_positions/run`)).status).toBe(409); // already queued

    const cellDb = await h.cells.forTenant(tenantId);
    const fetch = (async () => new Response(JSON.stringify(opensky), { headers: { 'content-type': 'application/json' } })) as typeof globalThis.fetch;
    await drainQueue(cellDb, { worker: 'test', fetch });
    const detail = (await api(admin).get(`/${key}/runs/${run.body.id}`)).body;
    expect(detail).toMatchObject({ status: 'succeeded', stats: { rows_fetched: 2, entities_created: 4 } });
    expect(detail.logs.map((l: { step: string | null }) => l.step)).toContain('snapshot');
    expect((await api(admin).get(`/${key}/jobs`)).body[0].freshness.status).toBe('fresh');
    expect((await api(admin).get(`/${key}/datasets`)).body[0]).toMatchObject({ key: 'airborne_now', rowCount: 2 });

    const tenant = (await h.admin('GET', `/platform/tenants/${tenantId}`)).body;
    const pub = await h.call(null, 'GET', `/public/projects/${tenant.slug}/${key}`);
    expect(pub.status).toBe(200);
    expect(pub.body.dashboards[0]).toMatchObject({ key: 'live', isPublic: true });
    // Live layers only show aircraft reported recently; the fixture's timestamps are from the job's run.
    const map = await h.call(null, 'GET', `/public/projects/${tenant.slug}/${key}/dashboards/live/widgets/countries`);
    expect(map.status).toBe(200);
    expect(map.body.freshness.status).toBe('fresh');
    expect((await h.call(null, 'GET', `/public/projects/${tenant.slug}/${key}/dashboards/live/widgets/nope`)).status).toBe(404);
  });

  it('applies dashboard parameters to public widgets, only within the declared filters', async () => {
    const tenant = (await h.admin('GET', `/platform/tenants/${tenantId}`)).body;
    const pub = (path: string) => h.call(null, 'GET', `/public/projects/${tenant.slug}/${key}/dashboards/live${path}`);
    const live = (await api(admin).get(`/${key}/dashboards`)).body.find((d: { key: string }) => d.key === 'live');
    expect((await pub('/areas')).body).toEqual([]); // no area filter yet
    const ireland = (await api(admin).get(`/${key}/entities?type=country&q=Ireland`)).body.items[0];
    expect((await pub(`/widgets/tracked?area=${ireland.id}`)).status).toBe(200); // ignored without a filter

    await api(admin).put(`/${key}/dashboards/live`, { ...live, filters: { areaType: 'country', period: true } });
    const areas = (await pub('/areas')).body;
    expect(areas.map((a: { name: string }) => a.name)).toEqual(expect.arrayContaining(['Ireland', 'United Kingdom']));
    // A year-long window keeps the fixture's fixed timestamps in range.
    const all = (await pub('/widgets/tracked?hours=8760')).body.rows[0].value;
    const ie = (await pub(`/widgets/tracked?area=${ireland.id}&hours=8760`)).body.rows[0].value;
    expect(all).toBe(2);
    expect(ie).toBe(1);
    expect((await pub(`/widgets/tracked?area=${uuidv7()}`)).status).toBe(404); // not an area of this dashboard
    expect((await pub('/widgets/tracked?hours=0')).status).toBe(400);
    // The explorer's selected place scopes any widget (it must be a place in this project).
    expect((await pub(`/widgets/tracked?entity=${ireland.id}&hours=8760`)).body.rows[0].value).toBe(1);
    expect((await pub(`/widgets/tracked?entity=${uuidv7()}`)).status).toBe(404);
  });

  it('serves the explorer anonymously with public overlays only', async () => {
    const tenant = (await h.admin('GET', `/platform/tenants/${tenantId}`)).body;
    const pub = (path: string) => h.call(null, 'GET', `/public/projects/${tenant.slug}/${key}${path}`);
    await api(admin).post(`/${key}/overlays`, { key: 'altitude', name: 'Altitude', element: 'altitude_m', aggregation: 'avg', level: 'aircraft', hours: 8760, isPublic: true });
    await api(admin).post(`/${key}/overlays`, { key: 'internal', name: 'Internal', element: 'altitude_m' });
    expect((await pub('/overlays')).body.map((o: { key: string }) => o.key)).toEqual(['altitude']);
    expect((await pub('/overlays/internal/values')).status).toBe(404);
    const values = (await pub('/overlays/altitude/values')).body;
    expect(values.features.features.length).toBeGreaterThan(0);
    expect((await pub('/explore')).status).toBe(200);
    expect((await pub('/search?q=ireland')).body[0]).toMatchObject({ name: 'Ireland' });
    expect((await h.call(null, 'GET', `/public/projects/${tenant.slug}/water-points/explore`)).status).toBe(404);
  });

  it('keeps private projects private', async () => {
    const tenant = (await h.admin('GET', `/platform/tenants/${tenantId}`)).body;
    expect((await h.call(null, 'GET', `/public/projects/${tenant.slug}/water-points`)).status).toBe(404);
    expect((await h.call(null, 'POST', `/tenants/${tenantId}/projects/${key}/query`, { kind: 'kpi' })).status).toBe(401);
  });

  it('cancels queued runs and validates schedules', async () => {
    const run = (await api(admin).post(`/${key}/jobs/opensky_positions/run`)).body;
    const cancelled = await api(admin).post(`/${key}/runs/${run.id}/cancel`);
    expect(cancelled.body).toMatchObject({ status: 'cancelled' });
    const job = (await api(admin).get(`/${key}/jobs`)).body[0];
    const bad = await api(admin).put(`/${key}/jobs/opensky_positions`, { ...job, schedule: '61 * * * *' });
    expect(bad.status).toBe(400);
    const runs = (await api(admin).get(`/${key}/runs?status=cancelled`)).body;
    expect(runs.total).toBe(1);
  });

  it('re-runs a finished run as a new run of the same job', async () => {
    const first = (await api(admin).get(`/${key}/runs?status=cancelled`)).body.items[0];
    expect((await api(vi).post(`/${key}/runs/${first.id}/rerun`)).status).toBe(403);
    const again = await api(admin).post(`/${key}/runs/${first.id}/rerun`);
    expect(again.status).toBe(202);
    expect(again.body).toMatchObject({ status: 'queued', trigger: 'rerun', jobId: first.jobId });
    expect((await api(admin).post(`/${key}/runs/${again.body.id}/rerun`)).status).toBe(409); // still queued
    await api(admin).post(`/${key}/runs/${again.body.id}/cancel`);
  });

  it('runs jobs from webhooks, entity changes and sensors', async () => {
    const cellDb = await h.cells.forTenant(tenantId);
    await drainQueue(cellDb, { worker: 'test' });
    const load = { id: 'load', type: 'entity.upsert', entityType: 'country', code: 'iso', name: 'name' };
    const saved = (await api(admin).post(`/${key}/jobs`, { key: 'inbound', name: 'Inbound countries', steps: [load], triggers: { webhook: true } })).body;
    const inbound = saved.find((j: { key: string }) => j.key === 'inbound');
    expect(inbound.webhookPath).toMatch(new RegExp(`^/hooks/${tenantId}\\.`));
    // Viewers never see the secret URL.
    expect((await api(vi).get(`/${key}/jobs`)).body.find((j: { key: string }) => j.key === 'inbound').webhookPath).toBeNull();

    const hook = await h.call(null, 'POST', inbound.webhookPath, { rows: [{ iso: 'PG', name: 'Papua New Guinea' }] });
    expect(hook.status).toBe(202);
    expect((await h.call(null, 'POST', `/hooks/${tenantId}.not-the-secret-not-the-secret-not-the-secret`, [])).status).toBe(404);

    // A job listening for country changes runs after the webhook's run writes one, and after a manual edit.
    await api(admin).post(`/${key}/jobs`, { key: 'on_country', name: 'On country change', steps: [{ id: 'noop', type: 'filter', condition: 'true' }], triggers: { events: [{ event: 'entity.changed', ref: 'country' }] } });
    await drainQueue(cellDb, { worker: 'test' });
    expect((await api(admin).get(`/${key}/runs/${hook.body.runId}`)).body).toMatchObject({ status: 'succeeded', trigger: 'webhook', stats: { rows_received: 1, entities_created: 1 } });
    const onCountry = async () => (await api(admin).get(`/${key}/runs?pageSize=100`)).body.items.filter((r: { jobName: string }) => r.jobName === 'On country change');
    expect((await onCountry()).map((r: { trigger: string }) => r.trigger)).toEqual(['entity.changed']);
    await api(admin).post(`/${key}/entities`, { typeKey: 'country', code: 'SB', name: 'Solomon Islands' });
    expect((await onCountry()).length).toBe(2);

    // Sensors are scheduled for the worker; turning the webhook off revokes its URL.
    const withSensor = (await api(admin).put(`/${key}/jobs/inbound`, { ...inbound, triggers: { webhook: false }, sensor: { url: 'https://example.org/feed.json', everyMinutes: 15 } })).body;
    const updated = withSensor.find((j: { key: string }) => j.key === 'inbound');
    expect(updated).toMatchObject({ webhookPath: null, sensor: { everyMinutes: 15 }, sensorState: { cursor: null, lastError: null } });
    expect((await h.call(null, 'POST', inbound.webhookPath, [])).status).toBe(404);
    await drainQueue(cellDb, { worker: 'test' });
  });

  it('stores uploaded files and runs the jobs that parse them on upload', async () => {
    const upload = (who: string, text: string, name = 'countries.csv') =>
      h.app.inject({
        method: 'PUT',
        url: `/tenants/${tenantId}/projects/${key}/files/countries?name=${name}&type=text/csv`,
        headers: { authorization: `Bearer ${who}`, 'content-type': 'application/octet-stream' },
        payload: Buffer.from(text),
      });
    const job = {
      key: 'country_import',
      name: 'Country import',
      runOnUpload: true,
      steps: [
        { id: 'read', type: 'file.parse', file: 'countries' },
        { id: 'load', type: 'entity.upsert', entityType: 'country', code: 'iso', name: 'name' },
      ],
    };
    expect((await api(admin).post(`/${key}/jobs`, { ...job, key: 'no_file', steps: [job.steps[1]] })).status).toBe(400);
    expect((await api(admin).post(`/${key}/jobs`, job)).status).toBe(200);

    expect((await upload(vi, 'iso,name\nFJ,Fiji\n')).statusCode).toBe(403);
    const res = await upload(admin, 'iso;name\nFJ;Fiji\nWS;Samoa\n');
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.file).toMatchObject({ key: 'countries', name: 'countries.csv', size: 26, versions: 1, jobs: [{ key: 'country_import', runOnUpload: true }] });
    expect(body.runs).toEqual([{ id: expect.any(String), job: 'country_import' }]);

    await drainQueue(await h.cells.forTenant(tenantId), { worker: 'test' });
    const run = (await api(admin).get(`/${key}/runs/${body.runs[0].id}`)).body;
    expect(run).toMatchObject({ status: 'succeeded', trigger: 'upload', stats: { rows_parsed: 2, entities_created: 2 } });

    await upload(admin, 'iso,name\nTO,Tonga\n', 'v2.csv');
    const files = (await api(vi).get(`/${key}/files`)).body;
    expect(files).toMatchObject([{ key: 'countries', name: 'v2.csv', versions: 2 }]);
    expect((await api(admin).del(`/${key}/files/countries`)).body).toEqual([]);
    await drainQueue(await h.cells.forTenant(tenantId), { worker: 'test' }); // the v2 run now fails: no file
  });
});
