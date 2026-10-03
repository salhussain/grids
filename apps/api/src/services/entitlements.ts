import type { LimitKey, PlanLimits } from '@grids/schema';
import { LimitExceededError } from '../errors.js';

/**
 * Hard-limit check at create time (spec §12). `null`/missing limit = unlimited.
 * Throws when `used + adding` would exceed the plan's limit.
 */
export function assertWithinLimit(
  limits: PlanLimits,
  key: LimitKey,
  used: number,
  adding = 1,
): void {
  const limit = limits[key];
  if (limit === null || limit === undefined) return;
  if (used + adding > limit) throw new LimitExceededError(key, limit);
}
