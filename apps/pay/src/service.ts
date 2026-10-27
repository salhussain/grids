import type { Kysely } from 'kysely';
import { PAY_METHODS, PAY_METHOD_INFO, surchargeFor, type MerchantDto, type MerchantInput, type MethodDto, type MethodInput, type PayMethod } from '@grids/schema';
import type { PayDB } from '@grids/db';
import type { Sealer } from './crypto.js';

export class PayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The keys a merchant's stored list holds that are still in the organisation's list of ways to pay (the first one, if none). */
const keysOf = (stored: unknown, known: string[]): string[] => {
  const have = Array.isArray(stored) ? stored.filter((k): k is string => typeof k === 'string') : [];
  const out = known.filter((k) => have.includes(k));
  return out.length ? out : known.slice(0, 1);
};

const parseJson = (s: string | null): Record<string, string> => {
  try {
    return s ? (JSON.parse(s) as Record<string, string>) : {};
  } catch {
    return {};
  }
};

export interface NewPayment {
  id: string;
  orgId: string;
  projectKey: string;
  formKey: string;
  amount: number;
  currency: string;
  description: string;
  email: string | null;
  returnUrl: string;
  merchantId: string | null;
}

/** GridPay's data: merchants, and the payments taken through them. */
export class PayService {
  constructor(
    private readonly db: Kysely<PayDB>,
    private readonly seal: Sealer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ---------- merchants (for the platform API, on behalf of an organisation) ----------

  private dto(known: string[], m: { id: string; name: string; merchant_ref: string; mode: 'test' | 'live'; enabled: boolean; credentials_enc: string | null; logo: string | null; methods: string[] }): MerchantDto {
    return { id: m.id, name: m.name, merchantRef: m.merchant_ref, mode: m.mode, enabled: m.enabled, hasKey: !!m.credentials_enc, logo: m.logo, methods: keysOf(m.methods, known) };
  }

  async merchants(orgId: string): Promise<MerchantDto[]> {
    const known = (await this.catalogue(orgId)).map((m) => m.key);
    const rows = await this.db.selectFrom('merchant').selectAll().where('org_id', '=', orgId).orderBy('created_at').execute();
    return rows.map((m) => this.dto(known, m));
  }

  // ---------- ways of paying (the organisation's own list) ----------

  /** The organisation's ways of paying. The four everyone starts with are added the first time the list is read. */
  async catalogue(orgId: string): Promise<MethodDto[]> {
    let rows = await this.db.selectFrom('pay_method').selectAll().where('org_id', '=', orgId).orderBy('sort').orderBy('created_at').execute();
    if (!rows.length) {
      await this.db
        .insertInto('pay_method')
        .values(PAY_METHODS.map((k, i) => ({ org_id: orgId, id: k, name: PAY_METHOD_INFO[k].name, kind: k, logo: null, sort: i })))
        .onConflict((oc) => oc.doNothing())
        .execute();
      rows = await this.db.selectFrom('pay_method').selectAll().where('org_id', '=', orgId).orderBy('sort').orderBy('created_at').execute();
    }
    return rows.map((r) => ({
      key: r.id,
      name: r.name,
      kind: r.kind,
      about: PAY_METHOD_INFO[r.kind].about,
      logo: r.logo,
      surchargePercent: Number(r.surcharge_percent),
      surchargeFixed: Number(r.surcharge_fixed),
      instalments: r.instalments,
    }));
  }

  async addMethod(orgId: string, input: MethodInput): Promise<MethodDto[]> {
    const list = await this.catalogue(orgId);
    if (list.length >= 30) throw new PayError(400, 'That is the most ways of paying one organisation can have.');
    await this.db
      .insertInto('pay_method')
      .values({ org_id: orgId, id: `m_${crypto.randomUUID().slice(0, 8)}`, name: input.name.trim(), kind: input.kind, logo: input.logo ?? null, sort: list.length, surcharge_percent: input.surchargePercent ?? 0, surcharge_fixed: input.surchargeFixed ?? 0, instalments: input.instalments ?? 4 })
      .execute();
    return this.catalogue(orgId);
  }

  async changeMethod(orgId: string, id: string, input: MethodInput): Promise<MethodDto[]> {
    await this.catalogue(orgId);
    const r = await this.db
      .updateTable('pay_method')
      .set({
        name: input.name.trim(),
        kind: input.kind,
        surcharge_percent: input.surchargePercent ?? 0,
        surcharge_fixed: input.surchargeFixed ?? 0,
        instalments: input.instalments ?? 4,
        ...(input.logo !== undefined && { logo: input.logo }),
      })
      .where('org_id', '=', orgId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r.numUpdatedRows) throw new PayError(404, 'Way of paying not found');
    return this.catalogue(orgId);
  }

  /** Takes a way of paying off the list, and off every merchant that offered it. At least one stays. */
  async deleteMethod(orgId: string, id: string): Promise<MethodDto[]> {
    const list = await this.catalogue(orgId);
    if (!list.some((m) => m.key === id)) throw new PayError(404, 'Way of paying not found');
    if (list.length === 1) throw new PayError(400, 'An organisation keeps at least one way of paying.');
    await this.db.deleteFrom('pay_method').where('org_id', '=', orgId).where('id', '=', id).execute();
    const rest = list.filter((m) => m.key !== id).map((m) => m.key);
    const merchants = await this.db.selectFrom('merchant').select(['id', 'methods']).where('org_id', '=', orgId).execute();
    for (const m of merchants)
      await this.db.updateTable('merchant').set({ methods: JSON.stringify(keysOf(m.methods, rest)) as unknown as string[] }).where('id', '=', m.id).execute();
    return this.catalogue(orgId);
  }

  async saveMerchant(orgId: string, id: string | null, input: MerchantInput & { id?: string }): Promise<MerchantDto[]> {
    const known = (await this.catalogue(orgId)).map((m) => m.key);
    const mode = input.mode ?? 'test';
    const existing = id ? await this.db.selectFrom('merchant').selectAll().where('id', '=', id).where('org_id', '=', orgId).executeTakeFirst() : null;
    if (id && !existing) throw new PayError(404, 'Merchant not found');
    const key = input.apiKey?.trim();
    const ref = (input.merchantRef ?? '').trim();
    if (mode === 'live' && (!ref || !(key || existing?.credentials_enc))) throw new PayError(400, 'A live merchant needs its merchant ID and API key.');
    const values = {
      name: input.name.trim(),
      merchant_ref: ref,
      credentials_enc: key ? this.seal.seal(JSON.stringify({ apiKey: key })) : (existing?.credentials_enc ?? null),
      mode,
      enabled: input.enabled ?? true,
      logo: input.logo === undefined ? (existing?.logo ?? null) : input.logo,
      methods: JSON.stringify(keysOf(input.methods ?? existing?.methods ?? [], known)) as unknown as string[],
    };
    if (existing) await this.db.updateTable('merchant').set(values).where('id', '=', existing.id).execute();
    else await this.db.insertInto('merchant').values({ id: input.id ?? crypto.randomUUID(), org_id: orgId, ...values }).execute();
    return this.merchants(orgId);
  }

  async deleteMerchant(orgId: string, id: string): Promise<MerchantDto[]> {
    const r = await this.db.deleteFrom('merchant').where('id', '=', id).where('org_id', '=', orgId).executeTakeFirst();
    if (!r.numDeletedRows) throw new PayError(404, 'Merchant not found');
    return this.merchants(orgId);
  }

  // ---------- payments ----------

  /** Opens a payment to the merchant named, or else the organisation's first one that is switched on. */
  async createPayment(p: NewPayment): Promise<{ id: string; status: string }> {
    const options = await this.db.selectFrom('merchant').select('id').where('org_id', '=', p.orgId).where('enabled', '=', true).orderBy('created_at').execute();
    if (!options.length) throw new PayError(403, 'This organisation is not taking payments at the moment.');
    const chosen = p.merchantId ? (options.find((o) => o.id === p.merchantId)?.id ?? null) : options[0]!.id;
    if (!chosen) throw new PayError(403, 'That merchant is not taking payments at the moment.');
    await this.db
      .insertInto('payment')
      .values({
        id: p.id,
        org_id: p.orgId,
        merchant_id: chosen,
        project_key: p.projectKey,
        form_key: p.formKey,
        amount: p.amount,
        currency: p.currency,
        description: p.description,
        payer_email: p.email,
        return_url: p.returnUrl,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
    return { id: p.id, status: 'pending' };
  }

  async payment(id: string) {
    const row = await this.db.selectFrom('payment').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw new PayError(404, 'Payment not found');
    return { ...row, amount: Number(row.amount), currency: row.currency.trim() };
  }

  /** What the payment page shows: what is paid for, to whom, and how. */
  async checkoutInfo(id: string) {
    const p = await this.payment(id);
    const m = p.merchant_id ? await this.db.selectFrom('merchant').select(['id', 'name', 'logo', 'mode', 'methods']).where('id', '=', p.merchant_id).executeTakeFirst() : undefined;
    const list = await this.catalogue(p.org_id);
    const offered = m ? keysOf(m.methods, list.map((x) => x.key)) : [];
    return {
      amount: p.amount,
      currency: p.currency,
      description: p.description,
      status: p.status,
      merchant: m ? { id: m.id, name: m.name, logo: m.logo, mode: m.mode, methods: offered.map((k) => list.find((x) => x.key === k)!) } : null,
    };
  }

  /** Ends a payment (once). Returns where the person goes back to. */
  async settle(id: string, status: 'succeeded' | 'failed' | 'cancelled', method: string | null = null, surcharge = 0): Promise<string> {
    const p = await this.payment(id);
    if (p.status === 'pending')
      await this.db.updateTable('payment').set({ status, method, surcharge: status === 'succeeded' ? surcharge : 0, paid_at: status === 'succeeded' ? this.now() : null }).where('id', '=', id).where('status', '=', 'pending').execute();
    return p.return_url;
  }

  /** A payment that is still open, to a merchant that offers the way of paying `key` (which must be of the `kind` the screen is for). */
  private async openFor(id: string, key: string, kind: PayMethod) {
    const p = await this.payment(id);
    if (p.status !== 'pending') throw new PayError(409, 'This payment has ended.');
    if (!p.merchant_id) throw new PayError(400, 'This payment has no merchant.');
    const m = await this.db.selectFrom('merchant').select(['mode', 'methods']).where('id', '=', p.merchant_id).executeTakeFirst();
    if (!m) throw new PayError(404, 'Merchant not found');
    const list = await this.catalogue(p.org_id);
    const way = list.find((x) => x.key === key);
    if (!way || way.kind !== kind || !keysOf(m.methods, list.map((x) => x.key)).includes(key)) throw new PayError(400, 'This merchant does not take that way of paying.');
    return { p, way, live: m.mode === 'live' };
  }

  private end(id: string, ok: boolean, method: string, message: string | null, surcharge = 0) {
    return this.settle(id, ok ? 'succeeded' : 'failed', method, surcharge).then((returnUrl) => ({ ok, message, returnUrl, ended: true }));
  }

  private static readonly NO = { ok: false, returnUrl: null, ended: false } as const;

  /**
   * Takes the card. In test mode only the well-known test cards are accepted (a real card number is refused, never
   * stored or logged); live mode needs the card processor, which is not connected yet.
   */
  async payByCard(id: string, method: string, card: { number: string; expiry: string; cvc: string; name: string }): Promise<{ ok: boolean; message: string | null; returnUrl: string | null; ended: boolean }> {
    const { p, way, live } = await this.openFor(id, method, 'card');
    if (live) return { ...PayService.NO, message: 'Live payments are not switched on yet.' };
    const digits = card.number.replace(/\s+/g, '');
    const outcomes: Record<string, 'ok' | string> = {
      '4242424242424242': 'ok',
      '5555555555554444': 'ok',
      '4000000000000002': 'Your card was declined.',
      '4000000000009995': 'Your card has insufficient funds.',
    };
    const outcome = outcomes[digits];
    if (outcome === undefined) return { ...PayService.NO, message: 'This is a test payment. Use a test card, for example 4242 4242 4242 4242.' };
    const exp = card.expiry.trim().match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/);
    const today = this.now();
    if (!exp || !/^\d{3,4}$/.test(card.cvc.trim()) || card.name.trim().length < 2) return { ...PayService.NO, message: 'Check the card details.' };
    if (2000 + Number(exp[2]) < today.getUTCFullYear() || (2000 + Number(exp[2]) === today.getUTCFullYear() && Number(exp[1]) < today.getUTCMonth() + 1))
      return { ...PayService.NO, message: 'This card has expired.' };
    return this.end(id, outcome === 'ok', method, outcome === 'ok' ? null : outcome, surchargeFor(p.amount, way));
  }

  /** A mobile wallet: the person approves on their phone (test: any number approves, one ending 0000 is declined). */
  async payByWallet(id: string, method: string, phone: string) {
    const { p, way, live } = await this.openFor(id, method, 'wallet');
    if (live) return { ...PayService.NO, message: 'Live payments are not switched on yet.' };
    const d = phone.replace(/\D/g, '');
    if (d.length < 7 || d.length > 13) return { ...PayService.NO, message: 'Enter your mobile number with the country code.' };
    return this.end(id, !d.endsWith('0000'), method, d.endsWith('0000') ? 'The wallet has insufficient balance.' : null, surchargeFor(p.amount, way));
  }

  /** Pay by bank: the person approves (or declines) the payment in their own bank (test: a pretend approval page). */
  async payByBank(id: string, method: string, approve: boolean) {
    const { p, way, live } = await this.openFor(id, method, 'bank');
    if (live) return { ...PayService.NO, message: 'Live payments are not switched on yet.' };
    return this.end(id, approve, method, approve ? null : 'The payment was declined at the bank.', surchargeFor(p.amount, way));
  }

  /** Pay later: split into instalments; the first is paid now (test: nothing is charged). */
  async payByInstalments(id: string, method: string, who: { name: string; email: string; agree: boolean }) {
    const { p, way, live } = await this.openFor(id, method, 'instalments');
    if (live) return { ...PayService.NO, message: 'Live payments are not switched on yet.' };
    if (!who.agree || who.name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(who.email.trim())) return { ...PayService.NO, message: 'Enter your name and email, and agree to the instalment plan.' };
    if (p.amount < 100 || p.amount > 200_000) return { ...PayService.NO, message: 'Paying later is available for amounts between 1.00 and 2,000.00.' };
    return this.end(id, true, method, null, surchargeFor(p.amount, way));
  }

  // ---------- telling the platform ----------

  /** Payments that have ended and whose end the platform has not yet been told. */
  async unnotified(limit = 50) {
    return this.db.selectFrom('payment').select(['id', 'status', 'paid_at', 'method', 'surcharge']).where('status', '<>', 'pending').where('notified_at', 'is', null).orderBy('created_at').limit(limit).execute();
  }

  async markNotified(id: string): Promise<void> {
    await this.db.updateTable('payment').set({ notified_at: this.now() }).where('id', '=', id).execute();
  }

  /** Merchants' credentials, for the card processor (never sent to a browser). */
  credentialsOf(enc: string | null): Record<string, string> {
    return enc ? parseJson(this.seal.open(enc)) : {};
  }
}
