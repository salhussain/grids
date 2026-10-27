import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreatedOAuthClient,
  OAuthClientDto,
  OAuthClientInput,
  OAuthClientsDto,
  OAuthClientUpdate,
  OrgInsightsDto,
  OrgTicketUpdate,
  EditMessageInput,
  ResolveThreadInput,
  HelpDeskConfig,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SupportAttachmentDto,
  SupportInfo,
  SupportMineDto,
  SupportReplyInput,
  SupportRequestInput,
  SupportSent,
  SupportThreadDto,
  AddDomainInput,
  CreateInvitationInput,
  CreateTicketInput,
  CreatedInvitation,
  DomainDto,
  MembersDto,
  ReplyInput,
  SecuritySettingsInput,
  SessionPolicy,
  MerchantDto,
  MerchantInput,
  MethodInput,
  PaymentsDto,
  ActiveSessionsDto,
  PastSessionsDto,
  TenantDetail,
  TicketDetail,
  AgentTypingInput,
  FavoriteInput,
  SupportEmbedSecret,
  SupportEmbedUsage,
  SupportSiteCheck,
  SupportSiteIdInput,
  SupportSiteCheckInput,
  SupportTypingInput,
  TicketLinkInput,
  TicketListQuery,
  TicketStats,
  TicketSummary,
  UpdateMemberInput,
  UpdateTicketInput,
  pageOf,
  ActivitySummaryDto,
  ActivitySummaryQuery,
  AuditPage,
  AuditQuery,
  GrantDto,
  GrantInput,
  InvoiceDto,
  OrgBillingDto,
  OrgPlanDto,
  EmailPreviewDto,
  EmailPreviewInput,
  EmailTestInput,
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

  app.put(
    '/tenants/:tenantId/session-policy',
    { schema: { params: T, body: SessionPolicy, response: { 200: TenantDetail } } },
    (req) => services.tenants.setSessionPolicy(actorOf(req), req.params.tenantId, req.body),
  );

  app.get('/tenants/:tenantId/sessions', { schema: { params: T, response: { 200: ActiveSessionsDto } } }, (req) =>
    services.tenants.activeSessions(actorOf(req), req.params.tenantId),
  );
  app.get('/tenants/:tenantId/sessions/past', { schema: { params: T, response: { 200: PastSessionsDto } } }, (req) =>
    services.tenants.pastSessions(actorOf(req), req.params.tenantId),
  );
  app.delete(
    '/tenants/:tenantId/sessions/:sessionId',
    { schema: { params: T.extend({ sessionId: z.string().min(1).max(200) }), response: { 200: ActiveSessionsDto } } },
    (req) => services.tenants.revokeSession(actorOf(req), req.params.tenantId, req.params.sessionId),
  );

  // ----- payments the organisation takes through its forms -----
  app.get('/tenants/:tenantId/payments', { schema: { params: T, response: { 200: PaymentsDto } } }, (req) =>
    services.payments.overview(actorOf(req), req.params.tenantId),
  );
  app.get(
    '/tenants/:tenantId/payments/export',
    {
      schema: {
        params: T,
        querystring: z.object({
          status: z.string().max(100).optional(),
          form: z.string().max(2000).optional(),
          method: z.string().max(100).optional(),
          from: z.iso.date().optional(),
          to: z.iso.date().optional(),
          q: z.string().max(100).optional(),
        }),
      },
    },
    async (req, reply) =>
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="payments-${new Date().toISOString().slice(0, 10)}.csv"`)
        .header('cache-control', 'private, no-store')
        .send(await services.payments.exportCsv(actorOf(req), req.params.tenantId, req.query)),
  );
  // Receipts: one as a PDF, or several as a ZIP of separate PDFs.
  app.get('/tenants/:tenantId/payments/:paymentId/receipt', { schema: { params: T.extend({ paymentId: z.uuid() }) } }, async (req, reply) => {
    const r = await services.payments.receipt(actorOf(req), req.params.tenantId, req.params.paymentId);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${r.name}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(r.pdf);
  });
  app.post(
    '/tenants/:tenantId/payments/receipts',
    { schema: { params: T, body: z.object({ ids: z.array(z.uuid()).min(1).max(500) }) } },
    async (req, reply) => {
      const r = await services.payments.receiptsZip(actorOf(req), req.params.tenantId, req.body.ids);
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="receipts-${new Date().toISOString().slice(0, 10)}.zip"`)
        .header('x-receipts', String(r.count))
        .header('x-receipts-skipped', String(r.skipped))
        .header('access-control-expose-headers', 'x-receipts, x-receipts-skipped')
        .header('cache-control', 'private, no-store')
        .send(r.zip);
    },
  );
  app.get(
    '/tenants/:tenantId/payments/merchant-choices',
    { schema: { params: T, response: { 200: z.array(MerchantDto.pick({ id: true, name: true, mode: true, enabled: true, logo: true, methods: true })) } } },
    (req) => services.payments.merchantChoices(actorOf(req), req.params.tenantId),
  );
  const Mth = T.extend({ key: z.string().min(1).max(60) });
  app.post(
    '/tenants/:tenantId/payments/methods',
    { schema: { params: T, body: MethodInput, response: { 200: PaymentsDto } } },
    (req) => services.payments.addMethod(actorOf(req), req.params.tenantId, req.body),
  );
  app.put(
    '/tenants/:tenantId/payments/methods/:key',
    { schema: { params: Mth, body: MethodInput, response: { 200: PaymentsDto } } },
    (req) => services.payments.changeMethod(actorOf(req), req.params.tenantId, req.params.key, req.body),
  );
  app.delete(
    '/tenants/:tenantId/payments/methods/:key',
    { schema: { params: Mth, response: { 200: PaymentsDto } } },
    (req) => services.payments.deleteMethod(actorOf(req), req.params.tenantId, req.params.key),
  );
  const M = T.extend({ merchantId: z.uuid() });
  app.post(
    '/tenants/:tenantId/payments/merchants',
    { schema: { params: T, body: MerchantInput, response: { 200: PaymentsDto } } },
    (req) => services.payments.saveMerchant(actorOf(req), req.params.tenantId, null, req.body),
  );
  app.put(
    '/tenants/:tenantId/payments/merchants/:merchantId',
    { schema: { params: M, body: MerchantInput, response: { 200: PaymentsDto } } },
    (req) => services.payments.saveMerchant(actorOf(req), req.params.tenantId, req.params.merchantId, req.body),
  );
  app.delete(
    '/tenants/:tenantId/payments/merchants/:merchantId',
    { schema: { params: M, response: { 200: PaymentsDto } } },
    (req) => services.payments.deleteMerchant(actorOf(req), req.params.tenantId, req.params.merchantId),
  );

  // ----- applications that sign people in through Grids -----
  const C = T.extend({ clientId: z.string().min(1).max(60) });
  app.get('/tenants/:tenantId/oauth-clients', { schema: { params: T, response: { 200: OAuthClientsDto } } }, (req) =>
    services.oauthClients.list(actorOf(req), req.params.tenantId),
  );
  app.post(
    '/tenants/:tenantId/oauth-clients',
    { schema: { params: T, body: OAuthClientInput, response: { 201: CreatedOAuthClient } } },
    async (req, reply) => reply.code(201).send(await services.oauthClients.create(actorOf(req), req.params.tenantId, req.body)),
  );
  app.patch(
    '/tenants/:tenantId/oauth-clients/:clientId',
    { schema: { params: C, body: OAuthClientUpdate, response: { 200: OAuthClientDto } } },
    (req) => services.oauthClients.update(actorOf(req), req.params.tenantId, req.params.clientId, req.body),
  );
  app.post(
    '/tenants/:tenantId/oauth-clients/:clientId/secret',
    { schema: { params: C, response: { 200: CreatedOAuthClient } } },
    (req) => services.oauthClients.rotateSecret(actorOf(req), req.params.tenantId, req.params.clientId),
  );
  app.delete('/tenants/:tenantId/oauth-clients/:clientId', { schema: { params: C } }, async (req, reply) => {
    await services.oauthClients.remove(actorOf(req), req.params.tenantId, req.params.clientId);
    return reply.code(204).send();
  });

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
  app.get(
    '/tenants/:tenantId/tickets/stats',
    { schema: { params: T, response: { 200: TicketStats } } },
    (req) => services.support.stats(actorOf(req), req.params.tenantId),
  );
  app.post('/tenants/:tenantId/tickets/:ticketId/typing', { schema: { params: T.extend({ ticketId: z.string().uuid() }), body: AgentTypingInput } }, async (req, reply) => {
    await services.support.agentIsTyping(actorOf(req), req.params.tenantId, req.params.ticketId, req.body.typing);
    return reply.status(204).send();
  });
  app.put(
    '/tickets/:ticketId/favorite',
    { schema: { params: z.object({ ticketId: z.uuid() }), body: FavoriteInput, response: { 200: TicketDetail } } },
    (req) => services.support.setFavorite(actorOf(req), req.params.ticketId, req.body.favorite),
  );
  app.post(
    '/tenants/:tenantId/tickets/:ticketId/links',
    { schema: { params: T.extend({ ticketId: z.string().uuid() }), body: TicketLinkInput, response: { 200: TicketDetail } } },
    (req) => services.support.link(actorOf(req), req.params.tenantId, req.params.ticketId, req.body),
  );
  app.delete(
    '/tenants/:tenantId/tickets/:ticketId/links/:linkId',
    { schema: { params: T.extend({ ticketId: z.string().uuid(), linkId: z.string().uuid() }), response: { 200: TicketDetail } } },
    (req) => services.support.unlink(actorOf(req), req.params.tenantId, req.params.ticketId, req.params.linkId),
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

  const MessageParams = Ticket.extend({ messageId: z.uuid() });
  app.patch('/tickets/:ticketId/messages/:messageId', { schema: { params: MessageParams, body: EditMessageInput, response: { 200: TicketDetail } } }, (req) =>
    services.support.editMessage(actorOf(req), req.params.ticketId, req.params.messageId, req.body.body),
  );
  app.post('/tickets/:ticketId/messages/:messageId/resolve', { schema: { params: MessageParams, body: ResolveThreadInput, response: { 200: TicketDetail } } }, (req) =>
    services.support.resolveThread(actorOf(req), req.params.ticketId, req.params.messageId, req.body.resolved),
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

  // The organisation's help desk: its stages, labels and how it takes requests; who tickets can go to; files.
  app.get('/tenants/:tenantId/support/desk', { schema: { params: T, response: { 200: HelpDeskConfig } } }, (req) => services.support.desk(actorOf(req), req.params.tenantId));
  app.post('/tenants/:tenantId/support/desk/embed-key', { schema: { params: T, body: z.object({ siteId: z.string().max(40) }), response: { 200: HelpDeskConfig } } }, (req) => services.support.rotateEmbedKey(actorOf(req), req.params.tenantId, req.body.siteId));
  app.post('/tenants/:tenantId/support/desk/check-site', { schema: { params: T, body: SupportSiteCheckInput, response: { 200: SupportSiteCheck } } }, (req) => services.support.checkSite(actorOf(req), req.params.tenantId, req.body.host));
  app.get('/tenants/:tenantId/support/desk/embed-usage', { schema: { params: T, response: { 200: SupportEmbedUsage } } }, (req) => services.helpDesk.embedUsage(actorOf(req), req.params.tenantId));
  app.get('/tenants/:tenantId/support/desk/embed-secret', { schema: { params: T, querystring: SupportSiteIdInput, response: { 200: SupportEmbedSecret } } }, async (req) => ({ secret: await services.helpDesk.embedSecret(actorOf(req), req.params.tenantId, req.query.siteId) }));
  app.post('/tenants/:tenantId/support/desk/embed-secret', { schema: { params: T, body: SupportSiteIdInput, response: { 200: HelpDeskConfig } } }, (req) => services.support.rotateEmbedSecret(actorOf(req), req.params.tenantId, req.body.siteId));
  app.put('/tenants/:tenantId/support/desk', { schema: { params: T, body: HelpDeskConfig, response: { 200: HelpDeskConfig } } }, (req) => services.support.saveDesk(actorOf(req), req.params.tenantId, req.body));
  app.get('/tenants/:tenantId/support/handlers', { schema: { params: T, response: { 200: z.array(z.object({ id: z.string(), name: z.string(), email: z.string().nullable() })) } } }, (req) =>
    services.support.handlers(actorOf(req), req.params.tenantId),
  );
  const fileQuery = z.object({ name: z.string().max(255).default('file'), type: z.string().max(100).default('application/octet-stream') });
  const sendFile = (reply: import('fastify').FastifyReply, f: { name: string; contentType: string; content: Buffer }) =>
    reply
      .header('content-type', f.contentType)
      .header('content-disposition', `${f.contentType.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(f.content);
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: SUPPORT_ATTACHMENT_MAX_BYTES }, (_req, body, done) => done(null, body));
  app.put(
    '/tenants/:tenantId/support/files',
    { bodyLimit: SUPPORT_ATTACHMENT_MAX_BYTES, schema: { params: T, querystring: fileQuery, response: { 201: SupportAttachmentDto } } },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) throw new Error('Send the file as the request body (application/octet-stream).');
      return reply.status(201).send(await services.support.uploadFile(actorOf(req), req.params.tenantId, { name: req.query.name, contentType: req.query.type, content: req.body }));
    },
  );
  app.get('/support/files/:id', { schema: { params: z.object({ id: z.uuid() }) } }, async (req, reply) => sendFile(reply, await services.support.file(actorOf(req), req.params.id)));

  // The person's own side: people signed in to the portal asking the organisation for help.
  const HelpT = T.extend({ id: z.uuid() });
  app.get('/tenants/:tenantId/help', { schema: { params: T, response: { 200: SupportInfo } } }, (req) => services.helpDesk.infoFor(actorOf(req), req.params.tenantId));
  app.get('/tenants/:tenantId/help/requests', { schema: { params: T, response: { 200: SupportMineDto } } }, (req) => services.helpDesk.mine(actorOf(req), req.params.tenantId));
  app.post('/tenants/:tenantId/help/requests', { schema: { params: T, body: SupportRequestInput, response: { 201: SupportSent } } }, async (req, reply) =>
    reply.status(201).send(await services.helpDesk.requestFor(actorOf(req), req.params.tenantId, req.body, req.ip)),
  );
  app.get('/tenants/:tenantId/help/requests/:id', { schema: { params: HelpT, response: { 200: SupportThreadDto } } }, (req) => services.helpDesk.threadFor(actorOf(req), req.params.tenantId, req.params.id));
  app.post('/tenants/:tenantId/help/requests/:id/messages', { schema: { params: HelpT, body: SupportReplyInput, response: { 200: SupportThreadDto } } }, (req) =>
    services.helpDesk.replyFor(actorOf(req), req.params.tenantId, req.params.id, req.body),
  );
  app.put(
    '/tenants/:tenantId/help/files',
    { bodyLimit: SUPPORT_ATTACHMENT_MAX_BYTES, schema: { params: T, querystring: fileQuery, response: { 201: SupportAttachmentDto } } },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) throw new Error('Send the file as the request body (application/octet-stream).');
      return reply.status(201).send(await services.helpDesk.uploadFor(actorOf(req), req.params.tenantId, { name: req.query.name, contentType: req.query.type, content: req.body }, req.ip));
    },
  );
  app.post('/tenants/:tenantId/help/requests/:id/typing', { schema: { params: HelpT, body: SupportTypingInput } }, async (req, reply) => {
    await services.helpDesk.typingFor(actorOf(req), req.params.tenantId, req.params.id, req.body.text);
    return reply.status(204).send();
  });
  app.get('/tenants/:tenantId/help/files/:id', { schema: { params: HelpT } }, async (req, reply) => sendFile(reply, await services.helpDesk.fileFor(actorOf(req), req.params.tenantId, req.params.id)));

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
    '/tenants/:tenantId/billing/plans',
    { schema: { params: T, response: { 200: z.array(OrgPlanDto) } } },
    (req) => services.billing.orgPlans(actorOf(req), req.params.tenantId),
  );
  app.get(
    '/tenants/:tenantId/billing/invoices',
    { schema: { params: T, querystring: PageQuery, response: { 200: pageOf(InvoiceDto) } } },
    (req) => services.billing.orgInvoices(actorOf(req), req.params.tenantId, req.query),
  );
  app.put(
    '/tenants/:tenantId/billing/cancellation',
    { schema: { params: T, body: z.object({ cancel: z.boolean() }), response: { 200: OrgBillingDto } } },
    (req) => services.billing.setCancellation(actorOf(req), req.params.tenantId, req.body.cancel),
  );
  app.get(
    '/tenants/:tenantId/billing/invoices/:invoiceId/pdf',
    {
      schema: {
        params: T.extend({ invoiceId: z.uuid() }),
        querystring: z.object({ kind: z.enum(['invoice', 'receipt']).default('invoice') }),
      },
    },
    async (req, reply) => {
      const { file, name } = await services.billing.invoicePdf(actorOf(req), req.params.tenantId, req.params.invoiceId, req.query.kind);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${name}"`)
        .header('cache-control', 'private, no-store')
        .send(file);
    },
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

  app.post(
    '/tenants/:tenantId/email/preview',
    { schema: { params: T, body: EmailPreviewInput, response: { 200: EmailPreviewDto } } },
    (req) => W.emailPreview(actorOf(req), req.params.tenantId, req.body),
  );
  app.post(
    '/tenants/:tenantId/email/test',
    { schema: { params: T, body: EmailTestInput, response: { 200: z.object({ sent: z.boolean(), to: z.string() }) } } },
    (req) => W.emailTest(actorOf(req), req.params.tenantId, req.body),
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

  app.get('/tenants/:tenantId/activity/summary', { schema: { params: T, querystring: ActivitySummaryQuery, response: { 200: ActivitySummaryDto } } }, (req) => W.activitySummary(actorOf(req), req.params.tenantId, req.query));
  app.get(
    '/tenants/:tenantId/activity',
    { schema: { params: T, querystring: AuditQuery.omit({ tenantId: true }), response: { 200: AuditPage } } },
    (req) => W.activity(actorOf(req), req.params.tenantId, req.query),
  );
};
