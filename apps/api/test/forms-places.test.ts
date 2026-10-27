import { uuidv7 } from '@grids/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// Questions that reach into the project: places (with related-to limits), pictures and codes.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let ed: string;
let key: string;
let districts: { id: string; name: string; code: string }[];
let inFirst: { id: string; name: string };
let inOther: { id: string; name: string };

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
  tenantId = await h.activeTenant('Island Places', 'business');
  admin = await h.join(tenantId, 'admin@ip.org', { role: 'org_admin' });
  ed = await h.join(tenantId, 'ed@ip.org');
  key = (await h.call(admin, 'POST', `/tenants/${tenantId}/projects`, { name: 'Surveillance', template: 'health-surveillance' })).body.key;
  await api(admin).put(`/${key}/members`, { userId: await h.userId(tenantId, 'ed@ip.org') });
  districts = (await api(admin).get(`/${key}/entities?type=district&pageSize=10`)).body.items;
  const kids = async (d: { id: string }) => (await api(admin).get(`/${key}/entities?type=facility&parentId=${d.id}&pageSize=20`)).body.items as { id: string; name: string }[];
  inFirst = (await kids(districts[0]!))[0]!;
  inOther = (await Promise.all(districts.slice(1).map(kids))).flat()[0]!;
}, 180_000);
afterAll(async () => h?.stop());

const definition = {
  title: 'Visit',
  sections: [
    {
      key: 'main',
      title: '',
      questions: [
        { key: 'district', type: 'entity', label: 'District', entityType: 'district', required: true },
        { key: 'facility', type: 'entity', label: 'Facility', entityType: 'facility', filter: { of: 'district', relation: 'children' }, required: true, primary: true },
        { key: 'photo', type: 'image', label: 'Photo' },
        { key: 'tag', type: 'qr', label: 'Asset tag' },
        { key: 'beds', type: 'integer', label: 'Beds', bind: { attribute: 'beds', entity: 'facility' } },
      ],
    },
  ],
};

const send = (who: string, answers: object) => api(who).post(`/${key}/forms/visit/submissions`, { id: uuidv7(), version: 1, entityId: null, collectedAt: '2026-08-05T10:00:00Z', answers });
const upload = (who: string, body: Buffer, type = 'image/png') =>
  h.app.inject({ method: 'PUT', url: `/tenants/${tenantId}/projects/${key}/forms/visit/attachments?name=p.png&type=${encodeURIComponent(type)}`, headers: { authorization: `Bearer ${who}`, 'content-type': 'application/octet-stream' }, payload: body });

describe('place, picture and code questions', () => {
  it('saves a form with a main place, and refuses nonsense', async () => {
    const form = { key: 'visit', name: 'Visit', subjectType: 'facility', definition };
    const bad = structuredClone(form);
    (bad.definition.sections[0]!.questions[1] as { filter: { of: string } }).filter.of = 'nope';
    expect((await api(admin).post(`/${key}/forms`, bad)).status).toBe(200); // a draft may have problems…
    expect((await api(admin).post(`/${key}/forms/visit/publish`)).status).toBe(400); // …but cannot be published
    const wrongType = structuredClone(form);
    (wrongType.definition.sections[0]!.questions[1] as { entityType: string }).entityType = 'district';
    expect((await api(admin).put(`/${key}/forms/visit`, wrongType)).status).toBe(400); // the main place must be the form's own type
    expect((await api(admin).put(`/${key}/forms/visit`, form)).status).toBe(200);
    expect((await api(admin).post(`/${key}/forms/visit/publish`)).status).toBe(200);
  });

  it('takes the submission’s place from the main-place question and checks how places relate', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = await upload(ed, png);
    expect(up.statusCode).toBe(201);
    const photo = up.json().id as string;
    expect((await upload(ed, Buffer.from('not a picture'), 'text/plain')).statusCode).toBe(400);

    // A facility from a different district than the one chosen is refused.
    const wrong = await send(ed, { district: districts[0]!.id, facility: inOther.id, photo });
    expect(wrong.status).toBe(422);
    expect(JSON.stringify(wrong.body)).toContain('facility');

    // A picture that was never uploaded is refused.
    expect((await send(ed, { district: districts[0]!.id, facility: inFirst.id, photo: uuidv7() })).status).toBe(422);

    const ok = await send(ed, { district: districts[0]!.id, facility: inFirst.id, photo, tag: 'ASSET-0042', beds: 321 });
    expect(ok.status).toBe(201);
    expect(ok.body.entity).toMatchObject({ id: inFirst.id }); // no choice above the form: the question was the subject
    expect(ok.body.answers).toMatchObject({ tag: 'ASSET-0042', facility: inFirst.id });

    // The picture comes back to people who can see the form.
    const pic = await h.app.inject({ method: 'GET', url: `/tenants/${tenantId}/projects/${key}/attachments/${photo}`, headers: { authorization: `Bearer ${ed}` } });
    expect(pic.statusCode).toBe(200);
    expect(pic.headers['content-type']).toBe('image/png');
    // A bound answer wrote the attribute on the chosen place.
    const detail = (await api(admin).get(`/${key}/entities/${inFirst.id}`)).body;
    expect(detail.attributes.beds).toBe(321);
  });

  it('offers only related places when asked', async () => {
    const kids = (await api(ed).get(`/${key}/entities?type=facility&parentId=${districts[0]!.id}&pageSize=50`)).body.items.map((x: { id: string }) => x.id);
    expect(kids).toContain(inFirst.id);
    expect(kids).not.toContain(inOther.id);
    const up = (await api(ed).get(`/${key}/entities?type=district&parentOfId=${inFirst.id}&pageSize=5`)).body.items.map((x: { id: string }) => x.id);
    expect(up).toEqual([districts[0]!.id]);
    const above = (await api(ed).get(`/${key}/entities?aboveId=${inFirst.id}&pageSize=10`)).body.items.length;
    expect(above).toBeGreaterThanOrEqual(2); // the district and its province
  });
});
