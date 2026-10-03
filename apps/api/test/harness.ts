import { TenantRouter, type CellDB } from '@grids/db';
import { startTestDatabases, type TestDatabases } from '@grids/db/testing';
import { uuidv7 } from '@grids/schema';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { EmailService } from '../src/services/email.js';
import { createServices } from '../src/services/index.js';
import { FakeIdp, FakeMailer, fakeVerifier } from './fakes.js';

/** Real Postgres + HTTP app with fake IdP/mailer. Bearer token = subject. */
export async function startHarness() {
  const dbs: TestDatabases = await startTestDatabases();
  const idp = new FakeIdp();
  const mailer = new FakeMailer();
  const cells = new TenantRouter<CellDB>(async () => ({
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
      now: () => new Date(),
    },
    { devAutoVerifyDomains: true },
  );
  const app: FastifyInstance = await buildApp({
    checks: {},
    platform: { services, idp, verifier: fakeVerifier },
  });

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

  const ADMIN = 'admin-sub';
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
  const admin = <T = any>(method: InjectOptions['method'], url: string, payload?: unknown) =>
    call<T>(ADMIN, method, url, payload);

  /** Active organisation on `planId`; returns its id. */
  async function activeTenant(name: string, planId = 'team') {
    const t = (
      await admin('POST', '/platform/tenants', {
        name,
        contacts: {
          primary: {
            name: 'Pat Primary',
            email: `pat@${name.toLowerCase().replace(/\W+/g, '')}.org`,
          },
        },
      })
    ).body;
    await admin('POST', `/platform/tenants/${t.id}/subscription`, { planId });
    const inv = (await admin('GET', `/platform/invoices?tenantId=${t.id}`)).body.items[0];
    if (inv)
      await admin('POST', `/platform/invoices/${inv.id}/payments`, { method: 'bank_transfer' });
    return t.id as string;
  }

  /** Invites (as `by`) and accepts; returns the subject. */
  async function join(
    tenantId: string,
    email: string,
    opts: { role?: 'org_admin' | 'member'; orgUnitId?: string; by?: string } = {},
  ) {
    const subject = `sub-${email}`;
    person(subject, email);
    const inv = await call(opts.by ?? ADMIN, 'POST', `/tenants/${tenantId}/invitations`, {
      email,
      firstName: 'First',
      lastName: 'Last',
      role: opts.role ?? 'member',
      ...(opts.orgUnitId && { orgUnitId: opts.orgUnitId }),
    });
    if (inv.status !== 201)
      throw new Error(`invite ${email}: ${inv.status} ${JSON.stringify(inv.body)}`);
    const token = inv.body.inviteUrl.split('/').pop();
    const accepted = await call(subject, 'POST', `/invitations/${token}/accept`);
    if (accepted.status !== 200) throw new Error(`accept ${email}: ${accepted.status}`);
    return subject;
  }

  const userId = async (tenantId: string, email: string) =>
    (await admin('GET', `/tenants/${tenantId}/members`)).body.members.find(
      (m: any) => m.email === email,
    ).userId as string;

  return {
    dbs,
    app,
    idp,
    services,
    cells,
    mailer,
    call,
    admin,
    person,
    activeTenant,
    join,
    userId,
    async stop() {
      await app.close();
      await cells.destroy();
      await dbs.stop();
    },
  };
}
