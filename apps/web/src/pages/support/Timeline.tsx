import { useMutation } from '@tanstack/react-query';
import type { TicketDetail, TicketMessage } from '@grids/schema';
import { Button, Dialog, cx, dateTime, relTime, useToast } from '@grids/ui';
import { RichBody, RichEditor, RichFilesProvider, type RichFiles } from '@grids/viz';
import { Check, CheckCircle2, ChevronDown, ChevronRight, CircleDot, Clock, FileText, Flag, Lock, Mail, MessageSquare, Phone, Pencil, RotateCcw, Tag, UserRound } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { Avatar, openSupportFile } from './shared';

const WHO = { requester: 'Requester', staff: 'Team', platform: 'Grids support', escalation: 'Note to Grids', system: '' } as const;

/** How rich text reaches this ticket's files: a picture is fetched with the sign-in token and shown from memory. */
function useFiles(): RichFiles {
  const cache = useRef(new Map<string, Promise<string>>());
  return useMemo<RichFiles>(
    () => ({
      url: (id) => {
        let p = cache.current.get(id);
        if (!p) {
          p = api.supportFile(id).then((b) => URL.createObjectURL(b));
          cache.current.set(id, p);
        }
        return p;
      },
      open: (id) => openSupportFile(id),
    }),
    [],
  );
}

/** What a change was about, to pick its icon. */
function iconOf(m: TicketMessage) {
  if (m.body.startsWith('Stage')) return CircleDot;
  if (m.body.startsWith('Assigned') || m.body === 'Unassigned') return UserRound;
  if (m.body.startsWith('Labels')) return Tag;
  if (m.body.startsWith('Priority')) return Flag;
  return m.internal ? Lock : Clock;
}
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A change, drawn on the left, borderless: who did it, what, and when. */
function Change({ m }: { m: TicketMessage }) {
  const Icon = iconOf(m);
  return (
    <div className="inline-flex max-w-full items-center gap-2 px-1 py-1.5 text-sm text-zinc-600" title={m.internal ? 'Only the team sees this' : dateTime(m.createdAt)}>
      <Icon className="size-4 shrink-0 text-zinc-400" />
      <span className="min-w-0 truncate">
        <b className="font-medium text-zinc-800">{m.author.name}</b> {lower(m.body)}
      </span>
      <span className="shrink-0 text-xs text-zinc-400">· {relTime(m.createdAt)}</span>
    </div>
  );
}

type Row =
  | { kind: 'message'; m: TicketMessage; replies: TicketMessage[] }
  | { kind: 'changes'; ms: TicketMessage[] }
  | { kind: 'resolved'; m: TicketMessage; replies: TicketMessage[] };

/** Messages in the order they happened, with answers gathered under the note they answer, runs of changes folded, and settled threads folded. */
/** The message that opened the ticket: what it is about, shown as the overview rather than as a comment. */
export const openingOf = (messages: TicketMessage[]) => messages.find((m) => !m.parentId && !m.internal && m.kind !== 'system') ?? null;

function rowsOf(messages: TicketMessage[]): Row[] {
  const replies = new Map<string, TicketMessage[]>();
  for (const m of messages) if (m.parentId) replies.set(m.parentId, [...(replies.get(m.parentId) ?? []), m]);
  const rows: Row[] = [];
  let run: TicketMessage[] = [];
  const flush = () => {
    if (run.length) rows.push({ kind: 'changes', ms: run });
    run = [];
  };
  for (const m of messages) {
    if (m.parentId) continue;
    if (m.kind === 'system') {
      run.push(m);
      continue;
    }
    flush();
    const r = replies.get(m.id) ?? [];
    rows.push(m.resolvedAt ? { kind: 'resolved', m, replies: r } : { kind: 'message', m, replies: r });
  }
  flush();
  return rows;
}

/** The words of a message, with a way to see what it said before it was changed. */
function Body({ m, history }: { m: TicketMessage; history: boolean }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <>
      {m.body ? <RichBody text={m.body} /> : <p className="text-sm text-zinc-400">(a file)</p>}
      {m.attachments.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {m.attachments
            .filter((f) => !m.body.includes(`file:${f.id}`))
            .map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => void openSupportFile(f.id).catch((e) => toast(e instanceof Error ? e.message : 'The file could not be opened'))} className="inline-flex max-w-full items-center gap-1.5 border border-zinc-300 bg-snow px-2 py-1 text-xs hover:border-zinc-500">
                  <FileText className="size-3.5 shrink-0 text-zinc-500" /> <span className="truncate">{f.name}</span>
                  <span className="text-zinc-400">{f.size > 1_048_576 ? `${(f.size / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
      {m.editedAt && (
        <div className="mt-1.5">
          <button type="button" onClick={() => history && setOpen(!open)} disabled={!history} className={cx('text-xs text-zinc-400', history && 'hover:text-ink hover:underline')} title={dateTime(m.editedAt)}>
            edited {relTime(m.editedAt)}
            {history && m.edits.length > 0 && ` · ${m.edits.length} earlier ${m.edits.length === 1 ? 'version' : 'versions'}`}
          </button>
          {open && (
            <Dialog open onClose={() => setOpen(false)} title="Edit history" description={`${m.edits.length} earlier ${m.edits.length === 1 ? 'version' : 'versions'}, newest first`}>
              <ol className="max-h-[60vh] space-y-4 overflow-y-auto">
                <li>
                  <div className="mb-1 text-xs font-medium text-ink">Current · edited {dateTime(m.editedAt)}</div>
                  <RichBody text={m.body} />
                </li>
                {[...m.edits].reverse().map((e, i) => (
                  <li key={i} className="border-t border-zinc-100 pt-3 text-zinc-600">
                    <div className="mb-1 text-xs text-zinc-500">{e.by} · {dateTime(e.at)}</div>
                    <RichBody text={e.body} className="text-zinc-600" />
                  </li>
                ))}
              </ol>
            </Dialog>
          )}
        </div>
      )}
    </>
  );
}

/** One comment card: who wrote it, what, and what you can do with it. */
function Comment({ m, t, me, team, nested, plain, onChange, children }: { m: TicketMessage; plain?: boolean; t: TicketDetail; me: string; team: boolean; nested?: boolean; onChange(d: TicketDetail): void; children?: ReactNode }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.body);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const mine = m.author.id === me && m.kind !== 'escalation';
  const note = m.internal;
  const visitor = m.author.id === 'visitor';
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'That did not work');
  const save = useMutation({ mutationFn: () => api.editTicketMessage(t.id, m.id, text.trim()), onSuccess: (d) => (onChange(d), setEditing(false)), onError: fail });
  const resolve = useMutation({ mutationFn: (resolved: boolean) => api.resolveThread(t.id, m.id, resolved), onSuccess: onChange, onError: fail });
  const answer = useMutation({ mutationFn: () => api.replyTicket(t.id, { body: reply, internal: true, parentId: m.id }), onSuccess: (d) => (onChange(d), setReply(''), setReplying(false)), onError: fail });
  const tone = note ? 'border-accent-600/30 bg-accent-50' : m.kind === 'escalation' ? 'border-violet-200 bg-violet-50' : m.kind === 'staff' || m.kind === 'platform' ? 'border-accent-600/25 bg-accent-50/50' : 'border-zinc-200 bg-snow';
  return (
    <article className={cx('min-w-0', !plain && 'border', !plain && tone)}>
      <header className={cx('flex flex-wrap items-center gap-x-2 gap-y-1 pt-2.5 text-xs', !plain && 'px-4')}>
        {nested && <Avatar name={m.author.name} size={20} />}
        <b className="text-sm font-semibold text-ink">{m.author.name}</b>
        {m.kind && WHO[m.kind] && <span className={cx('px-1.5 py-px font-medium', note ? 'bg-accent-100 text-accent-800' : m.kind === 'staff' || m.kind === 'platform' ? 'bg-accent-100 text-accent-800' : 'bg-zinc-100 text-zinc-600')}>{note ? 'Internal note' : WHO[m.kind]}</span>}
        {visitor && <span className="bg-sky-100 px-1.5 py-px font-medium text-sky-900">Visitor</span>}
        {note && <Lock className="size-3 text-accent-700" aria-label="Only the team sees this" />}
        <time className="text-zinc-500" title={dateTime(m.createdAt)}>
          {relTime(m.createdAt)}
        </time>
        <span className="ms-auto flex items-center gap-0.5">
          {mine && !editing && (
            <button type="button" onClick={() => (setText(m.body), setEditing(true))} className="inline-flex h-6 items-center gap-1 px-1.5 text-zinc-500 hover:bg-black/5 hover:text-ink" aria-label="Edit">
              <Pencil className="size-3.5" /> Edit
            </button>
          )}
          {note && team && !nested && !m.resolvedAt && (
            <button type="button" onClick={() => setReplying(true)} aria-label="Reply in thread" className="inline-flex h-6 items-center gap-1 px-1.5 text-zinc-500 hover:bg-black/5 hover:text-ink">
              <MessageSquare className="size-3.5" /> Reply
            </button>
          )}
          {note && team && !nested && (
            <button type="button" onClick={() => resolve.mutate(true)} disabled={resolve.isPending} className="inline-flex h-6 items-center gap-1 px-1.5 text-zinc-500 hover:bg-black/5 hover:text-emerald-700" aria-label="Resolve thread">
              <Check className="size-3.5" /> Resolve
            </button>
          )}
        </span>
      </header>
      <div className={cx('pt-1.5 pb-3', !plain && 'px-4')}>
        {editing ? (
          <div className="border border-zinc-300 bg-snow">
            <RichEditor label="Edit message" value={text} onChange={setText} minRows={4} autoFocus onSubmit={() => text.trim() && save.mutate()} />
            <div className="flex items-center justify-between gap-2 border-t border-black/5 px-3 py-2">
              <span className="text-xs text-zinc-500">The earlier wording is kept.</span>
              <span className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button size="sm" loading={save.isPending} disabled={!text.trim() || text.trim() === m.body} onClick={() => save.mutate()}>
                  Save
                </Button>
              </span>
            </div>
          </div>
        ) : (
          <Body m={m} history={team} />
        )}
      </div>
      {children}
      {replying && (
        <div className="border-t border-black/5 px-4 py-3">
          <div className="border border-zinc-300 bg-snow">
            <RichEditor label="Thread reply" value={reply} onChange={setReply} minRows={3} autoFocus tone="plain" onSubmit={() => reply.trim() && answer.mutate()} />
            <div className="flex justify-end gap-2 border-t border-black/5 px-3 py-2">
              <Button size="sm" variant="ghost" onClick={() => (setReplying(false), setReply(''))}>
                Cancel
              </Button>
              <Button size="sm" loading={answer.isPending} disabled={!reply.trim()} onClick={() => answer.mutate()}>
                Send reply
              </Button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

/** A thread: the note, and the team's answers under it. */
function Thread({ m, replies, t, me, team, onChange }: { m: TicketMessage; replies: TicketMessage[]; t: TicketDetail; me: string; team: boolean; onChange(d: TicketDetail): void }) {
  return (
    <Comment m={m} t={t} me={me} team={team} onChange={onChange}>
      {replies.length > 0 && (
        <div className="space-y-2 border-t border-black/5 bg-white/50 px-4 py-3">
          {replies.map((r) => (
            <Comment key={r.id} m={r} t={t} me={me} team={team} nested onChange={onChange} />
          ))}
        </div>
      )}
    </Comment>
  );
}

const names = (ms: TicketMessage[]) => {
  const n = [...new Set(ms.map((m) => m.author.name.split(' ')[0]!))];
  return n.length <= 2 ? n.join(' and ') : `${n.slice(0, 2).join(', ')} and ${n.length - 2} more`;
};

/**
 * The conversation as a timeline (the Linear way): a rail down the left with each comment and change on it, changes
 * drawn on the left in a bordered line and folded together when there are many, and settled threads folded away.
 */
export function Timeline({ t, me, team, onChange }: { t: TicketDetail; me: string; team: boolean; onChange(d: TicketDetail): void }) {
  const files = useFiles();
  const opening = openingOf(t.messages);
  const rows = useMemo(() => rowsOf(t.messages.filter((m) => m.id !== opening?.id)), [t.messages, opening?.id]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const reopen = useMutation({ mutationFn: (id: string) => api.resolveThread(t.id, id, false), onSuccess: onChange });
  return (
    <RichFilesProvider value={files}>
      <ol className="relative space-y-3 before:absolute before:start-[15px] before:top-3 before:bottom-3 before:w-px before:bg-zinc-200">
        {rows.map((r, i) => {
          const key = r.kind === 'changes' ? `c${r.ms[0]!.id}` : r.m.id;
          if (r.kind === 'changes') {
            const many = r.ms.length >= 3 && !open[key];
            return (
              <li key={key} className="relative ps-11">
                <span className="absolute start-1 top-1.5 flex size-[22px] items-center justify-center rounded-full border border-zinc-300 bg-snow text-zinc-400" aria-hidden>
                  <Clock className="size-3" />
                </span>
                {many ? (
                  <button type="button" onClick={() => toggle(key)} className="flex items-center gap-2 py-1.5 text-start text-sm text-zinc-500 hover:text-ink">
                    <ChevronRight className="size-4" /> Show {r.ms.length} events: {[...new Set(r.ms.map((m) => (m.body.startsWith('Stage') ? 'changed stage' : m.body.startsWith('Assigned') || m.body === 'Unassigned' ? 'assignee' : m.body.startsWith('Labels') ? 'labels' : m.body.startsWith('Priority') ? 'priority' : 'passed on')))].join(', ')}…
                  </button>
                ) : (
                  <div className="space-y-1.5">
                    {r.ms.length >= 3 && (
                      <button type="button" onClick={() => toggle(key)} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-ink">
                        <ChevronDown className="size-3.5" /> Hide events
                      </button>
                    )}
                    {r.ms.map((m) => (
                      <div key={m.id}>
                        <Change m={m} />
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          }
          if (r.kind === 'resolved') {
            const all = [r.m, ...r.replies];
            return (
              <li key={key} className="relative ps-11">
                <span className="absolute start-1 top-3 flex size-[22px] items-center justify-center rounded-full bg-emerald-100 text-emerald-700" aria-hidden>
                  <CheckCircle2 className="size-3.5" />
                </span>
                <div className="border border-zinc-200 bg-snow shadow-sm">
                  <button type="button" aria-expanded={!!open[key]} onClick={() => toggle(key)} className="flex w-full items-center gap-3 px-4 py-3 text-start text-sm text-zinc-600 hover:bg-zinc-50">
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    <span className="flex-1">
                      {all.length} resolved {all.length === 1 ? 'comment' : 'comments'} from {names(all)}
                      {r.m.resolvedBy && <span className="text-zinc-400"> · settled by {r.m.resolvedBy}</span>}
                    </span>
                    <ChevronDown className={cx('size-4 text-zinc-400 transition-transform', open[key] && 'rotate-180')} />
                  </button>
                  {open[key] && (
                    <div className="space-y-2 border-t border-zinc-200 p-3">
                      <Thread m={r.m} replies={r.replies} t={t} me={me} team={team} onChange={onChange} />
                      {team && (
                        <Button size="sm" variant="secondary" icon={RotateCcw} loading={reopen.isPending} onClick={() => reopen.mutate(r.m.id)}>
                          Open this thread again
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          }
          return (
            <li key={key} className="relative ps-11">
              <Avatar name={r.m.author.name} size={24} className="absolute start-0.5 top-2.5 ring-4 ring-white" />
              <Thread m={r.m} replies={r.replies} t={t} me={me} team={team} onChange={onChange} />
              <span className="hidden">{i}</span>
            </li>
          );
        })}
      </ol>
    </RichFilesProvider>
  );
}

/** What the ticket is about: the opening message, set out like a description. The person who wrote it can edit it (the history is kept). */
export function Overview({ t, me, team, onChange }: { t: TicketDetail; me: string; team: boolean; onChange(d: TicketDetail): void }) {
  const files = useFiles();
  const m = openingOf(t.messages);
  if (!m) return null;
  return (
    <RichFilesProvider value={files}>
      <section aria-label="Overview" className="border-s-4 border-accent-600 bg-zinc-50 px-5 pt-3 pb-1">
        <h2 className="mb-1 text-sm font-medium text-zinc-500">Overview</h2>
        <p className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
          {t.createdBy.email && (
            <a href={`mailto:${t.createdBy.email}`} className="inline-flex items-center gap-1 hover:text-ink">
              <Mail className="size-3" /> {t.createdBy.email}
            </a>
          )}
          {t.requesterPhone && (
            <a href={`tel:${t.requesterPhone}`} className="inline-flex items-center gap-1 hover:text-ink">
              <Phone className="size-3" /> {t.requesterPhone}
            </a>
          )}
          <span>{m.author.id === 'visitor' ? 'Visitor, no account' : 'Signed in'}</span>
          {t.sourceProject && <span>From {t.sourceProject}</span>}
        </p>
        <Comment m={m} t={t} me={me} team={team} plain onChange={onChange} />
      </section>
    </RichFilesProvider>
  );
}
