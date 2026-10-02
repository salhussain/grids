import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useState } from 'react';
import {
  ErrorNotice,
  Input,
  Loading,
  Mono,
  PageHeader,
  Pagination,
  Panel,
  RefreshControl,
  Select,
  Table,
  Td,
  dateTime,
  useLiveInterval,
  usePagination,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan } from '../session';
import { DetailsLine, TenantPicker } from './shared';

const AREAS = [
  'tenant.',
  'subscription.',
  'invoice.',
  'plan.',
  'invitation.',
  'member.',
  'security.',
  'domain.',
  'ticket.',
  'staff.',
];

export function SystemLogPage() {
  const can = useCan();
  const live = useLiveInterval();
  const [action, setAction] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = usePagination([action, tenantId, q], 50);
  const query = {
    action: action || undefined,
    tenantId: tenantId || undefined,
    q: q || undefined,
    ...page,
  };
  const log = useQuery({
    queryKey: ['audit', query],
    queryFn: () => api.auditLog(query),
    placeholderData: keepPreviousData,
    refetchInterval: live,
    enabled: can('logs.system'),
  });
  if (!can('logs.system')) return <NoAccess what="the system log" />;
  const d = log.data;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="System log"
        meta={<span>Append-only audit trail of every change across the platform.</span>}
        actions={<RefreshControl queryKeys={[['audit']]} />}
      />
      <Panel
        flush
        title={`${d?.total.toLocaleString() ?? '–'} events`}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-zinc-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search actor, details"
                className="w-56 pl-8"
                aria-label="Search log"
              />
            </div>
            <Select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              aria-label="Area"
              className="w-40"
            >
              <option value="">All areas</option>
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {a.replace('.', '')}
                </option>
              ))}
            </Select>
            <TenantPicker value={tenantId} onChange={setTenantId} />
          </>
        }
      >
        <ErrorNotice error={log.error} />
        {log.isPending ? (
          <Loading />
        ) : (
          <>
            <Table
              head={['Time', 'Action', 'Organisation', 'Actor', 'Details']}
              empty="No events match."
            >
              {d?.items.map((e) => (
                <tr key={e.id} className="align-top">
                  <Td className="font-mono text-xs whitespace-nowrap text-zinc-500">
                    {dateTime(e.at)}
                  </Td>
                  <Td>
                    <Mono className="text-xs font-medium">{e.action}</Mono>
                  </Td>
                  <Td>
                    {e.tenant ? (
                      <Link
                        to="/tenants/$tenantId"
                        params={{ tenantId: e.tenant.id }}
                        className="text-accent-700 hover:underline"
                      >
                        {e.tenant.name}
                      </Link>
                    ) : (
                      <span className="text-zinc-400">Platform</span>
                    )}
                  </Td>
                  <Td className="text-zinc-600">{e.actorEmail ?? 'system'}</Td>
                  <Td className="max-w-lg">
                    <DetailsLine details={e.details} />
                  </Td>
                </tr>
              ))}
            </Table>
            {d && <Pagination {...page} total={d.total} onChange={setPage} sizes={[25, 50, 100]} />}
          </>
        )}
      </Panel>
    </>
  );
}
