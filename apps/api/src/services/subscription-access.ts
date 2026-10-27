import type { ServiceContext } from './context.js';

/** Days before the end of a subscription from which people are told it is running out. */
export const EXPIRY_WARNING_DAYS = 14;

export interface AccessInput {
  status: string;
  trialEndsAt: string | Date | null;
  currentPeriodEnd: string | Date | null;
  /** What the customer pays per period; a free plan never runs out. */
  amount: number;
}

export type AccessState = 'ok' | 'expiring' | 'ended';

/**
 * Whether an organisation may still be used. A subscription that was cancelled, a trial that has finished, and a paid
 * period that was not renewed all end it; a free plan never does. An organisation that was never given a subscription
 * is managed by the platform and is left alone.
 */
export function accessOf(
  sub: AccessInput | null,
  hadCancelled: boolean,
  now: Date,
): { state: AccessState; endsAt: Date | null; daysLeft: number | null } {
  if (!sub) return { state: hadCancelled ? 'ended' : 'ok', endsAt: null, daysLeft: null };
  if (sub.status === 'pending_payment') return { state: 'ok', endsAt: null, daysLeft: null };
  const raw = sub.status === 'trialing' ? sub.trialEndsAt : sub.currentPeriodEnd;
  const endsAt = raw ? new Date(raw) : null;
  if (sub.amount <= 0 && sub.status !== 'trialing') return { state: 'ok', endsAt, daysLeft: null };
  if (!endsAt) return { state: 'ok', endsAt: null, daysLeft: null };
  const ms = endsAt.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(ms / 86_400_000));
  if (ms <= 0) return { state: 'ended', endsAt, daysLeft: 0 };
  return { state: daysLeft <= EXPIRY_WARNING_DAYS ? 'expiring' : 'ok', endsAt, daysLeft };
}

/**
 * Keeps each organisation's `access_blocked` flag, and the identity service's copy of it (which stops sign-in), in step
 * with its subscription. Run after anything that changes a subscription and on a timer, since time alone can end one.
 */
export class SubscriptionAccess {
  constructor(private readonly ctx: Pick<ServiceContext, 'db' | 'idp' | 'now'>) {}

  async evaluate(tenantId: string) {
    const { db } = this.ctx;
    const sub = await db
      .selectFrom('subscription')
      .select(['status', 'trial_ends_at', 'current_period_end', 'unit_price', 'discount_pct'])
      .where('tenant_id', '=', tenantId)
      .where('status', '<>', 'cancelled')
      .executeTakeFirst();
    const cancelled = sub
      ? undefined
      : await db
          .selectFrom('subscription')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('status', '=', 'cancelled')
          .executeTakeFirst();
    const amount = sub ? Math.round((sub.unit_price * (100 - Number(sub.discount_pct))) / 100) : 0;
    return accessOf(
      sub
        ? { status: sub.status, trialEndsAt: sub.trial_ends_at, currentPeriodEnd: sub.current_period_end, amount }
        : null,
      !!cancelled,
      this.ctx.now(),
    );
  }

  /** Applies the result for one organisation; returns whether it is now shut out. */
  async sync(tenantId: string): Promise<boolean> {
    const { db, idp } = this.ctx;
    const t = await db
      .selectFrom('tenant')
      .select(['access_blocked', 'idp_org_id', 'status'])
      .where('id', '=', tenantId)
      .executeTakeFirst();
    if (!t) return false;
    const ended = (await this.evaluate(tenantId)).state === 'ended';
    if (ended !== t.access_blocked) {
      if (t.idp_org_id) await idp.setOrganizationBlocked(t.idp_org_id, ended);
      await db.updateTable('tenant').set({ access_blocked: ended }).where('id', '=', tenantId).execute();
    }
    return ended;
  }

  async syncAll(): Promise<void> {
    const tenants = await this.ctx.db.selectFrom('tenant').select('id').where('status', '=', 'active').execute();
    for (const t of tenants) await this.sync(t.id).catch(() => undefined);
  }
}
