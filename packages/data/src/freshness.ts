import type { Freshness } from '@grids/schema';

/**
 * Freshness of data expected every `expectedMinutes` (spec §8): fresh within 1.5×
 * the interval, warning up to 3×, then stale. Without an expectation, data that
 * exists is reported fresh-as-of its timestamp.
 */
export function freshness(last: Date | string | null | undefined, expectedMinutes: number | null | undefined, now = new Date()): Freshness {
  const lastDate = last ? new Date(last) : null;
  const lastUpdated = lastDate ? lastDate.toISOString() : null;
  const expected = expectedMinutes ?? null;
  if (!lastDate) return { status: 'unknown', lastUpdated, expectedMinutes: expected };
  if (!expected) return { status: 'fresh', lastUpdated, expectedMinutes: null };
  const ageMin = (now.getTime() - lastDate.getTime()) / 60_000;
  const status = ageMin <= expected * 1.5 ? 'fresh' : ageMin <= expected * 3 ? 'warning' : 'stale';
  return { status, lastUpdated, expectedMinutes: expected };
}

/** The least fresh of several (stale > warning > unknown > fresh), for project-level badges. */
export function worstFreshness(items: Freshness[]): Freshness {
  const rank = { stale: 3, warning: 2, unknown: 1, fresh: 0 } as const;
  if (!items.length) return { status: 'unknown', lastUpdated: null, expectedMinutes: null };
  return items.reduce((a, b) => (rank[b.status] > rank[a.status] ? b : a));
}
