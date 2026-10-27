import type {
  AuditPage,
  Page,
  AuditQuery,
  EmailLogDetail,
  EmailLogDto,
  EmailLogQuery,
} from '@grids/schema';
import { categoryOf, type ActivitySummaryDto, type ActivitySummaryQuery, type AuditCategory } from '@grids/schema';
import { sql } from 'kysely';
import { notFound } from '../errors.js';
import { isPrivateIp } from '../request-context.js';
import type { ServiceContext } from './context.js';
import { iso, mapPage, paginate } from './util.js';

/** System (audit) log and email log, across all tenants. */
export class LogService {
  constructor(private readonly ctx: ServiceContext) {}

  async audit(query: Partial<AuditQuery>): Promise<AuditPage> {
    let q = this.ctx.db
      .selectFrom('platform_audit_log as a')
      .leftJoin('user_identity as u', 'u.id', 'a.actor_id')
      .leftJoin('tenant as t', 't.id', 'a.tenant_id')
      .select([
        'a.id',
        'a.at',
        'a.action',
        'a.details',
        'a.category',
        'a.project_key',
        'a.ip',
        'a.country',
        'a.region',
        'a.city',
        'a.user_agent',
        'u.email',
        't.id as tenant_id',
        't.name as tenant_name',
      ])
      .orderBy('a.id', 'desc');
    if (query.tenantId) q = q.where('a.tenant_id', '=', query.tenantId);
    if (query.project) q = q.where('a.project_key', '=', query.project);
    if (query.category) q = q.where('a.category', 'in', query.category.split(','));
    if (query.ip) q = q.where('a.ip', '=', query.ip);
    if (query.from) q = q.where('a.at', '>=', new Date(query.from));
    if (query.to) q = q.where('a.at', '<', new Date(query.to));
    if (query.action) q = q.where('a.action', 'like', `${query.action}%`);
    if (query.q) {
      const like = `%${query.q}%`;
      q = q.where((eb) =>
        eb.or([
          eb('a.action', 'ilike', like),
          eb('u.email', 'ilike', like),
          eb('t.name', 'ilike', like),
          eb('a.ip', 'ilike', like),
          eb('a.city', 'ilike', like),
          eb('a.country', 'ilike', like),
          eb(eb.cast('a.details', 'text'), 'ilike', like),
        ]),
      );
    }
    return mapPage(
      await paginate(q, { page: query.page ?? 1, pageSize: query.pageSize ?? 50 }),
      (r) => ({
        id: r.id,
        at: iso(r.at),
        action: r.action,
        actorEmail: r.email,
        tenant: r.tenant_id ? { id: r.tenant_id, name: r.tenant_name! } : null,
        details: r.details as Record<string, unknown>,
        category: categoryOf(r.action),
        project: r.project_key,
        ip: r.ip,
        location: [r.city || r.region, r.country].filter((x, i, all) => x && all.indexOf(x) === i).join(', ') || (isPrivateIp(r.ip) ? 'Local network' : null),
        userAgent: r.user_agent,
      }),
    );
  }

  /** The log at a glance (see `ActivitySummaryDto`), for an organisation or one project of it. */
  async summary(tenantId: string, project?: string, opts: Partial<ActivitySummaryQuery> = {}): Promise<ActivitySummaryDto> {
    const span = opts.days ?? 14;
    const limit = opts.limit ?? 6;
    const within = opts.span ?? 30;
    const now = this.ctx.now();
    const DAY = 86_400_000;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (Math.max(span, 14) - 1) * DAY);
    const scope = (q: ReturnType<LogService['base']>) => (project ? q.where('a.project_key', '=', project) : q);
    const rows = await scope(this.base(tenantId))
      .select([sql<string>`to_char(date_trunc('day', a.at), 'YYYY-MM-DD')`.as('day'), 'a.category', sql<number>`count(*)::int`.as('n')])
      .where('a.at', '>=', start)
      .groupBy(['day', 'a.category'])
      .execute();
    const days = Array.from({ length: Math.max(span, 14) }, (_, i) => {
      const day = new Date(start.getTime() + i * DAY).toISOString().slice(0, 10);
      const mine = rows.filter((r) => r.day === day);
      return { day, total: mine.reduce((n, r) => n + r.n, 0), byCategory: Object.fromEntries(mine.map((r) => [r.category, r.n])) as ActivitySummaryDto['days'][number]['byCategory'] };
    });
    const last = days.slice(-14);
    const sum = (from: number, to: number, cats?: string[]) => last.slice(from, to).reduce((n, d) => n + (cats ? cats.reduce((m, c) => m + (d.byCategory[c as AuditCategory] ?? 0), 0) : d.total), 0);
    const tile = (cats?: string[]) => ({ now: sum(7, 14, cats), before: sum(0, 7, cats) });
    const since = new Date(now.getTime() - within * DAY);
    const places = await scope(this.base(tenantId))
      .select([sql<string>`coalesce(nullif(concat_ws(', ', coalesce(nullif(a.city, ''), nullif(a.region, '')), nullif(a.country, '')), ''), 'Local network')`.as('label'), sql<number>`count(*)::int`.as('count')])
      .where('a.at', '>=', since)
      .where('a.ip', 'is not', null)
      .groupBy('label')
      .orderBy('count', 'desc')
      .limit(limit)
      .execute();
    const people = await scope(this.base(tenantId))
      .leftJoin('user_identity as u', 'u.id', 'a.actor_id')
      .select([sql<string>`coalesce(u.email, 'Visitors')`.as('label'), sql<number>`count(*)::int`.as('count')])
      .where('a.at', '>=', since)
      .groupBy('label')
      .orderBy('count', 'desc')
      .limit(limit)
      .execute();
    return { tiles: { events: tile(), submissions: tile(['submission']), changes: tile(['change', 'entity', 'access', 'approval']), publicVisits: tile(['public']) }, days, places, people };
  }

  private base(tenantId: string) {
    return this.ctx.db.selectFrom('platform_audit_log as a').where('a.tenant_id', '=', tenantId);
  }

  async emails(query: Partial<EmailLogQuery> = {}): Promise<Page<EmailLogDto>> {
    let q = this.emailQuery().orderBy('e.created_at', 'desc');
    if (query.tenantId) q = q.where('e.tenant_id', '=', query.tenantId);
    if (query.status) q = q.where('e.status', '=', query.status);
    if (query.q) {
      const like = `%${query.q}%`;
      q = q.where((eb) =>
        eb.or([
          eb('e.to_address', 'ilike', like),
          eb('e.subject', 'ilike', like),
          eb('e.template', 'ilike', like),
        ]),
      );
    }
    return mapPage(
      await paginate(q, { page: query.page ?? 1, pageSize: query.pageSize ?? 25 }),
      toEmailDto,
    );
  }

  async email(id: string): Promise<EmailLogDetail> {
    const row = await this.emailQuery()
      .select('e.body_text')
      .where('e.id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound('Email');
    return { ...toEmailDto(row), bodyText: row.body_text };
  }

  private emailQuery() {
    return this.ctx.db
      .selectFrom('email_log as e')
      .leftJoin('tenant as t', 't.id', 'e.tenant_id')
      .select([
        'e.id',
        'e.created_at',
        'e.template',
        'e.to_address',
        'e.subject',
        'e.status',
        'e.error',
        't.id as tenant_id',
        't.name as tenant_name',
      ]);
  }
}

function toEmailDto(r: {
  id: string;
  created_at: Date;
  template: string;
  to_address: string;
  subject: string;
  status: 'sent' | 'failed';
  error: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
}): EmailLogDto {
  return {
    id: r.id,
    at: iso(r.created_at),
    tenant: r.tenant_id ? { id: r.tenant_id, name: r.tenant_name! } : null,
    template: r.template,
    to: r.to_address,
    subject: r.subject,
    status: r.status,
    error: r.error,
  };
}
