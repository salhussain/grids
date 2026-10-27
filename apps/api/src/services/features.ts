import type { Kysely } from 'kysely';
import type { PlatformDB } from '@grids/db';
import type { FeatureKey } from '@grids/schema';
import { HttpError } from '../errors.js';

/** Whether the organisation's plan includes a feature. An organisation with no plan is managed by the platform and has them all. */
export async function planHasFeature(db: Kysely<PlatformDB>, tenantId: string, feature: FeatureKey): Promise<boolean> {
  const row = await db
    .selectFrom('tenant as t')
    .leftJoin('plan as p', 'p.id', 't.plan_id')
    .select(['t.plan_id', 'p.features'])
    .where('t.id', '=', tenantId)
    .executeTakeFirst();
  if (!row) return false;
  if (!row.plan_id) return true;
  return ((row.features as string[] | null) ?? []).includes(feature);
}

/** Refuses (403) when the plan does not include the feature. */
export async function requireFeature(db: Kysely<PlatformDB>, tenantId: string, feature: FeatureKey, what: string): Promise<void> {
  if (!(await planHasFeature(db, tenantId, feature)))
    throw new HttpError(403, 'Not included in your plan', `${what} is not included in your plan. Ask the Grids team to change it.`, undefined, undefined, 'feature_not_included');
}
