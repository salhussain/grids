import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Building2, LifeBuoy, MailWarning, TrendingUp, Wallet } from 'lucide-react';
import {
  ErrorNotice,
  Loading,
  PageHeader,
  Panel,
  RefreshControl,
  Status,
  Table,
  Td,
  moneyCompact,
  relTime,
  useLiveInterval,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan, useSession } from '../session';
import { Avatar, StatCard } from '../ui';
import { ActivityList } from './shared';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5
    ? 'Working late'
    : h < 12
      ? 'Good morning'
      : h < 18
        ? 'Good afternoon'
        : 'Good evening';
};

export function OverviewPage() {
  const can = useCan();
  const { me } = useSession();
  const first = (me.displayName ?? '').split(' ')[0];
  const live = useLiveInterval();
  const o = useQuery({
    queryKey: ['overview'],
    queryFn: api.overview,
    refetchInterval: live,
    enabled: can('overview.view'),
  });
  if (!can('overview.view')) return <NoAccess what="the platform overview" />;

  const header = (
    <PageHeader
      eyebrow="Platform"
      title={`${greeting()}${first ? `, ${first}` : ''}`}
      meta={
        <span>
          {new Date().toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </span>
      }
      actions={
        <>
          <RefreshControl queryKeys={[['overview']]} />
          {can('tenants.create') && (
            <Link
              to="/tenants/new"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent-600 px-3.5 text-sm font-medium text-white shadow-[0_1px_2px_rgb(16_24_40/0.15),inset_0_1px_0_rgb(255_255_255/0.2)] hover:bg-accent-700"
            >
              <Building2 className="size-4" /> New organisation
            </Link>
          )}
        </>
      }
    />
  );
  if (o.isPending)
    return (
      <>
        {header}
        <Loading />
      </>
    );
  if (o.isError)
    return (
      <>
        {header}
        <ErrorNotice error={o.error} />
      </>
    );
  const d = o.data;
  const mrr = d.mrr[0];
  const out = d.outstanding[0];
  const billing = can('billing.view');

  return (
    <>
      {header}
      <div
        className={`mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 ${billing ? 'xl:grid-cols-5' : 'xl:grid-cols-3'}`}
      >
        <StatCard
          to="/tenants"
          icon={Building2}
          label="Organisations"
          value={d.totalTenants}
          sub={`${d.tenants.active ?? 0} active · ${d.tenants.pending_payment ?? 0} awaiting payment`}
        />
        {billing && (
          <StatCard
            icon={TrendingUp}
            label="Monthly recurring revenue"
            value={mrr ? moneyCompact(mrr.amount, mrr.currency) : '$0'}
            sub={
              mrr ? `ARR ${moneyCompact(mrr.amount * 12, mrr.currency)}` : 'No paying subscriptions'
            }
          />
        )}
        {billing && (
          <StatCard
            to="/billing"
            icon={Wallet}
            label="Outstanding"
            value={out ? moneyCompact(out.amount, out.currency) : '$0'}
            sub={out?.overdueCount ? `${out.overdueCount} overdue` : 'Nothing overdue'}
            tone={out?.overdueCount ? 'bad' : undefined}
          />
        )}
        <StatCard
          to="/support"
          icon={LifeBuoy}
          label="Open tickets"
          value={d.openTickets}
          sub={d.urgentTickets ? `${d.urgentTickets} urgent` : 'No urgent tickets'}
          tone={d.urgentTickets ? 'warn' : undefined}
        />
        <StatCard
          to="/logs/emails"
          icon={MailWarning}
          label="Failed emails · 24h"
          value={d.emailsFailed24h}
          sub={`${d.totalMembers} members platform-wide`}
          tone={d.emailsFailed24h ? 'bad' : undefined}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {can('support.view') && (
            <Panel
              title="Support queue"
              description="Open and pending tickets, most recently updated first"
              actions={<SeeAll to="/support" />}
              flush
            >
              <Table
                head={['Ticket', 'Organisation', 'Priority', 'Status', 'Updated']}
                empty="No open tickets. Nice."
              >
                {d.recentTickets.map((t) => (
                  <tr key={t.id} className="hover:bg-zinc-50">
                    <Td>
                      <Link
                        to="/support/$ticketId"
                        params={{ ticketId: t.id }}
                        className="font-medium hover:text-accent-700"
                      >
                        <span className="mr-2 font-mono text-xs text-zinc-500">#{t.number}</span>
                        {t.subject}
                      </Link>
                    </Td>
                    <Td className="text-zinc-600">{t.tenantName}</Td>
                    <Td>
                      <Status value={t.priority} />
                    </Td>
                    <Td>
                      <Status value={t.status} />
                    </Td>
                    <Td className="whitespace-nowrap text-zinc-500">{relTime(t.updatedAt)}</Td>
                  </tr>
                ))}
              </Table>
            </Panel>
          )}
          <Panel
            title="Awaiting payment"
            description="Organisations created but not yet paid or trialing"
            flush
          >
            <Table
              head={['Organisation', 'Created', '']}
              empty="No organisations are waiting on payment."
            >
              {d.awaitingPayment.map((a) => (
                <tr key={a.id} className="hover:bg-zinc-50">
                  <Td>
                    <span className="flex items-center gap-3 font-medium">
                      <Avatar name={a.name} className="size-8 text-xs" />
                      {a.name}
                    </span>
                  </Td>
                  <Td className="text-zinc-500">{relTime(a.since)}</Td>
                  <Td className="text-right">
                    {can('tenants.view') && (
                      <Link
                        to="/tenants/$tenantId"
                        params={{ tenantId: a.id }}
                        className="text-sm font-medium text-accent-700 hover:underline"
                      >
                        Open →
                      </Link>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>

        {can('logs.system') && (
          <Panel title="Recent activity" actions={<SeeAll to="/logs/system" />}>
            <ActivityList entries={d.recentActivity} showTenant />
          </Panel>
        )}
      </div>
    </>
  );
}

function SeeAll({ to }: { to: '/support' | '/logs/system' }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-xs font-medium text-accent-700 hover:underline"
    >
      View all <ArrowRight className="size-3.5" />
    </Link>
  );
}
