import { sql } from 'kysely';
import type { PlatformOverview } from '@grids/schema';
import { can, requireStaff } from './authz.js';
import type { Actor, ServiceContext } from './context.js';
import type { LogService } from './logs.js';
import type { SupportService } from './support.js';
import { addDays, iso } from './util.js';

export class DashboardService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly deps: { logs: LogService; support: SupportService },
  ) {}

  async overview(actor: Actor): Promise<PlatformOverview> {
    requireStaff(actor, 'overview.view');
    const { db } = this.ctx;
    const now = this.ctx.now();
    const byStatus = await db
      .selectFrom('tenant')
      .select(['status', (eb) => eb.fn.countAll<string>().as('n')])
      .groupBy('status')
      .execute();
    const members = await db
      .selectFrom('membership')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    const mrr = await sql<{ currency: string; amount: string }>`
      select currency, sum(round(unit_price * (1 - discount_pct / 100) / case interval when 'yearly' then 12 else 1 end))::text as amount
      from subscription where status in ('active', 'past_due') group by currency
    `.execute(db);
    const outstanding = await sql<{ currency: string; amount: string; overdue: string }>`
      select currency, sum(total)::text as amount, count(*) filter (where due_at < ${now})::text as overdue
      from invoice where status = 'open' group by currency
    `.execute(db);
    const tickets = await db
      .selectFrom('support_ticket')
      .select([
        (eb) => eb.fn.countAll<string>().as('open'),
        sql<string>`count(*) filter (where priority = 'urgent')`.as('urgent'),
      ])
      .where('status', 'in', ['open', 'pending'])
      .executeTakeFirstOrThrow();
    const failed = await db
      .selectFrom('email_log')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('status', '=', 'failed')
      .where('created_at', '>', addDays(now, -1))
      .executeTakeFirstOrThrow();
    const awaiting = await db
      .selectFrom('tenant')
      .select(['id', 'name', 'created_at'])
      .where('status', '=', 'pending_payment')
      .orderBy('created_at')
      .limit(8)
      .execute();

    const tenants = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)]));
    return {
      tenants,
      totalTenants: Object.values(tenants).reduce((a, b) => a + b, 0),
      totalMembers: Number(members.n),
      // Revenue figures are only shown to staff who can see billing.
      mrr: !can(actor, 'billing.view')
        ? []
        : mrr.rows.map((r) => ({ currency: r.currency.trim(), amount: Number(r.amount) })),
      outstanding: !can(actor, 'billing.view')
        ? []
        : outstanding.rows.map((r) => ({
            currency: r.currency.trim(),
            amount: Number(r.amount),
            overdueCount: Number(r.overdue),
          })),
      openTickets: Number(tickets.open),
      urgentTickets: Number(tickets.urgent),
      emailsFailed24h: Number(failed.n),
      awaitingPayment: awaiting.map((a) => ({ id: a.id, name: a.name, since: iso(a.created_at) })),
      recentTickets: can(actor, 'support.view')
        ? (await this.deps.support.list(actor, { status: 'active', pageSize: 6 })).items
        : [],
      recentActivity: can(actor, 'logs.system')
        ? (await this.deps.logs.audit({ pageSize: 12 })).items
        : [],
    };
  }
}
