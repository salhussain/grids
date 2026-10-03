import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Plus, Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { Fragment, useState } from 'react';
import {
  STAFF_MODULES,
  type StaffPermission,
  type StaffRoleDto,
  type StaffUserDto,
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
  Pagination,
  Panel,
  Status,
  Table,
  Tabs,
  Tag,
  Td,
  Textarea,
  cx,
  relTime,
  usePagination,
  useToast,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan, useSession } from '../session';

type Tab = 'users' | 'roles' | 'matrix';

export function StaffPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('users');
  if (!can('staff.view')) return <NoAccess what="staff & roles" />;
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Staff & roles"
        meta={
          <span>
            Who can use the console, and what each person can do. Roles bundle permissions;
            individual permissions can be added per person.
          </span>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'users', label: 'Staff' },
          { id: 'roles', label: 'Roles' },
          { id: 'matrix', label: 'Permission matrix' },
        ]}
      />
      {tab === 'users' && <Users />}
      {tab === 'roles' && <Roles />}
      {tab === 'matrix' && <Matrix />}
    </>
  );
}

// ---------------------------------------------------------------- users

function Users() {
  const can = useCan();
  const { me } = useSession();
  const [q, setQ] = useState('');
  const [page, setPage] = usePagination([q]);
  const [editing, setEditing] = useState<StaffUserDto | 'new' | null>(null);
  const query = { q: q || undefined, ...page };
  const users = useQuery({
    queryKey: ['staff-users', query],
    queryFn: () => api.staffUsers(query),
    placeholderData: keepPreviousData,
  });
  const d = users.data;
  return (
    <>
      <Panel
        flush
        title={`${d?.total ?? '–'} staff`}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-zinc-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name or email"
                className="w-56 pl-8"
                aria-label="Search staff"
              />
            </div>
            {can('staff.manage') && (
              <Button icon={UserPlus} onClick={() => setEditing('new')}>
                Invite staff
              </Button>
            )}
          </>
        }
      >
        <ErrorNotice error={users.error} />
        {users.isPending ? (
          <Loading />
        ) : (
          <>
            <Table
              head={[
                'Person',
                'Roles',
                'Individual permissions',
                'Access',
                'Status',
                'Last seen',
                '',
              ]}
              empty="No staff match."
            >
              {d?.items.map((u) => (
                <tr
                  key={u.userId}
                  className={u.status === 'suspended' ? 'bg-zinc-50 text-zinc-500' : ''}
                >
                  <Td>
                    <div className="font-medium text-ink">
                      {u.name}
                      {u.userId === me.id && (
                        <span className="ml-2 text-xs font-normal text-zinc-500">(you)</span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500">{u.email}</div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length ? (
                        u.roles.map((r) => <Tag key={r.id}>{r.name}</Tag>)
                      ) : (
                        <span className="text-xs text-zinc-400">None</span>
                      )}
                    </div>
                  </Td>
                  <Td className="text-xs text-zinc-600">
                    {u.extraPermissions.length ? u.extraPermissions.join(', ') : '—'}
                  </Td>
                  <Td className="num text-xs text-zinc-600">
                    {u.effectivePermissions.length} permissions
                  </Td>
                  <Td>
                    <Status value={u.status} tone={u.status === 'invited' ? 'info' : undefined} />
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-zinc-500">
                    {u.lastSeenAt ? relTime(u.lastSeenAt) : 'Never'}
                  </Td>
                  <Td className="text-right">
                    {can('staff.manage') && u.userId !== me.id && (
                      <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(u)}>
                        Edit access
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            {d && <Pagination {...page} total={d.total} onChange={setPage} />}
          </>
        )}
      </Panel>
      <StaffDialog user={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function StaffDialog({
  user,
  onClose,
}: {
  user: StaffUserDto | 'new' | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useQuery({ queryKey: ['staff-roles'], queryFn: api.staffRoles, enabled: !!user });
  const isNew = user === 'new';
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    roleIds: [] as string[],
    extra: [] as string[],
  });
  const [loadedFor, setLoadedFor] = useState<unknown>(null);
  if (user !== loadedFor) {
    setLoadedFor(user);
    setForm(
      user && user !== 'new'
        ? {
            email: user.email ?? '',
            firstName: '',
            lastName: '',
            roleIds: user.roles.map((r) => r.id),
            extra: user.extraPermissions,
          }
        : { email: '', firstName: '', lastName: '', roleIds: [], extra: [] },
    );
  }
  const fromRoles = new Set(
    roles.data?.filter((r) => form.roleIds.includes(r.id)).flatMap((r) => r.permissions) ?? [],
  );

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? api.inviteStaff({
            email: form.email,
            firstName: form.firstName,
            lastName: form.lastName,
            roleIds: form.roleIds,
            extraPermissions: form.extra as StaffPermission[],
          })
        : api.updateStaff((user as StaffUserDto).userId, {
            roleIds: form.roleIds,
            extraPermissions: form.extra.filter((p) => !fromRoles.has(p)) as StaffPermission[],
          }),
    onSuccess: async (u) => {
      await qc.invalidateQueries({ queryKey: ['staff-users'] });
      await qc.invalidateQueries({ queryKey: ['staff-roles'] });
      toast(isNew ? `Invitation emailed to ${u.email}` : `Access updated for ${u.name}`);
      onClose();
    },
  });
  const status = useMutation({
    mutationFn: (s: 'active' | 'suspended') =>
      api.updateStaff((user as StaffUserDto).userId, { status: s }),
    onSuccess: async (u) => {
      await qc.invalidateQueries({ queryKey: ['staff-users'] });
      toast(`${u.name} is now ${u.status}`);
      onClose();
    },
  });
  const existing = user && user !== 'new' ? user : null;

  return (
    <Dialog
      open={!!user}
      onClose={onClose}
      wide
      title={isNew ? 'Invite staff member' : `Edit access · ${existing?.name ?? ''}`}
      description={
        isNew
          ? 'They’ll get an email to set their password, then sign in to this console.'
          : (existing?.email ?? undefined)
      }
      footer={
        <>
          {existing &&
            (existing.status === 'suspended' ? (
              <Button
                variant="secondary"
                onClick={() => status.mutate('active')}
                loading={status.isPending}
              >
                Reactivate
              </Button>
            ) : (
              <Button
                variant="danger"
                onClick={() =>
                  confirm(`Suspend ${existing.name}? They can no longer sign in.`) &&
                  status.mutate('suspended')
                }
                loading={status.isPending}
              >
                Suspend
              </Button>
            ))}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            {isNew ? 'Send invitation' : 'Save access'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {isNew && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" required>
              <Input
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </Field>
            <Field label="Last name" required>
              <Input
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </Field>
            <Field label="Work email" required className="sm:col-span-2">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
          </div>
        )}
        <section>
          <h3 className="mb-3 border-b border-zinc-200 pb-2 text-xs font-semibold tracking-wide text-zinc-600 uppercase">
            Roles
          </h3>
          {roles.isPending ? (
            <Loading />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {roles.data?.map((r) => (
                <Checkbox
                  key={r.id}
                  label={<span className="font-medium">{r.name}</span>}
                  description={`${r.description} (${r.permissions.length} permissions)`}
                  checked={form.roleIds.includes(r.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      roleIds: e.target.checked
                        ? [...form.roleIds, r.id]
                        : form.roleIds.filter((x) => x !== r.id),
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>
        <section>
          <h3 className="mb-1 border-b border-zinc-200 pb-2 text-xs font-semibold tracking-wide text-zinc-600 uppercase">
            Individual permissions
          </h3>
          <p className="mb-3 text-xs text-zinc-500">
            Grant extra permissions on top of the roles. Permissions already given by a role are
            shown as included.
          </p>
          <PermissionPicker
            value={form.extra}
            inherited={fromRoles}
            onChange={(extra) => setForm({ ...form, extra })}
          />
        </section>
        <ErrorNotice error={save.error ?? status.error} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- roles

function Roles() {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<StaffRoleDto | 'new' | null>(null);
  const roles = useQuery({ queryKey: ['staff-roles'], queryFn: api.staffRoles });
  const remove = useMutation({
    mutationFn: (r: StaffRoleDto) => api.deleteStaffRole(r.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['staff-roles'] });
      toast('Role deleted');
    },
  });
  return (
    <>
      <Panel
        flush
        title="Roles"
        description="Built-in roles cover common jobs; create custom roles for anything else."
        actions={
          can('staff.manage') && (
            <Button icon={Plus} onClick={() => setEditing('new')}>
              New role
            </Button>
          )
        }
      >
        <ErrorNotice error={roles.error ?? remove.error} />
        <Table head={['Role', 'Permissions', 'Staff', 'Type', '']}>
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
                <ModuleCoverage permissions={r.permissions} />
              </Td>
              <Td className="num text-right">{r.memberCount}</Td>
              <Td>{r.isSystem ? <Tag>Built-in</Tag> : <Tag>Custom</Tag>}</Td>
              <Td className="text-right whitespace-nowrap">
                {can('staff.manage') && !r.locked && (
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                )}
                {can('staff.manage') && !r.isSystem && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    onClick={() =>
                      confirm(`Delete the ${r.name} role? Staff lose its permissions.`) &&
                      remove.mutate(r)
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

/** Per-module summary: e.g. "Billing 3/4". */
function ModuleCoverage({ permissions }: { permissions: string[] }) {
  const set = new Set(permissions);
  return (
    <div className="flex flex-wrap gap-1">
      {STAFF_MODULES.map((m) => {
        const n = m.permissions.filter(([p]) => set.has(p)).length;
        if (!n) return null;
        const full = n === m.permissions.length;
        return (
          <span
            key={m.id}
            className={cx(
              'border px-1.5 py-0.5 text-[11px] whitespace-nowrap',
              full
                ? 'border-accent-100 bg-accent-50 text-accent-800'
                : 'border-zinc-300 text-zinc-600',
            )}
          >
            {m.label} {full ? '' : `${n}/${m.permissions.length}`}
          </span>
        );
      })}
    </div>
  );
}

function RoleDialog({ role, onClose }: { role: StaffRoleDto | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = role === 'new';
  const [form, setForm] = useState({ name: '', description: '', permissions: [] as string[] });
  const [loadedFor, setLoadedFor] = useState<unknown>(null);
  if (role !== loadedFor) {
    setLoadedFor(role);
    setForm(
      role && role !== 'new'
        ? { name: role.name, description: role.description, permissions: role.permissions }
        : { name: '', description: '', permissions: [] },
    );
  }
  const save = useMutation({
    mutationFn: () => {
      const input = { ...form, permissions: form.permissions as StaffPermission[] };
      return isNew
        ? api.createStaffRole(input)
        : api.updateStaffRole((role as StaffRoleDto).id, input);
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['staff-roles'] });
      await qc.invalidateQueries({ queryKey: ['staff-users'] });
      toast(`${r.name} saved`);
      onClose();
    },
  });
  return (
    <Dialog
      open={!!role}
      onClose={onClose}
      wide
      title={isNew ? 'New role' : `Edit ${(role as StaffRoleDto | null)?.name ?? ''}`}
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
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea
              rows={1}
              className="min-h-9"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
        </div>
        <PermissionPicker
          value={form.permissions}
          onChange={(permissions) => setForm({ ...form, permissions })}
        />
        <ErrorNotice error={save.error} />
      </div>
    </Dialog>
  );
}

/** Permissions grouped by module, with a module-level select-all. */
function PermissionPicker({
  value,
  onChange,
  inherited = new Set(),
}: {
  value: string[];
  onChange: (v: string[]) => void;
  inherited?: Set<string>;
}) {
  const set = new Set(value);
  const toggle = (ps: string[], on: boolean) =>
    onChange(on ? [...new Set([...value, ...ps])] : value.filter((p) => !ps.includes(p)));
  return (
    <div className="grid gap-px border border-zinc-200 bg-zinc-200 md:grid-cols-2">
      {STAFF_MODULES.map((m) => {
        const ids = m.permissions.map(([p]) => p as string).filter((p) => !inherited.has(p));
        const all = ids.length > 0 && ids.every((p) => set.has(p));
        return (
          <fieldset key={m.id} className="bg-snow p-4">
            <legend className="sr-only">{m.label}</legend>
            <div className="mb-3 flex items-center justify-between border-b border-zinc-100 pb-2">
              <span className="text-sm font-semibold">{m.label}</span>
              {ids.length > 0 && (
                <button
                  type="button"
                  onClick={() => toggle(ids, !all)}
                  className="text-xs font-medium text-accent-700 hover:underline"
                >
                  {all ? 'Clear' : 'Select all'}
                </button>
              )}
            </div>
            <div className="space-y-2">
              {m.permissions.map(([p, label]) =>
                inherited.has(p) ? (
                  <div key={p} className="flex items-start gap-2.5 text-sm text-zinc-500">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-600" />
                    <span>
                      {label} <span className="text-xs">(from role)</span>
                    </span>
                  </div>
                ) : (
                  <Checkbox
                    key={p}
                    label={label}
                    description={<span className="font-mono">{p}</span>}
                    checked={set.has(p)}
                    onChange={(e) => toggle([p], e.target.checked)}
                  />
                ),
              )}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- matrix

function Matrix() {
  const roles = useQuery({ queryKey: ['staff-roles'], queryFn: api.staffRoles });
  if (roles.isPending) return <Loading />;
  const rs = roles.data ?? [];
  return (
    <div className="overflow-x-auto border border-zinc-200 bg-snow">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-zinc-300 bg-zinc-50 text-xs text-zinc-600">
            <th className="px-5 py-3 text-left font-medium">Permission</th>
            {rs.map((r) => (
              <th key={r.id} className="border-l border-zinc-200 px-3 py-3 text-center font-medium">
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STAFF_MODULES.map((m) => (
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
                    <div className="font-mono text-[11px] text-zinc-400">{p}</div>
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
