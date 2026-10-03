import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, Building2, LifeBuoy, Plus } from 'lucide-react';
import type { TicketDetail } from '@grids/schema';
import { useState } from 'react';
import {
  Button,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
  Input,
  Listbox,
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
  const [audience, setAudience] = useState<'all' | 'organisation' | 'platform'>('all');
  const [page, setPage] = usePagination([status, audience], 10);
  const [open, setOpen] = useState(false);
  const query = { status: status === 'all' ? undefined : status, audience: audience === 'all' ? undefined : audience, ...page };
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
        meta={<span>Internal tickets are handled by your organisation’s admins; they can escalate them to the Grids team.</span>}
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { id: 'active', label: 'Open' },
            { id: 'resolved', label: 'Resolved' },
            { id: 'all', label: 'All' },
          ]}
        />
        <Listbox
          compact
          align="end"
          label="With"
          className="mb-3 w-56"
          value={audience}
          onChange={(v) => setAudience(v as typeof audience)}
          options={[
            { value: 'all', label: 'All tickets' },
            { value: 'organisation', label: 'Within the organisation' },
            { value: 'platform', label: 'With the Grids team' },
          ]}
        />
      </div>
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
            <Table head={['Ticket', 'With', 'Category', 'Priority', 'Status', 'Raised by', 'Updated']}>
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
                  <Td>
                    <AudienceBadge audience={t.audience} escalated={!!t.escalatedAt} />
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
  const [escalating, setEscalating] = useState(false);
  const [note, setNote] = useState('');
  const updated = (d: TicketDetail) => {
    qc.setQueryData(['ticket', ticketId], d);
    void qc.invalidateQueries({ queryKey: ['tickets', tenantId] });
  };
  const setStatus = useMutation({ mutationFn: (status: TicketDetail['status']) => api.updateOrgTicket(tenantId, ticketId, status), onSuccess: updated });
  const escalate = useMutation({
    mutationFn: () => api.escalateTicket(tenantId, ticketId, note || undefined),
    onSuccess: (d) => {
      updated(d);
      setEscalating(false);
    },
  });
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
            <AudienceBadge audience={t.audience} escalated={!!t.escalatedAt} />
            <Status value={t.status} label={t.status === 'pending' ? 'awaiting you' : undefined} />
            <Status value={t.priority} />
            <span>
              Opened {relTime(t.createdAt)} by {t.createdBy.name}
            </span>
          </>
        }
        actions={
          t.audience === 'organisation' && can('support.manage') ? (
            <>
              <Listbox
                compact
                align="end"
                label="Status"
                className="w-36"
                value={t.status}
                onChange={(v) => setStatus.mutate(v)}
                options={(['open', 'pending', 'resolved', 'closed'] as const).map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }))}
              />
              <Button variant="secondary" icon={ArrowUpRight} onClick={() => setEscalating(true)}>
                Escalate to Grids
              </Button>
            </>
          ) : undefined
        }
      />
      <ErrorNotice error={setStatus.error ?? escalate.error} />
      {escalating && (
        <Dialog
          open
          onClose={() => setEscalating(false)}
          title="Escalate to the Grids team"
          description="The platform team sees the whole conversation and replies here."
          footer={
            <>
              <Button variant="secondary" onClick={() => setEscalating(false)}>
                Cancel
              </Button>
              <Button onClick={() => escalate.mutate()} loading={escalate.isPending}>
                Escalate
              </Button>
            </>
          }
        >
          <Field label="Note for the Grids team (optional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </Dialog>
      )}
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
                  {m.author.isStaff ? 'Grids support' : m.author.id !== t.createdBy.id && t.audience === 'organisation' ? 'Organisation support' : ''}
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

export function AudienceBadge({ audience, escalated }: { audience: 'organisation' | 'platform'; escalated?: boolean }) {
  return audience === 'organisation' ? (
    <span className="inline-flex items-center gap-1 border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-700">
      <Building2 className="size-3" /> Organisation
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 border border-accent-600/40 bg-accent-50 px-1.5 py-0.5 text-xs text-accent-800">
      <LifeBuoy className="size-3" /> Grids team{escalated ? ' · escalated' : ''}
    </span>
  );
}
