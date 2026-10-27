import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type PermissionGroupDto } from '@grids/schema';
import {
  Button,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
  Input,
  Panel,
  Select,
  Textarea,
  cx, SectionHead } from '@grids/ui';
import { Globe, Lock, Network, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
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
    <Field label={label} hint="Members see it if it needs their level of the permission hierarchy or any level below. Managers see everything.">
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Everyone in the project</option>
        {groups.data?.map((g) => (
          <option key={g.id} value={g.id}>
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
  const name = groups.data?.find((g) => g.id === group)?.name ?? 'a permission';
  return (
    <span className="inline-flex items-center gap-1 border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-amber-800" title={`Only ${name} and the levels above it`}>
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
    <>
      <SectionHead title="Permissions" description="Control who sees each form, dashboard, chart and map overlay. Levels are ordered from the top: a member sees what their level needs, plus anything the levels below it need." actions={can('manager') ? <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>Add permission</Button> : undefined} />
      <Panel flush>
      <ErrorNotice error={groups.error} />
      {groups.data && !groups.data.length ? (
        <Empty icon={ShieldCheck} title="No permissions yet">
          Without permissions, every project member sees everything. Add permissions like “Admin › Staff › Public” to restrict some items.
        </Empty>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {groups.data?.map((g) => (
            <li key={g.id} className="flex items-center gap-3 px-5 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3" style={{ paddingInlineStart: g.depth * 24 }}>
                {g.depth > 0 && <span className="h-4 w-3 shrink-0 border-b border-s border-zinc-300" aria-hidden />}
                {g.kind === 'public' ? <Globe className="size-4 shrink-0 text-accent-600" /> : <ShieldCheck className={cx('size-4 shrink-0', g.depth === 0 ? 'text-accent-600' : 'text-zinc-400')} />}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 font-medium">
                    {g.name}
                    {g.system && (
                      <span
                        className="inline-flex items-center gap-1 border border-zinc-300 px-1.5 py-px text-[11px] font-normal text-zinc-600"
                        title="Every project has one; it can’t be deleted"
                      >
                        <Lock className="size-3" /> {g.kind === 'public' ? 'Built in' : 'Built in · sees everything'}
                      </span>
                    )}
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
    </>
  );
}

function GroupDialog({ group, all, onClose }: { group: PermissionGroupDto | null; all: PermissionGroupDto[]; onClose(): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  // New groups sit below the project admin group by default.
  const [f, setF] = useState({
    name: group?.name ?? '',
    description: group?.description ?? '',
    parent: group
      ? group.parent
      : (all.find((g) => g.kind === 'admin')?.id ?? null),
  });
  const done = (data: PermissionGroupDto[]) => {
    qc.setQueryData(['permission-groups', tenantId, project.key], data);
    onClose();
  };
  const save = useMutation({ mutationFn: () => api.savePermissionGroup(tenantId, project.key, f, group?.id), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api.deletePermissionGroup(tenantId, project.key, group!.id), onSuccess: done });
  return (
    <Dialog
      open
      onClose={onClose}
      title={group ? `Edit ${group.name}` : 'New permission'}
      footer={
        <>
          {group && !group.system && (
            <Button
              variant="danger"
              icon={Trash2}
              className="me-auto"
              onClick={() => remove.mutate()}
              loading={remove.isPending}
            >
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name || (!group?.system && !f.parent)}>
            Save permission
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error ?? remove.error} />
        <Field label="Name" intro="Name of the permission">
          <Input icon={ShieldCheck} placeholder="e.g. Country Manager" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Parent permission" intro={group?.system ? 'Built-in permissions are always at the top' : 'Members of the parent also see everything this permission sees'}>
          <Select icon={Network} value={f.parent ?? ''} disabled={group?.system} onChange={(e) => setF({ ...f, parent: e.target.value || null })}>
            {group?.system && <option value="">Top level</option>}
            {all
              .filter((g) => g.id !== group?.id && g.kind !== 'public')
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {'  '.repeat(g.depth)}
                  {g.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Description" intro="What this permission is for">
          <Textarea placeholder="e.g. Oversees data for one country" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}
