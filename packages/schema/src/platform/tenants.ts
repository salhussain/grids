import { z } from 'zod';
import { PageQuery, Slug } from '../common.js';
import { Currency, PlanLimits, UsageItem } from './plans.js';
import { SubscriptionDto } from './billing.js';
import { DomainDto } from './domains.js';

export const TenantStatus = z.enum([
  'pending_payment',
  'provisioning',
  'active',
  'suspended',
  'cancelled',
]);
export type TenantStatus = z.infer<typeof TenantStatus>;

export const INDUSTRIES = [
  'Healthcare',
  'Government',
  'NGO / Non-profit',
  'Education',
  'Research',
  'Agriculture',
  'Energy & Utilities',
  'Transport & Logistics',
  'Finance',
  'Retail',
  'Manufacturing',
  'Technology',
  'Other',
] as const;
export const COMPANY_SIZES = [
  '1–10',
  '11–50',
  '51–200',
  '201–1,000',
  '1,001–5,000',
  '5,000+',
] as const;

const opt = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const Address = z.object({
  line1: opt(),
  line2: opt(),
  city: opt(100),
  region: opt(100),
  postalCode: opt(20),
  /** ISO 3166-1 alpha-2 */
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Two-letter country code')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
export type Address = z.infer<typeof Address>;

export const Contact = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  phone: opt(40),
  jobTitle: opt(100),
});
export type Contact = z.output<typeof Contact>;

/** Response shape (no input transforms: responses are encoded, not parsed). */
export const ContactDto = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
});

// Base profile fields carry no defaults, so partial updates never reset omitted values.
const ProfileFields = {
  name: z.string().trim().min(2).max(120),
  legalName: opt(200),
  industry: opt(60),
  companySize: opt(20),
  website: z
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  registrationNumber: opt(60),
  taxId: opt(60),
  email: z
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  phone: opt(40),
  address: Address,
  timezone: z.string().trim().min(1).max(60),
  locale: z.string().trim().min(2).max(10),
  currency: Currency,
  notes: opt(4000),
};

export const CreateTenantInput = z.object({
  ...ProfileFields,
  address: Address.prefault({}),
  timezone: ProfileFields.timezone.default('UTC'),
  locale: ProfileFields.locale.default('en'),
  currency: Currency.default('USD'),
  /** Generated from the name when blank. */
  slug: Slug.optional().or(z.literal('').transform(() => undefined)),
  contacts: z.object({
    primary: Contact,
    billing: Contact.optional(),
    technical: Contact.optional(),
  }),
});
export type CreateTenantInput = z.input<typeof CreateTenantInput>;
export type CreateTenantData = z.output<typeof CreateTenantInput>;

export const UpdateTenantInput = z
  .object(ProfileFields)
  .partial()
  .extend({
    contacts: z
      .object({
        primary: Contact.optional(),
        /** `null` removes the contact. */
        billing: Contact.nullable().optional(),
        technical: Contact.nullable().optional(),
      })
      .optional(),
  });
export type UpdateTenantInput = z.input<typeof UpdateTenantInput>;
export type UpdateTenantData = z.output<typeof UpdateTenantInput>;

export const TenantSummary = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  status: TenantStatus,
  planId: z.string().nullable(),
  planName: z.string().nullable(),
  subscriptionStatus: z.string().nullable(),
  country: z.string().nullable(),
  industry: z.string().nullable(),
  primaryContactEmail: z.string().nullable(),
  memberCount: z.number().int(),
  openTickets: z.number().int(),
  createdAt: z.string(),
});
export type TenantSummary = z.infer<typeof TenantSummary>;


export const TenantDetail = TenantSummary.extend({
  idpOrgId: z.string().nullable(),
  cellId: z.string(),
  website: z.string().nullable(),
  registrationNumber: z.string().nullable(),
  taxId: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  companySize: z.string().nullable(),
  address: z.object({
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    city: z.string().nullable(),
    region: z.string().nullable(),
    postalCode: z.string().nullable(),
    country: z.string().nullable(),
  }),
  timezone: z.string(),
  locale: z.string(),
  currency: z.string(),
  notes: z.string().nullable(),
  contacts: z.object({
    primary: ContactDto.nullable(),
    billing: ContactDto.nullable(),
    technical: ContactDto.nullable(),
  }),
  mfaRequired: z.boolean(),
  subscription: SubscriptionDto.nullable(),
  limits: PlanLimits.nullable(),
  usage: z.array(UsageItem),
  domains: z.array(DomainDto),
  /** What the platform admin should do next, if anything. */
  nextStep: z.enum(['subscribe', 'record_payment', 'invite_admin', 'none']),
});
export type TenantDetail = z.infer<typeof TenantDetail>;

export const SecuritySettingsInput = z.object({ mfaRequired: z.boolean() });
export type SecuritySettingsInput = z.infer<typeof SecuritySettingsInput>;

export const TenantStatusInput = z.object({
  status: z.enum(['active', 'suspended', 'cancelled']),
  reason: opt(500),
});
export type TenantStatusInput = z.infer<typeof TenantStatusInput>;

export const TenantListQuery = PageQuery.extend({
  status: TenantStatus.optional(),
  q: z.string().trim().max(100).optional(),
});
export type TenantListQuery = z.infer<typeof TenantListQuery>;
