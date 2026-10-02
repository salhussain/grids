import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Fragment, useState } from 'react';
import {
  SCOPABLE_PERMISSIONS,
  WORKSPACE_MODULES,
  type WorkspacePermission,
  type WorkspaceRoleDto,
} from '@grids/schema';
import {
  Button,
  Checkbox,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Loading,
  PageHeader,
  Panel,
  Table,
  Tabs,
  Tag,
  Td,
  Textarea,
  useToast,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan, useWorkspace } from '../session';
import { useT } from '../i18n';
import { AccessDialog } from './PeoplePage';

type Tab = 'roles' | 'grants' | 'matrix';

export function AccessPage() {
  const t = useT();
  const can = useCan();
  const [tab, setTab] = useState<Tab>('roles');
  if (!can('roles.view')) return <NoAccess what="roles & access" />;
  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.workspace')}
        title={t('web.nav.access')}
        meta={
          <span>
            Roles bundle permissions. Grant them for the whole organisation or for one org unit and
            everything below it.
          </span>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'roles', label: 'Roles' },
          { id: 'grants', label: 'Who has access' },
          { id: 'matrix', label: 'Permission matrix' },
        ]}
      />
      {tab === 'roles' && <Roles />}
      {tab === 'grants' && <Grants />}
      {tab === 'matrix' && <Matrix />}
    </>
  );
}

function Roles() {
  const ws = useWorkspace();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const id = ws.tenant.id;
  const roles = useQuery({ queryKey: ['roles', id], queryFn: () => api.roles(id) });
  const [editing, setEditing] = useState<WorkspaceRoleDto | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (r: WorkspaceRoleDto) => api.deleteRole(id, r.id),
    onSuccess: (d) => (qc.setQueryData(['roles', id], d), toast('Role deleted')),
  });
  const manage = can('roles.manage');
  return (
    <>
      <Panel
        flush
        title="Roles"
        actions={
          manage && (
            <Button icon={Plus} onClick={() => setEditing('new')}>
              New role
            </Button>
          )
        }
      >
        <ErrorNotice error={roles.error ?? remove.error} />
        <Table head={['Role', 'Permissions', 'Grants', 'Type', '']}>
          {roles.data?.map((r) => (
            <tr key={r.id}>
              <Td>
                <div className="flex items-center gap-2 font-medium">
                  {r.locked && <Lock className="size-3.5 text-zinc-500" />}
                  {r.name}
                </div>
                <div className="text-xs text-zinc-500">{r.description}</div>
              </Td>
              <Td>
                <div className="flex max-w-md flex-wrap gap-1">
                  {r.permissions.map((p) => (
                    <Tag key={p}>{p}</Tag>
                  ))}
                </div>
              </Td>
              <Td className="num text-right">
                {r.key === 'member' ? 'Everyone' : r.key === 'org_admin' ? 'Admins' : r.grantCount}
              </Td>
              <Td>
                <Tag>{r.isSystem ? 'Built-in' : 'Custom'}</Tag>
              </Td>
              <Td className="text-right whitespace-nowrap">
                {manage && !r.locked && (
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                )}
                {manage && !r.isSystem && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    onClick={() =>
                      confirm(`Delete ${r.name}? Its grants are removed.`) && remove.mutate(r)
                    }
                  >
                    Delete
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
      <RoleDialog role={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function RoleDialog({
  role,
  onClose,
}: {
  role: WorkspaceRoleDto | 'new' | null;
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ name: '', description: '', permissions: [] as string[] });
  const [loadedFor, setLoadedFor] = useState<unknown>(null);
  if (role !== loadedFor) {
    setLoadedFor(role);
    setV(
      role && role !== 'new'
        ? { name: role.name, description: role.description, permissions: role.permissions }
        : { name: '', description: '', permissions: ['org.view'] },
    );
  }
  const save = useMutation({
    mutationFn: () => {
      const input = { ...v, permissions: v.permissions as WorkspacePermission[] };
      return role === 'new'
        ? api.createRole(ws.tenant.id, input)
        : api.updateRole(ws.tenant.id, (role as WorkspaceRoleDto).id, input);
    },
    onSuccess: (d) => (
      qc.setQueryData(['roles', ws.tenant.id], d),
      toast(`${v.name} saved`),
      onClose()
    ),
  });
  const set = new Set(v.permissions);
  const toggle = (p: string, on: boolean) =>
    setV({ ...v, permissions: on ? [...v.permissions, p] : v.permissions.filter((x) => x !== p) });
  return (
    <Dialog
      open={!!role}
      onClose={onClose}
      wide
      title={role === 'new' ? 'New role' : `Edit ${v.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save role
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea
              rows={1}
              className="min-h-9"
              value={v.description}
              onChange={(e) => setV({ ...v, description: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid gap-px border border-zinc-200 bg-zinc-200 md:grid-cols-2">
          {WORKSPACE_MODULES.map((m) => (
            <fieldset key={m.id} className="bg-snow p-4">
              <legend className="sr-only">{m.label}</legend>
              <div className="mb-3 border-b border-zinc-100 pb-2 text-sm font-semibold">
                {m.label}
              </div>
              <div className="space-y-2">
                {m.permissions.map(([p, label, scopable]) => (
                  <Checkbox
                    key={p}
                    label={label}
                    description={
                      <span className="font-mono">
                        {p}
                        {scopable ? ' · can apply to an org unit' : ''}
                      </span>
                    }
                    checked={set.has(p)}
                    onChange={(e) => toggle(p, e.target.checked)}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <ErrorNotice error={save.error} />
      </div>
    </Dialog>
  );
}

function Grants() {
  const ws = useWorkspace();
  const can = useCan();
  const id = ws.tenant.id;
  const grants = useQuery({ queryKey: ['grants', id, undefined], queryFn: () => api.grants(id) });
  const members = useQuery({
    queryKey: ['members', id],
    queryFn: () => api.members(id),
    enabled: can('people.view', { anywhere: true }),
  });
  const units = useQuery({ queryKey: ['units', id], queryFn: () => api.units(id) });
  const [person, setPerson] = useState('');
  const memberById = new Map(members.data?.members.map((m) => [m.userId, m]));
  const selected = person ? (memberById.get(person) ?? null) : null;
  const [open, setOpen] = useState(false);
  return (
    <>
      <Panel
        flush
        title={`${grants.data?.length ?? '–'} grants`}
        description="Admins hold everything and everyone holds Member; these are the extra roles."
        actions={
          can('roles.manage') && (
            <div className="flex">
              <select
                aria-label="Person"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                className="h-9 w-56 border border-r-0 border-zinc-300 bg-snow px-2 text-sm"
              >
                <option value="">Choose a person…</option>
                {members.data?.members
                  .filter((m) => m.role !== 'org_admin')
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.email}
                    </option>
                  ))}
              </select>
              <Button icon={Plus} disabled={!selected} onClick={() => setOpen(true)}>
                Grant access
              </Button>
            </div>
          )
        }
      >
        {grants.isPending ? (
          <Loading />
        ) : (
          <Table
            head={['Person', 'Role', 'Applies to', 'Granted']}
            empty="No extra roles granted yet."
          >
            {grants.data?.map((g) => {
              const m = memberById.get(g.userId);
              return (
                <tr key={g.id}>
                  <Td className="font-medium">
                    {m
                      ? [m.givenName, m.familyName].filter(Boolean).join(' ') || m.email
                      : g.userId.slice(0, 8)}
                    <div className="text-xs font-normal text-zinc-500">{m?.email}</div>
                  </Td>
                  <Td>{g.role.name}</Td>
                  <Td>
                    {g.orgUnit ? (
                      <span>
                        {g.orgUnit.name} <span className="text-xs text-zinc-500">and below</span>
                      </span>
                    ) : (
                      'Whole organisation'
                    )}
                  </Td>
                  <Td className="text-zinc-500">{new Date(g.createdAt).toLocaleDateString()}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>
      <AccessDialog
        member={open ? selected : null}
        onClose={() => setOpen(false)}
        units={units.data ?? []}
      />
    </>
  );
}

function Matrix() {
  const ws = useWorkspace();
  const roles = useQuery({
    queryKey: ['roles', ws.tenant.id],
    queryFn: () => api.roles(ws.tenant.id),
  });
  if (roles.isPending) return <Loading />;
  const rs = roles.data ?? [];
  return (
    <div className="overflow-x-auto border border-zinc-200 bg-snow">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-zinc-300 bg-zinc-50 text-xs text-zinc-600">
            <th className="px-5 py-3 text-start font-medium">Permission</th>
            {rs.map((r) => (
              <th key={r.id} className="border-l border-zinc-200 px-3 py-3 text-center font-medium">
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WORKSPACE_MODULES.map((m) => (
            <Fragment key={m.id}>
              <tr>
                <td
                  colSpan={rs.length + 1}
                  className="bg-zinc-50 px-5 py-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase"
                >
                  {m.label}
                </td>
              </tr>
              {m.permissions.map(([p, label]) => (
                <tr key={p} className="border-b border-zinc-100">
                  <td className="px-5 py-2">
                    {label}
                    <div className="font-mono text-[11px] text-zinc-400">
                      {p}
                      {(SCOPABLE_PERMISSIONS as string[]).includes(p) && ' · scopable'}
                    </div>
                  </td>
                  {rs.map((r) => (
                    <td
                      key={r.id}
                      className="border-l border-zinc-100 text-center"
                      aria-label={`${r.name}: ${r.permissions.includes(p) ? 'granted' : 'not granted'}`}
                    >
                      {r.permissions.includes(p) ? (
                        <span className="font-medium text-accent-700">✓</span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
