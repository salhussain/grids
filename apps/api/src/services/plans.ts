import { sql } from 'kysely';
import {
  yearlyPrice,
  type CreatePlanInput,
  type PlanDto,
  type PlanInput,
  type PlanLimits,
} from '@grids/schema';
import { conflict, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { requireStaff } from './authz.js';
import { isUniqueViolation } from './util.js';

/** Pricing configuration. Price edits affect new subscriptions only (they snapshot prices). */
export class PlanService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(opts: { includeArchived?: boolean } = {}): Promise<PlanDto[]> {
    let q = this.ctx.db
      .selectFrom('plan as p')
      .selectAll('p')
      .select((eb) =>
        eb
          .selectFrom('subscription as s')
          .whereRef('s.plan_id', '=', 'p.id')
          .where('s.status', '<>', 'cancelled')
          .select(eb.fn.countAll<string>().as('c'))
          .as('subscribers'),
      )
      .orderBy('p.sort_order')
      .orderBy('p.price_monthly');
    if (!opts.includeArchived) q = q.where('p.is_archived', '=', false);
    return (await q.execute()).map(toPlanDto);
  }

  async get(id: string): Promise<PlanDto> {
    const plan = (await this.list({ includeArchived: true })).find((p) => p.id === id);
    if (!plan) throw notFound('Plan');
    return plan;
  }

  async create(actor: Actor, input: CreatePlanInput): Promise<PlanDto> {
    requireStaff(actor, 'plans.manage');
    try {
      await this.ctx.db
        .insertInto('plan')
        .values({ id: input.id, ...toRow(input) })
        .execute();
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Plan ID already exists', `"${input.id}" is taken.`);
      throw e;
    }
    await audit(this.ctx, actor.id, null, 'plan.created', {
      plan: input.id,
      priceMonthly: input.priceMonthly,
    });
    return this.get(input.id);
  }

  async update(actor: Actor, id: string, input: PlanInput): Promise<PlanDto> {
    requireStaff(actor, 'plans.manage');
    const before = await this.get(id);
    await this.ctx.db
      .updateTable('plan')
      .set({ ...toRow(input), updated_at: sql`now()` })
      .where('id', '=', id)
      .execute();
    const changed = Object.keys(input).filter(
      (k) =>
        JSON.stringify(input[k as keyof PlanInput]) !== JSON.stringify(before[k as keyof PlanDto]),
    );
    await audit(this.ctx, actor.id, null, 'plan.updated', {
      plan: id,
      changed: changed.join(', '),
    });
    return this.get(id);
  }
}

function toRow(p: PlanInput) {
  return {
    name: p.name,
    description: p.description,
    currency: p.currency,
    price_monthly: p.priceMonthly,
    yearly_discount_pct: p.yearlyDiscountPct,
    trial_days: p.trialDays,
    limits: JSON.stringify(p.limits),
    features: JSON.stringify(p.features),
    is_public: p.isPublic,
    is_archived: p.isArchived,
    sort_order: p.sortOrder,
  };
}

export function toPlanDto(p: {
  id: string;
  name: string;
  description: string;
  currency: string;
  price_monthly: number;
  yearly_discount_pct: string;
  trial_days: number;
  limits: unknown;
  features: unknown;
  is_public: boolean;
  is_archived: boolean;
  sort_order: number;
  subscribers?: string | null;
}): PlanDto {
  const discount = Number(p.yearly_discount_pct);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    currency: p.currency.trim(),
    priceMonthly: p.price_monthly,
    yearlyDiscountPct: discount,
    priceYearly: yearlyPrice(p.price_monthly, discount),
    trialDays: p.trial_days,
    limits: p.limits as PlanLimits,
    features: p.features as string[],
    isPublic: p.is_public,
    isArchived: p.is_archived,
    sortOrder: p.sort_order,
    subscriberCount: Number(p.subscribers ?? 0),
  };
}
