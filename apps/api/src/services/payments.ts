import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import {
  feeFor,
  receiptNumber,
  type MerchantDto,
  type MerchantInput,
  type MethodInput,
  type PaymentDto,
  type PaymentFee,
  type PaymentsDto,
  type PaymentStarted,
} from '@grids/schema';
import { badRequest, conflict, forbidden, HttpError } from '../errors.js';
import { requireTenantAccess } from './authz.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { planHasFeature, requireFeature } from './features.js';
import { renderReceipt, zipFiles, type ReceiptData } from './receipts.js';
import { iso, isoOrNull } from './util.js';

/**
 * Payments organisations take from their own users (a fee on a form). The payment page, the merchants and the card
 * handling are GridPay's (a separate service, apps/pay); this keeps the platform's record of each payment, the fee the
 * plan charges on it, and puts the fees on the organisation's invoices.
 */
export class PaymentService {
  /** Whether each organisation has a merchant switched on, remembered for a few seconds. */
  private readonly open = new Map<string, { at: number; ok: boolean }>();

  constructor(private readonly ctx: ServiceContext) {}

  private get pay() {
    if (!this.ctx.pay) throw new HttpError(503, 'Payments are not available', 'The payment service is not connected.');
    return this.ctx.pay;
  }

  /** Whether this organisation can take a payment right now: its plan includes payments and a merchant is switched on. */
  async available(tenantId: string): Promise<boolean> {
    if (!(await planHasFeature(this.ctx.db, tenantId, 'payments'))) return false;
    const seen = this.open.get(tenantId);
    if (seen && Date.now() - seen.at < 15_000) return seen.ok;
    const ok = await this.pay.merchants(tenantId).then((m) => m.some((x) => x.enabled)).catch(() => false);
    this.open.set(tenantId, { at: Date.now(), ok });
    return ok;
  }

  private async fee(tenantId: string): Promise<PaymentFee | null> {
    const row = await this.ctx.db
      .selectFrom('tenant as t')
      .leftJoin('plan as p', 'p.id', 't.plan_id')
      .select('p.payment_fee')
      .where('t.id', '=', tenantId)
      .executeTakeFirst();
    return (row?.payment_fee as PaymentFee | null) ?? null;
  }

  // ---------- for the organisation's admins ----------

  async overview(actor: Actor, tenantId: string): Promise<PaymentsDto> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'billing.view', workspace: 'payments.manage' });
    const [merchants, methods] = await Promise.all([this.pay.merchants(tenantId), this.pay.methods(tenantId)]);
    const rows = await this.ctx.db.selectFrom('payment').selectAll().where('tenant_id', '=', tenantId).orderBy('created_at', 'desc').limit(200).execute();
    const unbilled = await sql<{ currency: string; amount: string; n: string }>`
      select currency, coalesce(sum(fee_amount), 0)::text as amount, count(*)::text as n
      from payment where tenant_id = ${tenantId} and status = 'succeeded' and fee_amount > 0 and fee_invoice_id is null
      group by currency order by currency`.execute(this.ctx.db);
    return {
      merchants,
      methods,
      fee: await this.fee(tenantId),
      items: rows.map((r) => this.toDto(r)),
      unbilled: unbilled.rows.map((u) => ({ amount: Number(u.amount), count: Number(u.n), currency: u.currency.trim() })),
    };
  }

  /** Payments as a CSV file, narrowed by status, form, dates and a search; up to 50,000 rows. */
  async exportCsv(actor: Actor, tenantId: string, f: { status?: string; form?: string; method?: string; from?: string; to?: string; q?: string }): Promise<string> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'billing.view', workspace: 'payments.manage' });
    let q = this.ctx.db.selectFrom('payment').selectAll().where('tenant_id', '=', tenantId);
    // Status, form and method each take several values, separated by commas.
    const many = (v?: string) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50) : []);
    const statuses = many(f.status).filter((x): x is 'pending' | 'succeeded' | 'failed' | 'cancelled' => ['pending', 'succeeded', 'failed', 'cancelled'].includes(x));
    if (statuses.length) q = q.where('status', 'in', statuses);
    const forms = many(f.form);
    if (forms.length) q = q.where(sql<boolean>`(project_key || '/' || form_key) in (${sql.join(forms)})`);
    const methods = many(f.method);
    if (methods.length) q = q.where('method', 'in', methods);
    if (f.from) q = q.where('created_at', '>=', new Date(`${f.from}T00:00:00Z`));
    if (f.to) q = q.where('created_at', '<', new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000));
    if (f.q) {
      const like = `%${f.q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
      q = q.where((eb) => eb.or([eb('description', 'ilike', like), eb('payer_email', 'ilike', like), eb('form_key', 'ilike', like)]));
    }
    const rows = await q.orderBy('created_at', 'desc').limit(50_000).execute();
    // A cell that starts like a formula would be run by a spreadsheet: it is made plain text.
    const cell = (v: unknown) => {
      let t = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
      return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const money = (minor: string | number) => (Number(minor) / 100).toFixed(2);
    const names = new Map((await this.pay.methods(tenantId).catch(() => [])).map((m) => [m.key, m.name]));
    const head = ['Date', 'Paid at', 'Status', 'Amount', 'Surcharge', 'Fee', 'Currency', 'Project', 'Form', 'Description', 'Payer email', 'Method', 'Payment ID', 'Submission ID'];
    const lines = rows.map((r) =>
      [iso(r.created_at), isoOrNull(r.paid_at), r.status, money(r.amount), money(r.surcharge), money(r.fee_amount), r.currency.trim(), r.project_key, r.form_key, r.description, r.payer_email, r.method ? (names.get(r.method) ?? r.method) : '', r.id, r.submission_id].map(cell).join(','),
    );
    return `\ufeff${[head.join(','), ...lines].join('\r\n')}\r\n`;
  }

  private toDto(r: {
    id: string; status: PaymentDto['status']; amount: string | number; currency: string; description: string; payer_email: string | null;
    project_key: string; form_key: string; fee_amount: string | number; fee_invoice_id: string | null; created_at: Date; paid_at: Date | null; method: string | null; surcharge: string | number; receipt_no: string | number | null;
  }): PaymentDto {
    return {
      id: r.id,
      status: r.status,
      amount: Number(r.amount),
      currency: r.currency.trim(),
      description: r.description,
      payerEmail: r.payer_email,
      project: r.project_key,
      form: r.form_key,
      fee: Number(r.fee_amount),
      invoiced: !!r.fee_invoice_id,
      createdAt: iso(r.created_at),
      paidAt: isoOrNull(r.paid_at),
      method: r.method,
      surcharge: Number(r.surcharge),
      receiptNo: r.receipt_no === null ? null : receiptNumber(r.receipt_no),
    };
  }

  /** Adds a merchant to GridPay, or changes one (a blank API key keeps the stored one). */
  async saveMerchant(actor: Actor, tenantId: string, id: string | null, input: MerchantInput): Promise<PaymentsDto> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'billing.subscriptions', workspace: 'payments.manage' });
    await requireFeature(this.ctx.db, tenantId, 'payments', 'Payments');
    await this.pay.saveMerchant(tenantId, id, input);
    this.open.delete(tenantId);
    await audit(this.ctx, actor.id, tenantId, id ? 'payments.merchant_changed' : 'payments.merchant_added', { name: input.name, mode: input.mode ?? 'test', enabled: input.enabled ?? true });
    return this.overview(actor, tenantId);
  }

  /** Adds a way of paying to the organisation's list. */
  async addMethod(actor: Actor, tenantId: string, input: MethodInput): Promise<PaymentsDto> {
    await this.manage(actor, tenantId);
    await this.pay.addMethod(tenantId, input);
    await audit(this.ctx, actor.id, tenantId, 'payments.method_added', { name: input.name, kind: input.kind });
    return this.overview(actor, tenantId);
  }

  async changeMethod(actor: Actor, tenantId: string, key: string, input: MethodInput): Promise<PaymentsDto> {
    await this.manage(actor, tenantId);
    await this.pay.changeMethod(tenantId, key, input);
    return this.overview(actor, tenantId);
  }

  async deleteMethod(actor: Actor, tenantId: string, key: string): Promise<PaymentsDto> {
    await this.manage(actor, tenantId);
    await this.pay.deleteMethod(tenantId, key);
    await audit(this.ctx, actor.id, tenantId, 'payments.method_removed', { method: key });
    return this.overview(actor, tenantId);
  }

  private async manage(actor: Actor, tenantId: string) {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'billing.subscriptions', workspace: 'payments.manage' });
    await requireFeature(this.ctx.db, tenantId, 'payments', 'Payments');
  }

  async deleteMerchant(actor: Actor, tenantId: string, id: string): Promise<PaymentsDto> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'billing.subscriptions', workspace: 'payments.manage' });
    await this.pay.deleteMerchant(tenantId, id);
    this.open.delete(tenantId);
    await audit(this.ctx, actor.id, tenantId, 'payments.merchant_removed', { merchant: id });
    return this.overview(actor, tenantId);
  }

  // ---------- the person paying (through a form) ----------

  /** Whether a return address is one of this organisation's own pages (so the provider cannot be used to send people elsewhere). */
  private async allowedReturn(tenantId: string, url: string): Promise<boolean> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    if (u.origin === new URL(this.ctx.workspaceUrl).origin) return true;
    if (host === 'localhost' || host === '127.0.0.1') return !this.ctx.workspaceUrl.startsWith('https://');
    if (host.endsWith(`.${this.ctx.baseDomain}`)) return true;
    const d = await this.ctx.db.selectFrom('tenant_domain').select('id').where('tenant_id', '=', tenantId).where('hostname', '=', host).where('status', '=', 'verified').executeTakeFirst();
    return !!d;
  }

  async start(
    tenantId: string,
    form: { project: string; form: string; amount: number; currency: string; description: string; merchantId: string | null },
    input: { returnUrl: string; email?: string },
  ): Promise<PaymentStarted> {
    if (!(await this.available(tenantId))) throw forbidden('This organisation is not taking payments at the moment.');
    if (!(await this.allowedReturn(tenantId, input.returnUrl))) throw badRequest('That return address is not allowed.');
    const id = randomUUID();
    await this.ctx.db
      .insertInto('payment')
      .values({
        id,
        tenant_id: tenantId,
        provider: 'gridpay',
        project_key: form.project,
        form_key: form.form,
        amount: form.amount,
        currency: form.currency,
        description: form.description,
        payer_email: input.email ?? null,
      })
      .execute();
    try {
      const r = await this.pay.createPayment({
        id,
        orgId: tenantId,
        projectKey: form.project,
        formKey: form.form,
        amount: form.amount,
        currency: form.currency,
        description: form.description,
        email: input.email ?? null,
        returnUrl: input.returnUrl,
        merchantId: form.merchantId,
      });
      return { paymentId: id, redirectUrl: r.checkoutUrl };
    } catch (e) {
      await this.ctx.db.updateTable('payment').set({ status: 'failed' }).where('id', '=', id).execute();
      throw e;
    }
  }

  /** The merchants a form can be set to pay (names and logos only: no secrets). */
  async merchantChoices(actor: Actor, tenantId: string): Promise<Pick<MerchantDto, 'id' | 'name' | 'mode' | 'enabled' | 'logo' | 'methods'>[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'billing.view', workspace: 'org.view' });
    if (!(await planHasFeature(this.ctx.db, tenantId, 'payments'))) return [];
    return (await this.pay.merchants(tenantId)).map(({ id, name, mode, enabled, logo, methods }) => ({ id, name, mode, enabled, logo, methods }));
  }

  /** How a payment stands. A pending one is checked with GridPay, in case the news of its end has not arrived. */
  async stateOf(tenantId: string, paymentId: string): Promise<'pending' | 'succeeded' | 'failed' | 'cancelled'> {
    const row = await this.ctx.db.selectFrom('payment').select(['status']).where('id', '=', paymentId).where('tenant_id', '=', tenantId).executeTakeFirst();
    if (!row) throw new HttpError(404, 'Payment not found');
    if (row.status !== 'pending') return row.status;
    const remote = await this.pay.payment(paymentId).catch(() => null);
    if (remote && remote.status !== 'pending') {
      await this.settle(paymentId, remote.status, remote.paidAt, null);
      return remote.status;
    }
    return 'pending';
  }

  /** A payment ended (GridPay says so): record how, and the fee the plan charges on a successful one. Once only. */
  async settle(paymentId: string, status: 'succeeded' | 'failed' | 'cancelled', paidAt: string | null = null, method: string | null = null, surcharge = 0): Promise<void> {
    const row = await this.ctx.db.selectFrom('payment').selectAll().where('id', '=', paymentId).executeTakeFirst();
    if (!row || row.status !== 'pending') return;
    const fee = status === 'succeeded' ? feeFor(Number(row.amount), await this.fee(row.tenant_id)) : 0;
    // The receipt number is taken in the same step as the payment's success, so numbers neither repeat nor skip.
    const done = await this.ctx.db.transaction().execute(async (trx) => {
      const r = await trx
        .updateTable('payment')
        .set({ status, method, surcharge: status === 'succeeded' ? surcharge : 0, fee_amount: fee, paid_at: status === 'succeeded' ? (paidAt ? new Date(paidAt) : this.ctx.now()) : null })
        .where('id', '=', paymentId)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (!r.numUpdatedRows) return false;
      if (status === 'succeeded') {
        const n = await sql<{ last: string }>`
          insert into tenant_receipt_counter (tenant_id, last) values (${row.tenant_id}, 1)
          on conflict (tenant_id) do update set last = tenant_receipt_counter.last + 1
          returning last`.execute(trx);
        await trx.updateTable('payment').set({ receipt_no: n.rows[0]!.last }).where('id', '=', paymentId).execute();
      }
      return true;
    });
    if (done && status === 'succeeded')
      await audit(this.ctx, null, row.tenant_id, 'payment.succeeded', { payment: paymentId, amount: Number(row.amount), currency: row.currency.trim() });
  }

  // ---------- receipts ----------

  /** The data of a receipt for each of these payments (only ones that succeeded have one). */
  private async receiptData(tenantId: string, ids: string[]): Promise<ReceiptData[]> {
    const rows = await this.ctx.db.selectFrom('payment').selectAll().where('tenant_id', '=', tenantId).where('id', 'in', ids).where('status', '=', 'succeeded').orderBy('receipt_no').execute();
    if (!rows.length) return [];
    const org = await this.ctx.db.selectFrom('tenant').select('name').where('id', '=', tenantId).executeTakeFirstOrThrow();
    // Names of the ways to pay come from GridPay; without it the key is shown instead.
    const names = new Map((await Promise.resolve().then(() => this.pay.methods(tenantId)).catch(() => [])).map((m) => [m.key, m.name]));
    return rows.map((r) => ({
      organisation: org.name,
      number: receiptNumber(r.receipt_no ?? 0),
      paidAt: r.paid_at ?? r.created_at,
      description: r.description,
      form: `${r.project_key}/${r.form_key}`,
      payerEmail: r.payer_email,
      method: r.method ? (names.get(r.method) ?? r.method) : null,
      amount: Number(r.amount),
      surcharge: Number(r.surcharge),
      currency: r.currency.trim(),
      paymentId: r.id,
    }));
  }

  /** One receipt as a PDF, for the organisation's admins. */
  async receipt(actor: Actor, tenantId: string, id: string): Promise<{ name: string; pdf: Buffer }> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'billing.view', workspace: 'payments.manage' });
    return this.receiptFile(tenantId, id);
  }

  /** The receipt for the person who paid: the payment's own id is the proof they were there. */
  async publicReceipt(tenantId: string, id: string): Promise<{ name: string; pdf: Buffer }> {
    await this.stateOf(tenantId, id).catch(() => undefined);
    return this.receiptFile(tenantId, id);
  }

  private async receiptFile(tenantId: string, id: string) {
    const [data] = await this.receiptData(tenantId, [id]);
    if (!data) throw new HttpError(404, 'No receipt', 'Only payments that went through have a receipt.');
    return { name: `receipt-${data.number}.pdf`, pdf: await renderReceipt(data) };
  }

  /** Several receipts as a ZIP of separate PDFs. Payments without a receipt (not paid) are left out. */
  async receiptsZip(actor: Actor, tenantId: string, ids: string[]): Promise<{ zip: Buffer; count: number; skipped: number }> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'billing.view', workspace: 'payments.manage' });
    const unique = [...new Set(ids)];
    const data = await this.receiptData(tenantId, unique);
    if (!data.length) throw badRequest('None of these payments has a receipt', 'Only payments that went through have a receipt.');
    const files = [];
    for (const d of data) files.push({ name: `receipt-${d.number}.pdf`, data: await renderReceipt(d) });
    return { zip: zipFiles(files), count: files.length, skipped: unique.length - files.length };
  }

  /** Before a form is sent: the payment it needs must have gone through, for this form and amount, and not been used. */
  async requirePaid(tenantId: string, paymentId: string | null, form: { project: string; form: string; amount: number }): Promise<void> {
    if (!paymentId) throw new HttpError(402, 'Payment required', 'This form needs a payment before it can be sent.');
    await this.stateOf(tenantId, paymentId).catch(() => undefined);
    const row = await this.ctx.db.selectFrom('payment').selectAll().where('id', '=', paymentId).where('tenant_id', '=', tenantId).executeTakeFirst();
    if (!row || row.status !== 'succeeded' || row.project_key !== form.project || row.form_key !== form.form || Number(row.amount) !== form.amount)
      throw new HttpError(402, 'Payment required', 'The payment was not completed.');
    if (row.submission_id) throw conflict('Payment already used', 'This payment has already been used for a form.');
  }

  /** Ties the payment to the submission it paid for (once). */
  async claim(tenantId: string, paymentId: string, submissionId: string): Promise<void> {
    const r = await this.ctx.db
      .updateTable('payment')
      .set({ submission_id: submissionId })
      .where('id', '=', paymentId)
      .where('tenant_id', '=', tenantId)
      .where('submission_id', 'is', null)
      .executeTakeFirst();
    if (!r.numUpdatedRows) throw conflict('Payment already used', 'This payment has already been used for a form.');
  }
}
