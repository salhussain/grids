import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// Receipts: numbered in order for each organisation, as one PDF or a ZIP of separate PDFs, only for payments that went through.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let otherTenant: string;
let admin: string;
let member: string;
const ids: Record<string, string> = {};

const add = async (tenant: string, key: string, over: { description?: string; payer?: string } = {}) => {
  const id = randomUUID();
  ids[key] = id;
  await h.dbs.platform
    .insertInto('payment')
    .values({ id, tenant_id: tenant, provider: 'test', project_key: 'demo', form_key: 'licence', amount: 2500, currency: 'AUD', description: over.description ?? 'Business licence', payer_email: over.payer ?? 'payer@example.org', receipt_no: null })
    .execute();
  return id;
};
const get = (as: string, url: string) => h.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${as}` } });
const zipNames = (zip: Buffer) => {
  const names: string[] = [];
  for (let i = 0; i + 46 <= zip.length; i++) {
    if (zip.readUInt32LE(i) === 0x02014b50) {
      const len = zip.readUInt16LE(i + 28);
      names.push(zip.subarray(i + 46, i + 46 + len).toString('utf8'));
    }
  }
  return names;
};

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Receipts Org', 'business');
  otherTenant = await h.activeTenant('Other Org', 'business');
  admin = await h.join(tenantId, 'admin@rc.org', { role: 'org_admin' });
  member = await h.join(tenantId, 'member@rc.org');
  for (const k of ['a', 'b', 'c']) await add(tenantId, k);
  await add(tenantId, 'failed');
  await add(tenantId, 'pending');
  await add(otherTenant, 'other');
  const pay = h.services.payments;
  await pay.settle(ids.a!, 'succeeded', null, 'card', 100);
  await pay.settle(ids.failed!, 'failed');
  await pay.settle(ids.b!, 'succeeded');
  await pay.settle(ids.other!, 'succeeded');
  await pay.settle(ids.c!, 'succeeded');
  await pay.settle(ids.a!, 'succeeded'); // a second notice of the same payment changes nothing
}, 180_000);
afterAll(async () => h?.stop());

describe('receipt numbers', () => {
  it('count up for each organisation, in the order payments succeeded, once each', async () => {
    const rows = await h.dbs.platform.selectFrom('payment').select(['id', 'tenant_id', 'receipt_no']).execute();
    const no = (k: string) => rows.find((p) => p.id === ids[k])?.receipt_no;
    expect([no('a'), no('b'), no('c')].map(Number)).toEqual([1, 2, 3]);
    expect(no('failed')).toBeNull();
    expect(no('pending')).toBeNull();
    expect(Number(no('other'))).toBe(1); // each organisation counts from 1
  });
});

describe('one receipt', () => {
  it('is a PDF for a payment that went through', async () => {
    const res = await get(admin, `/tenants/${tenantId}/payments/${ids.a}/receipt`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('receipt-R-000001.pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('does not exist for a payment that did not go through, or belongs to another organisation', async () => {
    expect((await get(admin, `/tenants/${tenantId}/payments/${ids.failed}/receipt`)).statusCode).toBe(404);
    expect((await get(admin, `/tenants/${tenantId}/payments/${ids.pending}/receipt`)).statusCode).toBe(404);
    expect((await get(admin, `/tenants/${tenantId}/payments/${ids.other}/receipt`)).statusCode).toBe(404);
  });

  it('is only for people who manage payments', async () => {
    expect((await get(member, `/tenants/${tenantId}/payments/${ids.a}/receipt`)).statusCode).toBe(403);
  });

  it('can be fetched by the payer through the service', async () => {
    const r = await h.services.payments.publicReceipt(tenantId, ids.b!);
    expect(r.name).toBe('receipt-R-000002.pdf');
    expect(r.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    await expect(h.services.payments.publicReceipt(tenantId, ids.pending!)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('several receipts', () => {
  it('come as a ZIP of separate PDFs, leaving out payments that have none', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/tenants/${tenantId}/payments/receipts`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { ids: [ids.a, ids.b, ids.failed, ids.pending, ids.other, ids.a] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['x-receipts']).toBe('2');
    expect(res.headers['x-receipts-skipped']).toBe('3'); // failed, pending, and the other organisation's
    expect(zipNames(res.rawPayload).sort()).toEqual(['receipt-R-000001.pdf', 'receipt-R-000002.pdf']);
  });

  it('refuse a list with nothing to give', async () => {
    const res = await h.call(admin, 'POST', `/tenants/${tenantId}/payments/receipts`, { ids: [ids.failed] });
    expect(res.status).toBe(400);
  });
});
