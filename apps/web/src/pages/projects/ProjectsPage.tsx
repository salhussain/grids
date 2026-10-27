import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ExplorerConfig, ProjectDto, ProjectStatus, ProjectVisibility } from '@grids/schema';
import { Button, Dialog, ErrorNotice, Field, Input, Listbox, Loading, PageHeader, Textarea, EmptyState, cx } from '@grids/ui';
import { BarChart3, Boxes, ClipboardList, FolderKanban, Hash, Plus, Type, UserRound, Workflow, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../../api';
import { useT } from '../../i18n';
import { useCan, useWorkspace } from '../../session';
import { contrastOn } from '../../theme';
import { iconOf } from './context';
import { ChoiceCards, ColourPicker, ExplorerLayoutFields, IconPicker, ImageField, STATUS, VISIBILITY } from './fields';
import { StatusBadge } from './StatusBadge';


export function ProjectsPage() {
  const ws = useWorkspace();
  const can = useCan();
  const t = useT();
  const [open, setOpen] = useState(false);
  const projects = useQuery({ queryKey: ['projects', ws.tenant.id, 'all'], queryFn: () => api.projects(ws.tenant.id, 'all') });
  const mayCreate = ws.me.role === 'org_admin' || can('projects.create');
  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.workspace')}
        title={t('web.home.projects')}
        meta={<span>{t('web.home.projectsText')}</span>}
        actions={
          <>
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
        <EmptyState icon={FolderKanban} title="No projects yet" action={mayCreate ? <Button icon={Plus} onClick={() => setOpen(true)}>Create your first project</Button> : undefined}>
          A project holds one body of work: its entities, data, jobs, dashboards, forms and map. Start from a template or from scratch.
        </EmptyState>
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
        style={{ '--pc': p.color } as React.CSSProperties}
        className="group flex h-full flex-col overflow-hidden border border-zinc-200 bg-snow transition-[border-color,box-shadow,translate] hover:-translate-y-0.5 hover:border-[var(--pc)] hover:shadow-raised motion-reduce:hover:translate-y-0"
      >
        <ProjectCover color={p.color} image={p.coverImage} />
        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="flex items-start gap-3">
            {p.logo ? (
              <img src={p.logo} alt="" className="size-11 shrink-0 border border-zinc-200 bg-snow object-contain p-1" />
            ) : (
              <span className="flex size-11 shrink-0 items-center justify-center" style={{ background: p.color, color: contrastOn(p.color) }}>
                <Icon className="size-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-semibold group-hover:text-[color-mix(in_srgb,var(--pc)_75%,var(--color-ink))]">{p.name}</h2>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
                <span className="truncate font-mono">{p.key}</span>
                <span aria-hidden>·</span>
                <V.icon className="size-3.5 shrink-0" aria-hidden />
                <span className="shrink-0">{V.label}</span>
              </div>
            </div>
            {p.archived ? <span className="mt-0.5 shrink-0 border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">Archived</span> : <StatusBadge status={p.status} color={p.color} className="mt-0.5 shrink-0" />}
          </div>
          <p className={cx('line-clamp-2 min-h-10 text-sm', p.description ? 'text-zinc-600' : 'text-zinc-400 italic')}>{p.description || 'No description yet'}</p>
          <ul className="mt-auto flex items-center border-t border-zinc-100 pt-4" aria-label="Project contents">
            {(
              [
                ['Entities', p.counts.entities, Boxes],
                ['Dashboards', p.counts.dashboards, BarChart3],
                ['Forms', p.counts.forms, ClipboardList],
                ['Jobs', p.counts.jobs, Workflow],
              ] as const
            ).map(([label, n, I]) => (
              <li key={label} title={`${n.toLocaleString()} ${label.toLowerCase()}`} aria-label={`${n.toLocaleString()} ${label.toLowerCase()}`} className="flex flex-1 items-center justify-center gap-1.5 border-s border-zinc-200 first:border-s-0">
                <I className={cx('size-4 shrink-0', n === 0 ? 'text-zinc-300' : 'text-zinc-500')} aria-hidden />
                <span className={cx('num text-sm font-semibold', n === 0 && 'text-zinc-400')}>{n.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      </Link>
    </li>
  );
}

/** A quiet header band in the project's colour over the Grids grid. */
function ProjectCover({ color, image, children }: { color: string; image?: string | null; children?: ReactNode }) {
  if (image)
    return (
      <div className="relative h-28 border-b border-zinc-200 bg-cover bg-center" style={{ backgroundImage: `url("${image}")` }}>
        {children}
      </div>
    );
  return (
    <div
      className="relative h-28 border-b border-zinc-200"
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
    color: ws.theme.primaryColor,
    icon: 'folder',
    visibility: 'private' as ProjectVisibility,
    status: 'draft' as ProjectStatus,
    logo: null as string | null,
    coverImage: null as string | null,
    managerIds: [] as string[],
    explorer: { layout: 'both', hideOnLayer: true, panelStart: 'open' } as ExplorerConfig,
  });
  const [keyEdited, setKeyEdited] = useState(false);
  const code = keyEdited ? f.key : slug(f.name);
  const create = useMutation({
    mutationFn: () =>
      api.createProject(ws.tenant.id, {
        name: f.name,
        key: code || undefined,
        description: f.description,
        color: f.color,
        icon: f.icon,
        visibility: f.visibility,
        status: f.status,
        logo: f.logo,
        coverImage: f.coverImage,
        managerIds: f.managerIds,
        explorer: f.explorer,
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
      title="New project"
      description="Start with the basics. Add data and forms later."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!f.name.trim() || f.managerIds.length === 0}>
            Create project
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ErrorNotice error={create.error} />

        <Field label="Project name" required intro="What people will call this project">
          <Input icon={Type} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus placeholder="e.g. Health surveillance" />
        </Field>

        <Field label="Code" intro="Short identifier used in the project’s web address" hint="Filled in from the name. Lowercase letters, digits and hyphens.">
          <Input
            icon={Hash}
            value={code}
            placeholder="e.g. health-surveillance"
            onChange={(e) => {
              setKeyEdited(true);
              setF({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') });
            }}
            className="font-mono"
          />
        </Field>

        <Field label="Description" intro="A short summary shown on the project tile and its pages">
          <Textarea value={f.description} placeholder="What is this project for, and who uses it?" onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-20" />
        </Field>

        <ColourPicker intro="Main colour of the project" swatches={false} value={f.color} onChange={(color) => setF({ ...f, color })} />
        <IconPicker label="Icon" intro="Used when there is no logo" value={f.icon} color={f.color} onChange={(icon) => setF({ ...f, icon })} />

        <ChoiceCards intro="Draft projects are only visible to managers while you set them up" label="Status" value={f.status} onChange={(status) => setF({ ...f, status })} options={STATUS} />
        <ChoiceCards intro="Who can open the project" label="Visibility" value={f.visibility} onChange={(visibility) => setF({ ...f, visibility })} options={VISIBILITY} />

        <div className="space-y-3 border-t border-zinc-200 pt-4">
          <div>
            <div className="text-sm font-medium">Explorer layout</div>
            <div className="text-xs text-zinc-500">What people see when they open the project. You can change it later in Settings.</div>
          </div>
          <ExplorerLayoutFields value={f.explorer} onChange={(explorer) => setF({ ...f, explorer })} dashboardCount={0} />
        </div>

        <Field label="Manager" required intro="Who runs the project day to day. Choose one or more people. You can choose yourself.">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {f.managerIds.map((id) => {
                  const m = people.find((x) => x.userId === id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1.5 border border-zinc-300 bg-zinc-50 py-1 ps-2.5 pe-1 text-sm">
                      <UserRound className="size-4 text-zinc-500" />
                      <span className="leading-tight">
                        {m?.displayName ?? m?.email ?? 'Member'}
                        {m?.displayName && m.email && <span className="block text-[11px] text-zinc-500">{m.email}</span>}
                      </span>
                      <button type="button" aria-label={`Remove ${m?.displayName ?? m?.email ?? 'manager'}`} className="p-1 text-zinc-500 hover:text-ink" onClick={() => setF({ ...f, managerIds: f.managerIds.filter((x) => x !== id) })}>
                        <X className="size-3.5" />
                      </button>
                    </span>
                  );
              })}
            </div>
            <Listbox
              label="Add a manager"
              searchable
              placeholder="Select a manager…"
              value={null}
              onChange={(v) => setF({ ...f, managerIds: [...f.managerIds, v] })}
              options={people
                .filter((m) => !f.managerIds.includes(m.userId))
                .map((m) => ({ value: m.userId, label: m.displayName ?? m.email ?? 'Member', description: m.displayName ? (m.email ?? undefined) : undefined, text: `${m.displayName ?? ''} ${m.email ?? ''}`, icon: UserRound }))}
            />
          </div>
        </Field>

        <div className="border-t border-zinc-200 pt-4">
          <div className="mb-3 text-sm font-medium">
            Images <span className="font-normal text-zinc-500">(optional)</span>
          </div>
          <div className="flex items-start gap-4">
            <ImageField label="Project logo" intro="Square logo of the project" value={f.logo} onChange={(logo) => setF({ ...f, logo })} />
            <ImageField label="Background image" intro="Wide image behind the project header" aspect="wide" maxSize={1600} value={f.coverImage} onChange={(coverImage) => setF({ ...f, coverImage })} />
          </div>
        </div>
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
