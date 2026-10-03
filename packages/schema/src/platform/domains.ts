import { z } from 'zod';

export const Hostname = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/,
    'A valid domain name, e.g. data.example.org',
  );

export const DomainDto = z.object({
  id: z.string(),
  hostname: z.string(),
  kind: z.enum(['platform', 'custom']),
  status: z.enum(['pending', 'verified', 'failed']),
  isPrimary: z.boolean(),
  /** DNS records the customer must create. */
  dns: z.array(z.object({ type: z.enum(['CNAME', 'TXT']), name: z.string(), value: z.string() })),
  lastCheckedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  verifiedAt: z.string().nullable(),
});
export type DomainDto = z.infer<typeof DomainDto>;

export const AddDomainInput = z.object({ hostname: Hostname });
export type AddDomainInput = z.infer<typeof AddDomainInput>;

/** Edge routing: which tenant a Host header belongs to, and where to send it. */
export const ResolvedHost = z.object({
  tenantId: z.string(),
  tenantSlug: z.string(),
  canonicalHost: z.string(),
  /** True when the request should 301 to `canonicalHost`. */
  redirect: z.boolean(),
});
export type ResolvedHost = z.infer<typeof ResolvedHost>;
