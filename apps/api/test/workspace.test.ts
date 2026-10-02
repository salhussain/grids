import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// Organisation workspace (M2): context, branding, structure, roles, scoped access.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let ana: string; // organisation admin
let mo: string; // plain member
const units: Record<string, string> = {};

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Pacific Health', 'team');
  ana = await h.join(tenantId, 'ana@ph.org', { role: 'org_admin' });
  mo = await h.join(tenantId, 'mo@ph.org');
}, 180_000);
afterAll(async () => h?.stop());

const as = (who: string) => ({
  get: (url: string) => h.call(who, 'GET', `/tenants/${tenantId}${url}`),
  post: (url: string, body?: unknown) => h.call(who, 'POST', `/tenants/${tenantId}${url}`, body),
  put: (url: string, body?: unknown) => h.call(who, 'PUT', `/tenants/${tenantId}${url}`, body),
  patch: (url: string, body?: unknown) => h.call(who, 'PATCH', `/tenants/${tenantId}${url}`, body),
  del: (url: string) => h.call(who, 'DELETE', `/tenants/${tenantId}${url}`),
});

describe('workspace context', () => {
  it('describes the organisation and the member’s permissions', async () => {
    const a = (await as(ana).get('/workspace')).body;
    expect(a).toMatchObject({
      tenant: { name: 'Pacific Health', planName: 'Team' },
      me: { role: 'org_admin' },
    });
    expect(a.me.permissions).toContain('roles.manage');
    expect(a.theme).toMatchObject({ primaryColor: '#0f62fe', logo: null });

    const m = (await as(mo).get('/workspace')).body;
    expect(m.me).toMatchObject({
      role: 'member',
      permissions: ['org.view', 'support.create', 'support.view'],
      scoped: [],
    });
  });

  it('rejects non-members', async () => {
    h.person('stranger', 'x@elsewhere.org');
    expect((await as('stranger').get('/workspace')).status).toBe(403);
  });
});

describe('branding', () => {
  it('admins set the theme; members cannot', async () => {
    const theme = {
      appName: 'PH Data',
      primaryColor: '#198038',
      logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      sidebar: 'brand',
      welcomeMessage: 'Kia ora!',
    };
    expect((await as(mo).put('/theme', theme)).status).toBe(403);
    const res = await as(ana).put('/theme', theme);
    expect(res.status).toBe(200);
    expect((await as(mo).get('/workspace')).body.theme).toMatchObject({
      appName: 'PH Data',
      primaryColor: '#198038',
      sidebar: 'brand',
    });
  });

  it('custom colours and logos need the custom_branding feature', async () => {
    const freeId = await h.activeTenant('Free Co', 'free');
    const owner = await h.join(freeId, 'owner@free.org', { role: 'org_admin' });
    const res = await h.call(owner, 'PUT', `/tenants/${freeId}/theme`, { primaryColor: '#da1e28' });
    expect(res.status).toBe(402);
    expect(
      (await h.call(owner, 'PUT', `/tenants/${freeId}/theme`, { appName: 'Free Workspace' }))
        .status,
    ).toBe(200);
  });
});

describe('structure', () => {
  it('builds a multi-level hierarchy', async () => {
    const create = async (name: string, levelLabel: string, parent?: string) => {
      const res = await as(ana).post('/org-units', {
        name,
        levelLabel,
        parentId: parent ? units[parent] : null,
      });
      expect(res.status).toBe(200);
      units[name] = res.body.find((u: any) => u.name === name).id;
      return res.body;
    };
    await create('North', 'Region');
    await create('South', 'Region');
    await create('Northland', 'District', 'North');
    const tree = await create('Kaitaia Clinic', 'Facility', 'Northland');
    expect(tree.map((u: any) => `${'-'.repeat(u.depth)}${u.name}`)).toEqual([
      'North',
      '-Northland',
      '--Kaitaia Clinic',
      'South',
    ]);
    expect((await as(ana).post('/org-units', { name: 'north', parentId: null })).status).toBe(409);
    expect((await as(mo).post('/org-units', { name: 'Rogue' })).status).toBe(403);
  });

  it('moves subtrees and prevents cycles', async () => {
    const moved = await as(ana).put(`/org-units/${units.Northland}`, {
      name: 'Northland',
      levelLabel: 'District',
      parentId: units.South,
    });
    expect(moved.body.map((u: any) => `${'-'.repeat(u.depth)}${u.name}`)).toEqual([
      'North',
      'South',
      '-Northland',
      '--Kaitaia Clinic',
    ]);
    const cycle = await as(ana).put(`/org-units/${units.South}`, {
      name: 'South',
      parentId: units['Kaitaia Clinic'],
    });
    expect(cycle.status).toBe(400);
    await as(ana).put(`/org-units/${units.Northland}`, {
      name: 'Northland',
      levelLabel: 'District',
      parentId: units.North,
    });
  });

  it('refuses to delete units with sub-units', async () => {
    expect((await as(ana).del(`/org-units/${units.North}`)).status).toBe(409);
  });
});

describe('roles and scoped access', () => {
  let roles: any[];
  let rita: string;

  it('seeds built-in roles and supports custom ones', async () => {
    roles = (await as(ana).get('/roles')).body;
    expect(roles.map((r: any) => r.key)).toEqual(
      expect.arrayContaining(['org_admin', 'manager', 'member']),
    );
    expect(
      (
        await as(ana).put(`/roles/${roles.find((r) => r.key === 'org_admin').id}`, {
          name: 'Boss',
          permissions: ['org.view'],
        })
      ).status,
    ).toBe(409);
    expect((await as(ana).del(`/roles/${roles.find((r) => r.key === 'member').id}`)).status).toBe(
      409,
    );
    const created = await as(ana).post('/roles', {
      name: 'Auditor',
      permissions: ['org.view', 'audit.view'],
    });
    expect(created.body.find((r: any) => r.name === 'Auditor')).toMatchObject({
      isSystem: false,
      grantCount: 0,
    });
    roles = created.body;
  });

  it('a regional manager manages people in their region only', async () => {
    const manager = roles.find((r) => r.key === 'manager');
    rita = await h.join(tenantId, 'rita@ph.org', { orgUnitId: units.North });
    const nina = await h.join(tenantId, 'nina@ph.org', { orgUnitId: units['Kaitaia Clinic'] });
    void nina;
    const ritaId = await h.userId(tenantId, 'rita@ph.org');
    const moId = await h.userId(tenantId, 'mo@ph.org');
    await as(ana).put(`/members/${moId}/placement`, { orgUnitId: units.South });

    // Scoped grant (Manager @ North)
    const g = await as(ana).post('/grants', {
      userId: ritaId,
      roleId: manager.id,
      orgUnitId: units.North,
    });
    expect(g.body[0]).toMatchObject({ role: { name: 'Manager' }, orgUnit: { name: 'North' } });

    const ctx = (await as(rita).get('/workspace')).body;
    expect(ctx.me.scoped).toEqual(
      expect.arrayContaining([
        { permission: 'people.manage', orgUnitId: units.North, orgUnitName: 'North' },
      ]),
    );
    expect(ctx.me.permissions).not.toContain('people.view'); // only within North

    // Sees North subtree only
    const seen = (await as(rita).get('/members')).body.members.map((m: any) => m.email).sort();
    expect(seen).toEqual(['nina@ph.org', 'rita@ph.org']);
    const ninaRow = (await as(ana).get('/members')).body.members.find(
      (m: any) => m.email === 'nina@ph.org',
    );
    expect(ninaRow).toMatchObject({ orgUnit: { name: 'Kaitaia Clinic' } });

    // Manages inside, not outside
    const ninaId = ninaRow.userId;
    expect((await as(rita).patch(`/members/${ninaId}`, { status: 'suspended' })).status).toBe(200);
    expect((await as(rita).patch(`/members/${moId}`, { status: 'suspended' })).status).toBe(403);
    expect(
      (await as(rita).put(`/members/${ninaId}/placement`, { orgUnitId: units.South })).status,
    ).toBe(403);
    expect(
      (await as(rita).put(`/members/${ninaId}/placement`, { orgUnitId: units.Northland })).status,
    ).toBe(200);

    // Invites inside their region only, and never administrators
    const invite = (email: string, orgUnitId?: string, role = 'member') =>
      as(rita).post('/invitations', {
        email,
        firstName: 'New',
        lastName: 'Person',
        role,
        ...(orgUnitId && { orgUnitId }),
      });
    expect((await invite('n1@ph.org', units.Northland)).status).toBe(201);
    expect((await invite('s1@ph.org', units.South)).status).toBe(403);
    expect((await invite('x1@ph.org')).status).toBe(403); // unplaced = organisation-wide
    expect((await invite('boss@ph.org', units.North, 'org_admin')).status).toBe(403);
    // ...and only sees invitations inside the region
    const invites = (await as(rita).get('/members')).body.invitations.map((i: any) => i.email);
    expect(invites).toContain('n1@ph.org');

    // Organisation-wide settings stay out of reach
    expect((await as(rita).post('/org-units', { name: 'Rita Land' })).status).toBe(403);
    expect((await as(rita).post('/grants', { userId: ninaId, roleId: manager.id })).status).toBe(
      403,
    );
  });

  it('validates grants', async () => {
    const auditor = roles.find((r) => r.name === 'Auditor');
    const moId = await h.userId(tenantId, 'mo@ph.org');
    const scoped = await as(ana).post('/grants', {
      userId: moId,
      roleId: auditor.id,
      orgUnitId: units.North,
    });
    expect(scoped.status).toBe(400);
    expect(scoped.body.title).toBe('Role cannot be scoped');
    const wide = await as(ana).post('/grants', { userId: moId, roleId: auditor.id });
    expect(wide.status).toBe(200);
    expect((await as(ana).post('/grants', { userId: moId, roleId: auditor.id })).status).toBe(409);
    // mo can now read the activity log
    const activity = (await as(mo).get('/activity?pageSize=5')).body;
    expect(activity.items.length).toBe(5);
    expect(activity.items.every((e: any) => e.tenant.id === tenantId)).toBe(true);
    // revoke
    expect(
      (await as(ana).del(`/grants/${wide.body.find((g: any) => g.role.name === 'Auditor').id}`))
        .status,
    ).toBe(200);
    expect((await as(mo).get('/activity')).status).toBe(403);
  });

  it('deleting a unit with members is refused; deleting a role removes its grants', async () => {
    expect((await as(ana).del(`/org-units/${units.South}`)).status).toBe(409);
    const auditor = roles.find((r) => r.name === 'Auditor');
    expect((await as(ana).del(`/roles/${auditor.id}`)).status).toBe(200);
  });

  it('platform staff with members.view see everyone', async () => {
    const all = (await h.admin('GET', `/tenants/${tenantId}/members`)).body.members.map(
      (m: any) => m.email,
    );
    expect(all).toEqual(
      expect.arrayContaining(['ana@ph.org', 'mo@ph.org', 'rita@ph.org', 'nina@ph.org']),
    );
  });
});

describe('personal preferences', () => {
  it('saves colour mode and language on /me; rejects unknown languages', async () => {
    expect((await h.call(mo, 'GET', '/me')).body.preferences).toEqual({
      colorMode: 'system',
      locale: null,
    });
    const res = await h.call(mo, 'PUT', '/me/preferences', { colorMode: 'dark' });
    expect(res.body.preferences).toEqual({ colorMode: 'dark', locale: null });
    const both = await h.call(mo, 'PUT', '/me/preferences', { locale: 'fr' });
    expect(both.body.preferences).toEqual({ colorMode: 'dark', locale: 'fr' });
    expect((await h.call(mo, 'PUT', '/me/preferences', { locale: 'xx' })).status).toBe(400);
  });
});

describe('languages', () => {
  it('admins enable languages, pick a default and override wording', async () => {
    expect((await as(ana).get('/workspace')).body.localization).toEqual({
      languages: ['en'],
      defaultLanguage: 'en',
      overrides: {},
    });
    const input = {
      languages: ['en', 'fr', 'ar'],
      defaultLanguage: 'fr',
      overrides: {
        fr: { 'web.nav.people': 'Équipe', 'auth.signIn.title': 'Connexion', blank: '' },
        sm: { 'web.nav.home': 'Fale' }, // not enabled: dropped
      },
    };
    expect((await as(mo).put('/localization', input)).status).toBe(403);
    const saved = await as(ana).put('/localization', input);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({
      languages: ['en', 'fr', 'ar'],
      defaultLanguage: 'fr',
      overrides: { fr: { 'web.nav.people': 'Équipe', 'auth.signIn.title': 'Connexion' } },
    });
    expect((await as(mo).get('/localization')).body.defaultLanguage).toBe('fr');
  });

  it('validates the language set', async () => {
    const bad = await as(ana).put('/localization', { languages: ['en'], defaultLanguage: 'fr' });
    expect(bad.status).toBe(400);
    const unknown = await as(ana).put('/localization', { languages: ['xx'], defaultLanguage: 'xx' });
    expect(unknown.status).toBe(400);
  });

  it('exposes branding, languages and sign-in wording publicly for the login page', async () => {
    const res = await h.call(null, 'GET', `/public/branding/${tenantId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tenantId,
      name: 'Pacific Health',
      appName: 'PH Data',
      primaryColor: '#198038',
      languages: ['en', 'fr', 'ar'],
      defaultLanguage: 'fr',
      overrides: { fr: { 'auth.signIn.title': 'Connexion' } }, // web.* stays private
    });
    expect(res.body.overrides.fr['web.nav.people']).toBeUndefined();
    const missing = await h.call(null, 'GET', '/public/branding/00000000-0000-7000-8000-000000000000');
    expect(missing.status).toBe(404);
  });
});

describe('organisation billing', () => {
  it('admins see their subscription, upcoming charge, usage and invoices; members cannot', async () => {
    expect((await as(mo).get('/billing')).status).toBe(403);
    const b = (await as(ana).get('/billing')).body;
    expect(b.subscription).toMatchObject({ planName: 'Team', status: 'active' });
    expect(b.upcoming).toMatchObject({ total: b.subscription.amount });
    expect(b.upcoming.lines[0].description).toMatch(/^Team plan — monthly/);
    const seats = b.usage.find((u: { key: string }) => u.key === 'users');
    expect(seats.limit).toBe(50);
    expect(seats.used).toBeGreaterThanOrEqual(2); // members joined earlier in this file
    expect(b.outstanding).toMatchObject({ count: 0, amount: 0 });

    const list = (await as(ana).get('/billing/invoices')).body;
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ status: 'paid', tenantName: 'Pacific Health' });
    const one = await as(ana).get(`/billing/invoices/${list.items[0].id}`);
    expect(one.body.number).toBe(list.items[0].number);

    // Another organisation's invoice is not reachable through this tenant
    const otherId = await h.activeTenant('Other Org', 'team');
    const other = (await h.admin('GET', `/platform/invoices?tenantId=${otherId}`)).body;
    expect((await as(ana).get(`/billing/invoices/${other.items[0].id}`)).status).toBe(404);
  });
});
