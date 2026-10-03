import { z } from 'zod';

/** URL-safe identifier used for tenant subdomains, project keys, entity type keys, etc. */
export const Slug = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and single hyphens only');
export type Slug = z.infer<typeof Slug>;

/** Machine key for config objects (attribute keys, question keys, data elements). */
export const Key = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z][a-z0-9_]*$/, 'snake_case starting with a letter');
export type Key = z.infer<typeof Key>;

export const CursorPage = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type CursorPage = z.infer<typeof CursorPage>;

/** RFC 7807 problem details: the error shape for every API error (spec §14). */
export const Problem = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof Problem>;

/** Formats an amount in minor units (e.g. cents) for display. */
export function formatMoney(minor: number, currency: string, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
}

/** Offset pagination for console/workspace tables. */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
