import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { DomainDto } from '@grids/schema';
import {
  Button,
  CopyField,
  ErrorNotice,
  Input,
  Mono,
  PageHeader,
  Panel,
  Status,
  relTime,
  useToast,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan, useWorkspace } from '../session';
import { useT } from '../i18n';

export function DomainsPage() {
  const t = useT();
  const ws = useWorkspace();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const id = ws.tenant.id;
  const [hostname, setHostname] = useState('');
  const domains = useQuery({
    queryKey: ['domains', id],
    queryFn: () => api.domains(id),
    enabled: can('domains.manage'),
  });
  const run = useMutation({
    mutationFn: ({ fn }: { fn: () => Promise<DomainDto[]>; msg: string }) => fn(),
    onSuccess: (d, v) => {
      qc.setQueryData(['domains', id], d);
      toast(v.msg);
    },
  });
  if (!can('domains.manage')) return <NoAccess what="domains" />;
  const featured = ws.features.includes('custom_domain');

  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.settings')}
        title={t('web.nav.domains')}
        meta={<span>Use your own address for this workspace, e.g. data.example.org.</span>}
      />
      {!featured && (
        <div className="mb-6 border-s-4 border-amber-500 bg-amber-50 px-5 py-3 text-sm">
          Custom domains are available on higher plans. Contact Grids support to upgrade.
        </div>
      )}
      <Panel
        title="Addresses"
        actions={
          featured && (
            <form
              onSubmit={(e: FormEvent) => (
                e.preventDefault(),
                run.mutate({
                  fn: () => api.addDomain(id, hostname),
                  msg: 'Domain added: create the DNS records, then verify',
                }),
                setHostname('')
              )}
              className="flex"
            >
              <Input
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="data.example.org"
                aria-label="Hostname"
                className="w-64 border-r-0"
              />
              <Button type="submit" icon={Plus} disabled={!hostname}>
                Add domain
              </Button>
            </form>
          )
        }
      >
        <div className="space-y-3">
          <ErrorNotice error={domains.error ?? run.error} />
          {domains.data?.map((d) => (
            <div key={d.id} className="border border-zinc-200">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Globe className="size-4 shrink-0 text-zinc-500" />
                  <Mono className="truncate font-medium">{d.hostname}</Mono>
                  {d.isPrimary && <Status value="primary" tone="accent" />}
                  <Status value={d.status} />
                </div>
                <div className="flex gap-1">
                  {d.kind === 'custom' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={RefreshCw}
                      onClick={() =>
                        run.mutate({
                          fn: () => api.verifyDomain(id, d.id),
                          msg: 'Verification checked',
                        })
                      }
                    >
                      Verify
                    </Button>
                  )}
                  {!d.isPrimary && d.status === 'verified' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Star}
                      onClick={() =>
                        run.mutate({
                          fn: () => api.primaryDomain(id, d.id),
                          msg: `${d.hostname} is now primary`,
                        })
                      }
                    >
                      Make primary
                    </Button>
                  )}
                  {d.kind === 'custom' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      onClick={() =>
                        confirm(`Remove ${d.hostname}?`) &&
                        run.mutate({ fn: () => api.removeDomain(id, d.id), msg: 'Domain removed' })
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              {d.kind === 'custom' && d.status !== 'verified' && (
                <div className="space-y-3 border-t border-zinc-200 bg-zinc-50 px-4 py-4">
                  <p className="text-xs text-zinc-600">
                    Create these records at your DNS provider, then click Verify:
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
    </>
  );
}
