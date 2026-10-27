import type { CreatedOAuthClient, OAuthClientInput, OAuthClientsDto, OAuthClientUpdate } from '@grids/schema';
import { badRequest, notFound } from '../errors.js';
import { requireTenantAccess } from './authz.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { planHasFeature, requireFeature } from './features.js';

/**
 * Applications an organisation registers to sign its people in through Grids.
 * Managed by organisation admins (the same permission as the security settings).
 */
export class OAuthClientService {
  constructor(private readonly ctx: ServiceContext) {}

  private async orgId(actor: Actor, tenantId: string, mutating = false): Promise<string> {
    if (mutating) await requireFeature(this.ctx.db, tenantId, 'authentication', 'Authentication');
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'tenants.security', workspace: 'security.manage' });
    const t = await this.ctx.db.selectFrom('tenant').select('idp_org_id').where('id', '=', tenantId).executeTakeFirst();
    if (!t) throw notFound('Organisation');
    if (!t.idp_org_id) throw badRequest('This organisation is not set up for sign-in yet.');
    return t.idp_org_id;
  }

  async list(actor: Actor, tenantId: string): Promise<OAuthClientsDto> {
    const orgId = await this.orgId(actor, tenantId);
    // A plan without authentication has nothing to show: the page explains instead.
    return (await planHasFeature(this.ctx.db, tenantId, 'authentication')) ? this.ctx.idp.listClients(orgId) : { issuer: '', clients: [] };
  }

  async create(actor: Actor, tenantId: string, input: OAuthClientInput): Promise<CreatedOAuthClient> {
    const orgId = await this.orgId(actor, tenantId, true);
    const created = await this.ctx.idp.createClient(orgId, {
      name: input.name,
      redirectUris: input.redirectUris,
      postLogoutRedirectUris: input.postLogoutRedirectUris ?? [],
      confidential: input.confidential ?? false,
    });
    await audit(this.ctx, actor.id, tenantId, 'sso.client_created', { clientId: created.clientId, name: created.name });
    return created;
  }

  async update(actor: Actor, tenantId: string, clientId: string, patch: OAuthClientUpdate) {
    const updated = await this.ctx.idp.updateClient(await this.orgId(actor, tenantId, true), clientId, patch);
    await audit(this.ctx, actor.id, tenantId, 'sso.client_updated', { clientId, fields: Object.keys(patch) });
    return updated;
  }

  async rotateSecret(actor: Actor, tenantId: string, clientId: string): Promise<CreatedOAuthClient> {
    const rotated = await this.ctx.idp.rotateClientSecret(await this.orgId(actor, tenantId, true), clientId);
    await audit(this.ctx, actor.id, tenantId, 'sso.client_secret_rotated', { clientId });
    return rotated;
  }

  async remove(actor: Actor, tenantId: string, clientId: string): Promise<void> {
    await this.ctx.idp.deleteClient(await this.orgId(actor, tenantId, true), clientId);
    await audit(this.ctx, actor.id, tenantId, 'sso.client_deleted', { clientId });
  }
}
