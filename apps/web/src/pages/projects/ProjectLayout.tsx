import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, Outlet, useParams, useRouterState } from '@tanstack/react-router';
import { ErrorNotice, Loading, cx } from '@grids/ui';
import { BarChart3, Boxes, ClipboardList, Database, Eye, FolderTree, Gauge, Globe, History, Inbox, KeyRound, Layers, ListChecks, Lock, Plug, Repeat, Settings, Shapes, ShieldCheck, Sigma, SlidersHorizontal, UserCog, Users, Workflow } from 'lucide-react';
import { api } from '../../api';
import { useProjectEvents } from '../../live';
import { contrastOn } from '../../theme';
import { useWorkspace } from '../../session';
import { iconOf, ProjectProvider, projectCtx } from './context';
import { ProjectExplorer } from './ProjectExplorer';
import { StatusBadge } from './StatusBadge';

/** The project's own menu: configuration first, grouped like the work. */
const MENU = [
  {
    section: 'Project',
    items: [
      { to: '', label: 'Overview', icon: Gauge },
      { to: 'members', label: 'Members', icon: UserCog },
      { to: 'permission-groups', label: 'Permissions', icon: ShieldCheck },
      { to: 'activity', label: 'Activity', icon: History },
      { to: 'settings', label: 'Settings', icon: Settings },
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
      { to: 'data-groups', label: 'Data groups', icon: Layers },
      { to: 'datasets', label: 'Datasets', icon: Database },
      { to: 'jobs', label: 'Jobs', icon: Workflow },
      { to: 'connections', label: 'Connections', icon: Plug },
      { to: 'variables', label: 'Variables', icon: KeyRound },
    ],
  },
  {
    section: 'Presentation',
    items: [
      { to: 'dashboards', label: 'Dashboards', icon: BarChart3 },
      { to: 'overlays', label: 'Map overlays', icon: Layers },
      { to: 'overlay-groups', label: 'Overlay groups', icon: FolderTree },
    ],
  },
  {
    section: 'Collection',
    items: [
      { to: 'forms', label: 'Forms', icon: ClipboardList },
      { to: 'form-groups', label: 'Form groups', icon: FolderTree },
      { to: 'submissions', label: 'Submissions', icon: Inbox },
    ],
  },
  {
    section: 'Work',
    items: [
      { to: 'work', label: 'Work', icon: ListChecks },
      { to: 'work-schedules', label: 'Recurring', icon: Repeat },
      { to: 'work-types', label: 'Work types', icon: SlidersHorizontal },
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
  const qc = useQueryClient();
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    if (!previewing) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('dialog[open]') && setPreviewing(false);
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [previewing]);
  const loaded = !!q.data;
  // Warm the data behind the project's tabs so switching between them is instant.
  useEffect(() => {
    if (!loaded) return;
    const t = ws.tenant.id;
    const warm = <T,>(name: string, fn: () => Promise<T>) => void qc.prefetchQuery({ queryKey: [name, t, key], queryFn: fn, staleTime: 30_000 });
    warm('types', () => api.types(t, key));
    warm('elements', () => api.elements(t, key));
    warm('datasets', () => api.datasets(t, key));
    warm('forms', () => api.forms(t, key));
    warm('dashboards', () => api.dashboards(t, key));
    warm('overlays', () => api.overlays(t, key));
    warm('jobs', () => api.jobs(t, key));
    warm('project-members', () => api.projectMembers(t, key));
    warm('permission-groups', () => api.permissionGroups(t, key));
    warm('overlay-groups', () => api.overlayGroups(t, key));
    warm('form-groups', () => api.projectFormGroups(t, key));
    warm('work-types', () => api.workTypes(t, key));
  }, [loaded, ws.tenant.id, key, qc]);
  useProjectEvents(ws.tenant.id, explore ? null : key);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorNotice error={q.error} />;
  const p = q.data;
  const ctx = projectCtx(p, ws.tenant.id);
  // Preview: the full-screen explorer (its own chrome).
  if (explore)
    return (
      <ProjectProvider value={ctx}>
        <div className="brand-scope contents" style={{ '--brand-600': p.color, '--brand-contrast': contrastOn(p.color) } as React.CSSProperties}>
          <ProjectExplorer />
        </div>
      </ProjectProvider>
    );
  const Icon = iconOf(p.icon);
  const brand = { '--brand-600': p.color, '--brand-contrast': contrastOn(p.color) } as React.CSSProperties;
  const V = p.visibility === 'public' ? Globe : p.visibility === 'organisation' ? Users : Lock;
  return (
    <ProjectProvider value={ctx}>
      {/* The project's own colour applies inside this area only, not to the workspace menus. */}
      <div className="brand-scope" style={brand}>
      {previewing &&
        createPortal(
          <div className="brand-scope fixed inset-0 z-[45] bg-black/55 p-2 sm:p-5 lg:p-8" style={brand} onMouseDown={(e) => e.target === e.currentTarget && setPreviewing(false)}>
            {/* The transform makes the explorer's full-screen layout fill this frame instead of the window. */}
            <div role="dialog" aria-modal="true" aria-label={`Preview of ${p.name}`} className="relative mx-auto h-full max-w-[1800px] overflow-hidden border border-zinc-300 bg-canvas shadow-raised" style={{ transform: 'translateZ(0)' }}>
              <ProjectExplorer onClose={() => setPreviewing(false)} />
            </div>
          </div>,
          document.body,
        )}
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
          <StatusBadge status={p.status} color={p.color} />
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 capitalize">
            <V className="size-3.5" /> {p.visibility}
          </span>
          {p.archived && <span className="border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-800">Archived</span>}
          <button type="button" onClick={() => setPreviewing(true)} className="inline-flex h-8 items-center gap-1.5 bg-accent-600 px-3 text-sm font-medium text-on-accent hover:bg-accent-700">
            <Eye className="size-4" /> Preview
          </button>
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
          <div key={path} className="page-in">
            <Outlet />
          </div>
        </div>
      </div>
      </div>
    </ProjectProvider>
  );
}
