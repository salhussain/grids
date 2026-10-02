import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { InvoiceDto } from '@grids/schema';
import {
  BarChart,
  ErrorNotice,
  Loading,
  Mono,
  PageHeader,
  Pagination,
  Panel,
  RefreshControl,
  Select,
  Stat,
  Status,
  Table,
  Tabs,
  Td,
  date,
  humanize,
  money,
  moneyCompact,
  useLiveInterval,
  usePagination,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan } from '../session';
import { InvoiceDialog } from './dialogs';

type Tab = 'overview' | 'subscriptions' | 'invoices';

export function BillingPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('overview');
  if (!can('billing.view')) return <NoAccess what="billing" />;
  return (
    <>
      <PageHeader
        eyebrow="Revenue"
        title="Billing"
        meta={<span>Recurring revenue, subscriptions and invoices across all organisations.</span>}
        actions={
          <RefreshControl queryKeys={[['billing-overview'], ['subscriptions'], ['invoices']]} />
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'subscriptions', label: 'Subscriptions' },
          { id: 'invoices', label: 'Invoices' },
        ]}
      />
      {tab === 'overview' && <Overview />}
      {tab === 'subscriptions' && <Subscriptions />}
      {tab === 'invoices' && <Invoices />}
    </>
  );
}

function Overview() {
  const live = useLiveInterval();
  const o = useQuery({
    queryKey: ['billing-overview'],
    queryFn: api.billingOverview,
    refetchInterval: live,
  });
  if (o.isPending) return <Loading />;
  if (o.isError) return <ErrorNotice error={o.error} />;
  const t = o.data.totals[0] ?? {
    currency: 'USD',
    mrr: 0,
    arr: 0,
    outstanding: 0,
    overdue: 0,
    collected30d: 0,
  };
  const cur = t.currency;

  // Last 12 months, zero-filled, in the primary currency.
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 11 + i);
    return d.toISOString().slice(0, 7);
  });
  const revenue = months.map((m) => ({
    key: m,
    label: new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short' }),
    value: o.data.revenueByMonth
      .filter((r) => r.month === m && r.currency === cur)
      .reduce((a, r) => a + r.amount, 0),
  }));
  const mixMax = Math.max(1, ...o.data.planMix.map((p) => p.mrr));

  return (
    <div className="space-y-6">
      <div className="stat-strip grid grid-cols-2 gap-px border border-zinc-200 bg-zinc-200 lg:grid-cols-5 [&>*]:border-0">
        <Stat
          label="MRR"
          value={moneyCompact(t.mrr, cur)}
          sub="Active subscriptions, normalised monthly"
        />
        <Stat label="ARR" value={moneyCompact(t.arr, cur)} sub="MRR × 12" />
        <Stat label="Collected · 30 days" value={moneyCompact(t.collected30d, cur)} />
        <Stat label="Outstanding" value={moneyCompact(t.outstanding, cur)} sub="Open invoices" />
        <Stat
          label="Overdue"
          value={moneyCompact(t.overdue, cur)}
          tone={t.overdue ? 'bad' : undefined}
          sub={t.overdue ? 'Past due date' : 'Nothing overdue'}
        />
      </div>
      {o.data.totals.length > 1 && (
        <p className="text-xs text-zinc-500">
          Showing {cur}. Other currencies:{' '}
          {o.data.totals
            .slice(1)
            .map((x) => `${x.currency} MRR ${money(x.mrr, x.currency)}`)
            .join(' · ')}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Revenue collected"
          description={`Paid invoices per month · ${cur}`}
        >
          <BarChart
            data={revenue}
            format={(v) => moneyCompact(v, cur)}
            title="Revenue collected per month, last 12 months"
          />
        </Panel>
        <Panel title="Plan mix" description="Subscriptions and MRR by plan">
          {o.data.planMix.length ? (
            <ul className="space-y-4">
              {o.data.planMix.map((p) => (
                <li key={p.planId}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{p.planName}</span>
                    <span className="num text-zinc-600">
                      {p.subscriptions} subs · {money(p.mrr, p.currency)}/mo
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 bg-zinc-100">
                    <div
                      className="h-full bg-accent-600"
                      style={{ width: `${(p.mrr / mixMax) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No subscriptions yet.</p>
          )}
          <div className="mt-6 flex flex-wrap gap-2 border-t border-zinc-200 pt-4">
            {Object.entries(o.data.subscriptionsByStatus).map(([s, n]) => (
              <span key={s} className="flex items-center gap-1.5 text-xs">
                <Status value={s} /> <span className="num">{n}</span>
              </span>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Subscriptions() {
  const live = useLiveInterval();
  const [status, setStatus] = useState('');
  const [page, setPage] = usePagination([status]);
  const query = { status: status || undefined, ...page };
  const subs = useQuery({
    queryKey: ['subscriptions', query],
    queryFn: () => api.subscriptions(query),
    placeholderData: keepPreviousData,
    refetchInterval: live,
  });
  const d = subs.data;
  return (
    <Panel
      flush
      title={`${d?.total ?? '–'} subscriptions`}
      actions={
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Subscription status"
          className="w-44"
        >
          <option value="">All statuses</option>
          {['active', 'trialing', 'pending_payment', 'past_due', 'cancelled'].map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </Select>
      }
    >
      <ErrorNotice error={subs.error} />
      <Table
        head={[
          'Organisation',
          'Plan',
          'Cycle',
          'Amount',
          'MRR',
          'Status',
          'Current period',
          'Renews',
        ]}
        empty="No subscriptions."
      >
        {d?.items.map((s) => (
          <tr key={s.id} className="hover:bg-zinc-50">
            <Td>
              <Link
                to="/tenants/$tenantId"
                params={{ tenantId: s.tenantId }}
                className="font-medium hover:text-accent-700"
              >
                {s.tenantName}
              </Link>
            </Td>
            <Td>{s.planName}</Td>
            <Td className="text-zinc-600">{humanize(s.interval)}</Td>
            <Td className="num text-right">
              {money(s.amount, s.currency)}
              {s.discountPct > 0 && (
                <div className="text-xs text-emerald-700">−{s.discountPct}%</div>
              )}
            </Td>
            <Td className="num text-right">{money(s.mrr, s.currency)}</Td>
            <Td>
              <Status value={s.status} />
            </Td>
            <Td className="whitespace-nowrap text-zinc-600">
              {s.currentPeriodStart
                ? `${date(s.currentPeriodStart)} – ${date(s.currentPeriodEnd)}`
                : '—'}
            </Td>
            <Td className="whitespace-nowrap text-zinc-600">
              {s.status === 'cancelled'
                ? '—'
                : s.cancelAtPeriodEnd
                  ? 'Cancels at period end'
                  : date(s.currentPeriodEnd)}
            </Td>
          </tr>
        ))}
      </Table>
      {d && <Pagination {...page} total={d.total} onChange={setPage} />}
    </Panel>
  );
}

function Invoices() {
  const live = useLiveInterval();
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<InvoiceDto | null>(null);
  const [page, setPage] = usePagination([filter]);
  const query = {
    ...(filter === 'overdue' ? { overdue: true } : filter ? { status: filter } : {}),
    ...page,
  };
  const invoices = useQuery({
    queryKey: ['invoices', query],
    queryFn: () => api.invoices(query),
    placeholderData: keepPreviousData,
    refetchInterval: live,
  });
  const d = invoices.data;
  return (
    <>
      <Panel
        flush
        title={`${d?.total ?? '–'} invoices`}
        actions={
          <Select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter invoices"
            className="w-40"
          >
            <option value="">All invoices</option>
            <option value="open">Open</option>
            <option value="overdue">Overdue</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </Select>
        }
      >
        <ErrorNotice error={invoices.error} />
        <Table
          head={['Invoice', 'Organisation', 'Status', 'Issued', 'Due', 'Paid', 'Total']}
          empty="No invoices match."
        >
          {d?.items.map((inv) => (
            <tr
              key={inv.id}
              className="cursor-pointer hover:bg-zinc-50"
              onClick={() => setSelected(inv)}
            >
              <Td>
                <Mono>{inv.number}</Mono>
              </Td>
              <Td className="font-medium">{inv.tenantName}</Td>
              <Td>
                <Status value={inv.overdue ? 'overdue' : inv.status} />
              </Td>
              <Td className="whitespace-nowrap text-zinc-600">{date(inv.issuedAt)}</Td>
              <Td className="whitespace-nowrap text-zinc-600">{date(inv.dueAt)}</Td>
              <Td className="whitespace-nowrap text-zinc-600">
                {inv.paidAt ? `${date(inv.paidAt)} · ${humanize(inv.paymentMethod ?? '')}` : '—'}
              </Td>
              <Td className="num text-right font-medium">{money(inv.total, inv.currency)}</Td>
            </tr>
          ))}
        </Table>
        {d && <Pagination {...page} total={d.total} onChange={setPage} />}
      </Panel>
      <InvoiceDialog invoice={selected} onClose={() => setSelected(null)} />
    </>
  );
}
