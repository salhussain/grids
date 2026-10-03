import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ProjectStatus, ProjectVisibility } from '@grids/schema';
import { Button, ErrorNotice, Field, Input, Panel, Textarea, cx, useToast } from '@grids/ui';
import { Archive, ArchiveRestore, Check, ChevronRight, Circle } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { iconOf, useProject } from './context';
import { ChoiceCards, IconPicker, ImageField, STATUS, VISIBILITY } from './fields';

/** A project's configuration home: profile, look, status and visibility, and setup progress. */
export function OverviewTab() {
  const { tenantId, project, can, base } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const manager = can('manager');
  const [f, setF] = useState({
    name: project.name,
    description: project.description,
    color: project.color,
    icon: project.icon,
    status: project.status as ProjectStatus,
    visibility: project.visibility as ProjectVisibility,
    logo: project.logo,
    coverImage: project.coverImage,
  });
  const dirty = JSON.stringify(f) !== JSON.stringify({ name: project.name, description: project.description, color: project.color, icon: project.icon, status: project.status, visibility: project.visibility, logo: project.logo, coverImage: project.coverImage });
  const save = useMutation({
    mutationFn: () => api.updateProject(tenantId, project.key, f),
    onSuccess: (p) => {
      qc.setQueryData(['project', tenantId, project.key], p);
      void qc.invalidateQueries({ queryKey: ['projects', tenantId] });
      toast('Project saved');
    },
  });
  const archive = useMutation({
    mutationFn: () => api.archiveProject(tenantId, project.key, !project.archived),
    onSuccess: (p) => {
      qc.setQueryData(['project', tenantId, project.key], p);
      void qc.invalidateQueries({ queryKey: ['projects', tenantId] });
    },
  });
  const types = useQuery({ queryKey: ['types', tenantId, project.key], queryFn: () => api.types(tenantId, project.key) });
  const elements = useQuery({ queryKey: ['elements', tenantId, project.key], queryFn: () => api.elements(tenantId, project.key) });
  const datasets = useQuery({ queryKey: ['datasets', tenantId, project.key], queryFn: () => api.datasets(tenantId, project.key) });
  const steps = [
    { done: (types.data?.length ?? 0) > 0, label: 'Define entity types', text: 'The kinds of things you track and how they nest', to: 'types' },
    { done: project.counts.entities > 0, label: 'Add entities', text: 'Create them, import a CSV, or let a job load them', to: 'entities' },
    { done: (elements.data?.length ?? 0) > 0 || (datasets.data?.length ?? 0) > 0, label: 'Set up data', text: 'Data elements for indicators, or datasets for tables', to: 'data' },
    { done: project.counts.dashboards > 0, label: 'Build a dashboard', text: 'KPIs, charts, maps and tables', to: 'dashboards' },
    { done: project.counts.forms > 0, label: 'Create a form', text: 'Collect data in the field', to: 'forms' },
    { done: project.status === 'live', label: 'Go live', text: 'Make it visible to everyone it is shared with', to: '' },
  ];
  const Icon = iconOf(f.icon);

  return (
    <div className="space-y-6">
      <div
        className="relative h-36 overflow-hidden border border-zinc-200 bg-cover bg-center"
        style={
          f.coverImage
            ? { backgroundImage: `url("${f.coverImage}")` }
            : {
                backgroundColor: `color-mix(in srgb, ${f.color} 8%, var(--color-snow))`,
                backgroundImage: `linear-gradient(color-mix(in srgb, ${f.color} 16%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, ${f.color} 16%, transparent) 1px, transparent 1px)`,
                backgroundSize: '16px 16px',
              }
        }
      >
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 bg-gradient-to-t from-black/55 to-transparent p-4 text-white">
          {f.logo ? (
            <img src={f.logo} alt="" className="size-12 border border-white/40 bg-white object-contain p-1" />
          ) : (
            <span className="flex size-12 items-center justify-center" style={{ background: f.color }}>
              <Icon className="size-6" />
            </span>
          )}
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{f.name || project.name}</div>
            <div className="truncate text-xs opacity-80">{f.description || 'No description yet'}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel title="Profile">
            <fieldset disabled={!manager} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                <Field label="Name">
                  <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </Field>
                <Field label="Code" hint="Fixed once created (used in links)">
                  <Input value={project.key} disabled className="font-mono" />
                </Field>
              </div>
              <Field label="Description">
                <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Colour">
                  <div className="flex gap-2">
                    <input type="color" aria-label="Colour" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-9 w-12 border border-zinc-300 bg-snow" />
                    <Input value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="font-mono" />
                  </div>
                </Field>
                <IconPicker label="Icon (when there is no logo)" value={f.icon} color={f.color} onChange={(icon) => setF({ ...f, icon })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ImageField label="Project logo" value={f.logo} onChange={(logo) => setF({ ...f, logo })} hint="Square works best" />
                <ImageField label="Background image" aspect="wide" maxSize={1600} value={f.coverImage} onChange={(coverImage) => setF({ ...f, coverImage })} hint="Wide images work best" />
              </div>
            </fieldset>
          </Panel>
          <Panel title="Status and visibility">
            <fieldset disabled={!manager} className="space-y-4">
              <ChoiceCards label="Status" value={f.status} onChange={(status) => setF({ ...f, status })} options={STATUS} />
              <ChoiceCards label="Visibility" value={f.visibility} onChange={(visibility) => setF({ ...f, visibility })} options={VISIBILITY} />
            </fieldset>
          </Panel>
          <ErrorNotice error={save.error ?? archive.error} />
          {manager && (
            <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-3 border-t border-zinc-200 bg-snow/95 px-1 py-3 backdrop-blur">
              <span className="text-xs text-zinc-500">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
              <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || !f.name.trim()}>
                Save changes
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Panel flush title="Set-up" description={`${steps.filter((s) => s.done).length} of ${steps.length} done`}>
            <ol>
              {steps.map((s) => (
                <li key={s.label}>
                  <Link to={s.to ? `${base}/${s.to}` : base} className="flex items-center gap-3 border-t border-zinc-100 px-5 py-3 first:border-t-0 hover:bg-zinc-50">
                    {s.done ? <Check className="size-5 shrink-0 bg-emerald-600 p-0.5 text-white" /> : <Circle className="size-5 shrink-0 text-zinc-300" />}
                    <span className="min-w-0 flex-1">
                      <span className={cx('block text-sm font-medium', s.done && 'text-zinc-500 line-through decoration-zinc-300')}>{s.label}</span>
                      <span className="block text-xs text-zinc-500">{s.text}</span>
                    </span>
                    <ChevronRight className="size-4 text-zinc-400 rtl:rotate-180" />
                  </Link>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="At a glance">
            <dl className="grid grid-cols-2 gap-px border border-zinc-200 bg-zinc-200 text-center">
              {(
                [
                  ['Entities', project.counts.entities],
                  ['Members', project.counts.members],
                  ['Dashboards', project.counts.dashboards],
                  ['Forms', project.counts.forms],
                  ['Jobs', project.counts.jobs],
                  ['Data elements', elements.data?.length ?? 0],
                ] as const
              ).map(([l, n]) => (
                <div key={l} className="bg-snow px-3 py-3">
                  <dd className="num text-xl font-semibold">{n.toLocaleString()}</dd>
                  <dt className="text-xs text-zinc-500">{l}</dt>
                </div>
              ))}
            </dl>
          </Panel>
          {manager && (
            <Panel title={project.archived ? 'Archived' : 'Archive'}>
              <p className="mb-3 text-sm text-zinc-600">
                {project.archived ? 'This project is archived: its jobs are stopped and it is hidden from lists.' : 'Archiving stops scheduled jobs and hides the project; you can restore it later.'}
              </p>
              <Button variant={project.archived ? 'secondary' : 'danger'} icon={project.archived ? ArchiveRestore : Archive} onClick={() => archive.mutate()} loading={archive.isPending}>
                {project.archived ? 'Restore project' : 'Archive project'}
              </Button>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
