import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { OrgTicketUpdate, TicketDetail } from '@grids/schema';
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Listbox,
  Loading,
  Textarea,
  cx,
  relTime,
  useLiveInterval,
  useToast,
} from '@grids/ui';
import { RichEditor, ting } from '@grids/viz';
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Check,
  Copy,
  FileText,
  Globe2,
  LifeBuoy,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  StickyNote,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { ticketRoute } from '../../router';
import { useMe, useCan, useWorkspace } from '../../session';
import { Relations, SubIssues } from './Links';
import { TicketMenu } from './TicketMenu';
import { Overview, Timeline } from './Timeline';
import {
  Avatar,
  KIND_TEXT,
  LabelChip,
  fillReply,
  PRIORITY_LABEL,
  PriorityIcon,
  StageDot,
  dotIcon,
  labelsOf,
  priorityIcon,
  stageIcon,
  useDesk,
  useHandlers,
} from './shared';

/** Reply to the person, or leave a note for the team, with files and ready-made replies. */
function Composer({
  t,
  canNote,
  canClose,
  onSent,
}: {
  t: TicketDetail;
  canNote: boolean;
  canClose: boolean;
  onSent(d: TicketDetail): void;
}) {
  const { tenantId } = ticketRoute.useParams();
  const toast = useToast();
  const desk = useDesk(tenantId);
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  // "Send and resolve": the reply goes, then the ticket moves to the organisation's first finished stage.
  const send = useMutation({
    mutationFn: async (resolve?: boolean) => {
      const sent = await api.replyTicket(t.id, {
        body,
        internal: mode === 'note',
        attachments: mode === 'note' ? [] : files.map((f) => f.id),
      });
      const done = desk.data?.stages.find((s) => s.kind === 'done');
      return resolve && done ? api.updateOrgTicket(tenantId, t.id, { stage: done.key }) : sent;
    },
    onSuccess: (d) => {
      onSent(d);
      setBody('');
      setFiles([]);
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'It could not be sent'),
  });
  const ready = (body.trim() || files.length) && !send.isPending && !busy;
  const person = t.createdBy.name;
  const ws = useWorkspace();
  const meNow = useMe();
  const meName = meNow.displayName ?? meNow.email ?? '';
  // In a chat, the person sees "is typing…" while the team writes a reply (told again every few seconds, and when it stops).
  const typing = t.channel === 'help' && mode === 'reply' && !!body.trim();
  useEffect(() => {
    if (!typing) return;
    void api.agentTyping(tenantId, t.id, true).catch(() => undefined);
    const again = setInterval(
      () => void api.agentTyping(tenantId, t.id, true).catch(() => undefined),
      3_000,
    );
    return () => {
      clearInterval(again);
      void api.agentTyping(tenantId, t.id, false).catch(() => undefined);
    };
  }, [typing, tenantId, t.id]);
  return (
    <form
      className={cx(
        'border',
        mode === 'note' ? 'border-accent-600/40 bg-accent-50' : 'border-zinc-300 bg-snow',
      )}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) send.mutate(false);
      }}
    >
      <div className="flex items-center gap-1 border-b border-black/5 px-2 pt-1.5">
        <button
          type="button"
          onClick={() => setMode('reply')}
          className={cx(
            'inline-flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-sm',
            mode === 'reply'
              ? 'border-accent-600 font-medium text-ink'
              : 'border-transparent text-zinc-500 hover:text-ink',
          )}
        >
          <MessageSquare className="size-4" />{' '}
          {t.channel === 'help' ? `Reply to ${person}` : 'Reply'}
        </button>
        {canNote && (
          <button
            type="button"
            onClick={() => setMode('note')}
            className={cx(
              'inline-flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-sm',
              mode === 'note'
                ? 'border-accent-600 font-medium text-accent-800'
                : 'border-transparent text-zinc-500 hover:text-ink',
            )}
          >
            <StickyNote className="size-4" /> Internal note
          </button>
        )}
        {canNote && (desk.data?.replies.length ?? 0) > 0 && mode === 'reply' && (
          <Listbox
            searchable
            label="Insert a ready-made reply"
            value={null}
            align="end"
            trigger={{
              className:
                'ms-auto inline-flex h-7 items-center gap-1.5 px-2 text-xs font-medium text-accent-700 hover:bg-accent-50',
              children: (
                <>
                  <Zap className="size-3.5" /> Ready-made reply
                </>
              ),
            }}
            options={(desk.data?.replies ?? []).map((r) => ({
              value: r.id,
              label: r.title,
              description: r.body.slice(0, 80),
            }))}
            onChange={(id) =>
              setBody(
                (cur) =>
                  `${cur}${cur && !cur.endsWith('\n') ? '\n\n' : ''}${fillReply(desk.data?.replies.find((r) => r.id === id)?.body ?? '', { person: { name: person, email: t.createdBy.email, phone: t.requesterPhone }, ticket: { number: t.number, subject: t.subject, project: t.sourceProject, stage: t.stage?.label ?? '', priority: PRIORITY_LABEL[t.priority] }, agent: meName, organisation: ws.tenant.name })}`,
              )
            }
          />
        )}
      </div>
      <RichEditor
        label={mode === 'note' ? 'Internal note' : 'Reply'}
        tone={mode === 'note' ? 'note' : 'plain'}
        placeholder={
          mode === 'note'
            ? 'Write a note only your team will see'
            : t.channel === 'help'
              ? `Write to ${person}. They get it by email and in the chat`
              : 'Write a reply'
        }
        value={body}
        onChange={setBody}
        minRows={5}
        onSubmit={() => ready && send.mutate(false)}
        onAttach={mode === 'reply' ? () => pick.current?.click() : undefined}
        onMedia={async (file) => {
          const up = await api.uploadSupportFile(tenantId, file, file.name);
          setFiles((cur) => [...cur, { id: up.id, name: up.name }]);
          return { id: up.id, name: up.name };
        }}
      />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-3 pb-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-1.5 bg-zinc-100 py-1 ps-2 pe-1 text-xs">
              <FileText className="size-3.5 text-zinc-500" /> {f.name}
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles(files.filter((x) => x.id !== f.id))}
                className="p-0.5 text-zinc-500 hover:text-ink"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-black/5 px-3 py-2">
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <input
            ref={pick}
            type="file"
            multiple
            hidden
            onChange={async (e) => {
              const list = [...(e.target.files ?? [])].slice(0, 5 - files.length);
              e.target.value = '';
              setBusy(true);
              try {
                for (const f of list) {
                  const up = await api.uploadSupportFile(tenantId, f, f.name);
                  setFiles((cur) => [...cur, { id: up.id, name: up.name }]);
                }
              } catch (err) {
                toast(err instanceof Error ? err.message : 'The file could not be attached');
              } finally {
                setBusy(false);
              }
            }}
          />
          {mode === 'reply' && (
            <button
              type="button"
              onClick={() => pick.current?.click()}
              disabled={busy || files.length >= 5}
              className="inline-flex items-center gap-1 hover:text-ink disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Paperclip className="size-4" />
              )}{' '}
              Attach
            </button>
          )}
          <span className="hidden sm:inline">
            {mode === 'note'
              ? 'Only your team sees this'
              : t.channel === 'help'
                ? 'Sent to their email too'
                : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {canClose && mode === 'reply' && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={Check}
              disabled={!ready}
              onClick={() => send.mutate(true)}
            >
              Send and resolve
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            icon={Send}
            loading={send.isPending}
            disabled={!ready}
            className={mode === 'note' ? 'bg-accent-700! hover:bg-accent-800!' : undefined}
          >
            {mode === 'note' ? 'Add note' : 'Send reply'}{' '}
            <kbd className="ms-1 hidden text-[10px] opacity-70 sm:inline">⌘↵</kbd>
          </Button>
        </div>
      </div>
    </form>
  );
}

const row =
  'flex h-9 w-full items-center gap-3 px-2 text-start text-[15px] hover:bg-zinc-100 disabled:cursor-default disabled:hover:bg-transparent';

/** The ticket: the conversation in the middle, its properties (stage, priority, person, labels) at the side. */
export function TicketPage() {
  const { ticketId, tenantId } = ticketRoute.useParams();
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const live = useLiveInterval();
  const desk = useDesk(tenantId);
  const manager = can('support.manage');
  const handlers = useHandlers(tenantId, manager);
  const ticket = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => api.ticket(ticketId),
    // A chat from the help window: look for the person's next message every few seconds.
    refetchInterval: (q) =>
      q.state.data?.channel === 'help' && q.state.data.stage?.kind !== 'done' ? 2_000 : live,
  });
  const [escalating, setEscalating] = useState(false);
  const [note, setNote] = useState('');
  const end = useRef<HTMLDivElement>(null);
  // In a chat, a new message from the person makes a sound for the team (not when the page first loads).
  const heard = useRef<number | null>(null);
  useEffect(() => {
    const msgs = ticket.data?.messages;
    if (!msgs || ticket.data?.channel !== 'help') return;
    const theirs = msgs.filter((m) => m.kind === 'requester').length;
    if (heard.current !== null && theirs > heard.current) ting();
    heard.current = theirs;
  }, [ticket.data]);
  const updated = (d: TicketDetail) => {
    qc.setQueryData(['ticket', ticketId], d);
    void qc.invalidateQueries({ queryKey: ['tickets', tenantId] });
  };
  const patch = useMutation({
    mutationFn: (p: OrgTicketUpdate) => api.updateOrgTicket(tenantId, ticketId, p),
    onSuccess: updated,
    onError: (e) => toast(e instanceof Error ? e.message : 'It could not be changed'),
  });
  const escalate = useMutation({
    mutationFn: () => api.escalateTicket(tenantId, ticketId, note || undefined),
    onSuccess: (d) => (updated(d), setEscalating(false)),
  });
  const count = ticket.data?.messages.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count]);
  if (ticket.isPending) return <Loading />;
  if (ticket.isError) return <ErrorNotice error={ticket.error} />;
  const t = ticket.data;
  const mine = t.audience === 'organisation';
  const editable = mine && manager;
  const done = t.stage?.kind === 'done';
  const stages = desk.data?.stages ?? [];
  const labels = labelsOf(desk.data, t.labels);
  return (
    <div className="-mt-2">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-sm text-zinc-500">
        <Link
          to="/o/$tenantId/support"
          params={{ tenantId }}
          className="inline-flex items-center gap-1.5 hover:text-ink"
        >
          <ArrowLeft className="size-4" /> Support
        </Link>
        <span aria-hidden>/</span>
        <span className="font-mono text-zinc-700">#{t.number}</span>
        <span className="ms-auto flex items-center gap-2">
          <TicketMenu tenantId={tenantId} t={t} editable={editable} onChange={updated} />
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(window.location.href)
                .then(() => toast('Link copied'))
            }
            className="inline-flex h-7 items-center justify-center gap-1.5 border border-zinc-300 bg-snow px-2.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
          >
            <Copy className="size-3.5" /> Copy link
          </button>
          {editable &&
            (done ? (
              <Button
                size="sm"
                variant="secondary"
                icon={RotateCcw}
                loading={patch.isPending}
                onClick={() =>
                  patch.mutate({
                    stage: stages.find((s) => s.kind === 'active')?.key ?? stages[0]?.key,
                  })
                }
              >
                Reopen
              </Button>
            ) : (
              <Button
                size="sm"
                icon={Check}
                loading={patch.isPending}
                onClick={() => patch.mutate({ stage: stages.find((s) => s.kind === 'done')?.key })}
              >
                Mark resolved
              </Button>
            ))}
        </span>
      </nav>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        {/* The conversation */}
        <div className="min-w-0 space-y-4">
          <header className="border-b border-zinc-200 pb-4">
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{t.subject}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-zinc-600">
              <span className="inline-flex items-center gap-1.5 text-sm text-zinc-800">
                <StageDot kind={t.stage?.kind ?? 'open'} stageKey={t.stage?.key} />{' '}
                {t.stage?.label ?? 'With Grids'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <PriorityIcon priority={t.priority} /> {PRIORITY_LABEL[t.priority]}
              </span>
              <span className="inline-flex items-center gap-1.5">
                {t.assignee ? (
                  <>
                    <Avatar name={t.assignee.name} size={18} /> {t.assignee.name}
                  </>
                ) : (
                  <span className="text-zinc-400">Unassigned</span>
                )}
              </span>
              <span className="ms-auto text-xs text-zinc-400">Opened {relTime(t.createdAt)}</span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 empty:hidden">
              {labels.map((l) => (
                <LabelChip key={l.key} label={l} />
              ))}
              {t.channel === 'help' && (
                <span className="inline-flex items-center gap-1 bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-sky-200">
                  <Globe2 className="size-3" /> Help window
                  {t.sourceProject ? ` · ${t.sourceProject}` : ''}
                </span>
              )}
              {t.audience === 'platform' && (
                <span className="inline-flex items-center gap-1 bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-800 ring-1 ring-violet-200">
                  <Building2 className="size-3" /> With the Grids team
                  {t.escalatedAt ? ` since ${relTime(t.escalatedAt)}` : ''}
                </span>
              )}
            </div>
          </header>
          <ErrorNotice error={patch.error ?? escalate.error} />
          <Overview t={t} me={me.id} team={editable} onChange={updated} />
          <SubIssues
            tenantId={tenantId}
            t={t}
            editable={editable && t.audience === 'organisation'}
            onChange={updated}
          />
          <h2 className="pt-2 text-sm font-medium text-zinc-500">Activity</h2>
          <Timeline t={t} me={me.id} team={editable} onChange={updated} />
          {t.visitorTyping && (
            <div className="flex items-start gap-3 ps-0.5 opacity-70" aria-live="polite">
              <Avatar name={t.visitorTyping.name} size={22} />
              <div className="min-w-0 flex-1 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-xs text-zinc-500">
                  {t.visitorTyping.name} is typing
                  <span className="inline-flex gap-0.5">
                    {[0, 150, 300].map((d) => (
                      <i
                        key={d}
                        className="size-1 animate-bounce rounded-full bg-zinc-400"
                        style={{ animationDelay: `${d}ms` }}
                      />
                    ))}
                  </span>
                </div>
                <p
                  className="text-sm break-words whitespace-pre-wrap text-zinc-500 select-none"
                  aria-disabled
                >
                  {t.visitorTyping.text}
                </p>
              </div>
            </div>
          )}
          <div ref={end} />
          {can('support.create') && t.status !== 'closed' && (
            <>
              {done && (
                <p className="text-xs text-zinc-500">
                  This is {t.stage?.label.toLowerCase()}. Replying opens it again.
                </p>
              )}
              <Composer
                t={t}
                canNote={mine ? manager : false}
                canClose={editable && !done}
                onSent={updated}
              />
            </>
          )}
        </div>

        {/* Properties: a plain list down the side, the value and its icon, with no boxes (the way Linear does it) */}
        <aside className="space-y-8 pt-1 lg:sticky lg:top-4">
          <section>
            <h2 className="mb-1 px-2 text-sm font-medium text-zinc-500">Properties</h2>
            <Listbox
              searchable
              label="Stage"
              align="end"
              value={t.stage?.key ?? null}
              disabled={!editable}
              trigger={{
                className: row,
                children: (
                  <>
                    <StageDot kind={t.stage?.kind ?? 'open'} stageKey={t.stage?.key} />{' '}
                    <span className="truncate">{t.stage?.label ?? 'With Grids'}</span>
                  </>
                ),
              }}
              options={stages.map((s) => ({
                value: s.key,
                label: s.label,
                description: KIND_TEXT[s.kind],
                icon: stageIcon(s.kind, s.key),
              }))}
              onChange={(stage) => patch.mutate({ stage })}
            />
            <Listbox
              searchable
              label="Priority"
              align="end"
              value={t.priority}
              disabled={!editable}
              trigger={{
                className: row,
                children: (
                  <>
                    <PriorityIcon priority={t.priority} /> {PRIORITY_LABEL[t.priority]}
                  </>
                ),
              }}
              options={(['urgent', 'high', 'normal', 'low'] as const).map((p) => ({
                value: p,
                label: PRIORITY_LABEL[p],
                icon: priorityIcon(p),
              }))}
              onChange={(priority) => patch.mutate({ priority })}
            />
            <Listbox
              searchable
              label="Assignee"
              align="end"
              value={t.assignee?.id ?? '__none'}
              disabled={!editable}
              trigger={{
                className: row,
                children: t.assignee ? (
                  <>
                    <Avatar name={t.assignee.name} size={20} />{' '}
                    <span className="truncate">{t.assignee.name}</span>
                  </>
                ) : (
                  <>
                    <span className="inline-block size-5 rounded-full border border-dashed border-zinc-300" />{' '}
                    <span className="text-zinc-500">Unassigned</span>
                  </>
                ),
              }}
              options={[
                { value: '__none', label: 'Unassigned' },
                ...(handlers.data ?? []).map((h) => ({
                  value: h.id,
                  label: h.id === me.id ? `${h.name} (you)` : h.name,
                  description: h.email ?? undefined,
                })),
              ]}
              onChange={(v) => patch.mutate({ assigneeId: v === '__none' ? null : v })}
            />
            {editable && t.assignee?.id !== me.id && (
              <button
                type="button"
                onClick={() => patch.mutate({ assigneeId: me.id })}
                className="ms-9 text-xs text-accent-700 hover:underline"
              >
                Assign to me
              </button>
            )}
          </section>

          <section>
            <h2 className="mb-2 px-2 text-sm font-medium text-zinc-500">Labels</h2>
            <div className="flex flex-wrap items-center gap-1.5 px-1">
              {labels.map((l) => (
                <LabelChip
                  key={l.key}
                  label={l}
                  onRemove={
                    editable
                      ? () => patch.mutate({ labels: t.labels.filter((k) => k !== l.key) })
                      : undefined
                  }
                />
              ))}
              {editable && (
                <Listbox
                  searchable
                  label="Add a label"
                  align="end"
                  value={null}
                  values={t.labels}
                  trigger={{
                    className:
                      'flex size-7 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-ink',
                    children: <Plus className="size-4" />,
                  }}
                  options={(desk.data?.labels ?? []).map((l) => ({
                    value: l.key,
                    label: l.label,
                    icon: dotIcon(l.color),
                  }))}
                  onChangeMany={(labels) => patch.mutate({ labels })}
                />
              )}
              {!editable && labels.length === 0 && (
                <span className="px-1 text-sm text-zinc-400">None</span>
              )}
            </div>
          </section>

          <Relations
            tenantId={tenantId}
            t={t}
            editable={editable && t.audience === 'organisation'}
            onChange={updated}
          />

          {editable && !t.escalatedAt && (
            <section>
              <h2 className="mb-1 px-2 text-sm font-medium text-zinc-500">Need Grids’ help?</h2>
              <p className="mb-2 px-2 text-xs leading-relaxed text-zinc-500">
                Only your team can ask. The person who asked is told the team asked for help, and
                you carry on answering them here.
              </p>
              <button
                type="button"
                onClick={() => setEscalating(true)}
                className={cx(row, 'text-accent-700')}
              >
                <ArrowUpRight className="size-4" /> Ask the Grids team
              </button>
            </section>
          )}
        </aside>
      </div>

      {escalating && (
        <Dialog
          open
          onClose={() => setEscalating(false)}
          title="Ask the Grids team"
          description="They see the whole conversation, but not your internal notes. The person who asked is not written to by Grids; you stay their contact."
          footer={
            <>
              <Button variant="secondary" onClick={() => setEscalating(false)}>
                Cancel
              </Button>
              <Button icon={Send} onClick={() => escalate.mutate()} loading={escalate.isPending}>
                Send to Grids
              </Button>
            </>
          }
        >
          <Field label="What do you need from them?" intro="Only the Grids team sees this note">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-24" />
          </Field>
        </Dialog>
      )}
    </div>
  );
}

export function AudienceBadge({
  audience,
  escalated,
}: {
  audience: 'organisation' | 'platform';
  escalated?: boolean;
}) {
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
