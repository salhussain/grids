import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import type { TenantDetail } from '@grids/schema';
import { api } from '../../api';
import { useCan } from '../../session';
import { ErrorNotice, Panel, Stat, Switch, useToast } from '@grids/ui';

export function SecurityTab({ t }: { t: TenantDetail }) {
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
  const ms = members.data?.members ?? [];
  const enrolled = ms.filter((m) => m.mfa?.enrolled).length;

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Panel className="xl:col-span-2" title="Two-factor authentication">
        <div className="flex items-start justify-between gap-6">
          <div className="flex gap-4">
            <ShieldCheck className="mt-0.5 size-6 shrink-0 text-accent-600" />
            <div className="text-sm">
              <p className="font-medium text-ink">Require 2FA for all users</p>
              <p className="mt-1 text-zinc-600">
                Enforced by the identity provider at sign-in for everyone in this organisation.
                Users without a second factor (authenticator app, security key or passkey) must
                enrol before continuing. Organisation administrators can change this from their own
                workspace too.
              </p>
              {!t.idpOrgId && (
                <p className="mt-2 text-xs text-amber-800">
                  Applied when the organisation is provisioned.
                </p>
              )}
            </div>
          </div>
          <Switch
            label="Require 2FA"
            checked={t.mfaRequired}
            disabled={set.isPending || !can('tenants.security')}
            onChange={(v) => set.mutate(v)}
          />
        </div>
        <div className="mt-4">
          <ErrorNotice error={set.error} />
        </div>
      </Panel>
      <div className="grid gap-px border border-zinc-200 bg-zinc-200 [&>*]:border-0">
        <Stat
          label="Members enrolled in 2FA"
          value={`${enrolled} / ${ms.length}`}
          sub={
            ms.length ? `${Math.round((enrolled / ms.length) * 100)}% coverage` : 'No members yet'
          }
          tone={t.mfaRequired && enrolled < ms.length ? 'warn' : undefined}
        />
        <Stat label="Suspended members" value={ms.filter((m) => m.status === 'suspended').length} />
      </div>
    </div>
  );
}
