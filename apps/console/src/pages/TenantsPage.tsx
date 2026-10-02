import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Building2, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { TenantStatus } from '@grids/schema';
import {
  Empty,
  ErrorNotice,
  Input,
  Loading,
  Mono,
  PageHeader,
  Pagination,
  Panel,
  Select,
  Status,
  Table,
  Td,
  countryName,
  humanize,
  relTime,
  usePagination,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan } from '../session';

export function TenantsPage() {
  const navigate = useNavigate();
  const can = useCan();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = usePagination([q, status]);
  const query = { q, status, ...page };
  const tenants = useQuery({
    queryKey: ['tenants', query],
    queryFn: () => api.tenants(query),
    placeholderData: keepPreviousData,
    enabled: can('tenants.view'),
  });
  if (!can('tenants.view')) return <NoAccess what="organisations" />;
  const d = tenants.data;

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Organisations"
        meta={<span>Every tenant on the platform: lifecycle, plan, people and support load.</span>}
        actions={
          can('tenants.create') && (
            <Link
              to="/tenants/new"
              className="inline-flex h-9 items-center gap-2 bg-accent-600 px-3.5 text-sm font-medium text-white hover:bg-accent-700"
            >
              <Plus className="size-4" /> New organisation
            </Link>
          )
        }
      />
      <Panel
        flush
        title={`${d?.total ?? '–'} organisations`}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-zinc-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, slug, email"
                className="w-64 pl-8"
                aria-label="Search organisations"
              />
            </div>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Status"
              className="w-44"
            >
              <option value="">All statuses</option>
              {TenantStatus.options.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </>
        }
      >
        <ErrorNotice error={tenants.error} />
        {tenants.isPending ? (
          <Loading />
        ) : !d?.total && !q && !status ? (
          <Empty icon={Building2} title="No organisations yet">
            Create an organisation, set up its subscription, then invite its administrators.
          </Empty>
        ) : (
          <>
            <Table
              head={[
                'Organisation',
                'Status',
                'Plan',
                'Country',
                'Primary contact',
                'Members',
                'Tickets',
                'Created',
              ]}
              empty="No organisations match."
            >
              {d?.items.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => navigate({ to: '/tenants/$tenantId', params: { tenantId: t.id } })}
                  className="cursor-pointer hover:bg-zinc-50"
                >
                  <Td>
                    <Link
                      to="/tenants/$tenantId"
                      params={{ tenantId: t.id }}
                      className="font-medium text-ink hover:text-accent-700"
                    >
                      {t.name}
                    </Link>
                    <div>
                      <Mono className="text-xs text-zinc-500">{t.slug}</Mono>
                    </div>
                  </Td>
                  <Td>
                    <Status value={t.status} />
                  </Td>
                  <Td>
                    {t.planName ?? <span className="text-zinc-400">—</span>}
                    {t.subscriptionStatus && t.subscriptionStatus !== 'active' && (
                      <div className="text-xs text-zinc-500">{humanize(t.subscriptionStatus)}</div>
                    )}
                  </Td>
                  <Td className="text-zinc-600">{countryName(t.country) ?? '—'}</Td>
                  <Td className="text-zinc-600">{t.primaryContactEmail ?? '—'}</Td>
                  <Td className="num text-right">{t.memberCount}</Td>
                  <Td className="num text-right">
                    {t.openTickets || <span className="text-zinc-400">0</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-zinc-500">{relTime(t.createdAt)}</Td>
                </tr>
              ))}
            </Table>
            {d && <Pagination {...page} total={d.total} onChange={setPage} />}
          </>
        )}
      </Panel>
    </>
  );
}
