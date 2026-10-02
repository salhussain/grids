import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { ErrorNotice, PageHeader, Panel, Stat, Switch, Table, Td, useToast } from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan, useWorkspace } from '../session';
import { useT } from '../i18n';

export function SecurityPage() {
  const t = useT();
  const ws = useWorkspace();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const id = ws.tenant.id;
  const members = useQuery({
    queryKey: ['members', id],
    queryFn: () => api.members(id),
    enabled: can('security.manage'),
  });
  const set = useMutation({
    mutationFn: (v: boolean) => api.setSecurity(id, v),
    onSuccess: async (t) => {
      await qc.invalidateQueries({ queryKey: ['members', id] });
      toast(t.mfaRequired ? '2FA is now required for everyone' : '2FA is now optional');
    },
  });
  if (!can('security.manage')) return <NoAccess what="security settings" />;
  const ms = members.data?.members ?? [];
  const enrolled = ms.filter((m) => m.mfa?.enrolled);
  const required = members.data?.mfaRequired ?? false;

  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.settings')}
        title={t('web.nav.security')}
        meta={<span>Sign-in requirements for everyone in {ws.tenant.name}.</span>}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Two-factor authentication">
          <div className="flex items-start justify-between gap-6">
            <div className="flex gap-4">
              <ShieldCheck className="mt-0.5 size-6 shrink-0 text-accent-600" />
              <div className="text-sm">
                <p className="font-medium">Require 2FA for all users</p>
                <p className="mt-1 text-zinc-600">
                  Everyone must use an authenticator app, security key or passkey in addition to
                  their password. People without a second factor are asked to set one up at their
                  next sign-in.
                </p>
              </div>
            </div>
            <Switch
              label="Require 2FA"
              checked={required}
              disabled={set.isPending || members.isPending}
              onChange={(v) => set.mutate(v)}
            />
          </div>
          <div className="mt-4">
            <ErrorNotice error={set.error} />
          </div>
        </Panel>
        <div className="grid gap-px border border-zinc-200 bg-zinc-200 [&>*]:border-0">
          <Stat
            label="Enrolled in 2FA"
            value={`${enrolled.length} / ${ms.length}`}
            sub={ms.length ? `${Math.round((enrolled.length / ms.length) * 100)}% coverage` : '—'}
            tone={required && enrolled.length < ms.length ? 'warn' : undefined}
          />
        </div>
      </div>
      <Panel
        className="mt-6"
        flush
        title="Not yet enrolled"
        description={
          required
            ? 'They’ll be asked to enrol at their next sign-in.'
            : 'Encourage them to enrol, or require 2FA.'
        }
      >
        <Table head={['Person', 'Email', 'Last seen']} empty="Everyone has 2FA set up.">
          {ms
            .filter((m) => m.mfa && !m.mfa.enrolled)
            .map((m) => (
              <tr key={m.userId}>
                <Td className="font-medium">
                  {[m.givenName, m.familyName].filter(Boolean).join(' ') || m.displayName}
                </Td>
                <Td className="text-zinc-600">{m.email}</Td>
                <Td className="text-zinc-500">
                  {m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleDateString() : 'Never'}
                </Td>
              </tr>
            ))}
        </Table>
      </Panel>
    </>
  );
}
