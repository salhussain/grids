import { z } from 'zod';
import { Currency } from './plans.js';

/** The ways a person can pay. A merchant offers the ones it has switched on. */
export const PAY_METHODS = ['card', 'wallet', 'bank', 'instalments'] as const;
/** The kind of screen a way of paying uses; the defaults are one of each, an organisation can have more of any kind. */
export const PayMethod = z.enum(PAY_METHODS);
export type PayMethod = z.infer<typeof PayMethod>;

/** A way of paying in the organisation's list (the four it starts with, and any it adds). */
export const MethodDto = z.object({
  key: z.string(),
  name: z.string(),
  kind: PayMethod,
  about: z.string(),
  logo: z.string().nullable(),
  /** Added to the amount when a person pays this way: a percentage and/or a fixed amount (minor units). */
  surchargePercent: z.number(),
  surchargeFixed: z.number().int(),
  /** How many instalments (for a way that works by instalments). */
  instalments: z.number().int(),
});
export type MethodDto = z.infer<typeof MethodDto>;

export const MethodInput = z.object({
  name: z.string().trim().min(2).max(60),
  kind: PayMethod,
  /** A picture (a data address); left out or null: the kind's icon is used. */
  logo: z.string().max(300_000).nullable().optional(),
  surchargePercent: z.number().min(0).max(20).default(0),
  surchargeFixed: z.number().int().min(0).max(1_000_000).default(0),
  instalments: z.number().int().min(2).max(12).default(4),
});
export type MethodInput = z.infer<typeof MethodInput>;
/** The surcharge a way of paying adds to an amount (minor units, rounded). */
export const surchargeFor = (amount: number, m: { surchargePercent: number; surchargeFixed: number }): number =>
  amount > 0 ? Math.round((amount * m.surchargePercent) / 100) + m.surchargeFixed : 0;

export const PAY_METHOD_INFO: Record<PayMethod, { name: string; about: string }> = {
  card: { name: 'Card', about: 'Credit or debit card' },
  wallet: { name: 'Mobile wallet', about: 'Pay from a phone money account, such as M-PAiSA' },
  bank: { name: 'Pay by bank', about: 'Approve the payment in your own bank' },
  instalments: { name: 'Pay later', about: 'Split into instalments, such as Afterpay' },
};

/** The one payment service. Organisations add merchants to it; in test mode a merchant takes pretend payments (no money moves). */
export const PAYMENT_SERVICE = 'GridPay';

/** What Grids charges on each payment an organisation takes: a percentage of it plus a fixed amount (minor units). */
export const PaymentFee = z.object({
  percent: z.number().min(0).max(100).default(0),
  fixed: z.number().int().min(0).default(0),
});
export type PaymentFee = z.infer<typeof PaymentFee>;

/** The fee on one payment of `amount` (minor units). */
export const feeFor = (amount: number, fee: PaymentFee | null | undefined): number =>
  fee && amount > 0 ? Math.round((amount * fee.percent) / 100) + fee.fixed : 0;

/** A merchant added to GridPay: the account payments are paid out to (never its secrets). */
export const MerchantDto = z.object({
  id: z.string(),
  name: z.string(),
  /** The merchant's own reference with the processor. */
  merchantRef: z.string(),
  mode: z.enum(['test', 'live']),
  enabled: z.boolean(),
  /** An API key is stored. */
  hasKey: z.boolean(),
  /** A picture shown on the payment page (a data address). */
  logo: z.string().nullable(),
  /** The ways people can pay this merchant (keys from the organisation's list). */
  methods: z.array(z.string()),
});
export type MerchantDto = z.infer<typeof MerchantDto>;

export const MerchantInput = z.object({
  name: z.string().trim().min(2).max(80),
  merchantRef: z.string().trim().max(100).default(''),
  /** Left out or blank keeps the stored key. */
  apiKey: z.string().max(500).optional(),
  mode: z.enum(['test', 'live']).default('test'),
  enabled: z.boolean().default(true),
  /** The logo: left out keeps it, null takes it away. */
  logo: z.string().max(300_000).nullable().optional(),
  /** The ways people can pay (at least one); left out keeps what is set. */
  methods: z.array(z.string().max(60)).min(1).optional(),
});
export type MerchantInput = z.input<typeof MerchantInput>;

export const PaymentStatus = z.enum(['pending', 'succeeded', 'failed', 'cancelled']);
export const PaymentDto = z.object({
  id: z.string(),
  status: PaymentStatus,
  amount: z.number().int(),
  currency: z.string(),
  description: z.string(),
  payerEmail: z.string().nullable(),
  project: z.string(),
  form: z.string(),
  /** What Grids charged on it. */
  fee: z.number().int(),
  invoiced: z.boolean(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  /** How it was paid (a key from the organisation's list of ways to pay). */
  method: z.string().nullable(),
  /** What the person paid on top, for the way they chose. */
  surcharge: z.number().int(),
  /** The receipt's number (R-000123), once the payment has succeeded. */
  receiptNo: z.string().nullable(),
});
export type PaymentDto = z.infer<typeof PaymentDto>;

export const PaymentsDto = z.object({
  merchants: z.array(MerchantDto),
  /** Every way of paying the organisation can switch on. */
  methods: z.array(MethodDto),
  /** What the plan charges per payment, so the page can say it. */
  fee: PaymentFee.nullable(),
  items: z.array(PaymentDto),
  /** Fees not yet on an invoice, for each currency (each currency is billed on its own invoice). */
  unbilled: z.array(z.object({ amount: z.number().int(), count: z.number().int(), currency: z.string() })),
});
export type PaymentsDto = z.infer<typeof PaymentsDto>;

/** What a form asks for before it can be sent. */
export const FormPayment = z.object({
  enabled: z.boolean().default(false),
  /** Minor units. */
  amount: z.number().int().min(0).max(100_000_000).default(0),
  currency: Currency.default('USD'),
  /** Shown to the payer and to the provider. */
  description: z.string().trim().max(200).default(''),
  /** The merchant it is paid to; null: the organisation's first one that is switched on. */
  merchantId: z.uuid().nullable().default(null),
});
export type FormPayment = z.infer<typeof FormPayment>;
export const DEFAULT_FORM_PAYMENT: FormPayment = { enabled: false, amount: 0, currency: 'USD', description: '', merchantId: null };

export const StartPaymentInput = z.object({
  /** Where the provider sends the person back to once they have paid (or given up). */
  returnUrl: z.url().max(1000),
  email: z.email().max(200).optional(),
});
export type StartPaymentInput = z.infer<typeof StartPaymentInput>;
export const PaymentStarted = z.object({ paymentId: z.uuid(), redirectUrl: z.string() });
export type PaymentStarted = z.infer<typeof PaymentStarted>;
export const PaymentState = z.object({ status: PaymentStatus });
export type PaymentState = z.infer<typeof PaymentState>;

/** How a receipt number is written: R-000123. */
export const receiptNumber = (n: number | string): string => `R-${String(n).padStart(6, '0')}`;
