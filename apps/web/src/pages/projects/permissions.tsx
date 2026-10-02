import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PermissionGroupDto } from '@grids/schema';
import { Button, Dialog, Empty, ErrorNotice, Field, Input, Panel, Select, Textarea, cx } from '@grids/ui';
import { Lock, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { useProject } from './context';

export function usePermissionGroups() {
  const { tenantId, project } = useProject();
  return useQuery({ queryKey: ['permission-groups', tenantId, project.key], queryFn: () => api.permissionGroups(tenantId, project.key) });
}

/** Picks the permission group a visual needs (or none = everyone in the project). */
export function GroupSelect({ value, onChange, label = 'Who can see it', id }: { value: string | null | undefined; onChange(v: string | null): void; label?: string; id?: string }) {
  const groups = usePermissionGroups();
  return (
    <Field label={label} hint="Members see a visual if it needs their permission group or a group below it. Managers see everything.">
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Everyone in the project</option>
        {groups.data?.map((g) => (
          <option key={g.key} value={g.key}>
            {'  '.repeat(g.depth)}
            {g.name} and above
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Marks a restricted visual in the studio. */
export function LockBadge({ group }: { group: string | null | undefined }) {
  const groups = usePermissionGroups();
  if (!group) return null;
  const name = groups.data?.find((g) => g.key === group)?.name ?? group;
  return (
    <span className="inline-flex items-center gap-1 border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-amber-800" title={`Only ${name} and the groups above it`}>
      <Lock className="size-3" /> {name}
    </span>
  );
}

/** Settings: the project's permission group tree. */
export function PermissionGroupsPanel() {
  const { can } = useProject();
  const groups = usePermissionGroups();
  const [editing, setEditing] = useState<PermissionGroupDto | 'new' | null>(null);
  return (
    <Panel
      flush
      title="Permission groups"
      description="Control who sees each dashboard, chart and map overlay. Groups form a hierarchy: a member sees what their group needs and anything a group below it needs."
      actions={can('manager') ? <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>New group</Button> : undefined}
    >
      <ErrorNotice error={groups.error} />
      {groups.data && !groups.data.length ? (
        <Empty icon={ShieldCheck} title="No permission groups">
          Without groups, every project member sees every visual. Add groups like “Admin › Staff › Public” to restrict some.
        </Empty>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {groups.data?.map((g) => (
            <li key={g.key} className="flex items-center gap-3 px-5 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3" style={{ paddingInlineStart: g.depth * 24 }}>
                {g.depth > 0 && <span className="h-4 w-3 shrink-0 border-b border-s border-zinc-300" aria-hidden />}
                <ShieldCheck className={cx('size-4 shrink-0', g.depth === 0 ? 'text-accent-600' : 'text-zinc-400')} />
                <div className="min-w-0">
                  <div className="font-medium">
                    {g.name} <span className="font-mono text-xs font-normal text-zinc-500">{g.key}</span>
                  </div>
                  {g.description && <div className="truncate text-xs text-zinc-500">{g.description}</div>}
                </div>
              </div>
              <span className="text-xs text-zinc-500">
                {g.memberCount} member{g.memberCount === 1 ? '' : 's'}
              </span>
              {can('manager') && (
                <button type="button" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)} className="p-1 text-zinc-500 hover:text-ink">
                  <Pencil className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <GroupDialog group={editing === 'new' ? null : editing} all={groups.data ?? []} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function GroupDialog({ group, all, onClose }: { group: PermissionGroupDto | null; all: PermissionGroupDto[]; onClose(): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState({ key: group?.key ?? '', name: group?.name ?? '', description: group?.description ?? '', parent: group?.parent ?? null });
  const done = (data: PermissionGroupDto[]) => {
    qc.setQueryData(['permission-groups', tenantId, project.key], data);
    onClose();
  };
  const save = useMutation({ mutationFn: () => api.savePermissionGroup(tenantId, project.key, f, group?.key), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api.deletePermissionGroup(tenantId, project.key, group!.key), onSuccess: done });
  return (
    <Dialog
      open
      onClose={onClose}
      title={group ? `Edit ${group.name}` : 'New permission group'}
      footer={
        <>
          {group && (
            <Button variant="danger" icon={Trash2} className="me-auto" onClick={() => remove.mutate()} loading={remove.isPending}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.key || !f.name}>
            Save group
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error ?? remove.error} />
        <Field label="Name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, key: group ? f.key : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') })} />
        </Field>
        <Field label="Key" hint="Used in exports and the API; can’t change later">
          <Input value={f.key} disabled={!!group} onChange={(e) => setF({ ...f, key: e.target.value })} className="font-mono" />
        </Field>
        <Field label="Sits below" hint="Members of the group above also see everything this group sees">
          <Select value={f.parent ?? ''} onChange={(e) => setF({ ...f, parent: e.target.value || null })}>
            <option value="">Nothing (a top-level group)</option>
            {all
              .filter((g) => g.key !== group?.key)
              .map((g) => (
                <option key={g.key} value={g.key}>
                  {'  '.repeat(g.depth)}
                  {g.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Description">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}
