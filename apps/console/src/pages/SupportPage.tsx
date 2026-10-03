import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { LifeBuoy, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import {
  Button,
  Empty,
  ErrorNotice,
  Input,
  Loading,
  PageHeader,
  Pagination,
  Panel,
  RefreshControl,
  Select,
  Status,
  Table,
  Tabs,
  Td,
  humanize,
  relTime,
  useLiveInterval,
  usePagination,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan } from '../session';
import { NewTicketDialog } from './dialogs';

type Filter = 'active' | 'open' | 'pending' | 'resolved' | 'closed' | 'all';

export function SupportPage() {
  const navigate = useNavigate();
  const can = useCan();
  const live = useLiveInterval();
  const [status, setStatus] = useState<Filter>('active');
  const [priority, setPriority] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [page, setPage] = usePagination([status, priority, q]);
  const query = {
    status: status === 'all' ? undefined : status,
    priority: priority || undefined,
    q: q || undefined,
    ...page,
  };
  const tickets = useQuery({
    queryKey: ['tickets', query],
    queryFn: () => api.tickets(query),
    placeholderData: keepPreviousData,
    refetchInterval: live,
    enabled: can('support.view'),
  });
  if (!can('support.view')) return <NoAccess what="support" />;
  const d = tickets.data;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Support"
        meta={
          <span>
            Issues raised by organisations. Staff replies set the ticket to pending; customer
            replies reopen it.
          </span>
        }
        actions={
          <>
            <RefreshControl queryKeys={[['tickets']]} />
            {can('support.create') && (
              <Button icon={Plus} onClick={() => setOpen(true)}>
                New ticket
              </Button>
            )}
          </>
        }
      />
      <Tabs<Filter>
        value={status}
        onChange={setStatus}
        tabs={[
          { id: 'active', label: 'Needs attention' },
          { id: 'open', label: 'Open' },
          { id: 'pending', label: 'Pending customer' },
          { id: 'resolved', label: 'Resolved' },
          { id: 'closed', label: 'Closed' },
          { id: 'all', label: 'All' },
        ]}
      />
      <Panel
        flush
        title={`${d?.total ?? '–'} tickets`}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-zinc-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Subject or #number"
                className="w-56 pl-8"
                aria-label="Search tickets"
              />
            </div>
            <Select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              aria-label="Priority"
              className="w-36"
            >
              <option value="">Any priority</option>
              {['urgent', 'high', 'normal', 'low'].map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </Select>
          </>
        }
      >
        <ErrorNotice error={tickets.error} />
        {tickets.isPending ? (
          <Loading />
        ) : !d?.total ? (
          <Empty icon={LifeBuoy} title="No tickets here">
            Tickets raised by organisations appear in this queue.
          </Empty>
        ) : (
          <>
            <Table
              head={[
                'Ticket',
                'Organisation',
                'Category',
                'Priority',
                'Status',
                'Assignee',
                'Messages',
                'Updated',
              ]}
            >
              {d.items.map((t) => (
                <tr
                  key={t.id}
                  className="cursor-pointer hover:bg-zinc-50"
                  onClick={() => navigate({ to: '/support/$ticketId', params: { ticketId: t.id } })}
                >
                  <Td>
                    <Link
                      to="/support/$ticketId"
                      params={{ ticketId: t.id }}
                      className="font-medium hover:text-accent-700"
                    >
                      <span className="mr-2 font-mono text-xs text-zinc-500">#{t.number}</span>
                      {t.subject}
                    </Link>
                    <div className="text-xs text-zinc-500">by {t.createdBy.name}</div>
                  </Td>
                  <Td className="text-zinc-600">{t.tenantName}</Td>
                  <Td className="text-zinc-600">{humanize(t.category)}</Td>
                  <Td>
                    <Status value={t.priority} />
                  </Td>
                  <Td>
                    <Status value={t.status} />
                  </Td>
                  <Td className="text-zinc-600">
                    {t.assignee?.name ?? <span className="text-zinc-400">Unassigned</span>}
                  </Td>
                  <Td className="num text-right">{t.messageCount}</Td>
                  <Td className="whitespace-nowrap text-zinc-500">{relTime(t.updatedAt)}</Td>
                </tr>
              ))}
            </Table>
            <Pagination {...page} total={d.total} onChange={setPage} />
          </>
        )}
      </Panel>
      <NewTicketDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={(id) => navigate({ to: '/support/$ticketId', params: { ticketId: id } })}
      />
    </>
  );
}
