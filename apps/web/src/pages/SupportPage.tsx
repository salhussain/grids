import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, LifeBuoy, Plus } from 'lucide-react';
import { useState } from 'react';
import {
  Button,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
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
  Textarea,
  cx,
  humanize,
  relTime,
  useLiveInterval,
  usePagination,
  useToast,
} from '@grids/ui';
import { api } from '../api';
import { ticketRoute } from '../router';
import { NoAccess, useCan, useWorkspace } from '../session';
import { useT } from '../i18n';

export function SupportPage() {
  const t = useT();
  const ws = useWorkspace();
  const can = useCan();
  const navigate = useNavigate();
  const live = useLiveInterval();
  const id = ws.tenant.id;
  const [status, setStatus] = useState<'active' | 'resolved' | 'all'>('active');
  const [page, setPage] = usePagination([status], 10);
  const [open, setOpen] = useState(false);
  const query = { status: status === 'all' ? undefined : status, ...page };
  const tickets = useQuery({
    queryKey: ['tickets', id, query],
    queryFn: () => api.tickets(id, query),
    placeholderData: keepPreviousData,
    refetchInterval: live,
    enabled: can('support.view'),
  });
  if (!can('support.view')) return <NoAccess what="support" />;
  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.help')}
        title={t('web.nav.support')}
        meta={<span>Questions or problems? The Grids team replies here and by email.</span>}
        actions={
          <>
            <RefreshControl queryKeys={[['tickets', id]]} />
            {can('support.create') && (
              <Button icon={Plus} onClick={() => setOpen(true)}>
                New ticket
              </Button>
            )}
          </>
        }
      />
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { id: 'active', label: 'Open' },
          { id: 'resolved', label: 'Resolved' },
          { id: 'all', label: 'All' },
        ]}
      />
      <Panel flush>
        {tickets.isPending ? (
          <Loading />
        ) : !tickets.data?.total ? (
          <Empty
            icon={LifeBuoy}
            title="No tickets"
            action={
              can('support.create') && (
                <Button icon={Plus} onClick={() => setOpen(true)}>
                  New ticket
                </Button>
              )
            }
          >
            Raise a ticket and the Grids team will help.
          </Empty>
        ) : (
          <>
            <Table head={['Ticket', 'Category', 'Priority', 'Status', 'Raised by', 'Updated']}>
              {tickets.data.items.map((t) => (
                <tr
                  key={t.id}
                  className="cursor-pointer hover:bg-zinc-50"
                  onClick={() =>
                    navigate({
                      to: '/o/$tenantId/support/$ticketId',
                      params: { tenantId: id, ticketId: t.id },
                    })
                  }
                >
                  <Td>
                    <Link
                      to="/o/$tenantId/support/$ticketId"
                      params={{ tenantId: id, ticketId: t.id }}
                      className="font-medium hover:text-accent-700"
                    >
                      <span className="mr-2 font-mono text-xs text-zinc-500">#{t.number}</span>
                      {t.subject}
                    </Link>
                  </Td>
                  <Td className="text-zinc-600">{humanize(t.category)}</Td>
                  <Td>
                    <Status value={t.priority} />
                  </Td>
                  <Td>
                    <Status
                      value={t.status}
                      label={t.status === 'pending' ? 'awaiting you' : undefined}
                    />
                  </Td>
                  <Td className="text-zinc-600">{t.createdBy.name}</Td>
                  <Td className="whitespace-nowrap text-zinc-500">{relTime(t.updatedAt)}</Td>
                </tr>
              ))}
            </Table>
            <Pagination
              {...page}
              total={tickets.data.total}
              onChange={setPage}
              sizes={[10, 25, 50]}
            />
          </>
        )}
      </Panel>
      <NewTicket open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function NewTicket({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [v, setV] = useState({ subject: '', category: 'question', priority: 'normal', body: '' });
  const create = useMutation({
    mutationFn: () => api.createTicket(ws.tenant.id, v as never),
    onSuccess: async (t) => {
      await qc.invalidateQueries({ queryKey: ['tickets', ws.tenant.id] });
      toast(`Ticket #${t.number} raised`);
      onClose();
      setV({ subject: '', category: 'question', priority: 'normal', body: '' });
      void navigate({
        to: '/o/$tenantId/support/$ticketId',
        params: { tenantId: ws.tenant.id, ticketId: t.id },
      });
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New support ticket"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            Submit
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Subject" required>
          <Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category">
            <Select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
              {['question', 'bug', 'billing', 'feature_request', 'account', 'other'].map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>
              {['low', 'normal', 'high', 'urgent'].map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Describe the issue" required>
          <Textarea
            rows={6}
            value={v.body}
            onChange={(e) => setV({ ...v, body: e.target.value })}
          />
        </Field>
        <ErrorNotice error={create.error} />
      </div>
    </Dialog>
  );
}

export function TicketPage() {
  const { ticketId, tenantId } = ticketRoute.useParams();
  const can = useCan();
  const qc = useQueryClient();
  const live = useLiveInterval();
  const ticket = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => api.ticket(ticketId),
    refetchInterval: live,
  });
  const [body, setBody] = useState('');
  const reply = useMutation({
    mutationFn: () => api.replyTicket(ticketId, body),
    onSuccess: (t) => (
      qc.setQueryData(['ticket', ticketId], t),
      setBody(''),
      void qc.invalidateQueries({ queryKey: ['tickets', tenantId] })
    ),
  });
  if (ticket.isPending) return <Loading />;
  if (ticket.isError) return <ErrorNotice error={ticket.error} />;
  const t = ticket.data;
  return (
    <>
      <Link
        to="/o/$tenantId/support"
        params={{ tenantId }}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Support
      </Link>
      <PageHeader
        eyebrow={<span className="font-mono">#{t.number}</span>}
        title={t.subject}
        meta={
          <>
            <Status value={t.status} label={t.status === 'pending' ? 'awaiting you' : undefined} />
            <Status value={t.priority} />
            <span>
              Opened {relTime(t.createdAt)} by {t.createdBy.name}
            </span>
          </>
        }
      />
      <div className="max-w-3xl space-y-4">
        {t.messages.map((m) => (
          <article
            key={m.id}
            className={cx(
              'border bg-snow',
              m.author.isStaff
                ? 'border-s-4 border-zinc-200 border-s-accent-600'
                : 'border-zinc-200',
            )}
          >
            <header className="flex items-center justify-between border-b border-zinc-100 px-5 py-2.5 text-sm">
              <span>
                <span className="font-medium">{m.author.name}</span>{' '}
                <span className="text-xs text-zinc-500">
                  {m.author.isStaff ? 'Grids support' : ''}
                </span>
              </span>
              <time className="text-xs text-zinc-500">{relTime(m.createdAt)}</time>
            </header>
            <div className="px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap">{m.body}</div>
          </article>
        ))}
        {can('support.create') && t.status !== 'closed' && (
          <Panel title="Reply">
            <Field label="Message">
              <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <div className="mt-3 flex justify-end">
              <Button
                onClick={() => reply.mutate()}
                loading={reply.isPending}
                disabled={!body.trim()}
              >
                Send reply
              </Button>
            </div>
            <ErrorNotice error={reply.error} />
          </Panel>
        )}
      </div>
    </>
  );
}
