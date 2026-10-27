import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, ShieldCheck, Timer, Users } from 'lucide-react';
import { useState } from 'react';
import type { SessionPolicy, TenantDetail } from '@grids/schema';
import { api } from '../../api';
import { useCan } from '../../session';
import {
  ErrorNotice,
  SectionHead,
  ActiveSessionsList,
  PastSessionsList,
  SessionPolicyPanel,
  Stat,
  Switch,
  VerticalTabs,
  useToast,
} from '@grids/ui';

type Tab = 'mfa' | 'sessions' | 'active' | 'past';

export function SecurityTab({ t }: { t: TenantDetail }) {
  const [tab, setTab] = useState<Tab>('mfa');
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const members = useQuery({
    queryKey: ['members', t.id],
    queryFn: () => api.members(t.id),
    enabled: t.status === 'active',
  });
  const set = useMutation({
    mutationFn: (v: boolean) => api.setSecurity(t.id, v),
    onSuccess: (res) => {
      qc.setQueryData(['tenant', t.id], res);
      void qc.invalidateQueries({ queryKey: ['members', t.id] });
      toast(
        res.mfaRequired
          ? '2FA is now required for everyone in this organisation'
          : '2FA is now optional',
      );
    },
  });
  const policy = useMutation({
    mutationFn: (p: SessionPolicy) => api.setSessionPolicy(t.id, p),
    onSuccess: (res) => {
      qc.setQueryData(['tenant', t.id], res);
      toast('Session settings saved');
    },
  });
  const active = useQuery({
    queryKey: ['sessions', t.id],
    queryFn: () => api.activeSessions(t.id),
    enabled: t.status === 'active' && can('tenants.security'),
  });
  const past = useQuery({
    queryKey: ['sessions-past', t.id],
    queryFn: () => api.pastSessions(t.id),
    enabled: t.status === 'active' && can('tenants.security') && tab === 'past',
  });
  const revoke = useMutation({
    mutationFn: (sessionId: string) => api.revokeSession(t.id, sessionId),
    onSuccess: (res) => {
      qc.setQueryData(['sessions', t.id], res);
      toast('Signed out');
    },
  });
  const ms = members.data?.members ?? [];
  const enrolled = ms.filter((m) => m.mfa?.enrolled).length;

  return (
    <>
      <VerticalTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'mfa', label: 'Two-factor', icon: ShieldCheck },
          { id: 'sessions', label: 'Session limits', icon: Timer },
          {
            id: 'active',
            label: 'Active sessions',
            icon: Users,
            count: active.data?.sessions.length,
          },
          { id: 'past', label: 'Past sessions', icon: History },
        ]}
      >
        {tab === 'mfa' && (
          <>
            <SectionHead
              title="Two-factor authentication"
              description="Enforced by the identity provider at sign-in. People without a second factor must enrol before continuing."
            />
            <div className="flex items-center justify-between gap-4 pb-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">Require 2FA for all users</div>
                <div className="text-xs text-zinc-500">
                  {t.idpOrgId
                    ? 'The organisation’s administrators can change this from their own workspace too'
                    : 'Applied when the organisation is provisioned'}
                </div>
              </div>
              <Switch
                label="Require 2FA"
                checked={t.mfaRequired}
                disabled={set.isPending || !can('tenants.security')}
                onChange={(v) => set.mutate(v)}
              />
            </div>
            <ErrorNotice error={set.error} />
            <div className="grid gap-px border border-zinc-200 bg-zinc-200 sm:grid-cols-2 [&>*]:border-0">
              <Stat
                label="Members enrolled in 2FA"
                value={`${enrolled} / ${ms.length}`}
                sub={
                  ms.length
                    ? `${Math.round((enrolled / ms.length) * 100)}% coverage`
                    : 'No members yet'
                }
                tone={t.mfaRequired && enrolled < ms.length ? 'warn' : undefined}
              />
              <Stat
                label="Suspended members"
                value={ms.filter((m) => m.status === 'suspended').length}
              />
            </div>
          </>
        )}
        {tab === 'sessions' && (
          <SessionPolicyPanel
            value={t.sessionPolicy}
            saving={policy.isPending}
            disabled={!can('tenants.security')}
            error={policy.error}
            onSave={(p) => policy.mutate(p)}
          />
        )}
        {tab === 'active' && (
          <ActiveSessionsList
            sessions={active.data?.sessions ?? []}
            loading={active.isPending}
            revoking={revoke.isPending}
            disabled={!can('tenants.security')}
            error={active.error ?? revoke.error}
            onRevoke={(sid) => revoke.mutate(sid)}
          />
        )}
        {tab === 'past' && (
          <PastSessionsList
            sessions={past.data?.sessions ?? []}
            loading={past.isPending}
            error={past.error}
          />
        )}
      </VerticalTabs>
    </>
  );
}
