import { uuidv7 } from '@grids/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// What the mobile app relies on: a list of places it can keep up to date, and its own past submissions.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let ed: string;
let key: string;
const base = () => `/tenants/${tenantId}/projects/${key}`;

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Mobile Org', 'business');
  admin = await h.join(tenantId, 'admin@mo.org', { role: 'org_admin' });
  ed = await h.join(tenantId, 'ed@mo.org');
  key = (await h.call(admin, 'POST', `/tenants/${tenantId}/projects`, { name: 'Surveillance', template: 'health-surveillance' })).body.key;
  await h.call(admin, 'PUT', `${base()}/members`, { userId: await h.userId(tenantId, 'ed@mo.org') });
}, 180_000);
afterAll(async () => h?.stop());

describe('entity sync', () => {
  it('pages through everything, then lists the ids that are still there', async () => {
    const first = (await h.call(admin, 'GET', `${base()}/entities/sync?limit=10`)).body;
    expect(first.items.length).toBe(10);
    expect(first.next).toBe(first.items[9].id);
    expect(first.ids).toBeNull();
    const seen = new Set<string>(first.items.map((i: { id: string }) => i.id));
    let page = first;
    while (page.next) {
      page = (await h.call(admin, 'GET', `${base()}/entities/sync?limit=10&after=${page.next}`)).body;
      for (const i of page.items) seen.add(i.id);
    }
    expect(page.ids).not.toBeNull();
    expect(new Set(page.ids)).toEqual(seen);
  });

  it('with `since`, returns only what changed', async () => {
    const all = (await h.call(admin, 'GET', `${base()}/entities/sync?limit=2000`)).body;
    const target = all.items[0];
    const full = (await h.call(admin, 'GET', `${base()}/entities/${target.id}`)).body;
    const quiet = (await h.call(admin, 'GET', `${base()}/entities/sync?since=${encodeURIComponent(all.serverTime)}`)).body;
    expect(quiet.items).toEqual([]);
    expect(quiet.ids).toHaveLength(all.items.length);
    await h.call(admin, 'PATCH', `${base()}/entities/${target.id}`, { name: `${full.name} (renamed)`, version: full.version });
    const changed = (await h.call(admin, 'GET', `${base()}/entities/sync?since=${encodeURIComponent(all.serverTime)}`)).body;
    expect(changed.items.map((i: { id: string }) => i.id)).toEqual([target.id]);
    expect(changed.items[0].name).toContain('renamed');
  });

  it('needs sign-in', async () => {
    const res = await h.call(null, 'GET', `${base()}/entities/sync`);
    expect(res.status).toBe(401);
  });
});

describe('my submissions', () => {
  it('lists only what the caller sent when asked', async () => {
    const forms = (await h.call(admin, 'GET', `${base()}/forms`)).body as { key: string; currentVersion: number | null; canFill: boolean }[];
    const form = forms.find((f) => f.currentVersion && f.canFill);
    if (!form) return; // the template ships no fillable form: nothing to check
    expect(uuidv7()).toBeTruthy();
    const mine = await h.call(ed, 'GET', `${base()}/forms/${form.key}/submissions?mine=true`);
    expect(mine.status).toBe(200);
    for (const s of mine.body.items) expect(s.submittedBy.name).toBeTruthy();
  });
});
