import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ProjectDto, ProjectStatus, ProjectVisibility } from '@grids/schema';
import { Button, Dialog, Empty, ErrorNotice, Field, Input, Listbox, Loading, PageHeader, Tag, Textarea } from '@grids/ui';
import { Archive, FolderKanban, Plus, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../../api';
import { useT } from '../../i18n';
import { useCan, useWorkspace } from '../../session';
import { FreshnessBadge } from '@grids/viz';
import { iconOf } from './context';
import { ChoiceCards, ImageField, STATUS, VISIBILITY } from './fields';


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
        <ProjectCover color={p.color} image={p.coverImage}>
          {p.logo ? (
            <img src={p.logo} alt="" className="absolute start-5 -bottom-5 size-12 border border-zinc-200 bg-snow object-contain p-1" />
          ) : (
            <span className="absolute start-5 -bottom-px flex size-10 items-center justify-center text-white" style={{ background: p.color }}>
              <Icon className="size-5" />
            </span>
          )}
          {p.status === 'draft' && <span className="absolute end-3 top-3 border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">Draft</span>}
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
            <Tag>{p.key}</Tag>
          </div>
        </div>
      </Link>
    </li>
  );
}

/** A quiet header band in the project's colour over the Grids grid. */
function ProjectCover({ color, image, children }: { color: string; image?: string | null; children?: ReactNode }) {
  if (image)
    return (
      <div className="relative h-24 border-b border-zinc-200 bg-cover bg-center" style={{ backgroundImage: `url("${image}")` }}>
        {children}
      </div>
    );
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
  const members = useQuery({ queryKey: ['members', ws.tenant.id], queryFn: () => api.members(ws.tenant.id), retry: false });
  const [f, setF] = useState({
    name: '',
    key: '',
    description: '',
    visibility: 'private' as ProjectVisibility,
    status: 'draft' as ProjectStatus,
    logo: null as string | null,
    coverImage: null as string | null,
    managerId: null as string | null,
  });
  const [keyEdited, setKeyEdited] = useState(false);
  const code = keyEdited ? f.key : slug(f.name);
  const create = useMutation({
    mutationFn: () =>
      api.createProject(ws.tenant.id, {
        name: f.name,
        key: code || undefined,
        description: f.description,
        visibility: f.visibility,
        status: f.status,
        logo: f.logo,
        coverImage: f.coverImage,
        managerId: f.managerId,
      }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['projects', ws.tenant.id] });
      void navigate({ to: '/o/$tenantId/p/$project', params: { tenantId: ws.tenant.id, project: p.key } });
    },
  });
  const people = (members.data?.members ?? []).filter((m) => m.status === 'active');
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="New project"
      description="Every project starts empty: add its data model, data, dashboards and forms once it exists."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!f.name.trim()}>
            Create project
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ErrorNotice error={create.error} />
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label="Project name" required>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Code" hint="Used in links; lowercase letters, digits and hyphens">
            <Input
              value={code}
              onChange={(e) => {
                setKeyEdited(true);
                setF({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') });
              }}
              className="font-mono"
            />
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={f.description} placeholder="What is this project for, and who uses it?" onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <ImageField label="Project logo" value={f.logo} onChange={(logo) => setF({ ...f, logo })} hint="Square works best" />
          <ImageField label="Background image" aspect="wide" maxSize={1600} value={f.coverImage} onChange={(coverImage) => setF({ ...f, coverImage })} hint="Shown on the project tile and pages" />
        </div>
        <Field label="Manager (optional)" hint="You are a manager too. Add someone else to run the project day to day.">
          <Listbox
            label="Manager"
            value={f.managerId ?? 'none'}
            onChange={(v) => setF({ ...f, managerId: v === 'none' ? null : v })}
            options={[
              { value: 'none', label: 'Only me for now', icon: UserRound },
              ...people.map((m) => ({ value: m.userId, label: m.displayName ?? m.email ?? 'Member', description: m.email ?? undefined, text: m.displayName ?? m.email ?? '', icon: UserRound })),
            ]}
          />
        </Field>
        <ChoiceCards label="Status" value={f.status} onChange={(status) => setF({ ...f, status })} options={STATUS} />
        <ChoiceCards label="Visibility" value={f.visibility} onChange={(visibility) => setF({ ...f, visibility })} options={VISIBILITY} />
      </div>
    </Dialog>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
