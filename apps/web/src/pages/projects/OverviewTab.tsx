import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { cx, relTime } from '@grids/ui';
import { FreshnessBadge } from '@grids/viz';
import {
  ArrowUpRight,
  BarChart3,
  Boxes,
  Check,
  ChevronRight,
  ClipboardList,
  Settings,
  Sigma,
  UserCog,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../../api';
import { useProject } from './context';

/** A project's home: where it stands, what it holds, and what to do next. */
export function OverviewTab() {
  const { tenantId, project, can, base } = useProject();
  const manager = can('manager');
  const types = useQuery({ queryKey: ['types', tenantId, project.key], queryFn: () => api.types(tenantId, project.key) });
  const elements = useQuery({ queryKey: ['elements', tenantId, project.key], queryFn: () => api.elements(tenantId, project.key) });
  const datasets = useQuery({ queryKey: ['datasets', tenantId, project.key], queryFn: () => api.datasets(tenantId, project.key) });
  const forms = useQuery({ queryKey: ['forms', tenantId, project.key], queryFn: () => api.forms(tenantId, project.key) });

  const ready = !!(types.data && elements.data && datasets.data && forms.data);
  const submissions = (forms.data ?? []).reduce((n, f) => n + f.submissionCount, 0);
  const steps = [
    { done: (types.data?.length ?? 0) > 0, label: 'Define entity types', text: 'The kinds of things you track', to: 'types' },
    { done: project.counts.entities > 0, label: 'Add entities', text: 'Create, import a CSV, or load with a job', to: 'entities' },
    { done: (elements.data?.length ?? 0) > 0 || (datasets.data?.length ?? 0) > 0, label: 'Set up data', text: 'Indicators or datasets', to: 'data' },
    { done: project.counts.dashboards > 0, label: 'Build a dashboard', text: 'KPIs, charts, maps and tables', to: 'dashboards' },
    { done: project.counts.forms > 0, label: 'Create a form', text: 'Collect data in the field', to: 'forms' },
    { done: project.status === 'live', label: 'Go live', text: 'Share it with everyone it is meant for', to: 'settings' },
  ];
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  const stats: { label: string; value: number; sub?: string; pending?: boolean; icon: LucideIcon; to: string }[] = [
    { label: 'Entities', value: project.counts.entities, sub: types.data ? `${types.data.length} types` : undefined, icon: Boxes, to: 'entities' },
    { label: 'Submissions', value: submissions, sub: `${project.counts.forms} forms`, pending: !forms.data, icon: ClipboardList, to: 'submissions' },
    { label: 'Indicators', value: elements.data?.length ?? 0, sub: datasets.data ? `${datasets.data.length} datasets` : undefined, pending: !elements.data, icon: Sigma, to: 'data' },
    { label: 'Dashboards', value: project.counts.dashboards, icon: BarChart3, to: 'dashboards' },
    { label: 'Jobs', value: project.counts.jobs, icon: Workflow, to: 'jobs' },
    { label: 'Members', value: project.counts.members, icon: UserCog, to: 'members' },
  ];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section
        className="relative overflow-hidden border border-zinc-200 bg-cover bg-center"
        style={
          project.coverImage
            ? { backgroundImage: `url("${project.coverImage}")` }
            : {
                backgroundColor: `color-mix(in srgb, ${project.color} 7%, var(--color-snow))`,
                backgroundImage: `linear-gradient(color-mix(in srgb, ${project.color} 14%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, ${project.color} 14%, transparent) 1px, transparent 1px)`,
                backgroundSize: '18px 18px',
              }
        }
      >
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 bg-gradient-to-t from-snow via-snow/90 to-transparent p-5 pt-14 sm:p-6 sm:pt-16">
          <div className="min-w-0 flex-1 basis-64">
            <p className="max-w-2xl text-sm text-zinc-700">{project.description || 'No description yet.'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-500">
              {project.freshness.status !== 'unknown' && <FreshnessBadge value={project.freshness} compact />}
              <span>Created {relTime(project.createdAt)}</span>
              <span>Updated {relTime(project.updatedAt)}</span>
            </div>
          </div>
          {manager && (
            <Link to={`${base}/settings`} className="inline-flex h-9 shrink-0 items-center gap-2 border border-zinc-300 bg-snow px-3 text-sm hover:border-zinc-500">
              <Settings className="size-4" /> Edit project
            </Link>
          )}
        </div>
      </section>

      {/* Key numbers */}
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <Link
            key={s.label}
            to={`${base}/${s.to}`}
            className="group relative flex flex-col border border-zinc-200 bg-snow p-4 transition-[border-color,box-shadow] hover:border-accent-600 hover:shadow-surface focus-visible:outline-2 focus-visible:outline-accent-600"
          >
            <div className="flex items-start justify-between">
              <span className="flex size-9 items-center justify-center bg-accent-50 text-accent-700">
                <s.icon className="size-[18px]" strokeWidth={1.75} />
              </span>
              <ArrowUpRight className="size-4 text-zinc-300 transition-colors group-hover:text-accent-600 rtl:-scale-x-100" />
            </div>
            <div className={cx('num mt-4 text-[28px] leading-none font-semibold tracking-tight', (s.pending || s.value === 0) && 'text-zinc-400')}>{s.pending ? '–' : s.value.toLocaleString()}</div>
            <div className="mt-2 text-sm font-medium">{s.label}</div>
            <div className="mt-0.5 min-h-4 text-xs text-zinc-500">{s.sub ?? '\u00a0'}</div>
          </Link>
        ))}
      </section>

      {/* Next steps while the project is being set up */}
      {ready && next && manager && (
        <section className="border border-accent-100 bg-accent-50 p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-64">
              <div className="text-xs font-medium tracking-wide text-accent-800 uppercase">Set-up · {done} of {steps.length} done</div>
              <div className="mt-1 text-base font-semibold">{next.label}</div>
              <div className="text-sm text-zinc-600">{next.text}</div>
              <div className="mt-3 flex h-1.5 max-w-sm gap-px">
                {steps.map((s) => (
                  <span key={s.label} className={cx('flex-1', s.done ? 'bg-accent-600' : 'bg-accent-100')} />
                ))}
              </div>
            </div>
            <Link to={`${base}/${next.to}`} className="inline-flex h-9 items-center gap-2 bg-accent-600 px-3.5 text-sm font-medium text-on-accent hover:bg-accent-700">
              Continue <ChevronRight className="size-4 rtl:rotate-180" />
            </Link>
          </div>
          <ol className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-accent-100 pt-3 text-xs">
            {steps.map((s) => (
              <li key={s.label}>
                <Link to={`${base}/${s.to}`} className={cx('inline-flex items-center gap-1.5 hover:underline', s.done ? 'text-zinc-500' : 'text-ink')}>
                  <span className={cx('flex size-4 items-center justify-center border', s.done ? 'border-accent-600 bg-accent-600 text-on-accent' : 'border-zinc-300 bg-snow')}>{s.done && <Check className="size-3" strokeWidth={3} />}</span>
                  {s.label}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
