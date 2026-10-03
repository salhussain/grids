import { withTenant } from '@grids/db';
import { notFound } from '../errors.js';
import { audit, type ServiceContext } from './context.js';
import { ensureSystemRoles } from './policy.js';

/**
 * Brings a paid (or trialing) tenant online: initialise its data cell, create its
 * identity-provider org (with its MFA policy), then mark it active and welcome it.
 * Idempotent: every step checks its own state, so it can be resumed after a failure.
 */
export class Provisioner {
  constructor(
    private readonly ctx: ServiceContext,
    /** Languages a new organisation starts with (platform settings). */
    private readonly orgDefaults: () => Promise<object> = async () => ({}),
  ) {}

  async provision(actorId: string | null, tenantId: string): Promise<void> {
    const { db } = this.ctx;
    const t = await db
      .selectFrom('tenant')
      .selectAll()
      .where('id', '=', tenantId)
      .executeTakeFirst();
    if (!t) throw notFound('Tenant');
    if (t.status === 'active') return;

    await db
      .updateTable('tenant')
      .set({ status: 'provisioning' })
      .where('id', '=', tenantId)
      .execute();

    const cellDb = await this.ctx.cells.forTenant(tenantId);
    const defaults = await this.orgDefaults();
    await withTenant(cellDb, tenantId, (tx) =>
      tx
        .insertInto('tenant_profile')
        .values({ tenant_id: tenantId, name: t.name, localization: JSON.stringify(defaults) })
        .onConflict((oc) => oc.column('tenant_id').doNothing())
        .execute(),
    );

    await ensureSystemRoles(this.ctx, tenantId);

    let idpOrgId = t.idp_org_id;
    if (!idpOrgId) {
      idpOrgId = await this.ctx.idp.createOrganization(tenantId, t.name);
      await db
        .updateTable('tenant')
        .set({ idp_org_id: idpOrgId })
        .where('id', '=', tenantId)
        .execute();
    }
    if (t.mfa_required) await this.ctx.idp.setOrganizationMfaRequired(idpOrgId, true);

    await db
      .updateTable('tenant')
      .set({ status: 'active', updated_at: this.ctx.now() })
      .where('id', '=', tenantId)
      .execute();
    await audit(this.ctx, actorId, tenantId, 'tenant.provisioned', { idpOrgId, cell: t.cell_id });

    const primary = await db
      .selectFrom('tenant_contact')
      .select(['name', 'email'])
      .where('tenant_id', '=', tenantId)
      .where('kind', '=', 'primary')
      .executeTakeFirst();
    if (primary) {
      await this.ctx.email.send('tenant_welcome', tenantId, {
        to: primary.email,
        subject: `${t.name} is ready on Grids`,
        text: `Hello ${primary.name},

Your Grids workspace for ${t.name} is ready.

Workspace address: https://${t.slug}.${this.ctx.baseDomain}

Your platform contact will now invite your administrators. Reply to this email if you need help.

— The Grids team`,
      });
    }
  }
}
