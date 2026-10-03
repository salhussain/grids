import { BillingService } from './billing.js';
import type { ServiceContext } from './context.js';
import { DashboardService } from './dashboard.js';
import { DomainService, type TxtResolver } from './domains.js';
import { FormService } from './forms.js';
import { EventBus } from './events.js';
import { ExploreService } from './explore.js';
import { JobService } from './jobs.js';
import { ProjectService } from './projects.js';
import { QueryService } from './query.js';
import { IdentityService } from './identity.js';
import { LogService } from './logs.js';
import { MemberService } from './members.js';
import { PlanService } from './plans.js';
import { Provisioner } from './provisioning.js';
import { StaffService } from './staff.js';
import { SupportService } from './support.js';
import { TenantService } from './tenants.js';
import { WorkspaceService } from './workspace.js';
import { installTemplate } from '../templates/index.js';

export type { Actor, ServiceContext } from './context.js';

/** Composition root for control-plane services. */
export function createServices(
  ctx: ServiceContext,
  opts: { resolveTxt?: TxtResolver; devAutoVerifyDomains?: boolean } = {},
) {
  const provisioner = new Provisioner(ctx);
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
  const billing = new BillingService(ctx, { provisioner, seatsUsed, projectsUsed });
  const tenants = (ref.tenants = new TenantService(ctx, { billing, domains, provisioner, projectsUsed }));
  const members = new MemberService(ctx, { identity, seatsUsed });
  const support = new SupportService(ctx);
  const logs = new LogService(ctx);
  const events = new EventBus(ctx.cells);
  const query = new QueryService(ctx, projects, events);
  return {
    events,
    identity,
    plans: new PlanService(ctx),
    staff: new StaffService(ctx),
    tenants,
    billing,
    members,
    domains,
    support,
    logs,
    dashboard: new DashboardService(ctx, { logs, support }),
    workspace: new WorkspaceService(ctx, { logs }),
    projects,
    jobs: new JobService(ctx, projects),
    query,
    explore: new ExploreService(ctx, projects, query),
    forms: new FormService(ctx, projects),
  };
}

export type Services = ReturnType<typeof createServices>;
