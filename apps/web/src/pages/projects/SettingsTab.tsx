import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ATTRIBUTE_TYPES, GEOMETRY_KINDS, PROJECT_ROLE_INFO, PROJECT_ROLES, type AttributeDef, type EntityTypeDto, type ProjectRole, type ProjectVisibility } from '@grids/schema';
import { Button, Dialog, Empty, ErrorNotice, Field, Input, Panel, Select, Table, Tag, Td, Textarea, useToast } from '@grids/ui';
import { Archive, ArchiveRestore, Boxes, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { useWorkspace } from '../../session';
import { ICONS, iconOf, useProject } from './context';
import { useTypes } from './EntitiesTab';

export function SettingsTab() {
  const { can } = useProject();
  return (
    <div className="space-y-6">
      {can('manager') && <General />}
      <Types />
      <Members />
    </div>
  );
}

function General() {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: project.name, description: project.description, visibility: project.visibility, color: project.color, icon: project.icon });
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
  return (
    <Panel
      title="Project"
      actions={
        <Button variant="secondary" size="sm" icon={project.archived ? ArchiveRestore : Archive} onClick={() => archive.mutate()} loading={archive.isPending}>
          {project.archived ? 'Restore' : 'Archive'}
        </Button>
      }
    >
      <ErrorNotice error={save.error ?? archive.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Visibility">
          <Select value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value as ProjectVisibility })}>
            <option value="private">Private: project members only</option>
            <option value="organisation">Organisation: every member can view</option>
            <option value="public">Public: anyone can view public dashboards</option>
          </Select>
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Colour">
          <div className="flex gap-2">
            <input type="color" aria-label="Colour" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-9 w-12 border border-zinc-300 bg-snow" />
            <Input value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="font-mono" />
          </div>
        </Field>
        <Field label="Icon">
          <Select value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })}>
            {Object.keys(ICONS).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => save.mutate()} loading={save.isPending}>
          Save
        </Button>
      </div>
    </Panel>
  );
}

function Types() {
  const { can } = useProject();
  const types = useTypes();
  const [editing, setEditing] = useState<EntityTypeDto | 'new' | null>(null);
  return (
    <Panel
      flush
      title="Entity types"
      description="The kinds of things this project tracks, their attributes, and where they sit in the hierarchy."
      actions={can('manager') ? <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>Add type</Button> : undefined}
    >
      <Table head={['Type', 'Key', 'Inside', 'Attributes', 'Location', 'Entities', '']} empty={<Empty icon={Boxes} title="No entity types yet" />}>
        {types.data?.map((t) => {
          const Icon = iconOf(t.icon);
          return (
            <tr key={t.key} className="border-t border-zinc-100">
              <Td>
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="size-4" style={{ color: t.color }} /> {t.name}
                </span>
              </Td>
              <Td className="font-mono text-xs">{t.key}</Td>
              <Td>{t.parentTypes.length ? t.parentTypes.join(', ') : <span className="text-zinc-500">top level</span>}</Td>
              <Td className="max-w-xs truncate text-xs text-zinc-600">{t.attributes.map((a) => a.label).join(', ') || '—'}</Td>
              <Td>{t.geometry === 'none' ? '—' : t.geometry}</Td>
              <Td className="num">{t.count.toLocaleString()}</Td>
              <Td>
                {can('manager') && (
                  <button type="button" aria-label={`Edit ${t.name}`} className="p-1 text-zinc-500 hover:text-ink" onClick={() => setEditing(t)}>
                    <Pencil className="size-4" />
                  </button>
                )}
              </Td>
            </tr>
          );
        })}
      </Table>
      {editing && <TypeDialog type={editing === 'new' ? null : editing} all={types.data ?? []} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function TypeDialog({ type, all, onClose }: { type: EntityTypeDto | null; all: EntityTypeDto[]; onClose(): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState({
    key: type?.key ?? '',
    name: type?.name ?? '',
    plural: type?.plural ?? '',
    icon: type?.icon ?? 'box',
    color: type?.color ?? '#0f62fe',
    geometry: type?.geometry ?? 'none',
    parentTypes: type?.parentTypes ?? [],
  });
  const [attrs, setAttrs] = useState<AttributeDef[]>(type?.attributes ?? []);
  const save = useMutation({
    mutationFn: () => api.saveType(tenantId, project.key, { ...f, attributes: attrs }, type?.key),
    onSuccess: (data) => {
      qc.setQueryData(['types', tenantId, project.key], data);
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteType(tenantId, project.key, type!.key),
    onSuccess: (data) => {
      qc.setQueryData(['types', tenantId, project.key], data);
      onClose();
    },
  });
  const setAttr = (i: number, patch: Partial<AttributeDef>) => setAttrs(attrs.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={type ? `Edit ${type.name}` : 'New entity type'}
      footer={
        <>
          {type && (
            <Button variant="danger" className="me-auto" onClick={() => remove.mutate()} loading={remove.isPending}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.key || !f.name || !f.plural}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ErrorNotice error={save.error ?? remove.error} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name">
            <Input
              value={f.name}
              onChange={(e) =>
                setF({ ...f, name: e.target.value, ...(type ? {} : { key: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''), plural: f.plural || '' }) })
              }
            />
          </Field>
          <Field label="Plural">
            <Input value={f.plural} placeholder={f.name ? `${f.name}s` : ''} onChange={(e) => setF({ ...f, plural: e.target.value })} />
          </Field>
          <Field label="Key">
            <Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} className="font-mono" />
          </Field>
          <Field label="Location">
            <Select value={f.geometry} onChange={(e) => setF({ ...f, geometry: e.target.value as typeof f.geometry })}>
              {GEOMETRY_KINDS.map((g) => (
                <option key={g} value={g}>
                  {g === 'none' ? 'No location' : g}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Icon">
            <Select value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })}>
              {Object.keys(ICONS).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </Select>
          </Field>
          <Field label="Colour">
            <input type="color" aria-label="Colour" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-9 w-full border border-zinc-300 bg-snow" />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-xs font-medium tracking-wide text-zinc-600">Can sit inside</legend>
          <div className="flex flex-wrap gap-2">
            {all
              .filter((t) => t.key !== type?.key)
              .map((t) => (
                <label key={t.key} className="flex cursor-pointer items-center gap-2 border border-zinc-300 px-2.5 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={f.parentTypes.includes(t.key)}
                    onChange={() => setF({ ...f, parentTypes: f.parentTypes.includes(t.key) ? f.parentTypes.filter((k) => k !== t.key) : [...f.parentTypes, t.key] })}
                    className="size-4 accent-[var(--brand-600)]"
                  />
                  {t.name}
                </label>
              ))}
            {all.length <= (type ? 1 : 0) && <span className="text-sm text-zinc-500">No other types yet: this one is top level.</span>}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-xs font-medium tracking-wide text-zinc-600">Attributes</legend>
          <div className="space-y-2">
            {attrs.map((a, i) => (
              <div key={i} className="grid grid-cols-2 items-end gap-2 border border-zinc-200 p-2 sm:grid-cols-[1.4fr_1fr_1fr_0.7fr_auto_auto_auto]">
                <Field label="Label">
                  <Input value={a.label} onChange={(e) => setAttr(i, { label: e.target.value, ...(a.key.startsWith('attribute') || !a.key ? { key: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') } : {}) })} />
                </Field>
                <Field label="Key">
                  <Input value={a.key} onChange={(e) => setAttr(i, { key: e.target.value })} className="font-mono text-xs" />
                </Field>
                <Field label="Type">
                  <Select value={a.type} onChange={(e) => setAttr(i, { type: e.target.value as AttributeDef['type'] })}>
                    {ATTRIBUTE_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Unit">
                  <Input value={a.unit ?? ''} onChange={(e) => setAttr(i, { unit: e.target.value || undefined })} />
                </Field>
                <label className="flex items-center gap-1.5 pb-2 text-xs">
                  <input type="checkbox" checked={!!a.required} onChange={(e) => setAttr(i, { required: e.target.checked })} className="accent-[var(--brand-600)]" /> Required
                </label>
                <label className="flex items-center gap-1.5 pb-2 text-xs">
                  <input type="checkbox" checked={!!a.summary} onChange={(e) => setAttr(i, { summary: e.target.checked })} className="accent-[var(--brand-600)]" /> In lists
                </label>
                <button type="button" aria-label={`Remove ${a.label}`} className="p-2 text-zinc-500 hover:text-red-700" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </button>
                {a.type === 'select' && (
                  <Field label="Options (one per line)" className="col-span-full">
                    <Textarea value={(a.options ?? []).join('\n')} onChange={(e) => setAttr(i, { options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} className="min-h-16" />
                  </Field>
                )}
              </div>
            ))}
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setAttrs([...attrs, { key: `attribute_${attrs.length + 1}`, label: '', type: 'text' }])}>
              Add attribute
            </Button>
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}

function Members() {
  const { tenantId, project, can } = useProject();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['project-members', tenantId, project.key], queryFn: () => api.projectMembers(tenantId, project.key) });
  const org = useQuery({ queryKey: ['members', ws.tenant.id], queryFn: () => api.members(ws.tenant.id), enabled: can('manager') });
  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<ProjectRole>('viewer');
  const set = useMutation({
    mutationFn: (input: { userId: string; role: ProjectRole; rootEntityId?: string | null }) => api.setProjectMember(tenantId, project.key, input),
    onSuccess: (data) => {
      qc.setQueryData(['project-members', tenantId, project.key], data);
      setAdding(false);
      setUserId('');
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.removeProjectMember(tenantId, project.key, id),
    onSuccess: (data) => qc.setQueryData(['project-members', tenantId, project.key], data),
  });
  const candidates = (org.data?.members ?? []).filter((m) => m.status === 'active' && !members.data?.some((x) => x.userId === m.userId && !x.implicit));
  return (
    <Panel
      flush
      title="Members"
      description="Organisation admins manage every project. Scope a member to one entity to limit them to its part of the hierarchy."
      actions={can('manager') ? <Button size="sm" icon={UserPlus} onClick={() => setAdding(true)}>Add member</Button> : undefined}
    >
      <ErrorNotice error={set.error ?? remove.error ?? members.error} />
      <Table head={['Person', 'Role', 'Limited to', '']}>
        {members.data?.map((m) => (
          <tr key={m.userId} className="border-t border-zinc-100">
            <Td>
              <div className="font-medium">{m.name ?? m.email}</div>
              <div className="text-xs text-zinc-500">{m.email}</div>
            </Td>
            <Td>
              {m.implicit || !can('manager') ? (
                <span className="flex items-center gap-2">
                  {PROJECT_ROLE_INFO[m.role].label}
                  {m.implicit && <Tag>Organisation admin</Tag>}
                </span>
              ) : (
                <Select aria-label={`Role of ${m.name ?? m.email}`} value={m.role} onChange={(e) => set.mutate({ userId: m.userId, role: e.target.value as ProjectRole, rootEntityId: m.rootEntity?.id ?? null })} className="w-36">
                  {PROJECT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {PROJECT_ROLE_INFO[r].label}
                    </option>
                  ))}
                </Select>
              )}
            </Td>
            <Td>{m.rootEntity ? `${m.rootEntity.name} (${m.rootEntity.type})` : <span className="text-zinc-500">Whole project</span>}</Td>
            <Td>
              {can('manager') && !m.implicit && (
                <button type="button" aria-label={`Remove ${m.name ?? m.email}`} className="p-1 text-zinc-500 hover:text-red-700" onClick={() => remove.mutate(m.userId)}>
                  <X className="size-4" />
                </button>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      {adding && (
        <Dialog
          open
          onClose={() => setAdding(false)}
          title="Add a member"
          footer={
            <>
              <Button variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button onClick={() => set.mutate({ userId, role, rootEntityId: null })} loading={set.isPending} disabled={!userId}>
                Add
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <ErrorNotice error={org.error ?? set.error} />
            <Field label="Person">
              <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Choose…</option>
                {candidates.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName ?? m.email}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Role" hint={PROJECT_ROLE_INFO[role].description}>
              <Select value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
                {PROJECT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {PROJECT_ROLE_INFO[r].label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
