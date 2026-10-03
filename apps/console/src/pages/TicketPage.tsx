import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Lock } from 'lucide-react';
import { useState } from 'react';
import type { TicketDetail } from '@grids/schema';
import { api } from '../api';
import { ticketRoute } from '../router';
import { useCan } from '../session';
import {
  Button,
  ErrorNotice,
  Field,
  KeyValues,
  Loading,
  PageHeader,
  Panel,
  Select,
  Status,
  Switch,
  Textarea,
  cx,
  useToast,
} from '@grids/ui';
import { useLiveInterval } from '@grids/ui';
import { dateTime, humanize, relTime } from '@grids/ui';

export function TicketPage() {
  const { ticketId } = ticketRoute.useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const live = useLiveInterval();
  const ticket = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => api.ticket(ticketId),
    refetchInterval: live,
  });
  const staff = useQuery({ queryKey: ['staff'], queryFn: api.staff });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);

  const onTicket = (t: TicketDetail) => {
    qc.setQueryData(['ticket', ticketId], t);
    void qc.invalidateQueries({ queryKey: ['tickets'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
  };
  const reply = useMutation({
    mutationFn: () => api.replyTicket(ticketId, { body, internal }),
    onSuccess: (t) => {
      onTicket(t);
      setBody('');
      toast(internal ? 'Internal note added' : 'Reply sent to the customer');
    },
  });
  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.updateTicket>[1]) =>
      api.updateTicket(ticketId, input),
    onSuccess: onTicket,
  });

  if (ticket.isPending) return <Loading />;
  if (ticket.isError) return <ErrorNotice error={ticket.error} />;
  const t = ticket.data;

  return (
    <>
      <Link
        to="/support"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Support
      </Link>
      <PageHeader
        eyebrow={<span className="font-mono">#{t.number}</span>}
        title={t.subject}
        meta={
          <>
            <Status value={t.status} />
            <Status value={t.priority} />
            <Link
              to="/tenants/$tenantId"
              params={{ tenantId: t.tenantId }}
              className="text-accent-700 hover:underline"
            >
              {t.tenantName}
            </Link>
            <span>
              Opened {relTime(t.createdAt)} by {t.createdBy.name}
            </span>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {t.messages.map((m) => (
            <article
              key={m.id}
              className={cx(
                'border bg-snow',
                m.internal
                  ? 'border-amber-300 bg-amber-50'
                  : m.author.isStaff
                    ? 'border-l-4 border-zinc-200 border-l-accent-600'
                    : 'border-zinc-200',
              )}
            >
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200/70 px-5 py-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.author.name}</span>
                  <span className="text-xs text-zinc-500">
                    {m.author.isStaff ? 'Grids staff' : t.tenantName}
                  </span>
                  {m.internal && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800">
                      <Lock className="size-3" /> Internal note
                    </span>
                  )}
                </div>
                <time className="text-xs text-zinc-500" title={dateTime(m.createdAt)}>
                  {relTime(m.createdAt)}
                </time>
              </header>
              <div className="px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap">{m.body}</div>
            </article>
          ))}

          {can('support.reply') && (
            <Panel
              title={internal ? 'Internal note (staff only)' : 'Reply to customer'}
              className={internal ? 'border-amber-300' : ''}
            >
              <Field label={internal ? 'Note' : 'Message'}>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={5}
                  placeholder={
                    internal
                      ? 'Only platform staff can see this.'
                      : 'The customer is emailed this reply.'
                  }
                />
              </Field>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2.5 text-sm">
                  <Switch label="Internal note" checked={internal} onChange={setInternal} />{' '}
                  Internal note
                </label>
                <Button
                  onClick={() => reply.mutate()}
                  loading={reply.isPending}
                  disabled={!body.trim()}
                >
                  {internal ? 'Add note' : 'Send reply'}
                </Button>
              </div>
              <div className="mt-3">
                <ErrorNotice error={reply.error} />
              </div>
            </Panel>
          )}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-8 xl:self-start">
          {can('support.triage') && (
            <Panel title="Triage">
              <div className="space-y-4">
                <Field label="Status">
                  <Select
                    value={t.status}
                    onChange={(e) =>
                      update.mutate({ status: e.target.value as TicketDetail['status'] })
                    }
                  >
                    {['open', 'pending', 'resolved', 'closed'].map((s) => (
                      <option key={s} value={s}>
                        {humanize(s)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select
                    value={t.priority}
                    onChange={(e) =>
                      update.mutate({ priority: e.target.value as TicketDetail['priority'] })
                    }
                  >
                    {['low', 'normal', 'high', 'urgent'].map((s) => (
                      <option key={s} value={s}>
                        {humanize(s)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Assignee">
                  <Select
                    value={t.assignee?.id ?? ''}
                    onChange={(e) => update.mutate({ assigneeId: e.target.value || null })}
                  >
                    <option value="">Unassigned</option>
                    {staff.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <ErrorNotice error={update.error} />
              </div>
            </Panel>
          )}
          <Panel title="Details">
            <KeyValues
              items={[
                ['Category', humanize(t.category)],
                ['Requester', t.createdBy.email ?? t.createdBy.name],
                ['Messages', t.messages.length],
                ['Created', dateTime(t.createdAt)],
                ['Updated', dateTime(t.updatedAt)],
              ]}
            />
          </Panel>
        </aside>
      </div>
    </>
  );
}
