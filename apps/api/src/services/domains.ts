import { resolveTxt } from 'node:dns/promises';
import { uuidv7, type DomainDto, type ResolvedHost } from '@grids/schema';
import { conflict, HttpError, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { requireTenantAccess } from './authz.js';
import { isoOrNull, isUniqueViolation, randomToken } from './util.js';

export type TxtResolver = (name: string) => Promise<string[][]>;

const CHALLENGE_PREFIX = '_grids-challenge';

/**
 * Custom domains. Every tenant has `{slug}.{baseDomain}`; on plans with the
 * `custom_domain` feature it can add its own hostname:
 *   1. CNAME the hostname to `edge.{baseDomain}` (traffic reaches our edge),
 *   2. publish a TXT challenge proving ownership,
 *   3. once verified, optionally make it primary: the platform subdomain then
 *      301-redirects to it. TLS is issued on demand by the edge, which asks
 *      `tlsAllowed()` before requesting a certificate.
 */
export class DomainService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly opts: { resolveTxt?: TxtResolver; devAutoVerify?: boolean } = {},
  ) {}

  /** Listing for a caller: organisation members or staff who can view organisations. */
  async listFor(actor: Actor, tenantId: string): Promise<DomainDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'tenants.view' });
    return this.list(tenantId);
  }

  async list(tenantId: string): Promise<DomainDto[]> {
    const { db, baseDomain } = this.ctx;
    const t = await db
      .selectFrom('tenant')
      .select('slug')
      .where('id', '=', tenantId)
      .executeTakeFirst();
    if (!t) return [];
    const rows = await db
      .selectFrom('tenant_domain')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at')
      .execute();
    const hasPrimary = rows.some((r) => r.is_primary);
    const platform: DomainDto = {
      id: 'platform',
      hostname: `${t.slug}.${baseDomain}`,
      kind: 'platform',
      status: 'verified',
      isPrimary: !hasPrimary,
      dns: [],
      lastCheckedAt: null,
      lastError: null,
      verifiedAt: null,
    };
    return [
      platform,
      ...rows.map((r) => ({
        id: r.id,
        hostname: r.hostname,
        kind: 'custom' as const,
        status: r.status,
        isPrimary: r.is_primary,
        dns: [
          { type: 'CNAME' as const, name: r.hostname, value: `edge.${baseDomain}` },
          {
            type: 'TXT' as const,
            name: `${CHALLENGE_PREFIX}.${r.hostname}`,
            value: `grids-verify=${r.verification_token}`,
          },
        ],
        lastCheckedAt: isoOrNull(r.last_checked_at),
        lastError: r.last_error,
        verifiedAt: isoOrNull(r.verified_at),
      })),
    ];
  }

  async add(actor: Actor, tenantId: string, hostname: string): Promise<DomainDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'tenants.domains',
      workspace: 'domains.manage',
    });
    const { db, baseDomain } = this.ctx;
    if (hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)) {
      throw conflict(
        'Reserved domain',
        `Hostnames under ${baseDomain} are managed by the platform.`,
      );
    }
    const plan = await db
      .selectFrom('tenant as t')
      .innerJoin('plan as p', 'p.id', 't.plan_id')
      .select('p.features')
      .where('t.id', '=', tenantId)
      .executeTakeFirst();
    if (!(plan?.features as string[] | undefined)?.includes('custom_domain')) {
      throw new HttpError(
        402,
        'Upgrade required',
        'Custom domains are available on plans with the custom domain feature.',
      );
    }
    try {
      await db
        .insertInto('tenant_domain')
        .values({
          id: uuidv7(),
          tenant_id: tenantId,
          hostname,
          status: 'pending',
          verification_token: randomToken(18),
        })
        .execute();
    } catch (e) {
      if (isUniqueViolation(e))
        throw conflict('Domain in use', `${hostname} is already connected.`);
      throw e;
    }
    await audit(this.ctx, actor.id, tenantId, 'domain.added', { hostname });
    return this.list(tenantId);
  }

  async verify(actor: Actor, tenantId: string, domainId: string): Promise<DomainDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'tenants.domains',
      workspace: 'domains.manage',
    });
    const d = await this.get(tenantId, domainId);
    let error: string | null = null;
    if (!(this.opts.devAutoVerify && /\.(localhost|test)$/.test(d.hostname))) {
      try {
        const records = (
          await (this.opts.resolveTxt ?? resolveTxt)(`${CHALLENGE_PREFIX}.${d.hostname}`)
        ).map((r) => r.join(''));
        if (!records.includes(`grids-verify=${d.verification_token}`))
          error = 'TXT record found but the value does not match.';
      } catch (e) {
        error =
          (e as { code?: string }).code === 'ENOTFOUND' ||
          (e as { code?: string }).code === 'ENODATA'
            ? `No TXT record at ${CHALLENGE_PREFIX}.${d.hostname} yet. DNS changes can take a while to propagate.`
            : `DNS lookup failed: ${(e as Error).message}`;
      }
    }
    const now = this.ctx.now();
    await this.ctx.db
      .updateTable('tenant_domain')
      .set(
        error
          ? {
              status: d.status === 'verified' ? 'verified' : 'failed',
              last_error: error,
              last_checked_at: now,
            }
          : {
              status: 'verified',
              last_error: null,
              last_checked_at: now,
              verified_at: d.verified_at ?? now,
            },
      )
      .where('id', '=', domainId)
      .execute();
    await audit(
      this.ctx,
      actor.id,
      tenantId,
      error ? 'domain.verification_failed' : 'domain.verified',
      { hostname: d.hostname },
    );
    return this.list(tenantId);
  }

  /** `domainId = 'platform'` makes the platform subdomain primary again. */
  async setPrimary(actor: Actor, tenantId: string, domainId: string): Promise<DomainDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'tenants.domains',
      workspace: 'domains.manage',
    });
    const target = domainId === 'platform' ? null : await this.get(tenantId, domainId);
    if (target && target.status !== 'verified') throw conflict('Domain not verified');
    await this.ctx.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('tenant_domain')
        .set({ is_primary: false })
        .where('tenant_id', '=', tenantId)
        .execute();
      if (target)
        await tx
          .updateTable('tenant_domain')
          .set({ is_primary: true })
          .where('id', '=', target.id)
          .execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'domain.primary_changed', {
      hostname: target?.hostname ?? 'platform subdomain',
    });
    return this.list(tenantId);
  }

  async remove(actor: Actor, tenantId: string, domainId: string): Promise<DomainDto[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'tenants.domains',
      workspace: 'domains.manage',
    });
    const d = await this.get(tenantId, domainId);
    await this.ctx.db.deleteFrom('tenant_domain').where('id', '=', d.id).execute();
    await audit(this.ctx, actor.id, tenantId, 'domain.removed', { hostname: d.hostname });
    return this.list(tenantId);
  }

  /** Edge routing: Host header → tenant, plus whether to redirect to the primary host. */
  async resolve(host: string): Promise<ResolvedHost> {
    const hostname = host.toLowerCase().replace(/:\d+$/, '');
    const { db, baseDomain } = this.ctx;
    let tenant: { id: string; slug: string } | undefined;
    if (hostname.endsWith(`.${baseDomain}`)) {
      const slug = hostname.slice(0, -baseDomain.length - 1);
      tenant = await db
        .selectFrom('tenant')
        .select(['id', 'slug'])
        .where('slug', '=', slug)
        .where('status', '=', 'active')
        .executeTakeFirst();
    } else {
      tenant = await db
        .selectFrom('tenant_domain as d')
        .innerJoin('tenant as t', 't.id', 'd.tenant_id')
        .select(['t.id', 't.slug'])
        .where('d.hostname', '=', hostname)
        .where('d.status', '=', 'verified')
        .where('t.status', '=', 'active')
        .executeTakeFirst();
    }
    if (!tenant) throw notFound('Host');
    const primary = await db
      .selectFrom('tenant_domain')
      .select('hostname')
      .where('tenant_id', '=', tenant.id)
      .where('is_primary', '=', true)
      .where('status', '=', 'verified')
      .executeTakeFirst();
    const canonicalHost = primary?.hostname ?? `${tenant.slug}.${baseDomain}`;
    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      canonicalHost,
      redirect: canonicalHost !== hostname,
    };
  }

  /** On-demand TLS gate for the edge (e.g. Caddy `ask`): only issue certs for known hosts. */
  async tlsAllowed(host: string): Promise<boolean> {
    return this.resolve(host).then(
      () => true,
      () => false,
    );
  }

  private async get(tenantId: string, domainId: string) {
    const d = await this.ctx.db
      .selectFrom('tenant_domain')
      .selectAll()
      .where('id', '=', domainId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!d) throw notFound('Domain');
    return d;
  }
}
