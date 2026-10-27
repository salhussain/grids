import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, ShieldCheck, Timer, UserCheck, Users } from 'lucide-react';
import { useState } from 'react';
import {
  ErrorNotice,
  PageHeader,
  Panel,
  SectionHead,
  ActiveSessionsList,
  PastSessionsList,
  SessionPolicyPanel,
  Switch,
  Table,
  VerticalTabs,
  Td,
  useToast,
} from '@grids/ui';
import type { SessionPolicy } from '@grids/schema';
import { api } from '../api';
import { NoAccess, useCan, useWorkspace } from '../session';
import { useT } from '../i18n';
import { Meter, StatCard } from '../ui';

type Tab = 'mfa' | 'sessions' | 'active' | 'past';

export function SecurityPage() {
  const [tab, setTab] = useState<Tab>('mfa');
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
  const policy = useMutation({
    mutationFn: (p: SessionPolicy) => api.setSessionPolicy(id, p),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['workspace', id] });
      toast('Session settings saved');
    },
  });
  const active = useQuery({
    queryKey: ['sessions', id],
    queryFn: () => api.activeSessions(id),
    enabled: can('security.manage'),
  });
  const past = useQuery({
    queryKey: ['sessions-past', id],
    queryFn: () => api.pastSessions(id),
    enabled: can('security.manage') && tab === 'past',
  });
  const revoke = useMutation({
    mutationFn: (sessionId: string) => api.revokeSession(id, sessionId),
    onSuccess: (res) => {
      qc.setQueryData(['sessions', id], res);
      toast('Signed out');
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
              description="Everyone uses an authenticator app, security key or passkey as well as their password."
            />
            <div className="flex items-center justify-between gap-4 pb-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">Require 2FA for all users</div>
                <div className="text-xs text-zinc-500">
                  People without a second factor are asked to set one up at their next sign-in
                </div>
              </div>
              <Switch
                label="Require 2FA"
                checked={required}
                disabled={set.isPending || members.isPending}
                onChange={(v) => set.mutate(v)}
              />
            </div>
            <ErrorNotice error={set.error} />
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard
                icon={UserCheck}
                label="Enrolled in 2FA"
                value={`${enrolled.length} / ${ms.length}`}
                sub={
                  ms.length ? `${Math.round((enrolled.length / ms.length) * 100)}% coverage` : '—'
                }
                tone={required && enrolled.length < ms.length ? 'warn' : 'good'}
              />
              <div className="self-end pb-3">
                <Meter value={enrolled.length} max={ms.length || null} />
              </div>
            </div>
            <div className="pt-4">
              <SectionHead
                title="Not yet enrolled"
                description={
                  required
                    ? 'They’ll be asked to enrol at their next sign-in.'
                    : 'Encourage them to enrol, or require 2FA.'
                }
              />
              <Panel flush>
                <Table head={['Person', 'Last seen']} empty="Everyone has 2FA set up.">
                  {ms
                    .filter((m) => m.mfa && !m.mfa.enrolled)
                    .map((m) => (
                      <tr key={m.userId} className="border-t border-zinc-100">
                        <Td>
                          <div className="font-medium">
                            {[m.givenName, m.familyName].filter(Boolean).join(' ') ||
                              m.displayName ||
                              m.email}
                          </div>
                          <div className="text-xs text-zinc-500">{m.email}</div>
                        </Td>
                        <Td className="text-zinc-500">
                          {m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleDateString() : 'Never'}
                        </Td>
                      </tr>
                    ))}
                </Table>
              </Panel>
            </div>
          </>
        )}
        {tab === 'sessions' && (
          <SessionPolicyPanel
            value={ws.sessionPolicy}
            saving={policy.isPending}
            error={policy.error}
            onSave={(p) => policy.mutate(p)}
          />
        )}
        {tab === 'active' && (
          <ActiveSessionsList
            sessions={active.data?.sessions ?? []}
            loading={active.isPending}
            revoking={revoke.isPending}
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
