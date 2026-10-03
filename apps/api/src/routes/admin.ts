import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  PlatformSettingsDto,
  PlatformSettingsInput,
  AuditPage,
  AuditQuery,
  BillingOverview,
  ChangeSubscriptionInput,
  CreatePlanInput,
  CreateSubscriptionInput,
  CreateTenantInput,
  EmailLogDetail,
  EmailLogDto,
  EmailLogQuery,
  InviteStaffInput,
  InvoiceDto,
  InvoiceListQuery,
  PlanDto,
  PlanInput,
  PlatformOverview,
  RecordPaymentInput,
  StaffCreateTicketInput,
  StaffDto,
  StaffListQuery,
  StaffRoleDto,
  StaffRoleInput,
  StaffUserDto,
  SubscriptionDto,
  SubscriptionListQuery,
  TenantDetail,
  TenantListQuery,
  TenantStatusInput,
  TenantSummary,
  TicketDetail,
  TicketListQuery,
  TicketSummary,
  UpdateStaffInput,
  UpdateTenantInput,
  pageOf,
} from '@grids/schema';
import { actorOf, authenticate, need, requireStaffHook, type AuthDeps } from '../auth/plugin.js';

const T = z.object({ tenantId: z.uuid() });
const Id = z.object({ id: z.string().min(1).max(64) });

/**
 * Platform administration (`/platform/*`): active staff, and each route requires
 * its specific console permission. Services re-check the same permission.
 */
export const adminRoutes: FastifyPluginAsyncZod<AuthDeps> = async (app, deps) => {
  const { services: s } = deps;
  app.addHook('preHandler', authenticate(deps));
  app.addHook('preHandler', requireStaffHook);

  app.get(
    '/platform/overview',
    { preHandler: need('overview.view'), schema: { response: { 200: PlatformOverview } } },
    (req) => s.dashboard.overview(actorOf(req)),
  );
  app.get(
    '/platform/staff',
    { preHandler: need('support.view'), schema: { response: { 200: z.array(StaffDto) } } },
    () => s.identity.listStaff(),
  );

  // ----- plans & pricing -----
  app.get(
    '/platform/plans',
    {
      preHandler: need('plans.view'),
      schema: {
        querystring: z.object({ includeArchived: z.stringbool().optional() }),
        response: { 200: z.array(PlanDto) },
      },
    },
    (req) => s.plans.list({ includeArchived: req.query.includeArchived }),
  );
  // Plan choices for subscribing (no pricing-admin permission needed).
  app.get(
    '/platform/plans/options',
    { preHandler: need('billing.subscriptions'), schema: { response: { 200: z.array(PlanDto) } } },
    () => s.plans.list(),
  );
  app.post(
    '/platform/plans',
    {
      preHandler: need('plans.manage'),
      schema: { body: CreatePlanInput, response: { 201: PlanDto } },
    },
    async (req, reply) => reply.status(201).send(await s.plans.create(actorOf(req), req.body)),
  );
  app.put(
    '/platform/plans/:id',
    {
      preHandler: need('plans.manage'),
      schema: { params: Id, body: PlanInput, response: { 200: PlanDto } },
    },
    (req) => s.plans.update(actorOf(req), req.params.id, req.body),
  );

  // ----- organisations -----
  app.get(
    '/platform/tenants',
    {
      preHandler: need('tenants.view'),
      schema: { querystring: TenantListQuery, response: { 200: pageOf(TenantSummary) } },
    },
    (req) => s.tenants.list(req.query),
  );
  app.post(
    '/platform/tenants',
    {
      preHandler: need('tenants.create'),
      schema: { body: CreateTenantInput, response: { 201: TenantDetail } },
    },
    async (req, reply) => reply.status(201).send(await s.tenants.create(actorOf(req), req.body)),
  );
  app.get(
    '/platform/tenants/:tenantId',
    { preHandler: need('tenants.view'), schema: { params: T, response: { 200: TenantDetail } } },
    (req) => s.tenants.get(req.params.tenantId),
  );
  app.patch(
    '/platform/tenants/:tenantId',
    {
      preHandler: need('tenants.edit'),
      schema: { params: T, body: UpdateTenantInput, response: { 200: TenantDetail } },
    },
    (req) => s.tenants.update(actorOf(req), req.params.tenantId, req.body),
  );
  app.put(
    '/platform/tenants/:tenantId/status',
    {
      preHandler: need('tenants.lifecycle'),
      schema: { params: T, body: TenantStatusInput, response: { 200: TenantDetail } },
    },
    (req) => s.tenants.setStatus(actorOf(req), req.params.tenantId, req.body),
  );

  // ----- billing -----
  app.post(
    '/platform/tenants/:tenantId/subscription',
    {
      preHandler: need('billing.subscriptions'),
      schema: { params: T, body: CreateSubscriptionInput, response: { 201: SubscriptionDto } },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send(
          await s.billing.subscribe(
            actorOf(req),
            req.params.tenantId,
            req.body as Required<typeof req.body>,
          ),
        ),
  );
  app.patch(
    '/platform/tenants/:tenantId/subscription',
    {
      preHandler: need('billing.subscriptions'),
      schema: { params: T, body: ChangeSubscriptionInput, response: { 200: SubscriptionDto } },
    },
    (req) => s.billing.changeSubscription(actorOf(req), req.params.tenantId, req.body),
  );
  app.post(
    '/platform/tenants/:tenantId/invoices',
    { preHandler: need('billing.invoices'), schema: { params: T, response: { 201: InvoiceDto } } },
    async (req, reply) =>
      reply.status(201).send(await s.billing.issueRenewal(actorOf(req), req.params.tenantId)),
  );
  app.get(
    '/platform/billing/overview',
    { preHandler: need('billing.view'), schema: { response: { 200: BillingOverview } } },
    () => s.billing.overview(),
  );
  app.get(
    '/platform/billing/subscriptions',
    {
      preHandler: need('billing.view'),
      schema: { querystring: SubscriptionListQuery, response: { 200: pageOf(SubscriptionDto) } },
    },
    (req) => s.billing.listSubscriptions(req.query),
  );
  app.get(
    '/platform/invoices',
    {
      preHandler: need('billing.view'),
      schema: { querystring: InvoiceListQuery, response: { 200: pageOf(InvoiceDto) } },
    },
    (req) => s.billing.listInvoices(req.query),
  );
  app.get(
    '/platform/invoices/:id',
    { preHandler: need('billing.view'), schema: { params: Id, response: { 200: InvoiceDto } } },
    (req) => s.billing.getInvoice(req.params.id),
  );
  app.post(
    '/platform/invoices/:id/payments',
    {
      preHandler: need('billing.payments'),
      schema: { params: Id, body: RecordPaymentInput, response: { 200: InvoiceDto } },
    },
    (req) => s.billing.recordPayment(actorOf(req), req.params.id, req.body),
  );
  app.post(
    '/platform/invoices/:id/void',
    { preHandler: need('billing.invoices'), schema: { params: Id, response: { 200: InvoiceDto } } },
    (req) => s.billing.voidInvoice(actorOf(req), req.params.id),
  );

  // ----- support desk -----
  app.get(
    '/platform/support/tickets',
    {
      preHandler: need('support.view'),
      schema: { querystring: TicketListQuery, response: { 200: pageOf(TicketSummary) } },
    },
    (req) => s.support.list(actorOf(req), req.query),
  );
  app.post(
    '/platform/support/tickets',
    {
      preHandler: need('support.create'),
      schema: { body: StaffCreateTicketInput, response: { 201: TicketDetail } },
    },
    async (req, reply) => {
      const { tenantId, ...ticket } = req.body;
      return reply
        .status(201)
        .send(await s.support.create(actorOf(req), tenantId, ticket as Required<typeof ticket>));
    },
  );

  // ----- logs -----
  app.get(
    '/platform/logs/audit',
    {
      preHandler: need('logs.system'),
      schema: { querystring: AuditQuery, response: { 200: AuditPage } },
    },
    (req) => s.logs.audit(req.query),
  );
  app.get(
    '/platform/logs/emails',
    {
      preHandler: need('logs.email'),
      schema: { querystring: EmailLogQuery, response: { 200: pageOf(EmailLogDto) } },
    },
    (req) => s.logs.emails(req.query),
  );
  app.get(
    '/platform/logs/emails/:id',
    { preHandler: need('logs.email'), schema: { params: Id, response: { 200: EmailLogDetail } } },
    (req) => s.logs.email(req.params.id),
  );

  // ----- staff & roles -----
  app.get(
    '/platform/staff/users',
    {
      preHandler: need('staff.view'),
      schema: { querystring: StaffListQuery, response: { 200: pageOf(StaffUserDto) } },
    },
    (req) => s.staff.listUsers(actorOf(req), req.query),
  );
  app.post(
    '/platform/staff/users',
    {
      preHandler: need('staff.manage'),
      schema: { body: InviteStaffInput, response: { 201: StaffUserDto } },
    },
    async (req, reply) => reply.status(201).send(await s.staff.invite(actorOf(req), req.body)),
  );
  app.patch(
    '/platform/staff/users/:id',
    {
      preHandler: need('staff.manage'),
      schema: { params: Id, body: UpdateStaffInput, response: { 200: StaffUserDto } },
    },
    (req) => s.staff.update(actorOf(req), req.params.id, req.body),
  );
  app.get(
    '/platform/staff/roles',
    { preHandler: need('staff.view'), schema: { response: { 200: z.array(StaffRoleDto) } } },
    (req) => s.staff.listRoles(actorOf(req)),
  );
  app.post(
    '/platform/staff/roles',
    {
      preHandler: need('staff.manage'),
      schema: { body: StaffRoleInput, response: { 201: StaffRoleDto } },
    },
    async (req, reply) => reply.status(201).send(await s.staff.createRole(actorOf(req), req.body)),
  );
  app.put(
    '/platform/staff/roles/:id',
    {
      preHandler: need('staff.manage'),
      schema: { params: Id, body: StaffRoleInput, response: { 200: StaffRoleDto } },
    },
    (req) => s.staff.updateRole(actorOf(req), req.params.id, req.body),
  );
  app.delete(
    '/platform/staff/roles/:id',
    { preHandler: need('staff.manage'), schema: { params: Id } },
    async (req, reply) => {
      await s.staff.deleteRole(actorOf(req), req.params.id);
      return reply.status(204).send();
    },
  );

  // ----- platform settings -----
  app.get('/platform/settings', { schema: { response: { 200: PlatformSettingsDto } } }, () => s.settings.get());
  app.put(
    '/platform/settings',
    { preHandler: need('settings.manage'), schema: { body: PlatformSettingsInput, response: { 200: PlatformSettingsDto } } },
    (req) => s.settings.update(actorOf(req), req.body),
  );
};
