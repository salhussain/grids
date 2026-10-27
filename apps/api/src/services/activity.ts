import type { ActivitySummaryDto, ActivitySummaryQuery, AuditPage, AuditQuery } from '@grids/schema';
import { requestInfo } from '../request-context.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import type { LogService } from './logs.js';
import type { ProjectService } from './projects.js';

const QUIET_MS = 30 * 60_000;
/** What was seen lately and by whom, so opening the same thing over and over is one entry, not hundreds. */
const seen = new Map<string, number>();

/** Notes that something was looked at, once per person (or address) per half hour. Never slows or fails the request. */
export function noteView(ctx: Pick<ServiceContext, 'db' | 'now'>, actorId: string | null, tenantId: string, action: string, details: Record<string, unknown>): void {
  const who = actorId ?? requestInfo.getStore()?.ip ?? '';
  const key = `${who}|${tenantId}|${action}|${JSON.stringify(details)}`;
  const now = ctx.now().getTime();
  if ((seen.get(key) ?? 0) > now - QUIET_MS) return;
  if (seen.size > 20_000) seen.clear();
  seen.set(key, now);
  void audit(ctx, actorId, tenantId, action, details).catch(() => undefined);
}

/** The project's activity log, and the record of what people looked at. */
export class ActivityService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
    private readonly logs: LogService,
  ) {}

  /** Everything that happened in a project: for its managers. */
  async project(actor: Actor, tenantId: string, project: string, query: Partial<AuditQuery>): Promise<AuditPage> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    return this.logs.audit({ ...query, tenantId, project: a.project.key });
  }

  /** See `noteView`. */
  view(actorId: string | null, tenantId: string, action: string, details: Record<string, unknown>): void {
    noteView(this.ctx, actorId, tenantId, action, details);
  }

  /** The project's log at a glance. */
  async projectSummary(actor: Actor, tenantId: string, project: string, query: Partial<ActivitySummaryQuery> = {}): Promise<ActivitySummaryDto> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    return this.logs.summary(tenantId, a.project.key, query);
  }

  private tenants = new Map<string, string>();

  /** The same for someone not signed in, on a public page: the organisation is named by its address. */
  async viewPublic(tenantSlug: string, action: string, details: Record<string, unknown>): Promise<void> {
    try {
      let id = this.tenants.get(tenantSlug);
      if (!id) {
        const t = await this.ctx.db.selectFrom('tenant').select('id').where('slug', '=', tenantSlug).executeTakeFirst();
        if (!t) return;
        id = t.id;
        this.tenants.set(tenantSlug, id);
      }
      noteView(this.ctx, null, id, action, details);
    } catch {
      /* the page is already served */
    }
  }

  /** Writes an entry now (for things that are not a view and not already logged where they happen). */
  record(actorId: string | null, tenantId: string, action: string, details: Record<string, unknown>): void {
    void audit(this.ctx, actorId, tenantId, action, details).catch(() => undefined);
  }
}
