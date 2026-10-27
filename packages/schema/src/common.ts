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

/** The group data elements are in when none is chosen; its elements are written without the group (`cases`, not `general.cases`). */
export const DEFAULT_DATA_GROUP = 'general';
/** How something refers to a data element: its key, or `group.key` for one outside the default group. */
export const ElementRef = z
  .string()
  .max(127)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/, 'An indicator key, or group.key');
export type ElementRef = z.infer<typeof ElementRef>;
export const elementRef = (group: string, key: string) => (group === DEFAULT_DATA_GROUP ? key : `${group}.${key}`);
/** The group and key an element reference names. */
export const splitElementRef = (ref: string): { group: string; key: string } => {
  const i = ref.indexOf('.');
  return i < 0 ? { group: DEFAULT_DATA_GROUP, key: ref } : { group: ref.slice(0, i), key: ref.slice(i + 1) };
};

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
  /** A stable name for the reason, for the few cases a screen reacts to (e.g. `subscription_ended`). */
  code: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  /** For a query that failed: what the database said, and the SQL as it was sent. */
  sql: z
    .object({
      /** The database's own error code (a Postgres SQLSTATE such as 22P02). */
      code: z.string().optional(),
      /** Where in `text` it went wrong, counted in characters from 1. */
      position: z.number().int().optional(),
      hint: z.string().optional(),
      detail: z.string().optional(),
      /** The SQL that ran, with the parameters filled in. */
      text: z.string().optional(),
    })
    .optional(),
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
