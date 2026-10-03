import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MailCheck,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import {
  CreateInvitationInput,
  type CreatedInvitation,
  type MemberDto,
  type MemberRole,
  type TenantDetail,
} from '@grids/schema';
import { api } from '../../api';
import {
  Button,
  CopyField,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
  Input,
  Panel,
  Select,
  Status,
  Table,
  Td,
  Textarea,
  useToast,
} from '@grids/ui';
import { date, relTime } from '@grids/ui';
import { useCan } from '../../session';
import { issuesToErrors, type Errors } from '../tenantForm';

export function PeopleTab({ t, onInvite }: { t: TenantDetail; onInvite: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const members = useQuery({
    queryKey: ['members', t.id],
    queryFn: () => api.members(t.id),
    enabled: t.status !== 'pending_payment',
  });
  const [link, setLink] = useState<CreatedInvitation | null>(null);

  const onMembers = (data: Awaited<ReturnType<typeof api.members>>) => {
    qc.setQueryData(['members', t.id], data);
    void qc.invalidateQueries({ queryKey: ['tenant', t.id] });
  };
  const update = useMutation({
    mutationFn: ({
      userId,
      ...input
    }: {
      userId: string;
      role?: MemberRole;
      status?: 'active' | 'suspended';
    }) => api.updateMember(t.id, userId, input),
    onSuccess: (d) => {
      onMembers(d);
      toast('Member updated');
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvite(t.id, id),
    onSuccess: (d) => (onMembers(d), toast('Invitation revoked')),
  });
  const resend = useMutation({
    mutationFn: (id: string) => api.resendInvite(t.id, id),
    onSuccess: (res) => {
      setLink(res);
      void qc.invalidateQueries({ queryKey: ['members', t.id] });
      toast(
        res.emailSent
          ? `Invitation re-sent to ${res.invitation.email}`
          : 'New link created (email failed)',
      );
    },
  });

  if (t.status === 'pending_payment') {
    return (
      <Panel>
        <Empty icon={Users} title="Invitations open after payment">
          Once the subscription is paid (or trialing) and the workspace is provisioned, invite
          administrators here.
        </Empty>
      </Panel>
    );
  }
  const d = members.data;
  const enrolled = d?.members.filter((m) => m.mfa?.enrolled).length ?? 0;

  return (
    <div className="space-y-6">
      <ErrorNotice error={members.error ?? update.error ?? revoke.error ?? resend.error} />
      {link && (
        <div className="border border-emerald-300 bg-emerald-50 p-4">
          <p className="mb-2 text-sm text-emerald-900">
            New invitation link for <b>{link.invitation.email}</b> (shown once):
          </p>
          <CopyField value={link.inviteUrl} />
        </div>
      )}
      <Panel
        flush
        title={`Members${d ? ` · ${d.members.length}` : ''}`}
        description={
          d &&
          `${enrolled} of ${d.members.length} enrolled in 2FA · 2FA ${d.mfaRequired ? 'required' : 'optional'} for this organisation`
        }
        actions={
          <Button
            icon={UserPlus}
            onClick={onInvite}
            disabled={t.status !== 'active' || !can('members.manage')}
          >
            Invite person
          </Button>
        }
      >
        {d && !d.members.length ? (
          <Empty icon={Users} title="No members yet">
            Invite the organisation’s administrator to get started.
          </Empty>
        ) : (
          <Table head={['Person', 'Role & position', 'Contact', '2FA', 'Status', 'Last seen', '']}>
            {d?.members.map((m) => (
              <MemberRow
                key={m.userId}
                m={m}
                mfaRequired={d.mfaRequired}
                busy={update.isPending || !can('members.manage')}
                onChange={(input) => update.mutate({ userId: m.userId, ...input })}
              />
            ))}
          </Table>
        )}
      </Panel>

      <Panel
        flush
        title={`Invitations${d ? ` · ${d.invitations.length}` : ''}`}
        description="Pending and expired invitations. Accepted ones become members."
      >
        <Table
          head={['Invitee', 'Role & position', 'Invited by', 'Expires', 'Status', '']}
          empty="No outstanding invitations."
        >
          {d?.invitations.map((i) => (
            <tr key={i.id}>
              <Td>
                <div className="font-medium">
                  {[i.firstName, i.lastName].filter(Boolean).join(' ') || i.email}
                </div>
                <div className="text-xs text-zinc-500">
                  {i.email}
                  {i.phone && ` · ${i.phone}`}
                </div>
              </Td>
              <Td>
                <div>{i.role === 'org_admin' ? 'Administrator' : 'Member'}</div>
                <div className="text-xs text-zinc-500">
                  {[i.jobTitle, i.department].filter(Boolean).join(' · ') || '—'}
                </div>
              </Td>
              <Td className="text-zinc-600">
                {i.invitedBy ?? '—'}
                <div className="text-xs text-zinc-500">{relTime(i.createdAt)}</div>
              </Td>
              <Td className="whitespace-nowrap text-zinc-600">{date(i.expiresAt)}</Td>
              <Td>
                <Status value={i.status} />
              </Td>
              <Td className="text-right whitespace-nowrap">
                {can('members.manage') && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={RotateCw}
                      onClick={() => resend.mutate(i.id)}
                      loading={resend.isPending && resend.variables === i.id}
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
                  </>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}

function MemberRow({
  m,
  mfaRequired,
  busy,
  onChange,
}: {
  m: MemberDto;
  mfaRequired: boolean;
  busy: boolean;
  onChange: (input: { role?: MemberRole; status?: 'active' | 'suspended' }) => void;
}) {
  const name = [m.givenName, m.familyName].filter(Boolean).join(' ') || m.displayName || m.email;
  return (
    <tr className={m.status === 'suspended' ? 'bg-zinc-50 text-zinc-500' : ''}>
      <Td>
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center bg-zinc-200 text-xs font-semibold text-zinc-700">
            {(name ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{name}</div>
            <div className="truncate text-xs text-zinc-500">{m.email}</div>
          </div>
        </div>
      </Td>
      <Td>
        <Select
          aria-label={`Role for ${m.email}`}
          value={m.role}
          disabled={busy}
          onChange={(e) => onChange({ role: e.target.value as MemberRole })}
          className="h-8 w-36 text-xs"
        >
          <option value="org_admin">Administrator</option>
          <option value="member">Member</option>
        </Select>
        <div className="mt-1 text-xs text-zinc-500">
          {[m.jobTitle, m.department].filter(Boolean).join(' · ') || '—'}
        </div>
      </Td>
      <Td className="text-xs text-zinc-600">{m.phone ?? '—'}</Td>
      <Td>
        {m.mfa === null ? (
          <span className="text-xs text-zinc-400">Unknown</span>
        ) : m.mfa.enrolled ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-800">
            <ShieldCheck className="size-4" />{' '}
            {m.mfa.methods.map((x) => x.toUpperCase()).join(', ')}
          </span>
        ) : (
          <span
            className={`inline-flex items-center gap-1.5 text-xs ${mfaRequired ? 'text-red-700' : 'text-zinc-500'}`}
          >
            <ShieldAlert className="size-4" />{' '}
            {mfaRequired ? 'Required, not set up' : 'Not enrolled'}
          </span>
        )}
      </Td>
      <Td>
        <Status value={m.status} />
      </Td>
      <Td className="text-xs whitespace-nowrap text-zinc-500">
        {m.lastSeenAt ? relTime(m.lastSeenAt) : 'Never'}
      </Td>
      <Td className="text-right">
        {m.status === 'active' ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              confirm(`Suspend ${m.email}? They lose access to this organisation.`) &&
              onChange({ status: 'suspended' })
            }
          >
            Suspend
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onChange({ status: 'active' })}
          >
            Reactivate
          </Button>
        )}
      </Td>
    </tr>
  );
}

export function InviteDialog({
  t,
  open,
  onClose,
  defaultRole,
}: {
  t: TenantDetail;
  open: boolean;
  onClose: () => void;
  defaultRole: MemberRole;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const blank = {
    email: '',
    firstName: '',
    lastName: '',
    jobTitle: '',
    department: '',
    phone: '',
    role: defaultRole,
    message: '',
  };
  const [v, setV] = useState(blank);
  const [errors, setErrors] = useState<Errors>({});
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const set = (k: keyof typeof v, val: string) => setV((x) => ({ ...x, [k]: val }));
  // Start fresh on every open: the default role depends on the tenant's current step.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setV({ ...blank, role: defaultRole });
  }
  const close = () => {
    setCreated(null);
    setV(blank);
    setErrors({});
    onClose();
  };

  const invite = useMutation({
    mutationFn: () => api.invite(t.id, v),
    onSuccess: async (res) => {
      setCreated(res);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['members', t.id] }),
        qc.invalidateQueries({ queryKey: ['tenant', t.id] }),
      ]);
      toast(
        res.emailSent
          ? `Invitation emailed to ${res.invitation.email}`
          : 'Invitation created (email failed)',
      );
    },
  });
  const submit = () => {
    const parsed = CreateInvitationInput.safeParse(v);
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues));
    setErrors({});
    invite.mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={created ? 'Invitation sent' : `Invite to ${t.name}`}
      description={
        created
          ? undefined
          : 'They’ll receive an email to register and join. Links expire after 7 days.'
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
            <MailCheck className="size-5 text-emerald-700" />{' '}
            {created.emailSent ? (
              <>
                Emailed to <b>{created.invitation.email}</b>.
              </>
            ) : (
              <>Email delivery failed. Share the link directly.</>
            )}
          </p>
          <div>
            <p className="mb-2 text-zinc-600">Invitation link (shown once):</p>
            <CopyField value={created.inviteUrl} />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={errors.firstName}>
            <Input
              value={v.firstName}
              onChange={(e) => set('firstName', e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Last name" required error={errors.lastName}>
            <Input value={v.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </Field>
          <Field label="Work email" required error={errors.email} className="sm:col-span-2">
            <Input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />
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
              <option value="org_admin">Administrator: manages people, security, settings</option>
              <option value="member">Member</option>
            </Select>
          </Field>
          <Field
            label="Personal message"
            className="sm:col-span-2"
            hint="Included in the invitation email"
          >
            <Textarea value={v.message} onChange={(e) => set('message', e.target.value)} rows={3} />
          </Field>
          {t.mfaRequired && (
            <p className="text-xs text-amber-800 sm:col-span-2">
              This organisation requires 2FA. They’ll be asked to set it up when they first sign in.
            </p>
          )}
          <div className="sm:col-span-2">
            <ErrorNotice error={invite.error} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
