import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { DomainDto, TenantDetail } from '@grids/schema';
import { api } from '../../api';
import { Button, CopyField, ErrorNotice, Input, Mono, Panel, Status, useToast } from '@grids/ui';
import { useCan } from '../../session';
import { relTime } from '@grids/ui';

export function DomainsTab({ t }: { t: TenantDetail }) {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const [hostname, setHostname] = useState('');
  const onDomains = (domains: DomainDto[]) => qc.setQueryData(['tenant', t.id], { ...t, domains });
  const run = (fn: () => Promise<DomainDto[]>, msg: string) =>
    fn().then((d) => (onDomains(d), toast(msg)));

  const add = useMutation({
    mutationFn: () => api.addDomain(t.id, hostname),
    onSuccess: (d) => {
      onDomains(d);
      setHostname('');
      toast('Domain added: publish the DNS records, then verify');
    },
  });
  const action = useMutation({
    mutationFn: ({ fn, msg }: { fn: () => Promise<DomainDto[]>; msg: string }) => run(fn, msg),
  });

  return (
    <div className="space-y-6">
      <Panel title="How custom domains work">
        <ol className="grid gap-4 text-sm text-zinc-700 md:grid-cols-3">
          {[
            [
              'Point the domain',
              <>
                Create a <Mono>CNAME</Mono> from the hostname to our edge. Traffic for it then
                reaches Grids.
              </>,
            ],
            [
              'Prove ownership',
              <>
                Publish the <Mono>TXT</Mono> challenge record, then click Verify.
              </>,
            ],
            [
              'Make it primary',
              <>
                TLS certificates are issued automatically. The platform address then{' '}
                <b>301-redirects</b> to the custom domain.
              </>,
            ],
          ].map(([title, body], i) => (
            <li key={i} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center bg-ink font-mono text-xs text-canvas">
                {i + 1}
              </span>
              <div>
                <div className="font-medium text-ink">{title}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-zinc-600">{body}</div>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel
        title="Domains"
        actions={
          can('tenants.domains') && (
            <form onSubmit={(e: FormEvent) => (e.preventDefault(), add.mutate())} className="flex">
              <Input
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="data.example.org"
                aria-label="Hostname"
                className="w-64 border-r-0"
              />
              <Button type="submit" icon={Plus} loading={add.isPending} disabled={!hostname}>
                Add domain
              </Button>
            </form>
          )
        }
      >
        <div className="space-y-3">
          <ErrorNotice error={add.error ?? action.error} />
          {t.domains.map((d) => (
            <div key={d.id} className="border border-zinc-200">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Globe className="size-4 shrink-0 text-zinc-500" />
                  <Mono className="truncate font-medium">{d.hostname}</Mono>
                  {d.isPrimary && <Status value="primary" tone="accent" />}
                  <Status value={d.status} />
                  {d.kind === 'platform' && (
                    <span className="text-xs text-zinc-500">Platform address</span>
                  )}
                </div>
                {d.kind === 'custom' && can('tenants.domains') && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={RefreshCw}
                      onClick={() =>
                        action.mutate({
                          fn: () => api.verifyDomain(t.id, d.id),
                          msg: 'Verification checked',
                        })
                      }
                    >
                      Verify
                    </Button>
                    {!d.isPrimary && d.status === 'verified' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Star}
                        onClick={() =>
                          action.mutate({
                            fn: () => api.primaryDomain(t.id, d.id),
                            msg: `${d.hostname} is now primary`,
                          })
                        }
                      >
                        Make primary
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      onClick={() =>
                        confirm(`Remove ${d.hostname}?`) &&
                        action.mutate({
                          fn: () => api.removeDomain(t.id, d.id),
                          msg: 'Domain removed',
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                )}
                {d.kind === 'platform' && !d.isPrimary && can('tenants.domains') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Star}
                    onClick={() =>
                      action.mutate({
                        fn: () => api.primaryDomain(t.id, 'platform'),
                        msg: 'Platform address is primary again',
                      })
                    }
                  >
                    Make primary
                  </Button>
                )}
              </div>
              {d.kind === 'custom' && d.status !== 'verified' && (
                <div className="space-y-3 border-t border-zinc-200 bg-zinc-50 px-4 py-4">
                  <p className="text-xs text-zinc-600">
                    Create these DNS records at your DNS provider:
                  </p>
                  {d.dns.map((r) => (
                    <div
                      key={r.type}
                      className="grid gap-2 md:grid-cols-[70px_1fr_1fr] md:items-center"
                    >
                      <Mono className="text-xs font-semibold">{r.type}</Mono>
                      <CopyField value={r.name} />
                      <CopyField value={r.value} />
                    </div>
                  ))}
                  {d.lastError && (
                    <p className="text-xs text-red-700">
                      {d.lastError}
                      {d.lastCheckedAt && ` (checked ${relTime(d.lastCheckedAt)})`}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
