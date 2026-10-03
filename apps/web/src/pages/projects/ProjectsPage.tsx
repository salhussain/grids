import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { TEMPLATE_KEYS, type ProjectDto, type ProjectTemplate, type ProjectVisibility } from '@grids/schema';
import { Button, Dialog, Empty, ErrorNotice, Field, Input, Loading, PageHeader, Tag, Textarea, cx } from '@grids/ui';
import { Archive, FolderKanban, Globe, Lock, Plus, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../../api';
import { useT } from '../../i18n';
import { useCan, useWorkspace } from '../../session';
import { FreshnessBadge } from '../../viz/Freshness';
import { iconOf } from './context';

const TEMPLATES: Record<ProjectTemplate, { title: string; text: string; icon: string; color: string }> = {
  blank: { title: 'Blank project', text: 'Start from scratch: define your own entity types, data and forms.', icon: 'folder', color: '#0f62fe' },
  'flight-tracker': { title: 'Live flight tracker', text: 'Aircraft positions from the OpenSky Network every 5 minutes, on a public live map.', icon: 'plane', color: '#0043ce' },
  'hr-workforce': { title: 'HR & workforce', text: 'Offices and staff, leave, training and changes, with a workforce dashboard.', icon: 'users', color: '#8a3ffc' },
  'health-surveillance': { title: 'Health facility surveillance', text: 'Weekly facility reports with indicators, alerts, maps and trends.', icon: 'heart-pulse', color: '#da1e28' },
};
const VISIBILITY: Record<ProjectVisibility, { label: string; text: string; icon: typeof Lock }> = {
  private: { label: 'Private', text: 'Only project members', icon: Lock },
  organisation: { label: 'Organisation', text: 'Every member can view', icon: Users },
  public: { label: 'Public', text: 'Anyone can view public dashboards', icon: Globe },
};

export function ProjectsPage() {
  const ws = useWorkspace();
  const can = useCan();
  const t = useT();
  const [archived, setArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const projects = useQuery({ queryKey: ['projects', ws.tenant.id, archived], queryFn: () => api.projects(ws.tenant.id, archived) });
  const mayCreate = ws.me.role === 'org_admin' || can('projects.create');
  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.workspace')}
        title={t('web.home.projects')}
        meta={<span>{t('web.home.projectsText')}</span>}
        actions={
          <>
            <Button variant="ghost" icon={Archive} onClick={() => setArchived(!archived)} aria-pressed={archived}>
              {archived ? 'Active projects' : 'Archived'}
            </Button>
            {mayCreate && (
              <Button icon={Plus} onClick={() => setOpen(true)}>
                New project
              </Button>
            )}
          </>
        }
      />
      {projects.isPending ? (
        <Loading />
      ) : projects.isError ? (
        <ErrorNotice error={projects.error} />
      ) : !projects.data.length ? (
        <div className="border border-zinc-200 bg-snow">
          <Empty icon={FolderKanban} title={archived ? 'No archived projects' : 'No projects yet'} action={mayCreate && !archived ? <Button icon={Plus} onClick={() => setOpen(true)}>New project</Button> : undefined}>
            Projects hold your entities, data, jobs, dashboards and forms.
          </Empty>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.data.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </ul>
      )}
      {open && <NewProjectDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ProjectCard({ p }: { p: ProjectDto }) {
  const ws = useWorkspace();
  const Icon = iconOf(p.icon);
  const V = VISIBILITY[p.visibility];
  return (
    <li>
      <Link
        to="/o/$tenantId/p/$project"
        params={{ tenantId: ws.tenant.id, project: p.key }}
        className="group flex h-full flex-col overflow-hidden border border-zinc-200 bg-snow transition-[border-color,box-shadow,translate] hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-raised motion-reduce:hover:translate-y-0"
      >
        <ProjectCover color={p.color}>
          <span className="absolute start-5 -bottom-px flex size-10 items-center justify-center text-white" style={{ background: p.color }}>
            <Icon className="size-5" />
          </span>
        </ProjectCover>
        <div className="flex flex-1 flex-col p-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-semibold group-hover:text-accent-700">{p.name}</h2>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                <V.icon className="size-3.5" /> {V.label}
                {p.myRole && <span>· {p.myRole}</span>}
              </div>
            </div>
          </div>
          {p.description && <p className="mt-3 line-clamp-2 text-sm text-zinc-600">{p.description}</p>}
          <dl className="mt-auto grid grid-cols-4 gap-2 border-t border-zinc-100 pt-4 text-center">
            {(
              [
                ['Entities', p.counts.entities],
                ['Dashboards', p.counts.dashboards],
                ['Forms', p.counts.forms],
                ['Jobs', p.counts.jobs],
              ] as const
            ).map(([label, n]) => (
              <div key={label}>
                <dd className="num text-lg font-semibold">{n.toLocaleString()}</dd>
                <dt className="text-[11px] text-zinc-500">{label}</dt>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex items-center justify-between gap-2">
            <FreshnessBadge value={p.freshness} compact />
            {p.template && <Tag>{TEMPLATES[p.template as ProjectTemplate]?.title ?? p.template}</Tag>}
          </div>
        </div>
      </Link>
    </li>
  );
}

/** A quiet header band in the project's colour over the Grids grid. */
function ProjectCover({ color, children }: { color: string; children?: ReactNode }) {
  return (
    <div
      className="relative h-20 border-b border-zinc-200"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 6%, var(--color-snow))`,
        backgroundImage: `linear-gradient(color-mix(in srgb, ${color} 14%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, ${color} 14%, transparent) 1px, transparent 1px)`,
        backgroundSize: '16px 16px',
      }}
    >
      {children}
    </div>
  );
}

function NewProjectDialog({ onClose }: { onClose(): void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<ProjectTemplate>('blank');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ProjectVisibility>('private');
  const create = useMutation({
    mutationFn: () =>
      api.createProject(ws.tenant.id, {
        name: name || TEMPLATES[template].title,
        description: description || (template === 'blank' ? '' : TEMPLATES[template].text),
        template,
        visibility,
        icon: TEMPLATES[template].icon,
        color: TEMPLATES[template].color,
      }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['projects', ws.tenant.id] });
      void navigate({ to: '/o/$tenantId/p/$project', params: { tenantId: ws.tenant.id, project: p.key } });
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="New project"
      description="Start blank or from a template with a ready data model, jobs, forms and dashboards."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            Create project
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ErrorNotice error={create.error} />
        <fieldset>
          <legend className="mb-2 text-xs font-medium tracking-wide text-zinc-600">Template</legend>
          <div role="radiogroup" className="grid gap-px border border-zinc-200 bg-zinc-200 sm:grid-cols-2">
            {TEMPLATE_KEYS.map((k) => {
              const tpl = TEMPLATES[k];
              const Icon = iconOf(tpl.icon);
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={template === k}
                  onClick={() => {
                    setTemplate(k);
                    if (k === 'flight-tracker') setVisibility('public');
                  }}
                  className={cx('flex gap-3 p-4 text-start transition-colors', template === k ? 'bg-accent-50 outline-2 -outline-offset-2 outline-accent-600' : 'bg-snow hover:bg-zinc-50')}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center text-white" style={{ background: tpl.color }}>
                    <Icon className="size-[18px]" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{tpl.title}</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">{tpl.text}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} placeholder={TEMPLATES[template].title} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Visibility">
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as ProjectVisibility)} className="h-9 w-full border border-zinc-300 bg-snow px-2.5 text-sm">
              {Object.entries(VISIBILITY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}: {v.text}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={description} placeholder={template === 'blank' ? 'What is this project for?' : TEMPLATES[template].text} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
