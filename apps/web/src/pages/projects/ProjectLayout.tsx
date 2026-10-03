import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useParams, useRouterState } from '@tanstack/react-router';
import { ErrorNotice, Loading, cx } from '@grids/ui';
import {
  BarChart3,
  Boxes,
  ClipboardList,
  Database,
  Eye,
  Gauge,
  Globe,
  Inbox,
  Layers,
  Lock,
  Shapes,
  Sigma,
  UserCog,
  Users,
  Workflow,
} from 'lucide-react';
import { api } from '../../api';
import { useProjectEvents } from '../../live';
import { useWorkspace } from '../../session';
import { FreshnessBadge, LiveIndicator } from '@grids/viz';
import { iconOf, ProjectProvider, projectCtx } from './context';
import { ProjectExplorer } from './ProjectExplorer';

/** The project's own menu: configuration first, grouped like the work. */
const MENU = [
  {
    section: 'Project',
    items: [
      { to: '', label: 'Overview', icon: Gauge },
      { to: 'members', label: 'Members & access', icon: UserCog },
    ],
  },
  {
    section: 'Data model',
    items: [
      { to: 'types', label: 'Entity types', icon: Shapes },
      { to: 'entities', label: 'Entities', icon: Boxes },
    ],
  },
  {
    section: 'Data',
    items: [
      { to: 'data', label: 'Data elements', icon: Sigma },
      { to: 'datasets', label: 'Datasets', icon: Database },
      { to: 'jobs', label: 'Jobs', icon: Workflow },
    ],
  },
  {
    section: 'Presentation',
    items: [
      { to: 'dashboards', label: 'Dashboards', icon: BarChart3 },
      { to: 'overlays', label: 'Map overlays', icon: Layers },
    ],
  },
  {
    section: 'Collection',
    items: [
      { to: 'forms', label: 'Forms', icon: ClipboardList },
      { to: 'submissions', label: 'Submissions', icon: Inbox },
    ],
  },
] as const;

/** A project: header, side menu, and the project context for its pages. */
export function ProjectLayout() {
  const ws = useWorkspace();
  const { project: key } = useParams({ strict: false }) as { project: string };
  const path = useRouterState({ select: (s) => s.location.pathname });
  const q = useQuery({ queryKey: ['project', ws.tenant.id, key], queryFn: () => api.project(ws.tenant.id, key) });
  const explore = /^\/o\/[^/]+\/p\/[^/]+\/explore\/?$/.test(path);
  const live = useProjectEvents(ws.tenant.id, explore ? null : key);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorNotice error={q.error} />;
  const p = q.data;
  const ctx = projectCtx(p, ws.tenant.id);
  // Preview: the full-screen explorer (its own chrome).
  if (explore)
    return (
      <ProjectProvider value={ctx}>
        <ProjectExplorer />
      </ProjectProvider>
    );
  const Icon = iconOf(p.icon);
  const V = p.visibility === 'public' ? Globe : p.visibility === 'organisation' ? Users : Lock;
  return (
    <ProjectProvider value={ctx}>
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-zinc-300 pb-4">
        {p.logo ? (
          <img src={p.logo} alt="" className="size-11 shrink-0 border border-zinc-200 bg-snow object-contain p-0.5" />
        ) : (
          <span className="flex size-11 shrink-0 items-center justify-center text-white" style={{ background: p.color }}>
            <Icon className="size-[22px]" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-zinc-500">{p.key}</div>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{p.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
          <span className={cx('border px-1.5 py-0.5 font-medium', p.status === 'draft' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-emerald-300 bg-emerald-50 text-emerald-800')}>
            {p.status === 'draft' ? 'Draft' : 'Live'}
          </span>
          <span className="inline-flex items-center gap-1.5 border border-zinc-300 px-1.5 py-0.5 capitalize">
            <V className="size-3.5" /> {p.visibility}
          </span>
          {p.archived && <span className="border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-800">Archived</span>}
          <FreshnessBadge value={p.freshness} compact />
          <LiveIndicator status={live} />
          <Link to={`${ctx.base}/explore`} className="inline-flex h-8 items-center gap-1.5 bg-ink px-3 text-sm font-medium text-canvas hover:opacity-90">
            <Eye className="size-4" /> Preview
          </Link>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Project" className="lg:sticky lg:top-20 lg:self-start">
          <div className="flex gap-1 overflow-x-auto pb-2 lg:block lg:space-y-4 lg:overflow-visible lg:pb-0">
            {MENU.map((g) => (
              <div key={g.section} className="contents lg:block">
                <div className="hidden px-2 pb-1 text-[10px] font-semibold tracking-[0.14em] text-zinc-500 uppercase lg:block">{g.section}</div>
                {g.items.map((t) => {
                  const href = t.to ? `${ctx.base}/${t.to}` : ctx.base;
                  const active = t.to ? path === href || path.startsWith(`${href}/`) : path === ctx.base || path === `${ctx.base}/`;
                  return (
                    <Link
                      key={t.label}
                      to={href}
                      aria-current={active ? 'page' : undefined}
                      className={cx(
                        'flex shrink-0 items-center gap-2.5 border-s-2 px-2 py-1.5 text-sm whitespace-nowrap transition-colors',
                        active ? 'border-accent-600 bg-accent-50 font-medium text-ink' : 'border-transparent text-zinc-600 hover:bg-zinc-100 hover:text-ink',
                      )}
                    >
                      <t.icon className="size-4 shrink-0" /> {t.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </ProjectProvider>
  );
}
