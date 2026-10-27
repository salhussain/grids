import { BillingService } from './billing.js';
import { SubscriptionAccess } from './subscription-access.js';
import { UsageService } from './usage.js';
import { PaymentService } from './payments.js';
import type { ServiceContext } from './context.js';
import { ConnectionService } from './connections.js';
import { DashboardService } from './dashboard.js';
import { DatasetService } from './datasets.js';
import { DomainService, type TxtResolver } from './domains.js';
import { DocumentService } from './documents.js';
import { HelpDeskService } from './help-desk.js';
import { FormLinkService } from './form-links.js';
import { WorkService } from './work.js';
import { WorkScheduleService } from './work-schedules.js';
import { FormService } from './forms.js';
import { EventBus } from './events.js';
import { ExploreService } from './explore.js';
import { JobService } from './jobs.js';
import { OrgTypeService } from './org-types.js';
import { SharedEntityService } from './shared-entities.js';
import { ProjectService } from './projects.js';
import { QueryService } from './query.js';
import { IdentityService } from './identity.js';
import { ActivityService } from './activity.js';
import { LogService } from './logs.js';
import { MemberService } from './members.js';
import { OAuthClientService } from './oauth-clients.js';
import { PlanService } from './plans.js';
import { Provisioner } from './provisioning.js';
import { StaffService } from './staff.js';
import { SettingsService } from './settings.js';
import { SupportService } from './support.js';
import { TenantService } from './tenants.js';
import { WorkflowRunner } from './workflow.js';
import { WorkspaceService } from './workspace.js';
import { allowPrivateAddresses } from './safe-fetch.js';
import { installTemplate } from '../templates/index.js';

export type { Actor, ServiceContext } from './context.js';

/** Composition root for control-plane services. */
export function createServices(
  ctx: ServiceContext,
  opts: { resolveTxt?: TxtResolver; devAutoVerifyDomains?: boolean; fetch?: typeof fetch } = {},
) {
  const settings = new SettingsService(ctx);
  const provisioner = new Provisioner(ctx, () => settings.orgDefaults());
  const identity = new IdentityService(ctx);
  const domains = new DomainService(ctx, {
    resolveTxt: opts.resolveTxt,
    devAutoVerify: opts.devAutoVerifyDomains,
  });
  // Tenants and billing reference each other through a narrow callback only.
  const ref: { tenants?: TenantService } = {};
  const seatsUsed = (tenantId: string) => ref.tenants!.seatsUsed(tenantId);
  const projects = new ProjectService(ctx);
  projects.setTemplateInstaller(installTemplate);
  // Tenants that aren't provisioned yet have no cell data: zero projects.
  const projectsUsed = (tenantId: string) => projects.projectCount(tenantId).catch(() => 0);
  const access = new SubscriptionAccess(ctx);
  const usage = new UsageService(ctx, { seatsUsed });
  const billing = new BillingService(ctx, { provisioner, seatsUsed, projectsUsed, access, usage });
  const tenants = (ref.tenants = new TenantService(ctx, { billing, domains, provisioner, projectsUsed, usage }));
  const members = new MemberService(ctx, { identity, seatsUsed });
  const support = new SupportService(ctx);
  const logs = new LogService(ctx);
  const events = new EventBus(ctx.cells);
  allowPrivateAddresses(ctx.allowPrivateConnections);
  const query = new QueryService(ctx, projects, events);
  const forms = new FormService(ctx, projects);
  forms.usage = usage;
  query.usage = usage;
  const formLinks = new FormLinkService(ctx, projects, forms);
  formLinks.usage = usage;
  const payments = new PaymentService(ctx);
  formLinks.payments = payments;
  const documents = new DocumentService(ctx, projects, forms);
  const workSchedules = new WorkScheduleService(ctx, projects);
  const jobs = new JobService(ctx, projects);
  jobs.usage = usage;
  const connections = new ConnectionService(ctx, projects);
  const datasetService = new DatasetService(ctx, projects, connections, jobs);
  query.variants = (tenantId, projectId, dataset, params) => datasetService.variantFor(tenantId, projectId, dataset, params);
  query.live = (tenantId, projectId, dataset, params) => datasetService.liveRows(tenantId, projectId, dataset, params);
  query.aggregate = (tenantId, projectId, dataset, plan) => datasetService.aggregateLive(tenantId, projectId, dataset, plan);
  query.tableRows = (tenantId, projectId, dataset, req) => datasetService.tableLive(tenantId, projectId, dataset, req);
  query.distinct = (tenantId, projectId, dataset, req) => datasetService.distinctLive(tenantId, projectId, dataset, req);
  const workspace = new WorkspaceService(ctx, { logs, usage, access });
  ctx.email.useBranding(async (tenantId) => {
    const b = await workspace.publicBranding(tenantId);
    const th = await workspace.theme(tenantId);
    return { name: b.appName || b.name, color: th.primaryColor, logo: th.logo, settings: th.email };
  });
  return {
    events,
    identity,
    email: ctx.email,
    settings,
    plans: new PlanService(ctx),
    staff: new StaffService(ctx),
    tenants,
    billing,
    access,
    usage,
    payments,
    members,
    oauthClients: new OAuthClientService(ctx),
    domains,
    support,
    logs,
    activity: new ActivityService(ctx, projects, logs),
    dashboard: new DashboardService(ctx, { logs, support }),
    workspace,
    projects,
    orgTypes: new OrgTypeService(ctx, projects),
    sharedEntities: new SharedEntityService(ctx, projects),
    jobs,
    connections,
    datasets: datasetService,
    query,
    explore: new ExploreService(ctx, projects, query),
    forms,
    formLinks,
    helpDesk: new HelpDeskService(ctx, support, formLinks, async (id) => (await workspace.theme(id)).primaryColor, async (id) => (await workspace.theme(id)).helpPosition),
    work: new WorkService(ctx, projects),
    workSchedules,
    documents,
    workflow: new WorkflowRunner(ctx, projects, forms, documents, { fetch: opts.fetch, schedules: workSchedules }),
  };
}

export type Services = ReturnType<typeof createServices>;
