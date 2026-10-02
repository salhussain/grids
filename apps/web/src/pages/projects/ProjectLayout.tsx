import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useParams, useRouterState } from '@tanstack/react-router';
import { ErrorNotice, Loading, cx } from '@grids/ui';
import { BarChart3, Boxes, ClipboardList, Database, Globe, Lock, Map as MapIcon, Settings, Users, Workflow } from 'lucide-react';
import { api } from '../../api';
import { useWorkspace } from '../../session';
import { useProjectEvents } from '../../live';
import { FreshnessBadge, LiveIndicator } from '../../viz/Freshness';
import { iconOf, ProjectProvider, projectCtx } from './context';

const TABS = [
  { to: '', label: 'Dashboards', icon: BarChart3 },
  { to: 'map', label: 'Map', icon: MapIcon },
  { to: 'entities', label: 'Entities', icon: Boxes },
  { to: 'data', label: 'Data', icon: Database },
  { to: 'forms', label: 'Forms', icon: ClipboardList },
  { to: 'jobs', label: 'Jobs', icon: Workflow },
  { to: 'settings', label: 'Settings', icon: Settings },
] as const;

/** A project: header, tabs, and the project context for its pages. */
export function ProjectLayout() {
  const ws = useWorkspace();
  const { project: key } = useParams({ strict: false }) as { project: string };
  const path = useRouterState({ select: (s) => s.location.pathname });
  const q = useQuery({ queryKey: ['project', ws.tenant.id, key], queryFn: () => api.project(ws.tenant.id, key) });
  const live = useProjectEvents(ws.tenant.id, key);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorNotice error={q.error} />;
  const p = q.data;
  const ctx = projectCtx(p, ws.tenant.id);
  const Icon = iconOf(p.icon);
  const V = p.visibility === 'public' ? Globe : p.visibility === 'organisation' ? Users : Lock;
  return (
    <ProjectProvider value={ctx}>
      <div className="mb-6 border-b border-zinc-300">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-4">
          <span className="flex size-11 shrink-0 items-center justify-center text-white" style={{ background: p.color }}>
            <Icon className="size-[22px]" />
          </span>
          <div className="min-w-0 flex-1">
            <Link to="/o/$tenantId/projects" params={{ tenantId: ws.tenant.id }} className="text-xs font-medium tracking-[0.12em] text-zinc-500 uppercase hover:text-accent-700">
              Projects
            </Link>
            <h1 className="truncate text-2xl font-semibold tracking-tight">{p.name}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
            <span className="inline-flex items-center gap-1.5 border border-zinc-300 px-1.5 py-0.5">
              <V className="size-3.5" /> {p.visibility}
            </span>
            {p.archived && <span className="border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-800">Archived</span>}
            <FreshnessBadge value={p.freshness} />
            <LiveIndicator status={live} />
          </div>
        </div>
        <nav aria-label="Project" className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.filter((t) => t.to !== 'settings' || ctx.can('viewer')).map((t) => {
            const href = t.to ? `${ctx.base}/${t.to}` : ctx.base;
            const active = t.to ? path.startsWith(href) : path === ctx.base || path === `${ctx.base}/`;
            return (
              <Link
                key={t.label}
                to={href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors',
                  active ? 'border-accent-600 font-medium text-ink' : 'border-transparent text-zinc-600 hover:border-zinc-400 hover:text-ink',
                )}
              >
                <t.icon className="size-4" /> {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <Outlet />
    </ProjectProvider>
  );
}
