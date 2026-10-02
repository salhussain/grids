import type { SelectQueryBuilder } from 'kysely';
import type { Page } from '@grids/schema';
import { createHash, randomBytes } from 'node:crypto';

export const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();
export const isoOrNull = (d: Date | string | null | undefined) => (d ? iso(d) : null);

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function addInterval(from: Date, interval: 'monthly' | 'yearly'): Date {
  const d = new Date(from);
  if (interval === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

export const addDays = (from: Date, days: number) => new Date(from.getTime() + days * 86_400_000);

/** URL-safe slug from free text: "Pacific Health (NZ)" → "pacific-health-nz". */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
}

/** Combines discounts multiplicatively: 15% yearly + 10% negotiated = 23.5%. */
export function combineDiscounts(...pcts: number[]): number {
  const remaining = pcts.reduce((r, p) => r * (1 - p / 100), 1);
  return Math.round((1 - remaining) * 10000) / 100;
}

export const applyDiscount = (amount: number, pct: number) => Math.round(amount * (1 - pct / 100));

/** Runs a page of `query` plus a count of all matching rows. */
export async function paginate<O>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any table set
  query: SelectQueryBuilder<any, any, O>,
  { page, pageSize }: { page: number; pageSize: number },
): Promise<Page<O>> {
  const [items, count] = await Promise.all([
    query
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute(),
    query
      .clearSelect()
      .clearOrderBy()
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirst() as Promise<{ n: string } | undefined>,
  ]);
  return { items, total: Number(count?.n ?? 0), page, pageSize };
}

export const mapPage = <A, B>(p: Page<A>, fn: (a: A) => B): Page<B> => ({
  ...p,
  items: p.items.map(fn),
});
