import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { TenantDetail } from '@grids/schema';
import {
  Button,
  Pagination,
  Panel,
  Status,
  Table,
  Td,
  humanize,
  relTime,
  usePagination,
} from '@grids/ui';
import { api } from '../../api';
import { useCan } from '../../session';
import { NewTicketDialog } from '../dialogs';

export function SupportTab({ t }: { t: TenantDetail }) {
  const navigate = useNavigate();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [page, setPage] = usePagination([], 10);
  const query = { tenantId: t.id, ...page };
  const tickets = useQuery({
    queryKey: ['tickets', query],
    queryFn: () => api.tickets(query),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <Panel
        flush
        title="Support tickets"
        description="Raised by this organisation’s users, or opened by staff on their behalf"
        actions={
          can('support.create') && (
            <Button icon={Plus} onClick={() => setOpen(true)}>
              New ticket
            </Button>
          )
        }
      >
        <Table
          head={['Ticket', 'Category', 'Priority', 'Status', 'Raised by', 'Updated']}
          empty="No tickets from this organisation."
        >
          {tickets.data?.items.map((tk) => (
            <tr
              key={tk.id}
              className="cursor-pointer hover:bg-zinc-50"
              onClick={() => navigate({ to: '/support/$ticketId', params: { ticketId: tk.id } })}
            >
              <Td>
                <Link
                  to="/support/$ticketId"
                  params={{ ticketId: tk.id }}
                  className="font-medium hover:text-accent-700"
                >
                  <span className="mr-2 font-mono text-xs text-zinc-500">#{tk.number}</span>
                  {tk.subject}
                </Link>
              </Td>
              <Td className="text-zinc-600">{humanize(tk.category)}</Td>
              <Td>
                <Status value={tk.priority} />
              </Td>
              <Td>
                <Status value={tk.status} />
              </Td>
              <Td className="text-zinc-600">{tk.createdBy.name}</Td>
              <Td className="whitespace-nowrap text-zinc-500">{relTime(tk.updatedAt)}</Td>
            </tr>
          ))}
        </Table>
        {tickets.data && (
          <Pagination
            {...page}
            total={tickets.data.total}
            onChange={setPage}
            sizes={[10, 25, 50]}
          />
        )}
      </Panel>
      <NewTicketDialog
        open={open}
        onClose={() => setOpen(false)}
        tenantId={t.id}
        onCreated={(id) => navigate({ to: '/support/$ticketId', params: { ticketId: id } })}
      />
    </>
  );
}
