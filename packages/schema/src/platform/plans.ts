import { z } from 'zod';
import { Slug } from '../common.js';

export const LIMIT_KEYS = [
  'projects',
  'users',
  'forms',
  'submissions_per_month',
  'storage_gb',
  'api_calls_per_month',
  'rows_ingested_per_month',
  'run_minutes_per_month',
] as const;
export const LimitKey = z.enum(LIMIT_KEYS);
export type LimitKey = z.infer<typeof LimitKey>;

/** Current use against a plan limit (`limit` null = unlimited, `used` null = not metered yet). */
export const UsageItem = z.object({
  key: LimitKey,
  used: z.number().nullable(),
  limit: z.number().nullable(),
});
export type UsageItem = z.infer<typeof UsageItem>;

/** `null` = unlimited. */
export const PlanLimits = z.record(LimitKey, z.number().int().nonnegative().nullable());
export type PlanLimits = z.infer<typeof PlanLimits>;

export const FEATURE_KEYS = [
  'custom_branding',
  'custom_domain',
  'sso',
  'api_access',
  'dhis2',
  'priority_support',
  'audit_export',
  'dedicated_db',
  'custom_code',
] as const;
export const FeatureKey = z.enum(FEATURE_KEYS);
export type FeatureKey = z.infer<typeof FeatureKey>;

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'NZD'] as const;
export const Currency = z.enum(CURRENCIES);
export type Currency = z.infer<typeof Currency>;

/** Amounts are integers in minor units (cents). */
export const Money = z.number().int().nonnegative();

export const PlanDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  currency: z.string(),
  priceMonthly: Money,
  yearlyDiscountPct: z.number(),
  /** Effective yearly price after the yearly discount. */
  priceYearly: Money,
  trialDays: z.number().int(),
  limits: PlanLimits,
  features: z.array(z.string()),
  isPublic: z.boolean(),
  isArchived: z.boolean(),
  sortOrder: z.number().int(),
  subscriberCount: z.number().int(),
});
export type PlanDto = z.infer<typeof PlanDto>;

export const PlanInput = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(''),
  currency: Currency.default('USD'),
  priceMonthly: Money,
  yearlyDiscountPct: z.number().min(0).max(100).default(0),
  trialDays: z.number().int().min(0).max(365).default(0),
  limits: PlanLimits,
  features: z.array(FeatureKey).default([]),
  isPublic: z.boolean().default(true),
  isArchived: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});
export type PlanInput = z.infer<typeof PlanInput>;

export const CreatePlanInput = PlanInput.extend({ id: Slug });
export type CreatePlanInput = z.infer<typeof CreatePlanInput>;

/** Yearly price for a monthly price and a yearly discount, rounded to whole minor units. */
export function yearlyPrice(priceMonthly: number, discountPct: number): number {
  return Math.round(priceMonthly * 12 * (1 - discountPct / 100));
}
