import { sql } from 'kysely';
import {
  LIMIT_KEYS,
  uuidv7,
  type Contact,
  type CreateTenantData,
  type Page,
  type PlanLimits,
  type TenantDetail,
  type TenantListQuery,
  type TenantStatusInput,
  type TenantSummary,
  type UpdateTenantData,
} from '@grids/schema';
import { badRequest, conflict, notFound } from '../errors.js';
import { requireStaff, requireTenantAccess } from './authz.js';
import type { BillingService } from './billing.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import type { DomainService } from './domains.js';
import type { Provisioner } from './provisioning.js';
import { iso, isUniqueViolation, mapPage, paginate, randomToken, slugify } from './util.js';

const CONTACT_KINDS = ['primary', 'billing', 'technical'] as const;

/** Organisation records: profile, contacts, lifecycle and security settings. */
export class TenantService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly deps: {
      billing: BillingService;
      domains: DomainService;
      provisioner: Provisioner;
      projectsUsed?: (tenantId: string) => Promise<number>;
    },
  ) {}

  async list(query: Partial<TenantListQuery> = {}): Promise<Page<TenantSummary>> {
    let q = this.summaryQuery().orderBy('t.created_at', 'desc');
    if (query.status) q = q.where('t.status', '=', query.status);
    if (query.q) {
      const like = `%${query.q}%`;
      q = q.where((eb) =>
        eb.or([
          eb('t.name', 'ilike', like),
          eb('t.slug', 'ilike', like),
          eb('t.legal_name', 'ilike', like),
          eb('t.email', 'ilike', like),
        ]),
      );
    }
    return mapPage(
      await paginate(q, { page: query.page ?? 1, pageSize: query.pageSize ?? 25 }),
      toSummary,
    );
  }

  async get(tenantId: string): Promise<TenantDetail> {
    const { db } = this.ctx;
    const t = await this.summaryQuery().where('t.id', '=', tenantId).executeTakeFirst();
    if (!t) throw notFound('Organisation');
    const contacts = await db
      .selectFrom('tenant_contact')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .execute();
    const contact = (kind: string): Contact | null => {
      const c = contacts.find((x) => x.kind === kind);
      return c
        ? {
            name: c.name,
            email: c.email,
            phone: c.phone ?? undefined,
            jobTitle: c.job_title ?? undefined,
          }
        : null;
    };
    const subscription = await this.deps.billing.currentSubscription(tenantId);
    const plan = t.plan_id
      ? await db.selectFrom('plan').select('limits').where('id', '=', t.plan_id).executeTakeFirst()
      : undefined;
    const limits = (plan?.limits as PlanLimits | undefined) ?? null;
    const seats = await this.seatsUsed(tenantId);
    const projectCount = (await this.deps.projectsUsed?.(tenantId)) ?? 0;

    return {
      ...toSummary(t),
      idpOrgId: t.idp_org_id,
      cellId: t.cell_id,
      website: t.website,
      registrationNumber: t.registration_number,
      taxId: t.tax_id,
      email: t.email,
      phone: t.phone,
      companySize: t.company_size,
      address: {
        line1: t.address_line1,
        line2: t.address_line2,
        city: t.city,
        region: t.region,
        postalCode: t.postal_code,
        country: t.country,
      },
      timezone: t.timezone,
      locale: t.locale,
      currency: t.currency.trim(),
      notes: t.notes,
      contacts: {
        primary: contact('primary'),
        billing: contact('billing'),
        technical: contact('technical'),
      },
      mfaRequired: t.mfa_required,
      subscription,
      limits,
      usage: LIMIT_KEYS.map((key) => ({
        key,
        used: key === 'users' ? seats : key === 'projects' ? projectCount : null,
        limit: limits?.[key] ?? null,
      })),
      domains: await this.deps.domains.list(tenantId),
      nextStep: await this.nextStep(t.status, tenantId, subscription?.status ?? null),
    };
  }

  async create(actor: Actor, input: CreateTenantData): Promise<TenantDetail> {
    requireStaff(actor, 'tenants.create');
    const { db } = this.ctx;
    const cell = await db
      .selectFrom('cell')
      .select('id')
      .where('kind', '=', 'shared')
      .where('accepting_tenants', '=', true)
      .orderBy('id')
      .executeTakeFirst();
    if (!cell) throw conflict('No cell is accepting new organisations');

    const slug = input.slug ?? (await this.generateSlug(input.legalName ?? input.name));
    const id = uuidv7();
    try {
      await db.transaction().execute(async (tx) => {
        await tx
          .insertInto('tenant')
          .values({
            ...profileRow(input),
            id,
            slug,
            name: input.name,
            status: 'pending_payment',
            plan_id: null,
            cell_id: cell.id,
          })
          .execute();
        for (const kind of CONTACT_KINDS) {
          const c = input.contacts[kind];
          if (c)
            await tx
              .insertInto('tenant_contact')
              .values(contactRow(id, kind, c))
              .execute();
        }
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw conflict('Slug already taken', `"${slug}" is in use. Choose another.`);
      throw e;
    }
    await audit(this.ctx, actor.id, id, 'tenant.created', {
      name: input.name,
      slug,
      cell: cell.id,
    });
    return this.get(id);
  }

  async update(actor: Actor, tenantId: string, input: UpdateTenantData): Promise<TenantDetail> {
    requireStaff(actor, 'tenants.edit');
    const { db } = this.ctx;
    const existing = await db
      .selectFrom('tenant')
      .select('id')
      .where('id', '=', tenantId)
      .executeTakeFirst();
    if (!existing) throw notFound('Organisation');

    await db.transaction().execute(async (tx) => {
      const row = profileRow(input);
      if (Object.keys(row).length) {
        await tx
          .updateTable('tenant')
          .set({ ...row, updated_at: this.ctx.now() })
          .where('id', '=', tenantId)
          .execute();
      }
      for (const kind of CONTACT_KINDS) {
        const c = input.contacts?.[kind];
        if (c === undefined) continue;
        if (c === null) {
          if (kind === 'primary') throw badRequest('A primary contact is required');
          await tx
            .deleteFrom('tenant_contact')
            .where('tenant_id', '=', tenantId)
            .where('kind', '=', kind)
            .execute();
        } else {
          const values = contactRow(tenantId, kind, c);
          await tx
            .insertInto('tenant_contact')
            .values(values)
            .onConflict((oc) =>
              oc.columns(['tenant_id', 'kind']).doUpdateSet({
                name: values.name,
                email: values.email,
                phone: values.phone,
                job_title: values.job_title,
              }),
            )
            .execute();
        }
      }
    });
    const fields = [
      ...Object.keys(profileRow(input)),
      ...Object.keys(input.contacts ?? {}).map((k) => `${k} contact`),
    ];
    await audit(this.ctx, actor.id, tenantId, 'tenant.updated', { fields: fields.join(', ') });
    return this.get(tenantId);
  }

  async setStatus(actor: Actor, tenantId: string, input: TenantStatusInput): Promise<TenantDetail> {
    requireStaff(actor, 'tenants.lifecycle');
    const t = await this.ctx.db
      .selectFrom('tenant')
      .selectAll()
      .where('id', '=', tenantId)
      .executeTakeFirst();
    if (!t) throw notFound('Organisation');
    if (t.status === input.status) return this.get(tenantId);

    if (input.status === 'active') {
      if (t.status === 'provisioning') {
        await this.deps.provisioner.provision(actor.id, tenantId); // resume a failed provisioning
        return this.get(tenantId);
      }
      if (!t.idp_org_id) {
        throw conflict(
          'Not provisioned yet',
          'Record the first payment or start a trial to activate.',
        );
      }
    }
    if (input.status === 'cancelled') await this.deps.billing.cancelForTenant(actor, tenantId);

    await this.ctx.db
      .updateTable('tenant')
      .set({ status: input.status, updated_at: this.ctx.now() })
      .where('id', '=', tenantId)
      .execute();
    await audit(
      this.ctx,
      actor.id,
      tenantId,
      `tenant.${input.status === 'active' ? 'reactivated' : input.status}`,
      {
        from: t.status,
        ...(input.reason && { reason: input.reason }),
      },
    );
    return this.get(tenantId);
  }

  /** Organisation-wide second-factor requirement, enforced by the identity provider. */
  async setMfaRequired(actor: Actor, tenantId: string, required: boolean): Promise<TenantDetail> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'tenants.security',
      workspace: 'security.manage',
    });
    const t = await this.ctx.db
      .selectFrom('tenant')
      .selectAll()
      .where('id', '=', tenantId)
      .executeTakeFirst();
    if (!t) throw notFound('Organisation');
    if (t.idp_org_id) await this.ctx.idp.setOrganizationMfaRequired(t.idp_org_id, required);
    await this.ctx.db
      .updateTable('tenant')
      .set({ mfa_required: required })
      .where('id', '=', tenantId)
      .execute();
    await audit(
      this.ctx,
      actor.id,
      tenantId,
      required ? 'security.mfa_required' : 'security.mfa_optional',
    );
    return this.get(tenantId);
  }

  /** Members plus pending invitations count against the `users` limit. */
  async seatsUsed(tenantId: string): Promise<number> {
    const row = await sql<{ n: string }>`
      select (
        (select count(*) from membership where tenant_id = ${tenantId}) +
        (select count(*) from invitation
          where tenant_id = ${tenantId} and accepted_at is null and revoked_at is null and expires_at > ${this.ctx.now()})
      )::text as n
    `.execute(this.ctx.db);
    return Number(row.rows[0]?.n ?? 0);
  }

  private async nextStep(
    status: string,
    tenantId: string,
    subscriptionStatus: string | null,
  ): Promise<TenantDetail['nextStep']> {
    if (status === 'cancelled') return 'none';
    if (!subscriptionStatus) return 'subscribe';
    if (subscriptionStatus === 'pending_payment') return 'record_payment';
    if (status !== 'active') return 'none';
    const admin = await sql<{ n: string }>`
      select (
        (select count(*) from membership where tenant_id = ${tenantId} and role = 'org_admin' and status = 'active') +
        (select count(*) from invitation where tenant_id = ${tenantId} and role = 'org_admin'
          and accepted_at is null and revoked_at is null and expires_at > ${this.ctx.now()})
      )::text as n
    `.execute(this.ctx.db);
    return Number(admin.rows[0]?.n) > 0 ? 'none' : 'invite_admin';
  }

  private async generateSlug(name: string): Promise<string> {
    let base =
      slugify(name) ||
      `org-${randomToken(4)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')}`;
    if (base.length < 2) base = `${base}-org`;
    const taken = new Set(
      (
        await this.ctx.db
          .selectFrom('tenant')
          .select('slug')
          .where((eb) => eb.or([eb('slug', '=', base), eb('slug', 'like', `${base}-%`)]))
          .execute()
      ).map((r) => r.slug),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  private summaryQuery() {
    return this.ctx.db
      .selectFrom('tenant as t')
      .leftJoin('plan as p', 'p.id', 't.plan_id')
      .selectAll('t')
      .select('p.name as plan_name')
      .select((eb) => [
        eb
          .selectFrom('membership as m')
          .whereRef('m.tenant_id', '=', 't.id')
          .select(eb.fn.countAll<string>().as('c'))
          .as('member_count'),
        eb
          .selectFrom('support_ticket as st')
          .whereRef('st.tenant_id', '=', 't.id')
          .where('st.status', 'in', ['open', 'pending'])
          .select(eb.fn.countAll<string>().as('c'))
          .as('open_tickets'),
        eb
          .selectFrom('subscription as s')
          .whereRef('s.tenant_id', '=', 't.id')
          .where('s.status', '<>', 'cancelled')
          .select('s.status')
          .limit(1)
          .as('subscription_status'),
        eb
          .selectFrom('tenant_contact as c')
          .whereRef('c.tenant_id', '=', 't.id')
          .where('c.kind', '=', 'primary')
          .select('c.email')
          .limit(1)
          .as('primary_email'),
      ]);
  }
}

type SummaryRow = {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  status: TenantSummary['status'];
  plan_id: string | null;
  plan_name: string | null;
  subscription_status: string | null;
  country: string | null;
  industry: string | null;
  primary_email: string | null;
  member_count: string | null;
  open_tickets: string | null;
  created_at: Date;
};

function toSummary(t: SummaryRow): TenantSummary {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    legalName: t.legal_name,
    status: t.status,
    planId: t.plan_id,
    planName: t.plan_name,
    subscriptionStatus: t.subscription_status,
    country: t.country?.trim() ?? null,
    industry: t.industry,
    primaryContactEmail: t.primary_email,
    memberCount: Number(t.member_count ?? 0),
    openTickets: Number(t.open_tickets ?? 0),
    createdAt: iso(t.created_at),
  };
}

/** Maps provided profile fields to columns; omitted fields are left untouched. */
function profileRow(p: UpdateTenantData) {
  const row: Record<string, string | null> = {};
  const set = (col: string, v: string | undefined) => {
    if (v !== undefined) row[col] = v || null;
  };
  set('name', p.name);
  set('legal_name', p.legalName);
  set('industry', p.industry);
  set('company_size', p.companySize);
  set('website', p.website);
  set('registration_number', p.registrationNumber);
  set('tax_id', p.taxId);
  set('email', p.email);
  set('phone', p.phone);
  set('timezone', p.timezone);
  set('locale', p.locale);
  set('currency', p.currency);
  set('notes', p.notes);
  if (p.address) {
    row.address_line1 = p.address.line1 ?? null;
    row.address_line2 = p.address.line2 ?? null;
    row.city = p.address.city ?? null;
    row.region = p.address.region ?? null;
    row.postal_code = p.address.postalCode ?? null;
    row.country = p.address.country ?? null;
  }
  return row;
}

function contactRow(tenantId: string, kind: (typeof CONTACT_KINDS)[number], c: Contact) {
  return {
    id: uuidv7(),
    tenant_id: tenantId,
    kind,
    name: c.name,
    email: c.email,
    phone: c.phone ?? null,
    job_title: c.jobTitle ?? null,
  };
}
