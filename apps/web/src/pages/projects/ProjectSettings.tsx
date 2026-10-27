import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProjectStatus, ProjectVisibility } from '@grids/schema';
import { Button, ErrorNotice, Field, Input, SectionHead, Textarea, useToast } from '@grids/ui';
import { Archive, ArchiveRestore } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../../api';
import { iconOf, useProject } from './context';
import { ChoiceCards, ColourPicker, ExplorerLayoutFields, RefreshFields, ReportingFields, IconPicker, ImageField, STATUS, VISIBILITY } from './fields';

/** A settings section: a titled header over its controls. */
function Card({ title, text, color, children }: { title: string; text: string; color: string; children: ReactNode }) {
  return (
    <section className="border border-s-[3px] border-zinc-200 bg-snow" style={{ borderInlineStartColor: color }}>
      <header
        className="border-b px-5 py-3.5"
        style={{
          background: `color-mix(in srgb, ${color} 7%, var(--color-snow))`,
          borderBottomColor: `color-mix(in srgb, ${color} 18%, var(--color-zinc-200))`,
        }}
      >
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-zinc-500">{text}</p>
      </header>
      <div className="min-w-0 space-y-5 p-5">{children}</div>
    </section>
  );
}

/** Project settings: profile, look, status and visibility, and archiving. */
export function ProjectSettings() {
  const { tenantId, project, can } = useProject();
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
    explorer: project.explorer,
    reporting: project.reporting,
  });
  const dirty = JSON.stringify(f) !== JSON.stringify({ name: project.name, description: project.description, color: project.color, icon: project.icon, status: project.status, visibility: project.visibility, logo: project.logo, coverImage: project.coverImage, explorer: project.explorer, reporting: project.reporting });
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
  const Icon = iconOf(f.icon);
  /** Restoring takes the project's colour; archiving a deep maroon. */
  const archiveTone = project.archived ? f.color : '#7a1f24';

  return (
    <div className="space-y-6">
      <SectionHead title="Settings" description="The project’s name, look, status and who can see it." />
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

      <div className="space-y-6">
        <div className="space-y-6">
          <fieldset disabled={!manager} className="space-y-6">
            <Card color={f.color} title="Identity" text="What people see in lists and on the project’s page.">
              <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                <Field label="Name" intro="Name of the project">
                  <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </Field>
                <Field label="Code" intro="Unique code for the project">
                  <Input value={project.key} disabled className="font-mono" />
                </Field>
              </div>
              <Field label="Description" intro="Short summary of the project">
                <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-28" />
              </Field>
            </Card>

            <Card color={f.color} title="Branding" text="Colour and icon, plus an optional logo and background image.">
              <div className="grid gap-4 sm:grid-cols-2">
                <ColourPicker intro="Main colour of the project" swatches={false} value={f.color} onChange={(color) => setF({ ...f, color })} />
                <IconPicker label="Icon" intro="Used when there is no logo" value={f.icon} color={f.color} onChange={(icon) => setF({ ...f, icon })} />
              </div>
              <div className="flex flex-wrap gap-5">
                <ImageField label="Project logo" intro="Square logo of the project" value={f.logo} onChange={(logo) => setF({ ...f, logo })} />
                <ImageField label="Background image" intro="Wide image behind the project header" aspect="wide" maxSize={1600} value={f.coverImage} onChange={(coverImage) => setF({ ...f, coverImage })} />
              </div>
            </Card>

            <Card color={f.color} title="Explorer layout" text="What people see when they open this project: the map, the dashboards, or both together.">
              <ExplorerLayoutFields value={f.explorer} onChange={(explorer) => setF({ ...f, explorer })} dashboardCount={project.counts.dashboards} />
            </Card>

            <Card color={f.color} title="Reporting periods" text="The time periods people can choose for the dashboards and map layers of this project.">
              <ReportingFields value={f.reporting} onChange={(reporting) => setF({ ...f, reporting })} />
            </Card>

            <Card color={f.color} title="Auto-refresh" text="How often dashboards and map layers refresh themselves. Everyone starts at your default each time the page loads.">
              <RefreshFields value={f.reporting.refresh} onChange={(refresh) => setF({ ...f, reporting: { ...f.reporting, refresh } })} />
            </Card>

            <Card color={f.color} title="Access" text="Whether the project is live, and who can open it.">
              <ChoiceCards intro="Whether the project is draft or live" label="Status" value={f.status} onChange={(status) => setF({ ...f, status })} options={STATUS} />
              <ChoiceCards intro="Who can open the project" label="Visibility" value={f.visibility} onChange={(visibility) => setF({ ...f, visibility })} options={VISIBILITY} />
            </Card>
          </fieldset>
          {manager && (
            <section
              className="flex flex-wrap items-center gap-x-6 gap-y-3 border border-s-[3px] border-zinc-200 px-5 py-4"
              style={{
                '--a': archiveTone,
                background: 'color-mix(in srgb, var(--a) 7%, var(--color-snow))',
                borderColor: 'color-mix(in srgb, var(--a) 22%, var(--color-zinc-200))',
                borderInlineStartColor: archiveTone,
              } as CSSProperties}
            >
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{project.archived ? 'Archived project' : 'Archive project'}</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {project.archived ? 'Its scheduled jobs are stopped. Restore it to use it again.' : 'Stops its scheduled jobs. You can restore it later.'}
                </p>
              </div>
              <Button
                variant="secondary"
                icon={project.archived ? ArchiveRestore : Archive}
                onClick={() => archive.mutate()}
                loading={archive.isPending}
                className="border-[var(--a)]! text-[var(--a)]! hover:bg-[var(--a)]! hover:text-white!"
              >
                {project.archived ? 'Restore project' : 'Archive project'}
              </Button>
            </section>
          )}
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

      </div>
    </div>
  );
}
