import { TenantRouter, withTenant, type CellDB } from '@grids/db';
import { startTestDatabases, type TestDatabases } from '@grids/db/testing';
import { uuidv7 } from '@grids/schema';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { EmailService } from '../src/services/email.js';
import { createServices } from '../src/services/index.js';
import { FakeIdp, FakeMailer, fakeVerifier } from './fakes.js';

// Control plane end-to-end through HTTP, with real Postgres (control plane + RLS cell).

let dbs: TestDatabases;
let app: FastifyInstance;
let cells: TenantRouter<CellDB>;
const idp = new FakeIdp();
const mailer = new FakeMailer();
const txt = new Map<string, string[]>();
const clock = new Date('2026-10-01T09:00:00Z');

const ADMIN = 'admin-sub';
const person = (subject: string, email: string, name = email.split('@')[0]!) =>
  idp.profiles.set(subject, { subject, email, displayName: name });

async function call<T = any>(
  as: string | null,
  method: InjectOptions['method'],
  url: string,
  payload?: unknown,
) {
  const res = await app.inject({
    method,
    url,
    payload: payload as never,
    headers: as ? { authorization: `Bearer ${as}` } : {},
  });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}
const admin = <T = any>(method: InjectOptions['method'], url: string, payload?: unknown) =>
  call<T>(ADMIN, method, url, payload);

const org = (name: string, extra: object = {}) => ({
  name,
  contacts: {
    primary: { name: 'Pat Primary', email: `pat@${name.toLowerCase().replace(/\W+/g, '')}.org` },
  },
  ...extra,
});

/** Creates an organisation, subscribes and pays, returning its id. */
async function activeTenant(name: string, planId = 'team') {
  const t = (await admin('POST', '/platform/tenants', org(name))).body;
  await admin('POST', `/platform/tenants/${t.id}/subscription`, { planId });
  const inv = (await admin('GET', `/platform/invoices?tenantId=${t.id}`)).body.items[0];
  if (inv)
    await admin('POST', `/platform/invoices/${inv.id}/payments`, { method: 'bank_transfer' });
  return t.id as string;
}

/** Invites and accepts; returns the member's subject. */
async function addMember(tenantId: string, email: string, role: 'org_admin' | 'member' = 'member') {
  const subject = `sub-${email}`;
  person(subject, email);
  const inv = await admin('POST', `/tenants/${tenantId}/invitations`, {
    email,
    firstName: 'First',
    lastName: 'Last',
    role,
    jobTitle: 'Analyst',
  });
  expect(inv.status).toBe(201);
  const token = inv.body.inviteUrl.split('/').pop();
  expect((await call(subject, 'POST', `/invitations/${token}/accept`)).status).toBe(200);
  return subject;
}

beforeAll(async () => {
  dbs = await startTestDatabases();
  cells = new TenantRouter<CellDB>(async () => ({
    cellId: 'cell-1',
    connectionString: dbs.cellAppUrl,
  }));
  const services = createServices(
    {
      db: dbs.platform,
      cells,
      idp,
      email: new EmailService(dbs.platform, mailer),
      consoleUrl: 'http://console',
      workspaceUrl: 'http://web',
      baseDomain: 'grids.test',
      supportEmail: 'support@grids.test',
      now: () => clock,
    },
    {
      resolveTxt: async (name) =>
        txt.has(name)
          ? [txt.get(name)!]
          : Promise.reject(Object.assign(new Error('nx'), { code: 'ENOTFOUND' })),
    },
  );
  app = await buildApp({ checks: {}, platform: { services, idp, verifier: fakeVerifier } });
  person(ADMIN, 'admin@grids.local', 'Platform Admin');
  const adminId = uuidv7();
  await dbs.platform
    .insertInto('user_identity')
    .values({
      id: adminId,
      idp_subject: ADMIN,
      email: 'admin@grids.local',
      display_name: 'Platform Admin',
    })
    .execute();
  await dbs.platform.insertInto('staff_member').values({ user_id: adminId }).execute();
  await dbs.platform
    .insertInto('staff_member_role')
    .values({ user_id: adminId, role_id: 'super_admin' })
    .execute();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await cells?.destroy();
  await dbs?.stop();
});

describe('authentication & authorisation', () => {
  it('rejects anonymous and non-staff callers', async () => {
    expect((await call(null, 'GET', '/platform/tenants')).status).toBe(401);
    person('random', 'random@example.com');
    expect((await call('random', 'GET', '/platform/tenants')).status).toBe(403);
    expect((await call('random', 'GET', '/platform/overview')).status).toBe(403);
  });
});

describe('organisation onboarding: create → subscribe → pay → invite', () => {
  let tenantId: string;

  it('creates an organisation with full profile, generating the slug', async () => {
    const res = await admin('POST', '/platform/tenants', {
      ...org('Pacific Health'),
      legalName: 'Pacific Health Network Ltd',
      industry: 'Healthcare',
      companySize: '201–1,000',
      website: 'https://pacifichealth.example',
      taxId: 'NZ-123',
      address: { line1: '1 Queen St', city: 'Auckland', postalCode: '1010', country: 'nz' },
      timezone: 'Pacific/Auckland',
      contacts: {
        primary: {
          name: 'Ana Smith',
          email: 'ana@pacifichealth.example',
          phone: '+64 9 000 0000',
          jobTitle: 'CIO',
        },
        billing: { name: 'Finance Team', email: 'finance@pacifichealth.example' },
      },
    });
    expect(res.status).toBe(201);
    tenantId = res.body.id;
    expect(res.body).toMatchObject({
      slug: 'pacific-health-network-ltd',
      status: 'pending_payment',
      planId: null,
      subscription: null,
      nextStep: 'subscribe',
      address: { city: 'Auckland', country: 'NZ' },
      contacts: {
        primary: { name: 'Ana Smith', jobTitle: 'CIO' },
        billing: { email: 'finance@pacifichealth.example' },
        technical: null,
      },
    });
  });

  it('de-duplicates generated slugs and rejects taken explicit ones', async () => {
    const a = await admin('POST', '/platform/tenants', org('Pacific Health Network Ltd'));
    expect(a.body.slug).toBe('pacific-health-network-ltd-2');
    const b = await admin(
      'POST',
      '/platform/tenants',
      org('Other', { slug: 'pacific-health-network-ltd' }),
    );
    expect(b.status).toBe(409);
  });

  it('blocks invitations until the organisation is paid and provisioned', async () => {
    const res = await admin('POST', `/tenants/${tenantId}/invitations`, {
      email: 'x@y.org',
      firstName: 'X',
      lastName: 'Y',
    });
    expect(res.status).toBe(409);
    expect(res.body.title).toBe('Organisation not active');
  });

  it('subscribing to a paid plan issues the first invoice to the billing contact', async () => {
    const res = await admin('POST', `/platform/tenants/${tenantId}/subscription`, {
      planId: 'team',
      interval: 'yearly',
      extraDiscountPct: 10,
    });
    expect(res.status).toBe(201);
    // Team: $99/mo → $1,188/yr; 15% yearly × 10% negotiated = 23.5% off → $908.82
    expect(res.body).toMatchObject({
      status: 'pending_payment',
      interval: 'yearly',
      unitPrice: 118800,
      discountPct: 23.5,
      amount: 90882,
      mrr: 7574,
    });

    const detail = (await admin('GET', `/platform/tenants/${tenantId}`)).body;
    expect(detail).toMatchObject({
      status: 'pending_payment',
      planName: 'Team',
      nextStep: 'record_payment',
    });

    const [inv] = (await admin('GET', `/platform/invoices?tenantId=${tenantId}`)).body.items;
    expect(inv).toMatchObject({
      status: 'open',
      total: 90882,
      discount: 118800 - 90882,
      overdue: false,
    });
    expect(inv.number).toMatch(/^INV-2026-\d{5}$/);
    expect(mailer.to('finance@pacifichealth.example')[0]!.subject).toContain(inv.number);
  });

  it('recording payment activates, provisions and welcomes the organisation', async () => {
    const [inv] = (await admin('GET', `/platform/invoices?tenantId=${tenantId}`)).body.items;
    const paid = await admin('POST', `/platform/invoices/${inv.id}/payments`, {
      method: 'bank_transfer',
      reference: 'BT-7781',
    });
    expect(paid.body).toMatchObject({
      status: 'paid',
      paymentMethod: 'bank_transfer',
      paymentReference: 'BT-7781',
    });
    expect(
      (await admin('POST', `/platform/invoices/${inv.id}/payments`, { method: 'card' })).status,
    ).toBe(409);

    const detail = (await admin('GET', `/platform/tenants/${tenantId}`)).body;
    expect(detail).toMatchObject({
      status: 'active',
      nextStep: 'invite_admin',
      subscription: { status: 'active' },
    });
    expect(detail.subscription.currentPeriodEnd).toBe('2027-10-01T09:00:00.000Z');
    expect(detail.idpOrgId).toMatch(/^org-/);

    const cell = await cells.forTenant(tenantId);
    const profile = await withTenant(cell, tenantId, (tx) =>
      tx.selectFrom('tenant_profile').selectAll().execute(),
    );
    expect(profile).toHaveLength(1);

    expect(mailer.to('finance@pacifichealth.example').map((m) => m.subject)).toContainEqual(
      expect.stringContaining('Receipt'),
    );
    expect(mailer.to('ana@pacifichealth.example')[0]!.subject).toBe(
      'Pacific Health is ready on Grids',
    );
  });

  it('invites an administrator with person details and accepts', async () => {
    const res = await admin('POST', `/tenants/${tenantId}/invitations`, {
      email: 'ana@pacifichealth.example',
      firstName: 'Ana',
      lastName: 'Smith',
      jobTitle: 'CIO',
      department: 'IT',
      phone: '+64 21 000',
      role: 'org_admin',
      message: 'Welcome aboard!',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      emailSent: true,
      invitation: {
        firstName: 'Ana',
        jobTitle: 'CIO',
        status: 'pending',
        invitedBy: 'admin@grids.local',
      },
    });
    const mail = mailer.to('ana@pacifichealth.example').at(-1)!;
    expect(mail.text).toContain(res.body.inviteUrl);
    expect(mail.text).toContain('Welcome aboard!');

    person('ana', 'ana@pacifichealth.example', 'Ana Smith');
    idp.secondFactors.set('ana', ['totp']);
    const token = res.body.inviteUrl.split('/').pop();
    const preview = (await call(null, 'GET', `/invitations/${token}`)).body;
    expect(preview).toMatchObject({
      firstName: 'Ana',
      role: 'org_admin',
      mfaRequired: false,
      status: 'pending',
    });
    expect(
      (await call('ana', 'POST', `/invitations/${token}/accept`)).body.memberships[0],
    ).toMatchObject({ role: 'org_admin', status: 'active' });

    const members = (await admin('GET', `/tenants/${tenantId}/members`)).body;
    expect(members.members[0]).toMatchObject({
      email: 'ana@pacifichealth.example',
      givenName: 'Ana',
      jobTitle: 'CIO',
      department: 'IT',
      phone: '+64 21 000',
      role: 'org_admin',
      status: 'active',
      mfa: { enrolled: true, methods: ['totp'] },
    });
    expect((await admin('GET', `/platform/tenants/${tenantId}`)).body.nextStep).toBe('none');
  });

  it('org admins manage their own organisation: MFA policy, member status, invitations', async () => {
    const memberSub = await addMember(tenantId, 'bob@pacifichealth.example');

    const sec = await call('ana', 'PUT', `/tenants/${tenantId}/security`, { mfaRequired: true });
    expect(sec.body.mfaRequired).toBe(true);
    expect(idp.mfaPolicy.get(sec.body.idpOrgId)).toBe(true);

    const bobId = (await call('ana', 'GET', `/tenants/${tenantId}/members`)).body.members.find(
      (m: any) => m.email.startsWith('bob'),
    ).userId;
    const suspended = await call('ana', 'PATCH', `/tenants/${tenantId}/members/${bobId}`, {
      status: 'suspended',
    });
    expect(suspended.body.members.find((m: any) => m.userId === bobId).status).toBe('suspended');
    // Suspended members lose access to the organisation.
    expect((await call(memberSub, 'GET', `/tenants/${tenantId}/tickets`)).status).toBe(403);

    // The only active administrator can't be demoted.
    const anaId = suspended.body.members.find((m: any) => m.email.startsWith('ana')).userId;
    expect(
      (await call('ana', 'PATCH', `/tenants/${tenantId}/members/${anaId}`, { role: 'member' }))
        .status,
    ).toBe(409);

    // Members (non-admins) can't manage people.
    await call('ana', 'PATCH', `/tenants/${tenantId}/members/${bobId}`, { status: 'active' });
    expect((await call(memberSub, 'GET', `/tenants/${tenantId}/members`)).status).toBe(403);

    // Revoke + resend
    const inv = (
      await call('ana', 'POST', `/tenants/${tenantId}/invitations`, {
        email: 'carol@pacifichealth.example',
        firstName: 'Carol',
        lastName: 'C',
      })
    ).body;
    const resent = await call(
      'ana',
      'POST',
      `/tenants/${tenantId}/invitations/${inv.invitation.id}/resend`,
    );
    expect(resent.body.inviteUrl).not.toBe(inv.inviteUrl);
    expect((await call(null, 'GET', `/invitations/${inv.inviteUrl.split('/').pop()}`)).status).toBe(
      404,
    );
    const revoked = await call(
      'ana',
      'DELETE',
      `/tenants/${tenantId}/invitations/${inv.invitation.id}`,
    );
    expect(revoked.body.invitations.find((i: any) => i.id === inv.invitation.id)).toBeUndefined();
    expect(
      (await call(null, 'GET', `/invitations/${resent.body.inviteUrl.split('/').pop()}`)).body
        .status,
    ).toBe('revoked');
  });

  it('renewal invoices advance the billing period when paid', async () => {
    const renewal = await admin('POST', `/platform/tenants/${tenantId}/invoices`);
    expect(renewal.status).toBe(201);
    expect(renewal.body.periodStart).toBe('2027-10-01T09:00:00.000Z');
    expect((await admin('POST', `/platform/tenants/${tenantId}/invoices`)).status).toBe(409);
    await admin('POST', `/platform/invoices/${renewal.body.id}/payments`, { method: 'card' });
    expect(
      (await admin('GET', `/platform/tenants/${tenantId}`)).body.subscription.currentPeriodEnd,
    ).toBe('2028-10-01T09:00:00.000Z');
  });
});

describe('subscriptions: trials, free plans, changes', () => {
  it('a trial provisions immediately without an invoice', async () => {
    const t = (await admin('POST', '/platform/tenants', org('Trial Co'))).body;
    const sub = await admin('POST', `/platform/tenants/${t.id}/subscription`, {
      planId: 'business',
      trial: true,
    });
    expect(sub.body).toMatchObject({ status: 'trialing', trialEndsAt: '2026-10-15T09:00:00.000Z' });
    expect((await admin('GET', `/platform/tenants/${t.id}`)).body.status).toBe('active');
    expect((await admin('GET', `/platform/invoices?tenantId=${t.id}`)).body.total).toBe(0);
  });

  it('the free plan activates immediately', async () => {
    const t = (await admin('POST', '/platform/tenants', org('Free Co'))).body;
    const sub = await admin('POST', `/platform/tenants/${t.id}/subscription`, { planId: 'free' });
    expect(sub.body).toMatchObject({ status: 'active', amount: 0 });
    expect((await admin('GET', `/platform/tenants/${t.id}`)).body.status).toBe('active');
  });

  it('enforces seat limits and blocks downgrades below current usage', async () => {
    const id = await activeTenant('Seats Co', 'free'); // Free: 5 users
    for (const n of [1, 2, 3, 4, 5]) {
      expect(
        (
          await admin('POST', `/tenants/${id}/invitations`, {
            email: `m${n}@seats.org`,
            firstName: 'M',
            lastName: `${n}`,
          })
        ).status,
      ).toBe(201);
    }
    const over = await admin('POST', `/tenants/${id}/invitations`, {
      email: 'm6@seats.org',
      firstName: 'M',
      lastName: '6',
    });
    expect(over.status).toBe(402);
    expect(over.body.detail).toBe('The plan allows 5 users.');

    await admin('PATCH', `/platform/tenants/${id}/subscription`, { planId: 'team' });
    expect(
      (
        await admin('POST', `/tenants/${id}/invitations`, {
          email: 'm6@seats.org',
          firstName: 'M',
          lastName: '6',
        })
      ).status,
    ).toBe(201);
    expect(
      (await admin('PATCH', `/platform/tenants/${id}/subscription`, { planId: 'free' })).status,
    ).toBe(402);
  });

  it('plan price changes apply to new subscriptions only', async () => {
    const id = await activeTenant('Grandfathered Co', 'team');
    const team = (await admin('GET', '/platform/plans')).body.find((p: any) => p.id === 'team');
    const updated = await admin('PUT', '/platform/plans/team', { ...team, priceMonthly: 12900 });
    expect(updated.body).toMatchObject({
      priceMonthly: 12900,
      priceYearly: Math.round(12900 * 12 * 0.85),
    });
    expect((await admin('GET', `/platform/tenants/${id}`)).body.subscription.amount).toBe(9900);
  });

  it('creates new plans and validates them', async () => {
    const res = await admin('POST', '/platform/plans', {
      id: 'starter',
      name: 'Starter',
      priceMonthly: 2900,
      yearlyDiscountPct: 20,
      limits: {
        projects: 2,
        users: 10,
        forms: 10,
        submissions_per_month: 2000,
        storage_gb: 5,
        api_calls_per_month: 50000,
        rows_ingested_per_month: 500000,
        run_minutes_per_month: 200,
      },
      features: ['api_access'],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ priceYearly: 27840, subscriberCount: 0 });
    expect((await admin('POST', '/platform/plans', { ...res.body, id: 'starter' })).status).toBe(
      409,
    );
    expect(
      (
        await admin('POST', '/platform/plans', {
          id: 'bad',
          name: 'B',
          priceMonthly: -1,
          limits: {},
        })
      ).status,
    ).toBe(400);
  });

  it('reports MRR and outstanding revenue', async () => {
    const overview = (await admin('GET', '/platform/billing/overview')).body;
    const usd = overview.totals.find((t: any) => t.currency === 'USD');
    expect(usd.mrr).toBeGreaterThan(0);
    expect(usd.arr).toBe(usd.mrr * 12);
    expect(overview.revenueByMonth.length).toBeGreaterThan(0);
  });
});

describe('custom domains', () => {
  let tenantId: string;
  beforeAll(async () => {
    tenantId = await activeTenant('Domain Co', 'business');
  });

  it('requires the custom_domain feature', async () => {
    const teamId = await activeTenant('No Domains Co', 'team');
    expect(
      (await admin('POST', `/tenants/${teamId}/domains`, { hostname: 'data.nodomains.org' }))
        .status,
    ).toBe(402);
  });

  it('verifies ownership by DNS TXT, then redirects the platform host to the primary domain', async () => {
    const added = await admin('POST', `/tenants/${tenantId}/domains`, {
      hostname: 'Data.DomainCo.org',
    });
    const custom = added.body.find((d: any) => d.kind === 'custom');
    expect(custom).toMatchObject({ hostname: 'data.domainco.org', status: 'pending' });
    expect(custom.dns).toEqual([
      { type: 'CNAME', name: 'data.domainco.org', value: 'edge.grids.test' },
      {
        type: 'TXT',
        name: '_grids-challenge.data.domainco.org',
        value: expect.stringMatching(/^grids-verify=/),
      },
    ]);

    const failed = await admin('POST', `/tenants/${tenantId}/domains/${custom.id}/verify`);
    expect(failed.body[1]).toMatchObject({
      status: 'failed',
      lastError: expect.stringContaining('No TXT record'),
    });
    expect((await admin('POST', `/tenants/${tenantId}/domains/${custom.id}/primary`)).status).toBe(
      409,
    );

    txt.set('_grids-challenge.data.domainco.org', [custom.dns[1].value]);
    const ok = await admin('POST', `/tenants/${tenantId}/domains/${custom.id}/verify`);
    expect(ok.body[1].status).toBe('verified');

    const slug = (await admin('GET', `/platform/tenants/${tenantId}`)).body.slug;
    expect((await call(null, 'GET', `/edge/resolve?host=${slug}.grids.test`)).body).toMatchObject({
      redirect: false,
    });
    await admin('POST', `/tenants/${tenantId}/domains/${custom.id}/primary`);
    expect((await call(null, 'GET', `/edge/resolve?host=${slug}.grids.test`)).body).toMatchObject({
      canonicalHost: 'data.domainco.org',
      redirect: true,
    });
    expect(
      (await call(null, 'GET', '/edge/resolve?host=data.domainco.org:443')).body,
    ).toMatchObject({ tenantId, redirect: false });

    expect((await app.inject('/edge/tls-allowed?domain=data.domainco.org')).statusCode).toBe(200);
    expect((await app.inject('/edge/tls-allowed?domain=evil.example')).statusCode).toBe(404);
    expect(
      (await admin('POST', `/tenants/${tenantId}/domains`, { hostname: 'x.grids.test' })).status,
    ).toBe(409);
  });
});

describe('support desk', () => {
  let tenantId: string;
  let ticketId: string;
  let member: string;

  beforeAll(async () => {
    tenantId = await activeTenant('Support Co', 'team');
    member = await addMember(tenantId, 'user@supportco.org');
  });

  it('members raise tickets that staff see in the queue', async () => {
    const res = await call(member, 'POST', `/tenants/${tenantId}/tickets`, {
      subject: 'Dashboard not loading',
      category: 'bug',
      priority: 'high',
      body: 'The regional dashboard spins forever.',
    });
    expect(res.status).toBe(201);
    ticketId = res.body.id;
    expect(res.body).toMatchObject({
      number: expect.any(Number),
      status: 'open',
      tenantName: 'Support Co',
      messageCount: 1,
    });
    expect(mailer.to('support@grids.test').at(-1)!.subject).toContain('Dashboard not loading');

    const queue = (await admin('GET', '/platform/support/tickets?status=active')).body.items;
    expect(queue.map((t: any) => t.id)).toContain(ticketId);
  });

  it('internal notes stay internal; replies move the ticket between open and pending', async () => {
    const staffId = (await admin('GET', '/platform/staff')).body[0].id;
    await admin('PATCH', `/tickets/${ticketId}`, { assigneeId: staffId, priority: 'urgent' });
    await admin('POST', `/tickets/${ticketId}/messages`, {
      body: 'Looks like cell-1 latency',
      internal: true,
    });
    const reply = await admin('POST', `/tickets/${ticketId}/messages`, {
      body: 'We are looking into it.',
    });
    expect(reply.body).toMatchObject({
      status: 'pending',
      priority: 'urgent',
      assignee: { id: staffId },
    });
    expect(mailer.to('user@supportco.org').at(-1)!.text).toContain('We are looking into it.');

    const seen = (await call(member, 'GET', `/tickets/${ticketId}`)).body;
    expect(seen.messages.map((m: any) => m.body)).toEqual([
      'The regional dashboard spins forever.',
      'We are looking into it.',
    ]);
    expect(
      (await call(member, 'POST', `/tickets/${ticketId}/messages`, { body: 'x', internal: true }))
        .status,
    ).toBe(403);
    expect(
      (await call(member, 'POST', `/tickets/${ticketId}/messages`, { body: 'Still broken' })).body
        .status,
    ).toBe('open');
    expect((await call(member, 'PATCH', `/tickets/${ticketId}`, { status: 'closed' })).status).toBe(
      403,
    );
  });

  it('other organisations cannot see the ticket', async () => {
    const otherId = await activeTenant('Nosy Co', 'team');
    const nosy = await addMember(otherId, 'nosy@nosy.org');
    expect((await call(nosy, 'GET', `/tickets/${ticketId}`)).status).toBe(403);
    expect((await call(nosy, 'GET', `/tenants/${tenantId}/tickets`)).status).toBe(403);
  });

  it('staff can open tickets on behalf of an organisation', async () => {
    const res = await admin('POST', '/platform/support/tickets', {
      tenantId,
      subject: 'Phone call: billing question',
      category: 'billing',
      body: 'Asked about yearly pricing.',
    });
    expect(res.status).toBe(201);
  });
});

describe('logs and overview', () => {
  it('records failed emails in the email log', async () => {
    mailer.failFor.add('bounce@failco.org');
    const t = (
      await admin(
        'POST',
        '/platform/tenants',
        org('Fail Co', {
          contacts: { primary: { name: 'Bo Bounce', email: 'bounce@failco.org' } },
        }),
      )
    ).body;
    await admin('POST', `/platform/tenants/${t.id}/subscription`, { planId: 'team' });
    const failed = (await admin('GET', '/platform/logs/emails?status=failed')).body.items;
    expect(failed[0]).toMatchObject({
      to: 'bounce@failco.org',
      template: 'invoice_issued',
      error: expect.stringContaining('550'),
    });
    const detail = (await admin('GET', `/platform/logs/emails/${failed[0].id}`)).body;
    expect(detail.bodyText).toContain('INV-');
  });

  it('filters and pages the system log', async () => {
    const page = (await admin('GET', '/platform/logs/audit?action=invoice.&pageSize=5')).body;
    expect(page.items).toHaveLength(5);
    expect(page.total).toBeGreaterThan(5);
    expect(page.items.every((e: any) => e.action.startsWith('invoice.'))).toBe(true);
    const next = (await admin('GET', '/platform/logs/audit?action=invoice.&pageSize=5&page=2'))
      .body;
    expect(next.page).toBe(2);
    expect(next.items[0].id).not.toBe(page.items[0].id);
  });

  it('summarises the platform', async () => {
    const o = (await admin('GET', '/platform/overview')).body;
    expect(o.totalTenants).toBeGreaterThan(5);
    expect(o.openTickets).toBeGreaterThan(0);
    expect(o.emailsFailed24h).toBe(1);
    expect(o.awaitingPayment.map((a: any) => a.name)).toContain('Fail Co');
  });
});

describe('lifecycle', () => {
  it('cancelling an organisation cancels its subscription and voids open invoices', async () => {
    const t = (await admin('POST', '/platform/tenants', org('Churn Co'))).body;
    await admin('POST', `/platform/tenants/${t.id}/subscription`, { planId: 'team' });
    const res = await admin('PUT', `/platform/tenants/${t.id}/status`, {
      status: 'cancelled',
      reason: 'Did not pay',
    });
    expect(res.body).toMatchObject({ status: 'cancelled', subscription: null });
    expect((await admin('GET', `/platform/invoices?tenantId=${t.id}`)).body.items[0].status).toBe(
      'void',
    );
  });

  it('resumes provisioning after an IdP failure', async () => {
    const t = (await admin('POST', '/platform/tenants', org('Flaky Co'))).body;
    idp.failNext = true;
    expect(
      (await admin('POST', `/platform/tenants/${t.id}/subscription`, { planId: 'free' })).status,
    ).toBe(500);
    expect((await admin('GET', `/platform/tenants/${t.id}`)).body.status).toBe('provisioning');
    const resumed = await admin('PUT', `/platform/tenants/${t.id}/status`, { status: 'active' });
    expect(resumed.body).toMatchObject({
      status: 'active',
      idpOrgId: expect.stringMatching(/^org-/),
    });
  });
});

describe('pagination', () => {
  it('pages organisations with a total count', async () => {
    const first = (await admin('GET', '/platform/tenants?pageSize=5')).body;
    expect(first).toMatchObject({ page: 1, pageSize: 5 });
    expect(first.items).toHaveLength(5);
    expect(first.total).toBeGreaterThan(10);
    const second = (await admin('GET', '/platform/tenants?pageSize=5&page=2')).body;
    expect(second.items.map((t: any) => t.id)).not.toContain(first.items[0].id);
    expect((await admin('GET', '/platform/tenants?pageSize=500')).status).toBe(400);
  });
});

describe('console staff, roles and permissions', () => {
  const bea = 'staff-bea@grids.local'; // subject assigned by FakeIdp.createStaffUser

  it('invites staff with roles; permissions are enforced per action', async () => {
    const res = await admin('POST', '/platform/staff/users', {
      email: 'bea@grids.local',
      firstName: 'Bea',
      lastName: 'Billing',
      roleIds: ['billing_manager'],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'invited', roles: [{ id: 'billing_manager' }] });
    expect(res.body.effectivePermissions).toContain('billing.payments');
    expect(idp.staffCreated).toContain('bea@grids.local');

    person(bea, 'bea@grids.local', 'Bea Billing');
    const me = (await call(bea, 'GET', '/me')).body;
    expect(me.isPlatformAdmin).toBe(true);
    expect(me.permissions).toContain('billing.view');
    expect(me.permissions).not.toContain('support.view');

    expect((await call(bea, 'GET', '/platform/invoices')).status).toBe(200);
    expect((await call(bea, 'GET', '/platform/support/tickets')).status).toBe(403);
    expect((await call(bea, 'POST', '/platform/tenants', org('Nope'))).status).toBe(403);
    expect((await call(bea, 'GET', '/platform/staff/users')).status).toBe(403);
    // Overview hides modules she can't see
    const o = (await call(bea, 'GET', '/platform/overview')).body;
    expect(o.recentTickets).toEqual([]);
    expect(o.mrr.length).toBeGreaterThan(0);
  });

  it('individual permissions add to role permissions', async () => {
    const list = (await admin('GET', '/platform/staff/users?q=bea')).body;
    const id = list.items[0].userId;
    await admin('PATCH', `/platform/staff/users/${id}`, { extraPermissions: ['support.view'] });
    expect((await call(bea, 'GET', '/platform/support/tickets')).status).toBe(200);
    expect((await call(bea, 'PATCH', `/tickets/${uuidv7()}`, { status: 'closed' })).status).toBe(
      403,
    );
  });

  it('custom roles bundle permissions and can be edited and deleted', async () => {
    const role = await admin('POST', '/platform/staff/roles', {
      name: 'Domain helper',
      permissions: ['tenants.view', 'tenants.domains'],
    });
    expect(role.status).toBe(201);
    expect(role.body).toMatchObject({ isSystem: false, locked: false, memberCount: 0 });
    const updated = await admin('PUT', `/platform/staff/roles/${role.body.id}`, {
      name: 'Domain helper',
      permissions: ['tenants.view'],
    });
    expect(updated.body.permissions).toEqual(['tenants.view']);
    expect(
      (
        await admin('PUT', '/platform/staff/roles/super_admin', {
          name: 'Root',
          permissions: ['overview.view'],
        })
      ).status,
    ).toBe(409);
    expect((await admin('DELETE', '/platform/staff/roles/auditor')).status).toBe(409);
    expect((await admin('DELETE', `/platform/staff/roles/${role.body.id}`)).status).toBe(204);
    const roles = (await admin('GET', '/platform/staff/roles')).body;
    expect(roles.find((r: any) => r.id === 'super_admin')).toMatchObject({ locked: true });
    expect(roles.find((r: any) => r.id === 'super_admin').permissions).toContain('staff.manage');
  });

  it('suspending staff revokes access and blocks sign-in at the IdP', async () => {
    const id = (await admin('GET', '/platform/staff/users?q=bea')).body.items[0].userId;
    const res = await admin('PATCH', `/platform/staff/users/${id}`, { status: 'suspended' });
    expect(res.body.status).toBe('suspended');
    expect(idp.inactive.has(bea)).toBe(true);
    expect((await call(bea, 'GET', '/platform/invoices')).status).toBe(403);
    expect((await call(bea, 'GET', '/me')).body.permissions).toEqual([]);
  });

  it('guards against locking the platform out', async () => {
    const meId = (await admin('GET', '/me')).body.id;
    expect(
      (await admin('PATCH', `/platform/staff/users/${meId}`, { status: 'suspended' })).status,
    ).toBe(403);
    expect(
      (await admin('PATCH', `/platform/staff/users/${meId}`, { roleIds: ['auditor'] })).status,
    ).toBe(403);

    // Another super admin can change this admin's access; the demoted admin loses manage rights.
    await admin('POST', '/platform/staff/users', {
      email: 'sam@grids.local',
      firstName: 'Sam',
      lastName: 'Super',
      roleIds: ['super_admin'],
    });
    const sam = 'staff-sam@grids.local';
    person(sam, 'sam@grids.local', 'Sam Super');
    expect(
      (await call(sam, 'PATCH', `/platform/staff/users/${meId}`, { roleIds: ['auditor'] })).status,
    ).toBe(200);
    expect((await admin('GET', '/platform/staff/users')).status).toBe(200); // auditors can view
    const samId = (await admin('GET', '/platform/staff/users?q=sam')).body.items[0].userId;
    expect(
      (await admin('PATCH', `/platform/staff/users/${samId}`, { status: 'suspended' })).status,
    ).toBe(403); // but not manage
    expect(
      (await call(sam, 'PATCH', `/platform/staff/users/${samId}`, { roleIds: ['auditor'] })).status,
    ).toBe(403); // nor self-demote
    // restore
    expect(
      (await call(sam, 'PATCH', `/platform/staff/users/${meId}`, { roleIds: ['super_admin'] }))
        .status,
    ).toBe(200);
  });
});
