import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { FORM_LAYOUT_INFO, type FormGroupDto, type MenuForm } from '@grids/schema';
import { Button, Dialog, Empty, ErrorNotice, Field, Input, Loading, PageHeader, Select, cx, useToast } from '@grids/ui';
import { ArrowRight, ChevronRight, ClipboardList, FolderPlus, GitBranch, Inbox, Pencil, Plus, Search, Settings2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../../api';
import { useCan, useWorkspace } from '../../session';
import { ICONS, iconOf } from '../projects/context';

/** Groups as a tree: children of each group (null = top level), in menu order. */
export function groupTree(groups: FormGroupDto[]) {
  const children = new Map<string | null, FormGroupDto[]>();
  for (const g of groups) children.set(g.parentId, [...(children.get(g.parentId) ?? []), g]);
  return children;
}

/** Ids of a group and everything below it. */
const below = (children: Map<string | null, FormGroupDto[]>, id: string): Set<string> => {
  const out = new Set([id]);
  for (const c of children.get(id) ?? []) for (const x of below(children, c.id)) out.add(x);
  return out;
};

export const fillHref = (tenantId: string, f: Pick<MenuForm, 'project' | 'key'>) => `/o/${tenantId}/fill/${f.project.key}/${f.key}`;

export function useFormsMenu() {
  const ws = useWorkspace();
  return useQuery({ queryKey: ['forms-menu', ws.tenant.id], queryFn: () => api.formsMenu(ws.tenant.id), staleTime: 30_000 });
}

/**
 * The organisation's forms, organised by the admin-defined groups. Everyone sees
 * the forms they may fill in; admins also arrange the groups here.
 */
export function FormsHome() {
  const ws = useWorkspace();
  const can = useCan();
  const admin = ws.me.role === 'org_admin' || can('projects.manage');
  const search = useSearch({ strict: false }) as { group?: string };
  const navigate = useNavigate();
  const menu = useFormsMenu();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ group: FormGroupDto | null; parentId: string | null } | null>(null);

  const children = useMemo(() => groupTree(menu.data?.groups ?? []), [menu.data]);
  const selected = menu.data?.groups.find((g) => g.id === search.group) ?? null;
  const trail = useMemo(() => {
    const out: FormGroupDto[] = [];
    for (let g = selected; g; g = menu.data?.groups.find((x) => x.id === g!.parentId) ?? null) out.unshift(g);
    return out;
  }, [selected, menu.data]);
  const scope = selected ? below(children, selected.id) : null;
  const forms = (menu.data?.forms ?? []).filter(
    (f) => (!scope || (f.groupId && scope.has(f.groupId))) && (!q || `${f.name} ${f.description} ${f.project.name}`.toLowerCase().includes(q.toLowerCase())),
  );
  const go = (group?: string) => void navigate({ to: `/o/${ws.tenant.id}/forms`, search: group ? { group } : {} });

  // Sections: forms directly in the selected group, then each sub-group (with everything below it).
  const sections: { group: FormGroupDto | null; forms: MenuForm[] }[] = [];
  const direct = forms.filter((f) => (selected ? f.groupId === selected.id : !f.groupId || !menu.data?.groups.some((g) => g.id === f.groupId)));
  for (const g of children.get(selected?.id ?? null) ?? []) {
    const ids = below(children, g.id);
    sections.push({ group: g, forms: forms.filter((f) => f.groupId && ids.has(f.groupId)) });
  }
  if (direct.length) sections[selected ? 'unshift' : 'push']({ group: null, forms: direct });

  return (
    <div className="space-y-6">
      <PageHeader
        title={selected?.name ?? 'Fill in a form'}
        eyebrow="Forms"
        meta={selected ? undefined : 'Everything you can fill in, organised by your organisation.'}
        actions={
          <div className="flex gap-2">
            <Link
              to={`/o/${ws.tenant.id}/inbox`}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-snow px-3.5 text-sm font-medium shadow-[0_1px_2px_rgb(16_24_40/0.05)] hover:bg-zinc-50"
            >
              <Inbox className="size-4" /> Submissions
            </Link>
            {admin && (
              <Button icon={FolderPlus} onClick={() => setEditing({ group: null, parentId: selected?.id ?? null })}>
                {selected ? 'New sub-group' : 'New group'}
              </Button>
            )}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm" aria-label="Breadcrumb">
          <button type="button" onClick={() => go()} className={cx('rounded-md px-2 py-1 hover:bg-zinc-100', !selected && 'font-medium')}>
            All forms
          </button>
          {trail.map((g) => (
            <span key={g.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-zinc-400" />
              <button type="button" onClick={() => go(g.id)} className={cx('rounded-md px-2 py-1 hover:bg-zinc-100', g.id === selected?.id && 'font-medium')}>
                {g.name}
              </button>
            </span>
          ))}
          {admin && selected && (
            <button type="button" aria-label="Edit group" onClick={() => setEditing({ group: selected, parentId: selected.parentId })} className="ms-1 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-ink">
              <Settings2 className="size-4" />
            </button>
          )}
        </nav>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search forms" className="ps-9" aria-label="Search forms" />
        </div>
      </div>
      <ErrorNotice error={menu.error} />
      {menu.isPending ? (
        <Loading />
      ) : !sections.some((s) => s.forms.length || (admin && s.group)) ? (
        <div className="rounded-2xl border border-zinc-200 bg-snow">
          <Empty icon={ClipboardList} title={q ? 'No forms match' : 'No forms here yet'}>
            {admin ? 'Create groups for your menu, then choose a group for each form in its builder (Access tab).' : 'Forms you can fill in will appear here.'}
          </Empty>
        </div>
      ) : (
        <div className="space-y-8">
          {sections.map(({ group, forms: list }) => {
            if (!list.length && !(admin && group)) return null;
            const Icon = group ? iconOf(group.icon) : ClipboardList;
            const subs = group ? (children.get(group.id) ?? []) : [];
            return (
              <section key={group?.id ?? 'direct'}>
                {group && (
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-accent-50 text-accent-700 ring-1 ring-accent-100">
                      <Icon className="size-4" />
                    </span>
                    <button type="button" onClick={() => go(group.id)} className="group flex items-center gap-1 text-[15px] font-semibold tracking-tight hover:text-accent-700">
                      {group.name}
                      <ChevronRight className="size-4 text-zinc-400 transition group-hover:translate-x-0.5" />
                    </button>
                    {subs.length > 0 && <span className="text-xs text-zinc-500">{subs.map((s) => s.name).join(' · ')}</span>}
                    <span className="flex-1" />
                    {admin && (
                      <span className="flex gap-1">
                        <button type="button" aria-label={`Add a sub-group to ${group.name}`} title="Add sub-group" onClick={() => setEditing({ group: null, parentId: group.id })} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink">
                          <Plus className="size-4" />
                        </button>
                        <button type="button" aria-label={`Edit ${group.name}`} title="Edit" onClick={() => setEditing({ group, parentId: group.parentId })} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink">
                          <Pencil className="size-4" />
                        </button>
                      </span>
                    )}
                  </div>
                )}
                {list.length ? (
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {list.map((f) => (
                      <li key={`${f.project.key}/${f.key}`}>
                        <FormCard form={f} href={fillHref(ws.tenant.id, f)} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500">No forms in this group yet — pick it in a form’s builder.</p>
                )}
              </section>
            );
          })}
        </div>
      )}
      {editing && <GroupDialog {...editing} groups={menu.data?.groups ?? []} onClose={() => setEditing(null)} onDeleted={() => go(editing.group?.parentId ?? undefined)} />}
    </div>
  );
}

function FormCard({ form: f, href }: { form: MenuForm; href: string }) {
  return (
    <Link
      to={href}
      className="group relative flex h-full flex-col rounded-2xl border border-zinc-200 bg-snow p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition hover:-translate-y-0.5 hover:border-accent-300 hover:shadow-[var(--shadow-raised)]"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-700 text-on-accent shadow-sm">
          <ClipboardList className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate font-semibold tracking-tight">{f.name}</h3>
          <p className="truncate text-xs text-zinc-500">{f.project.name}</p>
        </div>
      </div>
      {f.description && <p className="mt-3 line-clamp-2 text-sm text-zinc-600">{f.description}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4 text-[11px] text-zinc-600">
        <span className="bg-zinc-100 px-2 py-0.5">{f.questionCount} questions</span>
        <span className="bg-zinc-100 px-2 py-0.5">{FORM_LAYOUT_INFO[f.layout].label}</span>
        {f.hasWorkflow && (
          <span className="inline-flex items-center gap-1 bg-sky-50 px-2 py-0.5 text-sky-800">
            <GitBranch className="size-3" /> Approval
          </span>
        )}
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-700 opacity-0 transition group-hover:opacity-100">
          Fill in <ArrowRight className="size-3.5" />
        </span>
      </div>
    </Link>
  );
}

const GROUP_ICONS = Object.keys(ICONS);

function GroupDialog({ group, parentId, groups, onClose, onDeleted }: { group: FormGroupDto | null; parentId: string | null; groups: FormGroupDto[]; onClose(): void; onDeleted(): void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(group?.name ?? '');
  const [icon, setIcon] = useState(group?.icon ?? 'folder');
  const [parent, setParent] = useState<string>(parentId ?? '');
  const [sort, setSort] = useState(group?.sort ?? 0);
  const children = groupTree(groups);
  const blocked = group ? below(children, group.id) : new Set<string>();
  const options: { g: FormGroupDto; depth: number }[] = [];
  const walk = (id: string | null, depth: number) => {
    for (const g of children.get(id) ?? []) {
      if (blocked.has(g.id)) continue;
      options.push({ g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['forms-menu', ws.tenant.id] });
    void qc.invalidateQueries({ queryKey: ['form-groups', ws.tenant.id] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => api.saveFormGroup(ws.tenant.id, { name, icon, parentId: parent || null, sort }, group?.id),
    onSuccess: () => {
      toast(group ? 'Group saved' : 'Group created');
      done();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteFormGroup(ws.tenant.id, group!.id),
    onSuccess: () => {
      toast('Group deleted');
      onDeleted();
      done();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={group ? 'Edit group' : parentId ? 'New sub-group' : 'New group'}
      description="Groups become menu items in everyone’s sidebar; sub-groups are nested beneath them."
      footer={
        <>
          {group && (
            <Button variant="danger" icon={Trash2} onClick={() => remove.mutate()} loading={remove.isPending} className="me-auto">
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error ?? remove.error} />
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Surveillance" />
        </Field>
        <Field label="Inside">
          <Select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Top level of the menu</option>
            {options.map(({ g, depth }) => (
              <option key={g.id} value={g.id}>
                {'  '.repeat(depth * 2)}
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Icon">
          <div className="flex flex-wrap gap-1.5">
            {GROUP_ICONS.map((k) => {
              const I = iconOf(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-label={k}
                  aria-pressed={icon === k}
                  onClick={() => setIcon(k)}
                  className={cx('flex size-9 items-center justify-center rounded-lg border transition', icon === k ? 'border-accent-500 bg-accent-50 text-accent-700 ring-1 ring-accent-500' : 'border-zinc-200 text-zinc-600 hover:border-zinc-400')}
                >
                  <I className="size-4" />
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Order" hint="Lower numbers come first; ties are alphabetical.">
          <Input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value) || 0)} className="w-28" />
        </Field>
      </div>
    </Dialog>
  );
}
