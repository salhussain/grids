import { sql } from 'kysely';
import type { InvoiceLine } from '@grids/db';
import {
  formatMoney,
  uuidv7,
  type BillingOverview,
  type ChangeSubscriptionInput,
  type CreateSubscriptionInput,
  type InvoiceDto,
  type InvoiceListQuery,
  type OrgBillingDto,
  type Page,
  type SubscriptionListQuery,
  type PlanLimits,
  type RecordPaymentInput,
  type SubscriptionDto,
  LIMIT_KEYS,
} from '@grids/schema';
import { conflict, notFound } from '../errors.js';
import { requireStaff, requireTenantAccess } from './authz.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { assertWithinLimit } from './entitlements.js';
import type { Provisioner } from './provisioning.js';
import {
  addDays,
  addInterval,
  applyDiscount,
  combineDiscounts,
  iso,
  isoOrNull,
  mapPage,
  paginate,
} from './util.js';

const PAYMENT_TERMS_DAYS = 14;

/**
 * Subscriptions and invoicing. Payments are recorded manually for now (bank
 * transfer, card terminal, …); a payment-provider adapter (Stripe) plugs in at
 * `recordPayment`. Amounts are integers in minor units.
 */
export class BillingService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly deps: {
      provisioner: Provisioner;
      seatsUsed: (tenantId: string) => Promise<number>;
      projectsUsed?: (tenantId: string) => Promise<number>;
    },
  ) {}

  // ---------- subscriptions ----------

  async currentSubscription(tenantId: string): Promise<SubscriptionDto | null> {
    const row = await this.subscriptionQuery()
      .where('s.tenant_id', '=', tenantId)
      .where('s.status', '<>', 'cancelled')
      .executeTakeFirst();
    return row ? toSubscriptionDto(row) : null;
  }

  async listSubscriptions(
    query: Partial<SubscriptionListQuery> = {},
  ): Promise<Page<SubscriptionDto>> {
    let q = this.subscriptionQuery().orderBy('s.created_at', 'desc');
    if (query.status) q = q.where('s.status', '=', query.status);
    return mapPage(
      await paginate(q, { page: query.page ?? 1, pageSize: query.pageSize ?? 25 }),
      toSubscriptionDto,
    );
  }

  /**
   * Starts a subscription. Free plans and trials provision the organisation
   * immediately; paid plans issue the first invoice and wait for payment.
   */
  async subscribe(
    actor: Actor,
    tenantId: string,
    input: Required<CreateSubscriptionInput>,
  ): Promise<SubscriptionDto> {
    requireStaff(actor, 'billing.subscriptions');
    const { db } = this.ctx;
    const tenant = await db
      .selectFrom('tenant')
      .selectAll()
      .where('id', '=', tenantId)
      .executeTakeFirst();
    if (!tenant) throw notFound('Organisation');
    if (tenant.status === 'cancelled') throw conflict('Organisation is cancelled');
    if (await this.currentSubscription(tenantId))
      throw conflict('Already subscribed', 'Change the existing subscription instead.');
    const plan = await db
      .selectFrom('plan')
      .selectAll()
      .where('id', '=', input.planId)
      .executeTakeFirst();
    if (!plan || plan.is_archived) throw notFound('Plan');

    const now = this.ctx.now();
    const price = pricing(plan, input.interval, input.extraDiscountPct);
    const free = price.amount === 0;
    const trial = !free && input.trial && plan.trial_days > 0;
    const status = free ? 'active' : trial ? 'trialing' : 'pending_payment';
    const periodEnd = trial ? addDays(now, plan.trial_days) : addInterval(now, input.interval);

    const id = uuidv7();
    await db.transaction().execute(async (tx) => {
      await tx
        .insertInto('subscription')
        .values({
          id,
          tenant_id: tenantId,
          plan_id: plan.id,
          interval: input.interval,
          unit_price: price.unitPrice,
          discount_pct: price.discountPct,
          extra_discount_pct: input.extraDiscountPct,
          currency: plan.currency,
          status,
          trial_ends_at: trial ? periodEnd : null,
          current_period_start: status === 'pending_payment' ? null : now,
          current_period_end: status === 'pending_payment' ? null : periodEnd,
        })
        .execute();
      await tx.updateTable('tenant').set({ plan_id: plan.id }).where('id', '=', tenantId).execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'subscription.created', {
      plan: plan.id,
      interval: input.interval,
      status,
      amount: formatMoney(price.amount, plan.currency.trim()),
    });

    if (status === 'pending_payment') {
      await this.issueInvoice(actor, id, now, addInterval(now, input.interval));
    } else if (tenant.status === 'pending_payment') {
      await this.deps.provisioner.provision(actor.id, tenantId);
    }
    return (await this.currentSubscription(tenantId))!;
  }

  /** Plan/interval changes apply from the next invoice (no proration yet). */
  async changeSubscription(
    actor: Actor,
    tenantId: string,
    input: ChangeSubscriptionInput,
  ): Promise<SubscriptionDto> {
    requireStaff(actor, 'billing.subscriptions');
    const { db } = this.ctx;
    const sub = await db
      .selectFrom('subscription')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('status', '<>', 'cancelled')
      .executeTakeFirst();
    if (!sub) throw notFound('Subscription');

    const planId = input.planId ?? sub.plan_id;
    const interval = input.interval ?? sub.interval;
    const changes: Record<string, unknown> = {};
    const update: Record<string, unknown> = {};

    if (planId !== sub.plan_id || interval !== sub.interval) {
      const plan = await db
        .selectFrom('plan')
        .selectAll()
        .where('id', '=', planId)
        .executeTakeFirst();
      if (!plan || plan.is_archived) throw notFound('Plan');
      // A downgrade must not leave the organisation above its new limits.
      assertWithinLimit(plan.limits as PlanLimits, 'users', await this.deps.seatsUsed(tenantId), 0);
      const price = pricing(plan, interval, Number(sub.extra_discount_pct));
      Object.assign(update, {
        plan_id: planId,
        interval,
        unit_price: price.unitPrice,
        discount_pct: price.discountPct,
        currency: plan.currency,
      });
      if (planId !== sub.plan_id) changes.plan = `${sub.plan_id} → ${planId}`;
      if (interval !== sub.interval) changes.interval = `${sub.interval} → ${interval}`;
    }
    if (
      input.cancelAtPeriodEnd !== undefined &&
      input.cancelAtPeriodEnd !== sub.cancel_at_period_end
    ) {
      update.cancel_at_period_end = input.cancelAtPeriodEnd;
      changes.cancelAtPeriodEnd = input.cancelAtPeriodEnd;
    }
    if (Object.keys(update).length) {
      await db.updateTable('subscription').set(update).where('id', '=', sub.id).execute();
      if (update.plan_id)
        await db
          .updateTable('tenant')
          .set({ plan_id: planId })
          .where('id', '=', tenantId)
          .execute();
      await audit(this.ctx, actor.id, tenantId, 'subscription.changed', changes);
    }
    return (await this.currentSubscription(tenantId))!;
  }

  /** Cancels immediately and voids open invoices; used when an organisation is cancelled. */
  async cancelForTenant(actor: Actor, tenantId: string): Promise<void> {
    const { db } = this.ctx;
    const sub = await db
      .selectFrom('subscription')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('status', '<>', 'cancelled')
      .executeTakeFirst();
    if (!sub) return;
    await db
      .updateTable('subscription')
      .set({ status: 'cancelled', cancelled_at: this.ctx.now() })
      .where('id', '=', sub.id)
      .execute();
    await db
      .updateTable('invoice')
      .set({ status: 'void', voided_at: this.ctx.now() })
      .where('subscription_id', '=', sub.id)
      .where('status', '=', 'open')
      .execute();
    await audit(this.ctx, actor.id, tenantId, 'subscription.cancelled');
  }

  // ---------- organisation self-service (workspace › Billing) ----------

  private async orgAccess(actor: Actor, tenantId: string) {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'billing.view',
      workspace: 'billing.view',
    });
  }

  /** Subscription, next charge, usage against limits and the outstanding balance. */
  async orgBilling(actor: Actor, tenantId: string): Promise<OrgBillingDto> {
    await this.orgAccess(actor, tenantId);
    const { db } = this.ctx;
    const subscription = await this.currentSubscription(tenantId);
    const plan = subscription
      ? await db
          .selectFrom('plan')
          .select(['name', 'description', 'features', 'limits'])
          .where('id', '=', subscription.planId)
          .executeTakeFirst()
      : undefined;
    const limits = (plan?.limits as PlanLimits | undefined) ?? null;
    const seats = await this.deps.seatsUsed(tenantId);
    const projectCount = (await this.deps.projectsUsed?.(tenantId)) ?? 0;

    let upcoming: OrgBillingDto['upcoming'] = null;
    const renews =
      subscription &&
      ['active', 'trialing', 'past_due'].includes(subscription.status) &&
      !subscription.cancelAtPeriodEnd;
    const date =
      subscription?.status === 'trialing' ? subscription.trialEndsAt : subscription?.currentPeriodEnd;
    if (renews && date) {
      const start = new Date(date);
      const end = addInterval(start, subscription.interval);
      const lines = [
        {
          description: `${subscription.planName} plan — ${subscription.interval} (${iso(start).slice(0, 10)} to ${iso(end).slice(0, 10)})`,
          quantity: 1,
          unitAmount: subscription.unitPrice,
          amount: subscription.unitPrice,
        },
      ];
      if (subscription.discountPct > 0) {
        const off = subscription.amount - subscription.unitPrice;
        lines.push({
          description: `Discount (${subscription.discountPct}%)`,
          quantity: 1,
          unitAmount: off,
          amount: off,
        });
      }
      upcoming = { date, currency: subscription.currency, lines, total: subscription.amount };
    }

    const open = await db
      .selectFrom('invoice')
      .select((eb) => [
        eb.fn.countAll<string>().as('n'),
        eb.fn.coalesce(eb.fn.sum<string>('total'), eb.lit(0)).as('amount'),
        eb.fn
          .count<string>('id')
          .filterWhere('due_at', '<', this.ctx.now())
          .as('overdue'),
      ])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'open')
      .executeTakeFirstOrThrow();
    const contact = await db
      .selectFrom('tenant_contact')
      .select(['name', 'email', 'kind'])
      .where('tenant_id', '=', tenantId)
      .where('kind', 'in', ['billing', 'primary'])
      .execute();
    const billingContact = contact.find((c) => c.kind === 'billing') ?? contact[0];
    const tenant = await db
      .selectFrom('tenant')
      .select('currency')
      .where('id', '=', tenantId)
      .executeTakeFirstOrThrow();

    return {
      subscription,
      plan: plan
        ? {
            name: plan.name,
            description: plan.description,
            features: (plan.features as string[]) ?? [],
            limits: limits ?? (Object.fromEntries(LIMIT_KEYS.map((k) => [k, null])) as PlanLimits),
          }
        : null,
      usage: LIMIT_KEYS.map((key) => ({
        key,
        used: key === 'users' ? seats : key === 'projects' ? projectCount : null,
        limit: limits?.[key] ?? null,
      })),
      upcoming,
      outstanding: {
        currency: subscription?.currency ?? tenant.currency.trim(),
        amount: Number(open.amount),
        count: Number(open.n),
        overdue: Number(open.overdue),
      },
      billingContact:
        billingContact?.email && billingContact.name
          ? { name: billingContact.name, email: billingContact.email }
          : null,
    };
  }

  async orgInvoices(
    actor: Actor,
    tenantId: string,
    query: { page?: number; pageSize?: number },
  ): Promise<Page<InvoiceDto>> {
    await this.orgAccess(actor, tenantId);
    return this.listInvoices({ ...query, tenantId });
  }

  async orgInvoice(actor: Actor, tenantId: string, invoiceId: string): Promise<InvoiceDto> {
    await this.orgAccess(actor, tenantId);
    const invoice = await this.getInvoice(invoiceId);
    if (invoice.tenantId !== tenantId) throw notFound('Invoice');
    return invoice;
  }

  // ---------- invoices ----------

  /** Issues the invoice for the period after the current one (renewal). */
  async issueRenewal(actor: Actor, tenantId: string): Promise<InvoiceDto> {
    requireStaff(actor, 'billing.invoices');
    const sub = await this.ctx.db
      .selectFrom('subscription')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['active', 'trialing', 'past_due'])
      .executeTakeFirst();
    if (!sub || !sub.current_period_end) throw conflict('No active subscription to renew');
    const open = await this.ctx.db
      .selectFrom('invoice')
      .select('number')
      .where('subscription_id', '=', sub.id)
      .where('status', '=', 'open')
      .executeTakeFirst();
    if (open) throw conflict('Invoice already open', `${open.number} is still awaiting payment.`);
    const start = sub.current_period_end;
    return this.issueInvoice(actor, sub.id, start, addInterval(start, sub.interval));
  }

  async listInvoices(query: Partial<InvoiceListQuery> = {}): Promise<Page<InvoiceDto>> {
    let q = this.invoiceQuery().orderBy('i.issued_at', 'desc');
    if (query.status) q = q.where('i.status', '=', query.status);
    if (query.tenantId) q = q.where('i.tenant_id', '=', query.tenantId);
    if (query.overdue) q = q.where('i.status', '=', 'open').where('i.due_at', '<', this.ctx.now());
    return mapPage(
      await paginate(q, { page: query.page ?? 1, pageSize: query.pageSize ?? 25 }),
      (r) => toInvoiceDto(r, this.ctx.now()),
    );
  }

  async getInvoice(id: string): Promise<InvoiceDto> {
    const row = await this.invoiceQuery().where('i.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Invoice');
    return toInvoiceDto(row, this.ctx.now());
  }

  /**
   * Marks an invoice paid. The first payment activates the subscription and
   * provisions the organisation; later payments advance the billing period.
   */
  async recordPayment(
    actor: Actor,
    invoiceId: string,
    input: RecordPaymentInput,
  ): Promise<InvoiceDto> {
    requireStaff(actor, 'billing.payments');
    const { db } = this.ctx;
    const inv = await db
      .selectFrom('invoice')
      .selectAll()
      .where('id', '=', invoiceId)
      .executeTakeFirst();
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'open') throw conflict(`Invoice is ${inv.status}`);
    const paidAt = input.paidAt ? new Date(input.paidAt) : this.ctx.now();

    await db.transaction().execute(async (tx) => {
      const claimed = await tx
        .updateTable('invoice')
        .set({
          status: 'paid',
          paid_at: paidAt,
          payment_method: input.method,
          payment_reference: input.reference ?? null,
        })
        .where('id', '=', invoiceId)
        .where('status', '=', 'open')
        .executeTakeFirst();
      if (claimed.numUpdatedRows === 0n) throw conflict('Invoice already settled');
      if (inv.subscription_id) {
        await tx
          .updateTable('subscription')
          .set({
            status: 'active',
            trial_ends_at: null,
            current_period_start: inv.period_start,
            current_period_end: inv.period_end,
          })
          .where('id', '=', inv.subscription_id)
          .where('status', '<>', 'cancelled')
          .execute();
      }
    });
    await audit(this.ctx, actor.id, inv.tenant_id, 'invoice.paid', {
      invoice: inv.number,
      amount: formatMoney(inv.total, inv.currency.trim()),
      method: input.method,
      ...(input.reference && { reference: input.reference }),
    });

    const tenant = await db
      .selectFrom('tenant')
      .select(['status', 'name'])
      .where('id', '=', inv.tenant_id)
      .executeTakeFirstOrThrow();
    if (tenant.status === 'pending_payment' || tenant.status === 'provisioning') {
      await this.deps.provisioner.provision(actor.id, inv.tenant_id);
    }
    const to = await this.billingEmail(inv.tenant_id);
    if (to) {
      await this.ctx.email.send('payment_receipt', inv.tenant_id, {
        to,
        subject: `Receipt for invoice ${inv.number}`,
        text: `Thank you. We received ${formatMoney(inv.total, inv.currency.trim())} for invoice ${inv.number} (${tenant.name}).

Payment method: ${input.method.replace('_', ' ')}${input.reference ? `\nReference: ${input.reference}` : ''}
Paid on: ${paidAt.toDateString()}

— The Grids team`,
      });
    }
    return this.getInvoice(invoiceId);
  }

  async voidInvoice(actor: Actor, invoiceId: string): Promise<InvoiceDto> {
    requireStaff(actor, 'billing.invoices');
    const inv = await this.ctx.db
      .selectFrom('invoice')
      .selectAll()
      .where('id', '=', invoiceId)
      .executeTakeFirst();
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'open') throw conflict(`Invoice is ${inv.status}`);
    await this.ctx.db
      .updateTable('invoice')
      .set({ status: 'void', voided_at: this.ctx.now() })
      .where('id', '=', invoiceId)
      .execute();
    await audit(this.ctx, actor.id, inv.tenant_id, 'invoice.voided', { invoice: inv.number });
    return this.getInvoice(invoiceId);
  }

  // ---------- reporting ----------

  async overview(): Promise<BillingOverview> {
    const { db } = this.ctx;
    const now = this.ctx.now();
    const totals = await sql<{
      currency: string;
      mrr: string;
      outstanding: string;
      overdue: string;
      collected30d: string;
    }>`
      with cur as (
        select distinct currency from subscription
        union select distinct currency from invoice
      )
      select cur.currency,
        coalesce((select sum(${mrrSql}) from subscription s
                   where s.currency = cur.currency and s.status in ('active', 'past_due')), 0)::text as mrr,
        coalesce((select sum(total) from invoice where currency = cur.currency and status = 'open'), 0)::text as outstanding,
        coalesce((select sum(total) from invoice where currency = cur.currency and status = 'open' and due_at < ${now}), 0)::text as overdue,
        coalesce((select sum(total) from invoice where currency = cur.currency and status = 'paid'
                   and paid_at > ${addDays(now, -30)}), 0)::text as collected30d
      from cur order by cur.currency
    `.execute(db);

    const revenue = await sql<{ month: string; currency: string; amount: string }>`
      select to_char(date_trunc('month', paid_at), 'YYYY-MM') as month, currency, sum(total)::text as amount
      from invoice
      where status = 'paid' and paid_at >= date_trunc('month', ${now}::timestamptz) - interval '11 months'
      group by 1, 2 order by 1
    `.execute(db);

    const mix = await sql<{
      plan_id: string;
      plan_name: string;
      subscriptions: string;
      mrr: string;
      currency: string;
    }>`
      select p.id as plan_id, p.name as plan_name, count(s.id)::text as subscriptions,
             coalesce(sum(${mrrSql}) filter (where s.status in ('active', 'past_due')), 0)::text as mrr, p.currency
      from plan p join subscription s on s.plan_id = p.id and s.status <> 'cancelled'
      group by p.id order by p.sort_order
    `.execute(db);

    const byStatus = await db
      .selectFrom('subscription')
      .select(['status', (eb) => eb.fn.countAll<string>().as('n')])
      .groupBy('status')
      .execute();

    return {
      totals: totals.rows.map((r) => ({
        currency: r.currency.trim(),
        mrr: Number(r.mrr),
        arr: Number(r.mrr) * 12,
        outstanding: Number(r.outstanding),
        overdue: Number(r.overdue),
        collected30d: Number(r.collected30d),
      })),
      revenueByMonth: revenue.rows.map((r) => ({
        month: r.month,
        currency: r.currency.trim(),
        amount: Number(r.amount),
      })),
      planMix: mix.rows.map((r) => ({
        planId: r.plan_id,
        planName: r.plan_name,
        subscriptions: Number(r.subscriptions),
        mrr: Number(r.mrr),
        currency: r.currency.trim(),
      })),
      subscriptionsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
    };
  }

  // ---------- internals ----------

  private async issueInvoice(
    actor: Actor,
    subscriptionId: string,
    start: Date,
    end: Date,
  ): Promise<InvoiceDto> {
    const { db } = this.ctx;
    const sub = await db
      .selectFrom('subscription as s')
      .innerJoin('plan as p', 'p.id', 's.plan_id')
      .innerJoin('tenant as t', 't.id', 's.tenant_id')
      .select([
        's.id',
        's.tenant_id',
        's.interval',
        's.unit_price',
        's.discount_pct',
        's.currency',
        'p.name as plan_name',
        't.name as tenant_name',
      ])
      .where('s.id', '=', subscriptionId)
      .executeTakeFirstOrThrow();
    const discountPct = Number(sub.discount_pct);
    const total = applyDiscount(sub.unit_price, discountPct);
    const lines: InvoiceLine[] = [
      {
        description: `${sub.plan_name} plan — ${sub.interval} (${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)})`,
        quantity: 1,
        unitAmount: sub.unit_price,
        amount: sub.unit_price,
      },
    ];
    if (discountPct > 0) {
      lines.push({
        description: `Discount (${discountPct}%)`,
        quantity: 1,
        unitAmount: total - sub.unit_price,
        amount: total - sub.unit_price,
      });
    }
    const seq = await sql<{ n: string }>`select nextval('invoice_number_seq')::text as n`.execute(
      db,
    );
    const number = `INV-${this.ctx.now().getUTCFullYear()}-${seq.rows[0]!.n.padStart(5, '0')}`;
    const id = uuidv7();
    const dueAt = addDays(this.ctx.now(), PAYMENT_TERMS_DAYS);
    await db
      .insertInto('invoice')
      .values({
        id,
        number,
        tenant_id: sub.tenant_id,
        subscription_id: sub.id,
        status: 'open',
        currency: sub.currency,
        subtotal: sub.unit_price,
        discount: sub.unit_price - total,
        total,
        lines: JSON.stringify(lines),
        period_start: start,
        period_end: end,
        due_at: dueAt,
      })
      .execute();
    const amount = formatMoney(total, sub.currency.trim());
    await audit(this.ctx, actor.id, sub.tenant_id, 'invoice.issued', { invoice: number, amount });

    const to = await this.billingEmail(sub.tenant_id);
    if (to) {
      await this.ctx.email.send('invoice_issued', sub.tenant_id, {
        to,
        subject: `Invoice ${number} from Grids — ${amount}`,
        text: `Hello,

A new invoice is ready for ${sub.tenant_name}.

Invoice:   ${number}
Amount:    ${amount}
Period:    ${start.toDateString()} – ${end.toDateString()}
Due:       ${dueAt.toDateString()}

${lines.map((l) => `  ${l.description}: ${formatMoney(l.amount, sub.currency.trim())}`).join('\n')}

Pay by bank transfer quoting ${number}, or reply to arrange card payment.

— The Grids team`,
      });
    }
    return this.getInvoice(id);
  }

  private async billingEmail(tenantId: string): Promise<string | null> {
    const contacts = await this.ctx.db
      .selectFrom('tenant_contact')
      .select(['kind', 'email'])
      .where('tenant_id', '=', tenantId)
      .execute();
    return (
      (contacts.find((c) => c.kind === 'billing') ?? contacts.find((c) => c.kind === 'primary'))
        ?.email ?? null
    );
  }

  private subscriptionQuery() {
    return this.ctx.db
      .selectFrom('subscription as s')
      .innerJoin('plan as p', 'p.id', 's.plan_id')
      .innerJoin('tenant as t', 't.id', 's.tenant_id')
      .selectAll('s')
      .select(['p.name as plan_name', 't.name as tenant_name']);
  }

  private invoiceQuery() {
    return this.ctx.db
      .selectFrom('invoice as i')
      .innerJoin('tenant as t', 't.id', 'i.tenant_id')
      .selectAll('i')
      .select('t.name as tenant_name');
  }
}

/** Monthly recurring revenue of one subscription row `s`, in SQL. */
const mrrSql = sql`round(s.unit_price * (1 - s.discount_pct / 100) / case s.interval when 'yearly' then 12 else 1 end)`;

/** List price per interval and the effective discount (yearly × negotiated). */
function pricing(
  plan: { price_monthly: number; yearly_discount_pct: string },
  interval: 'monthly' | 'yearly',
  extraDiscountPct: number,
) {
  const unitPrice = interval === 'yearly' ? plan.price_monthly * 12 : plan.price_monthly;
  const discountPct = combineDiscounts(
    interval === 'yearly' ? Number(plan.yearly_discount_pct) : 0,
    extraDiscountPct,
  );
  return { unitPrice, discountPct, amount: applyDiscount(unitPrice, discountPct) };
}

type SubscriptionRow = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  plan_id: string;
  plan_name: string;
  interval: 'monthly' | 'yearly';
  unit_price: number;
  discount_pct: string;
  currency: string;
  status: SubscriptionDto['status'];
  trial_ends_at: Date | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  created_at: Date;
};

function toSubscriptionDto(s: SubscriptionRow): SubscriptionDto {
  const discountPct = Number(s.discount_pct);
  const amount = applyDiscount(s.unit_price, discountPct);
  return {
    id: s.id,
    tenantId: s.tenant_id,
    tenantName: s.tenant_name,
    planId: s.plan_id,
    planName: s.plan_name,
    interval: s.interval,
    unitPrice: s.unit_price,
    discountPct,
    amount,
    mrr: Math.round(s.interval === 'yearly' ? amount / 12 : amount),
    currency: s.currency.trim(),
    status: s.status,
    trialEndsAt: isoOrNull(s.trial_ends_at),
    currentPeriodStart: isoOrNull(s.current_period_start),
    currentPeriodEnd: isoOrNull(s.current_period_end),
    cancelAtPeriodEnd: s.cancel_at_period_end,
    createdAt: iso(s.created_at),
  };
}

type InvoiceRow = {
  id: string;
  number: string;
  tenant_id: string;
  tenant_name: string;
  status: 'open' | 'paid' | 'void';
  currency: string;
  subtotal: number;
  discount: number;
  total: number;
  lines: unknown;
  period_start: Date | null;
  period_end: Date | null;
  issued_at: Date;
  due_at: Date;
  paid_at: Date | null;
  payment_method: string | null;
  payment_reference: string | null;
};

function toInvoiceDto(i: InvoiceRow, now: Date): InvoiceDto {
  return {
    id: i.id,
    number: i.number,
    tenantId: i.tenant_id,
    tenantName: i.tenant_name,
    status: i.status,
    overdue: i.status === 'open' && i.due_at < now,
    currency: i.currency.trim(),
    subtotal: i.subtotal,
    discount: i.discount,
    total: i.total,
    lines: i.lines as InvoiceLine[],
    periodStart: isoOrNull(i.period_start),
    periodEnd: isoOrNull(i.period_end),
    issuedAt: iso(i.issued_at),
    dueAt: iso(i.due_at),
    paidAt: isoOrNull(i.paid_at),
    paymentMethod: i.payment_method,
    paymentReference: i.payment_reference,
  };
}
