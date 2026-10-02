import { z } from 'zod';
import { PageQuery } from '../common.js';
import { Money, PlanLimits, UsageItem } from './plans.js';

export const BillingInterval = z.enum(['monthly', 'yearly']);
export type BillingInterval = z.infer<typeof BillingInterval>;

export const SubscriptionStatus = z.enum([
  'pending_payment',
  'trialing',
  'active',
  'past_due',
  'cancelled',
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const SubscriptionDto = z.object({
  id: z.string(),
  tenantId: z.string(),
  tenantName: z.string(),
  planId: z.string(),
  planName: z.string(),
  interval: BillingInterval,
  /** List price per interval before the subscription discount. */
  unitPrice: Money,
  discountPct: z.number(),
  /** What the customer pays per interval. */
  amount: Money,
  /** Normalised monthly recurring revenue. */
  mrr: Money,
  currency: z.string(),
  status: SubscriptionStatus,
  trialEndsAt: z.string().nullable(),
  currentPeriodStart: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  createdAt: z.string(),
});
export type SubscriptionDto = z.infer<typeof SubscriptionDto>;

export const CreateSubscriptionInput = z.object({
  planId: z.string(),
  interval: BillingInterval.default('monthly'),
  /** Start with the plan's free trial instead of an upfront invoice. */
  trial: z.boolean().default(false),
  /** Negotiated extra discount on top of the yearly discount. */
  extraDiscountPct: z.number().min(0).max(100).default(0),
});
export type CreateSubscriptionInput = z.input<typeof CreateSubscriptionInput>;

export const ChangeSubscriptionInput = z.object({
  planId: z.string().optional(),
  interval: BillingInterval.optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
});
export type ChangeSubscriptionInput = z.infer<typeof ChangeSubscriptionInput>;

export const InvoiceLine = z.object({
  description: z.string(),
  quantity: z.number(),
  unitAmount: z.number().int(),
  amount: z.number().int(),
});

export const InvoiceStatus = z.enum(['open', 'paid', 'void']);
export const InvoiceDto = z.object({
  id: z.string(),
  number: z.string(),
  tenantId: z.string(),
  tenantName: z.string(),
  status: InvoiceStatus,
  overdue: z.boolean(),
  currency: z.string(),
  subtotal: z.number().int(),
  discount: z.number().int(),
  total: z.number().int(),
  lines: z.array(InvoiceLine),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  issuedAt: z.string(),
  dueAt: z.string(),
  paidAt: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  paymentReference: z.string().nullable(),
});
export type InvoiceDto = z.infer<typeof InvoiceDto>;

export const PAYMENT_METHODS = ['bank_transfer', 'card', 'cash', 'cheque', 'other'] as const;
export const RecordPaymentInput = z.object({
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).optional(),
  paidAt: z.iso.datetime({ offset: true }).optional(),
});
export type RecordPaymentInput = z.infer<typeof RecordPaymentInput>;

export const InvoiceListQuery = PageQuery.extend({
  status: InvoiceStatus.optional(),
  tenantId: z.uuid().optional(),
  overdue: z.stringbool().optional(),
});
export type InvoiceListQuery = z.infer<typeof InvoiceListQuery>;

export const SubscriptionListQuery = PageQuery.extend({ status: SubscriptionStatus.optional() });
export type SubscriptionListQuery = z.infer<typeof SubscriptionListQuery>;

export const BillingOverview = z.object({
  totals: z.array(
    z.object({
      currency: z.string(),
      mrr: Money,
      arr: Money,
      outstanding: Money,
      overdue: Money,
      collected30d: Money,
    }),
  ),
  revenueByMonth: z.array(z.object({ month: z.string(), currency: z.string(), amount: Money })),
  planMix: z.array(
    z.object({
      planId: z.string(),
      planName: z.string(),
      subscriptions: z.number().int(),
      mrr: Money,
      currency: z.string(),
    }),
  ),
  subscriptionsByStatus: z.record(z.string(), z.number().int()),
});
export type BillingOverview = z.infer<typeof BillingOverview>;

/** What an organisation's admins see about their own billing (workspace › Billing). */
export const OrgBillingDto = z.object({
  subscription: SubscriptionDto.nullable(),
  plan: z
    .object({
      name: z.string(),
      description: z.string(),
      features: z.array(z.string()),
      limits: PlanLimits,
    })
    .nullable(),
  usage: z.array(UsageItem),
  /** The next charge, if the subscription renews. */
  upcoming: z
    .object({
      date: z.string(),
      currency: z.string(),
      lines: z.array(InvoiceLine),
      total: Money,
    })
    .nullable(),
  outstanding: z.object({
    currency: z.string(),
    amount: Money,
    count: z.number().int(),
    overdue: z.number().int(),
  }),
  billingContact: z.object({ name: z.string(), email: z.string() }).nullable(),
});
export type OrgBillingDto = z.infer<typeof OrgBillingDto>;
