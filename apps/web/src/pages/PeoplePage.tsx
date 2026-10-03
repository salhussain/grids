import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound,
  MailCheck,
  RotateCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CreateInvitationInput,
  type CreatedInvitation,
  type MemberDto,
  type OrgUnitDto,
} from '@grids/schema';
import {
  Button,
  CopyField,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
  Input,
  Loading,
  PageHeader,
  Pagination,
  Panel,
  Select,
  Status,
  Table,
  Tag,
  Td,
  Textarea,
  relTime,
  usePagination,
  useToast,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan, useMe, useWorkspace } from '../session';
import { useT } from '../i18n';
import { indent, subtreeIds } from './tree';

/** Org units where the current user holds `permission` (all when tenant-wide). */
function useUnitsWhere(permission: 'people.manage' | 'people.invite', units: OrgUnitDto[]) {
  const ws = useWorkspace();
  return useMemo(() => {
    if (ws.me.permissions.includes(permission))
      return { all: true, ids: new Set(units.map((u) => u.id)) };
    return {
      all: false,
      ids: subtreeIds(
        units,
        ws.me.scoped.filter((s) => s.permission === permission).map((s) => s.orgUnitId),
      ),
    };
  }, [ws, permission, units]);
}

export function PeoplePage() {
  const t = useT();
  const ws = useWorkspace();
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const id = ws.tenant.id;
  const [q, setQ] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [page, setPage] = usePagination([q, unitFilter], 25);
  const [inviting, setInviting] = useState(false);
  const [access, setAccess] = useState<MemberDto | null>(null);
  const [link, setLink] = useState<CreatedInvitation | null>(null);

  const members = useQuery({
    queryKey: ['members', id],
    queryFn: () => api.members(id),
    enabled: can('people.view', { anywhere: true }),
  });
  const units = useQuery({ queryKey: ['units', id], queryFn: () => api.units(id) });
  const unitList = units.data ?? [];
  const manageable = useUnitsWhere('people.manage', unitList);

  const onMembers = (d: Awaited<ReturnType<typeof api.members>>) =>
    qc.setQueryData(['members', id], d);
  const update = useMutation({
    mutationFn: ({
      userId,
      ...input
    }: {
      userId: string;
      status?: 'active' | 'suspended';
      role?: 'org_admin' | 'member';
    }) => api.updateMember(id, userId, input),
    onSuccess: (d) => (onMembers(d), toast('Updated')),
  });
  const place = useMutation({
    mutationFn: ({ userId, orgUnitId }: { userId: string; orgUnitId: string | null }) =>
      api.placeMember(id, userId, orgUnitId),
    onSuccess: (d) => (onMembers(d), toast('Placement updated')),
  });
  const resend = useMutation({
    mutationFn: (invId: string) => api.resendInvite(id, invId),
    onSuccess: (r) => (setLink(r), toast(`Invitation re-sent to ${r.invitation.email}`)),
  });
  const revoke = useMutation({
    mutationFn: (invId: string) => api.revokeInvite(id, invId),
    onSuccess: (d) => (onMembers(d), toast('Invitation revoked')),
  });

  if (!can('people.view', { anywhere: true })) return <NoAccess what="people" />;
  const d = members.data;
  const scopedView = !can('people.view');
  const filterIds = unitFilter ? subtreeIds(unitList, [unitFilter]) : null;
  const rows = (d?.members ?? []).filter(
    (m) =>
      (!q ||
        `${m.givenName} ${m.familyName} ${m.displayName} ${m.email} ${m.jobTitle}`
          .toLowerCase()
          .includes(q.toLowerCase())) &&
      (!filterIds || (m.orgUnit && filterIds.has(m.orgUnit.id))),
  );
  const pageRows = rows.slice((page.page - 1) * page.pageSize, page.page * page.pageSize);
  const tenantWideManage = can('people.manage');

  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.workspace')}
        title={t('web.nav.people')}
        meta={
          <span>
            {scopedView
              ? `People in ${ws.me.scoped
                  .filter((s) => s.permission === 'people.view')
                  .map((s) => s.orgUnitName)
                  .join(', ')}`
              : `Everyone in ${ws.tenant.name}`}
          </span>
        }
        actions={
          can('people.invite', { anywhere: true }) && (
            <Button icon={UserPlus} onClick={() => setInviting(true)}>
              Invite people
            </Button>
          )
        }
      />
      <ErrorNotice
        error={members.error ?? update.error ?? place.error ?? resend.error ?? revoke.error}
      />
      {link && (
        <div className="mb-4 border border-emerald-300 bg-emerald-50 p-4">
          <p className="mb-2 text-sm text-emerald-900">
            New invitation link for <b>{link.invitation.email}</b> (shown once):
          </p>
          <CopyField value={link.inviteUrl} />
        </div>
      )}
      <Panel
        flush
        title={`${rows.length} people`}
        description={
          d &&
          `${d.members.filter((m) => m.mfa?.enrolled).length} of ${d.members.length} enrolled in 2FA`
        }
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 start-2.5 size-4 text-zinc-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name, email, title"
                className="w-56 ps-8"
                aria-label="Search people"
              />
            </div>
            <Select
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              aria-label="Org unit filter"
              className="w-56"
            >
              <option value="">All units</option>
              {unitList.map((u) => (
                <option key={u.id} value={u.id}>
                  {indent(u)}
                </option>
              ))}
            </Select>
          </>
        }
      >
        {members.isPending ? (
          <Loading />
        ) : !rows.length ? (
          <Empty icon={Users} title="No one here yet">
            Invite people and place them in your structure.
          </Empty>
        ) : (
          <>
            <Table
              head={['Person', 'Role', 'Org unit', 'Access', '2FA', 'Status', 'Last seen', '']}
            >
              {pageRows.map((m) => {
                const canManage = m.orgUnit
                  ? manageable.ids.has(m.orgUnit.id) || tenantWideManage
                  : tenantWideManage;
                const name =
                  [m.givenName, m.familyName].filter(Boolean).join(' ') || m.displayName || m.email;
                return (
                  <tr
                    key={m.userId}
                    className={m.status === 'suspended' ? 'bg-zinc-50 text-zinc-500' : ''}
                  >
                    <Td>
                      <div className="font-medium text-ink">{name}</div>
                      <div className="text-xs text-zinc-500">
                        {m.email}
                        {m.jobTitle && ` · ${m.jobTitle}`}
                      </div>
                    </Td>
                    <Td>
                      {tenantWideManage ? (
                        <Select
                          aria-label={`Role for ${m.email}`}
                          value={m.role}
                          onChange={(e) =>
                            update.mutate({
                              userId: m.userId,
                              role: e.target.value as 'org_admin' | 'member',
                            })
                          }
                          className="h-8 w-36 text-xs"
                        >
                          <option value="org_admin">Admin</option>
                          <option value="member">Member</option>
                        </Select>
                      ) : (
                        <span className="text-sm">
                          {m.role === 'org_admin' ? 'Admin' : 'Member'}
                        </span>
                      )}
                    </Td>
                    <Td>
                      {canManage ? (
                        <Select
                          aria-label={`Org unit for ${m.email}`}
                          value={m.orgUnit?.id ?? ''}
                          onChange={(e) =>
                            place.mutate({ userId: m.userId, orgUnitId: e.target.value || null })
                          }
                          className="h-8 w-48 text-xs"
                        >
                          {tenantWideManage && <option value="">Unplaced</option>}
                          {unitList
                            .filter((u) => manageable.ids.has(u.id))
                            .map((u) => (
                              <option key={u.id} value={u.id}>
                                {indent(u)}
                              </option>
                            ))}
                        </Select>
                      ) : (
                        <span className="text-sm">
                          {m.orgUnit?.name ?? <span className="text-zinc-400">Unplaced</span>}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {m.grants.length ? (
                          m.grants.map((g, i) => (
                            <Tag key={i}>
                              {g.roleName}
                              {g.orgUnitName && ` @ ${g.orgUnitName}`}
                            </Tag>
                          ))
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      {m.mfa?.enrolled ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-800">
                          <ShieldCheck className="size-4" /> On
                        </span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 text-xs ${d?.mfaRequired ? 'text-red-700' : 'text-zinc-500'}`}
                        >
                          <ShieldAlert className="size-4" /> Off
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Status value={m.status} />
                    </Td>
                    <Td className="text-xs whitespace-nowrap text-zinc-500">
                      {m.lastSeenAt ? relTime(m.lastSeenAt) : 'Never'}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {can('roles.manage') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={KeyRound}
                          onClick={() => setAccess(m)}
                        >
                          Access
                        </Button>
                      )}
                      {canManage &&
                        m.userId !== me.id &&
                        (m.status === 'active' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              confirm(`Suspend ${name}?`) &&
                              update.mutate({ userId: m.userId, status: 'suspended' })
                            }
                          >
                            Suspend
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => update.mutate({ userId: m.userId, status: 'active' })}
                          >
                            Reactivate
                          </Button>
                        ))}
                    </Td>
                  </tr>
                );
              })}
            </Table>
            <Pagination {...page} total={rows.length} onChange={setPage} />
          </>
        )}
      </Panel>

      <Panel
        className="mt-6"
        flush
        title={`Invitations · ${d?.invitations.length ?? 0}`}
        description="Pending and expired invitations"
      >
        <Table
          head={['Invitee', 'Role', 'Org unit', 'Invited by', 'Expires', 'Status', '']}
          empty="No outstanding invitations."
        >
          {d?.invitations.map((i) => (
            <tr key={i.id}>
              <Td>
                <div className="font-medium">
                  {[i.firstName, i.lastName].filter(Boolean).join(' ') || i.email}
                </div>
                <div className="text-xs text-zinc-500">{i.email}</div>
              </Td>
              <Td>{i.role === 'org_admin' ? 'Admin' : 'Member'}</Td>
              <Td className="text-zinc-600">
                {unitList.find((u) => u.id === i.orgUnitId)?.name ?? '—'}
              </Td>
              <Td className="text-zinc-600">{i.invitedBy ?? '—'}</Td>
              <Td className="whitespace-nowrap text-zinc-600">
                {new Date(i.expiresAt).toLocaleDateString()}
              </Td>
              <Td>
                <Status value={i.status} />
              </Td>
              <Td className="text-right whitespace-nowrap">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RotateCw}
                  onClick={() => resend.mutate(i.id)}
                >
                  Resend
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() =>
                    confirm(`Revoke the invitation for ${i.email}?`) && revoke.mutate(i.id)
                  }
                >
                  Revoke
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <InviteDialog open={inviting} onClose={() => setInviting(false)} units={unitList} />
      <AccessDialog member={access} onClose={() => setAccess(null)} units={unitList} />
    </>
  );
}

function InviteDialog({
  open,
  onClose,
  units,
}: {
  open: boolean;
  onClose: () => void;
  units: OrgUnitDto[];
}) {
  const ws = useWorkspace();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const invitable = useUnitsWhere('people.invite', units);
  const blank = {
    email: '',
    firstName: '',
    lastName: '',
    jobTitle: '',
    department: '',
    phone: '',
    role: 'member',
    message: '',
    orgUnitId: '',
  };
  const [v, setV] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const set = (k: keyof typeof v, val: string) => setV((x) => ({ ...x, [k]: val }));
  const close = () => (setCreated(null), setV(blank), setErrors({}), onClose());
  const input = {
    ...v,
    role: v.role as 'member' | 'org_admin',
    orgUnitId: v.orgUnitId || undefined,
  };
  const invite = useMutation({
    mutationFn: () => api.invite(ws.tenant.id, input),
    onSuccess: async (r) => {
      setCreated(r);
      await qc.invalidateQueries({ queryKey: ['members', ws.tenant.id] });
      toast(r.emailSent ? `Invitation emailed to ${r.invitation.email}` : 'Invitation created');
    },
  });
  const submit = () => {
    const parsed = CreateInvitationInput.safeParse(input);
    if (!parsed.success)
      return setErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
      );
    setErrors({});
    invite.mutate();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={created ? 'Invitation sent' : `Invite to ${ws.tenant.name}`}
      description={
        created ? undefined : 'They’ll receive an email to create their account and join.'
      }
      footer={
        created ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={submit} loading={invite.isPending}>
              Send invitation
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-4 text-sm">
          <p className="flex items-center gap-2">
            <MailCheck className="size-5 text-emerald-700" /> Emailed to{' '}
            <b>{created.invitation.email}</b>.
          </p>
          <CopyField value={created.inviteUrl} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={errors.firstName}>
            <Input value={v.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </Field>
          <Field label="Last name" required error={errors.lastName}>
            <Input value={v.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </Field>
          <Field label="Work email" required error={errors.email} className="sm:col-span-2">
            <Input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field
            label="Org unit"
            hint={
              invitable.all
                ? 'Optional: where they sit in the organisation'
                : 'Within the part of the organisation you manage'
            }
            className="sm:col-span-2"
          >
            <Select value={v.orgUnitId} onChange={(e) => set('orgUnitId', e.target.value)}>
              {invitable.all ? (
                <option value="">Not placed yet</option>
              ) : (
                <option value="">Select…</option>
              )}
              {units
                .filter((u) => invitable.ids.has(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {indent(u)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Job title">
            <Input value={v.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
          </Field>
          <Field label="Department">
            <Input value={v.department} onChange={(e) => set('department', e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input type="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Role">
            <Select value={v.role} onChange={(e) => set('role', e.target.value)}>
              <option value="member">Member</option>
              {can('people.manage') && <option value="org_admin">Organisation admin</option>}
            </Select>
          </Field>
          <Field label="Personal message" className="sm:col-span-2">
            <Textarea rows={3} value={v.message} onChange={(e) => set('message', e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <ErrorNotice error={invite.error} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Roles granted to one person, organisation-wide or for an org unit. */
export function AccessDialog({
  member,
  onClose,
  units,
}: {
  member: MemberDto | null;
  onClose: () => void;
  units: OrgUnitDto[];
}) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const id = ws.tenant.id;
  const grants = useQuery({
    queryKey: ['grants', id, member?.userId],
    queryFn: () => api.grants(id, member!.userId),
    enabled: !!member,
  });
  const roles = useQuery({
    queryKey: ['roles', id],
    queryFn: () => api.roles(id),
    enabled: !!member,
  });
  const [roleId, setRoleId] = useState('');
  const [unitId, setUnitId] = useState('');
  const refresh = (data: Awaited<ReturnType<typeof api.grants>>) => {
    qc.setQueryData(['grants', id, member?.userId], data);
    void qc.invalidateQueries({ queryKey: ['members', id] });
    void qc.invalidateQueries({ queryKey: ['grants', id, undefined] });
  };
  const grant = useMutation({
    mutationFn: () => api.grant(id, { userId: member!.userId, roleId, orgUnitId: unitId || null }),
    onSuccess: (d) => (refresh(d), toast('Access granted')),
  });
  const revoke = useMutation({
    mutationFn: (grantId: string) => api.revokeGrant(id, grantId),
    onSuccess: (d) => (refresh(d), toast('Access removed')),
  });
  const name = member
    ? [member.givenName, member.familyName].filter(Boolean).join(' ') || member.email
    : '';
  return (
    <Dialog
      open={!!member}
      onClose={onClose}
      wide
      title={`Access · ${name}`}
      description={
        member?.role === 'org_admin'
          ? 'Organisation admins already hold every permission.'
          : 'Everyone holds the Member role. Grant extra roles here.'
      }
    >
      <div className="space-y-5">
        <Table head={['Role', 'Applies to', '']} empty="No extra roles.">
          {grants.data?.map((g) => (
            <tr key={g.id}>
              <Td className="font-medium">{g.role.name}</Td>
              <Td>{g.orgUnit ? g.orgUnit.name : 'Whole organisation'}</Td>
              <Td className="text-right">
                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => revoke.mutate(g.id)}>
                  Remove
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
        <div className="grid gap-3 border-t border-zinc-200 pt-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Role">
            <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Select…</option>
              {roles.data
                ?.filter((r) => r.key !== 'org_admin' && r.key !== 'member')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Applies to">
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">Whole organisation</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {indent(u)}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={() => grant.mutate()} disabled={!roleId} loading={grant.isPending}>
            Grant
          </Button>
        </div>
        <ErrorNotice error={grant.error ?? revoke.error} />
      </div>
    </Dialog>
  );
}
