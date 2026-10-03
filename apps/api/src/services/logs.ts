import type {
  AuditPage,
  Page,
  AuditQuery,
  EmailLogDetail,
  EmailLogDto,
  EmailLogQuery,
} from '@grids/schema';
import { notFound } from '../errors.js';
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
        'u.email',
        't.id as tenant_id',
        't.name as tenant_name',
      ])
      .orderBy('a.id', 'desc');
    if (query.tenantId) q = q.where('a.tenant_id', '=', query.tenantId);
    if (query.action) q = q.where('a.action', 'like', `${query.action}%`);
    if (query.q) {
      const like = `%${query.q}%`;
      q = q.where((eb) =>
        eb.or([
          eb('a.action', 'ilike', like),
          eb('u.email', 'ilike', like),
          eb('t.name', 'ilike', like),
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
      }),
    );
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
