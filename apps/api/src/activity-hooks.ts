import type { FastifyInstance } from 'fastify';
import { infoFrom, requestInfo, type RequestInfo } from './request-context.js';
import type { Services } from './services/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    origin: RequestInfo;
  }
}

const PROJECT = '/tenants/:tenantId/projects/:project';

/** Pages and data a manager would want to know were looked at, by the route that serves them. */
const VIEWS: Record<string, { action: string; detail?(p: Record<string, string>): Record<string, unknown> }> = {
  [PROJECT]: { action: 'project.viewed' },
  [`${PROJECT}/forms`]: { action: 'form.viewed' },
  [`${PROJECT}/dashboards`]: { action: 'dashboard.viewed' },
  [`${PROJECT}/overlays/:key/values`]: { action: 'overlay.viewed', detail: (p) => ({ overlay: p.key }) },
  [`${PROJECT}/submissions/:id`]: { action: 'submission.viewed', detail: (p) => ({ submission: p.id }) },
  [`${PROJECT}/entities/:id`]: { action: 'entity.viewed', detail: (p) => ({ entity: p.id }) },
  [`${PROJECT}/work/:id`]: { action: 'work.viewed', detail: (p) => ({ item: p.id }) },
};

/** The same for people who are not signed in. */
const PUBLIC_VIEWS: Record<string, { action: string; detail?(p: Record<string, string>): Record<string, unknown> }> = {
  '/public/projects/:tenant/:project': { action: 'public.project_viewed' },
  '/public/projects/:tenant/:project/explore': { action: 'public.map_viewed' },
  '/public/projects/:tenant/:project/overlays/:key/values': { action: 'public.overlay_viewed', detail: (p) => ({ overlay: p.key }) },
  '/public/projects/:tenant/:project/dashboards/:dashboard/widgets/:widget': { action: 'public.dashboard_viewed', detail: (p) => ({ dashboard: p.dashboard }) },
};

/** Routes that only read, or that are not worth an entry each time. */
const SKIP = [/\/query$/, /\/explore$/, /\/sample$/, /\/preview$/, /\/draft$/, /\/captcha/, /\/events$/];
const VERB = { POST: 'created', PUT: 'updated', PATCH: 'updated', DELETE: 'deleted' } as const;

/**
 * Gives every request its origin (address, browser, and place where the proxy says so), and fills the activity log
 * with what services do not write themselves: what was looked at, and any change made to a project that nothing
 * else already described.
 */
export function activityHooks(app: FastifyInstance, services: Services) {
  app.decorateRequest('origin', null as unknown as RequestInfo);
  app.addHook('onRequest', (req, _reply, done) => {
    req.origin = infoFrom(req);
    requestInfo.run(req.origin, done);
  });
  app.addHook('onResponse', (req, reply, done) => {
    // The log must never hold up or break an answer that has already gone out.
    requestInfo.run(req.origin, () => {
      try {
        const url = req.routeOptions?.url ?? '';
        const p = (req.params ?? {}) as Record<string, string>;
        if (reply.statusCode >= 400) return;
        if (req.method === 'GET') {
          const v = VIEWS[url];
          if (v && p.tenantId && req.actor) services.activity.view(req.actor.id, p.tenantId, v.action, { project: p.project, ...v.detail?.(p) });
          const pv = PUBLIC_VIEWS[url];
          if (pv && p.tenant) void services.activity.viewPublic(p.tenant, pv.action, { project: p.project, ...pv.detail?.(p) });
          return;
        }
        if (req.origin.logged || !req.actor || !p.tenantId || !url.startsWith(PROJECT) || !(req.method in VERB)) return;
        if ((req.routeOptions?.config as { readOnly?: boolean } | undefined)?.readOnly || SKIP.some((r) => r.test(url))) return;
        const rest = url.slice(PROJECT.length);
        const words = rest.split('/').filter((x) => x && !x.startsWith(':'));
        if (!words.length) return;
        services.activity.record(req.actor.id, p.tenantId, `${words.join('.')}.${VERB[req.method as keyof typeof VERB]}`, { project: p.project, method: req.method, path: req.url.split('?')[0]!.replace(/^\/tenants\/[^/]+\/projects\/[^/]+/, '') });
      } catch {
        /* nothing to do */
      } finally {
        done();
      }
    });
  });
}
