import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  OrgInsightsDto,
  OrgTicketUpdate,
  AddDomainInput,
  CreateInvitationInput,
  CreateTicketInput,
  CreatedInvitation,
  DomainDto,
  MembersDto,
  ReplyInput,
  SecuritySettingsInput,
  TenantDetail,
  TicketDetail,
  TicketListQuery,
  TicketSummary,
  UpdateMemberInput,
  UpdateTicketInput,
  pageOf,
  AuditPage,
  GrantDto,
  GrantInput,
  InvoiceDto,
  OrgBillingDto,
  LocalizationDto,
  LocalizationInput,
  OrgUnitDto,
  OrgUnitInput,
  PageQuery,
  PlacementInput,
  Theme,
  WorkspaceDto,
  WorkspaceRoleDto,
  WorkspaceRoleInput,
} from '@grids/schema';
import { actorOf, authenticate, type AuthDeps } from '../auth/plugin.js';

const T = z.object({ tenantId: z.uuid() });

/**
 * Organisation-scoped endpoints. Authorisation is per call: organisation admins
 * of that tenant (or platform staff) — enforced in the services.
 */
export const tenantRoutes: FastifyPluginAsyncZod<AuthDeps> = async (app, deps) => {
  const { services } = deps;
  app.addHook('preHandler', authenticate(deps));

  // ----- people -----
  app.get(
    '/tenants/:tenantId/members',
    { schema: { params: T, response: { 200: MembersDto } } },
    (req) => services.members.list(actorOf(req), req.params.tenantId),
  );
  app.patch(
    '/tenants/:tenantId/members/:userId',
    {
      schema: {
        params: T.extend({ userId: z.uuid() }),
        body: UpdateMemberInput,
        response: { 200: MembersDto },
      },
    },
    (req) =>
      services.members.update(actorOf(req), req.params.tenantId, req.params.userId, req.body),
  );
  app.post(
    '/tenants/:tenantId/invitations',
    { schema: { params: T, body: CreateInvitationInput, response: { 201: CreatedInvitation } } },
    async (req, reply) =>
      reply
        .status(201)
        .send(await services.members.invite(actorOf(req), req.params.tenantId, req.body)),
  );
  const Inv = T.extend({ invitationId: z.uuid() });
  app.post(
    '/tenants/:tenantId/invitations/:invitationId/resend',
    { schema: { params: Inv, response: { 200: CreatedInvitation } } },
    (req) => services.members.resend(actorOf(req), req.params.tenantId, req.params.invitationId),
  );
  app.delete(
    '/tenants/:tenantId/invitations/:invitationId',
    { schema: { params: Inv, response: { 200: MembersDto } } },
    (req) => services.members.revoke(actorOf(req), req.params.tenantId, req.params.invitationId),
  );

  // ----- security -----
  app.put(
    '/tenants/:tenantId/security',
    { schema: { params: T, body: SecuritySettingsInput, response: { 200: TenantDetail } } },
    (req) =>
      services.tenants.setMfaRequired(actorOf(req), req.params.tenantId, req.body.mfaRequired),
  );

  // ----- domains -----
  const D = T.extend({ domainId: z.string().max(40) });
  const Domains = { 200: z.array(DomainDto) };
  app.get('/tenants/:tenantId/domains', { schema: { params: T, response: Domains } }, (req) =>
    services.domains.list(req.params.tenantId),
  );
  app.post(
    '/tenants/:tenantId/domains',
    { schema: { params: T, body: AddDomainInput, response: Domains } },
    (req) => services.domains.add(actorOf(req), req.params.tenantId, req.body.hostname),
  );
  app.post(
    '/tenants/:tenantId/domains/:domainId/verify',
    { schema: { params: D, response: Domains } },
    (req) => services.domains.verify(actorOf(req), req.params.tenantId, req.params.domainId),
  );
  app.post(
    '/tenants/:tenantId/domains/:domainId/primary',
    { schema: { params: D, response: Domains } },
    (req) => services.domains.setPrimary(actorOf(req), req.params.tenantId, req.params.domainId),
  );
  app.delete(
    '/tenants/:tenantId/domains/:domainId',
    { schema: { params: D, response: Domains } },
    (req) => services.domains.remove(actorOf(req), req.params.tenantId, req.params.domainId),
  );

  // ----- support -----
  app.get(
    '/tenants/:tenantId/tickets',
    {
      schema: {
        params: T,
        querystring: TicketListQuery.omit({ tenantId: true }),
        response: { 200: pageOf(TicketSummary) },
      },
    },
    (req) => services.support.list(actorOf(req), { ...req.query, tenantId: req.params.tenantId }),
  );
  app.post(
    '/tenants/:tenantId/tickets',
    { schema: { params: T, body: CreateTicketInput, response: { 201: TicketDetail } } },
    async (req, reply) =>
      reply
        .status(201)
        .send(await services.support.create(actorOf(req), req.params.tenantId, req.body)),
  );
  const Ticket = z.object({ ticketId: z.uuid() });
  app.get(
    '/tickets/:ticketId',
    { schema: { params: Ticket, response: { 200: TicketDetail } } },
    (req) => services.support.get(actorOf(req), req.params.ticketId),
  );
  app.post(
    '/tickets/:ticketId/messages',
    { schema: { params: Ticket, body: ReplyInput, response: { 200: TicketDetail } } },
    (req) => services.support.reply(actorOf(req), req.params.ticketId, req.body),
  );
  app.patch(
    '/tickets/:ticketId',
    { schema: { params: Ticket, body: UpdateTicketInput, response: { 200: TicketDetail } } },
    (req) => services.support.update(actorOf(req), req.params.ticketId, req.body),
  );

  const OrgTicket = T.extend({ ticketId: z.uuid() });
  app.patch(
    '/tenants/:tenantId/tickets/:ticketId',
    { schema: { params: OrgTicket, body: OrgTicketUpdate, response: { 200: TicketDetail } } },
    (req) => services.support.orgUpdate(actorOf(req), req.params.tenantId, req.params.ticketId, req.body),
  );
  app.post(
    '/tenants/:tenantId/tickets/:ticketId/escalate',
    { schema: { params: OrgTicket, body: z.object({ note: z.string().trim().max(2000).optional() }), response: { 200: TicketDetail } } },
    (req) => services.support.escalate(actorOf(req), req.params.tenantId, req.params.ticketId, req.body.note),
  );

  app.get('/tenants/:tenantId/insights', { schema: { params: T, response: { 200: OrgInsightsDto } } }, (req) =>
    services.workspace.insights(actorOf(req), req.params.tenantId),
  );

  // ----- billing (organisation self-service) -----
  app.get(
    '/tenants/:tenantId/billing',
    { schema: { params: T, response: { 200: OrgBillingDto } } },
    (req) => services.billing.orgBilling(actorOf(req), req.params.tenantId),
  );
  app.get(
    '/tenants/:tenantId/billing/invoices',
    { schema: { params: T, querystring: PageQuery, response: { 200: pageOf(InvoiceDto) } } },
    (req) => services.billing.orgInvoices(actorOf(req), req.params.tenantId, req.query),
  );
  app.get(
    '/tenants/:tenantId/billing/invoices/:invoiceId',
    {
      schema: {
        params: T.extend({ invoiceId: z.uuid() }),
        response: { 200: InvoiceDto },
      },
    },
    (req) =>
      services.billing.orgInvoice(actorOf(req), req.params.tenantId, req.params.invoiceId),
  );

  // ----- workspace (M2) -----
  const W = services.workspace;
  app.get(
    '/tenants/:tenantId/workspace',
    { schema: { params: T, response: { 200: WorkspaceDto } } },
    (req) => W.context(actorOf(req), req.params.tenantId),
  );
  app.put(
    '/tenants/:tenantId/theme',
    { schema: { params: T, body: Theme, response: { 200: Theme } } },
    (req) => W.setTheme(actorOf(req), req.params.tenantId, req.body),
  );

  app.get(
    '/tenants/:tenantId/localization',
    { schema: { params: T, response: { 200: LocalizationDto } } },
    async (req) => {
      await W.context(actorOf(req), req.params.tenantId); // members only
      return W.localization(req.params.tenantId);
    },
  );
  app.put(
    '/tenants/:tenantId/localization',
    { schema: { params: T, body: LocalizationInput, response: { 200: LocalizationDto } } },
    (req) => W.setLocalization(actorOf(req), req.params.tenantId, req.body),
  );

  const Units = { 200: z.array(OrgUnitDto) };
  const U = T.extend({ unitId: z.uuid() });
  app.get('/tenants/:tenantId/org-units', { schema: { params: T, response: Units } }, (req) =>
    W.units(actorOf(req), req.params.tenantId),
  );
  app.post(
    '/tenants/:tenantId/org-units',
    { schema: { params: T, body: OrgUnitInput, response: Units } },
    (req) => W.createUnit(actorOf(req), req.params.tenantId, req.body),
  );
  app.put(
    '/tenants/:tenantId/org-units/:unitId',
    { schema: { params: U, body: OrgUnitInput, response: Units } },
    (req) => W.updateUnit(actorOf(req), req.params.tenantId, req.params.unitId, req.body),
  );
  app.delete(
    '/tenants/:tenantId/org-units/:unitId',
    { schema: { params: U, response: Units } },
    (req) => W.deleteUnit(actorOf(req), req.params.tenantId, req.params.unitId),
  );

  const Roles = { 200: z.array(WorkspaceRoleDto) };
  const R = T.extend({ roleId: z.uuid() });
  app.get('/tenants/:tenantId/roles', { schema: { params: T, response: Roles } }, (req) =>
    W.roles(actorOf(req), req.params.tenantId),
  );
  app.post(
    '/tenants/:tenantId/roles',
    { schema: { params: T, body: WorkspaceRoleInput, response: Roles } },
    (req) => W.createRole(actorOf(req), req.params.tenantId, req.body),
  );
  app.put(
    '/tenants/:tenantId/roles/:roleId',
    { schema: { params: R, body: WorkspaceRoleInput, response: Roles } },
    (req) => W.updateRole(actorOf(req), req.params.tenantId, req.params.roleId, req.body),
  );
  app.delete(
    '/tenants/:tenantId/roles/:roleId',
    { schema: { params: R, response: Roles } },
    (req) => W.deleteRole(actorOf(req), req.params.tenantId, req.params.roleId),
  );

  const Grants = { 200: z.array(GrantDto) };
  app.get(
    '/tenants/:tenantId/grants',
    {
      schema: {
        params: T,
        querystring: z.object({ userId: z.uuid().optional() }),
        response: Grants,
      },
    },
    (req) => W.grants(actorOf(req), req.params.tenantId, req.query.userId),
  );
  app.post(
    '/tenants/:tenantId/grants',
    { schema: { params: T, body: GrantInput, response: Grants } },
    (req) => W.grant(actorOf(req), req.params.tenantId, req.body),
  );
  app.delete(
    '/tenants/:tenantId/grants/:grantId',
    { schema: { params: T.extend({ grantId: z.uuid() }), response: Grants } },
    (req) => W.revokeGrant(actorOf(req), req.params.tenantId, req.params.grantId),
  );

  app.put(
    '/tenants/:tenantId/members/:userId/placement',
    {
      schema: {
        params: T.extend({ userId: z.uuid() }),
        body: PlacementInput,
        response: { 200: MembersDto },
      },
    },
    (req) =>
      services.members.setPlacement(
        actorOf(req),
        req.params.tenantId,
        req.params.userId,
        req.body.orgUnitId,
      ),
  );

  app.get(
    '/tenants/:tenantId/activity',
    { schema: { params: T, querystring: PageQuery, response: { 200: AuditPage } } },
    (req) => W.activity(actorOf(req), req.params.tenantId, req.query),
  );
};
