import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { WORK_PRIORITIES, WORK_PRIORITY_LABEL, type WorkDetailDto, type WorkItemDto, type WorkPriority, type WorkTypeDto } from '@grids/schema';
import { Button, DateTimePicker, Dialog, EmptyState, ErrorNotice, Field, Input, Listbox, Loading, SectionHead, Tabs, Textarea, cx, dateTime, relTime, useToast } from '@grids/ui';
import { AlertTriangle, CalendarClock, Check, CheckCircle2, ChevronsUp, CircleDot, ListChecks, Clock, MapPin, MessageSquare, Plus, Search, Settings2, Ticket, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api';
import { useMe } from '../../session';
import { iconOf, useProject } from './context';

/** A state's look: waiting to be picked up, being worked on, or finished. */
const KIND_STYLE = { open: 'bg-zinc-100 text-zinc-700', active: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200', done: 'bg-emerald-100 text-emerald-900' } as const;
const PRIORITY_DOT: Record<WorkPriority, string> = { low: 'bg-zinc-300', normal: 'bg-sky-400', high: 'bg-orange-500', urgent: 'bg-red-600' };

export const StatePill = ({ state }: { state: WorkItemDto['state'] }) => <span className={cx('inline-flex h-[22px] items-center px-2 text-xs font-medium whitespace-nowrap', KIND_STYLE[state.kind])}>{state.label}</span>;
export const PriorityMark = ({ priority }: { priority: WorkPriority }) => (
  <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600" title={`${WORK_PRIORITY_LABEL[priority]} priority`}>
    <span className={cx('size-2 rounded-full', PRIORITY_DOT[priority])} />
    {WORK_PRIORITY_LABEL[priority]}
  </span>
);
/** The words for a deadline: when, and whether it has passed. */
export function Due({ at, late }: { at: string | null; late?: boolean }) {
  if (!at) return <span className="text-xs text-zinc-400">No due date</span>;
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs', late ? 'font-medium text-red-700' : 'text-zinc-600')} title={dateTime(at)}>
      <CalendarClock className="size-3.5" /> {late ? 'Overdue · ' : 'Due '}
      {relTime(at)}
    </span>
  );
}

/** Picks a place or thing by searching for it. */
function EntityPick({ value, onChange }: { value: { id: string; name: string } | null; onChange(v: { id: string; name: string } | null): void }) {
  const { tenantId, project } = useProject();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const hits = useQuery({ queryKey: ['work-places', tenantId, project.key, q], queryFn: () => api.searchPlaces(tenantId, project.key, q), enabled: open && q.trim().length >= 2 });
  return (
    <div className="relative">
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(!open)} className="flex h-9 min-w-0 flex-1 items-center gap-2 border border-zinc-300 bg-snow px-3 text-start text-sm hover:border-zinc-500">
          <MapPin className="size-4 shrink-0 text-zinc-400" />
          <span className={cx('min-w-0 flex-1 truncate', !value && 'text-zinc-400')}>{value?.name ?? 'Nothing in particular'}</span>
        </button>
        {value && (
          <button type="button" aria-label="Clear" onClick={() => onChange(null)} className="flex size-9 items-center justify-center border border-zinc-300 bg-snow text-zinc-500 hover:border-zinc-500">
            <X className="size-4" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 border border-zinc-300 bg-snow shadow-lg">
          <div className="border-b border-zinc-200 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input autoFocus aria-label="Search" placeholder="Search by name or code" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-full border border-zinc-300 ps-8 pe-2 text-sm focus:border-accent-600 focus:outline-none" />
            </div>
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {q.trim().length < 2 && <li className="px-3 py-2 text-xs text-zinc-500">Type at least two letters.</li>}
            {hits.data?.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="flex w-full items-baseline gap-2 px-3 py-1.5 text-start text-sm hover:bg-zinc-50"
                  onClick={() => {
                    onChange({ id: h.id, name: h.name });
                    setOpen(false);
                    setQ('');
                  }}
                >
                  <span className="truncate">{h.name}</span>
                  <span className="ms-auto shrink-0 text-xs text-zinc-500">{h.type.name}</span>
                </button>
              </li>
            ))}
            {hits.data && !hits.data.length && <li className="px-3 py-2 text-xs text-zinc-500">No matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** People who can be given work here. */
function useAssignees() {
  const { tenantId, project } = useProject();
  const members = useQuery({ queryKey: ['project-members', tenantId, project.key], queryFn: () => api.projectMembers(tenantId, project.key) });
  return useMemo(() => (members.data ?? []).map((m) => ({ value: m.userId, label: m.name ?? m.email ?? 'Someone', description: m.email ?? undefined })), [members.data]);
}

/** One piece of work, in full: its details, what has happened, and a place to answer. */
function WorkSheet({ id, types, onClose }: { id: string; types: WorkTypeDto[]; onClose(): void }) {
  const { tenantId, project, can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const assignees = useAssignees();
  const key = ['work-item', tenantId, project.key, id];
  const item = useQuery({ queryKey: key, queryFn: () => api.workItem(tenantId, project.key, id) });
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const done = (d: WorkDetailDto) => {
    qc.setQueryData(key, d);
    void qc.invalidateQueries({ queryKey: ['work', tenantId, project.key] });
    void qc.invalidateQueries({ queryKey: ['my-work', tenantId] });
  };
  const change = useMutation({ mutationFn: (patch: Parameters<typeof api.updateWork>[3]) => api.updateWork(tenantId, project.key, id, patch), onSuccess: done, onError: (e) => toast(e instanceof Error ? e.message : 'It could not be changed') });
  const send = useMutation({
    mutationFn: () => api.commentWork(tenantId, project.key, id, { body: reply, internal }),
    onSuccess: (d) => {
      done(d);
      setReply('');
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'It could not be sent'),
  });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const w = item.data;
  const type = types.find((t) => t.key === w?.type.key);
  const manager = can('manager');
  const me = useMe();
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal aria-label="Work">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[38rem] flex-col border-s border-zinc-300 bg-snow shadow-2xl">
        {item.isPending ? (
          <Loading />
        ) : item.isError || !w ? (
          <div className="p-6">
            <ErrorNotice error={item.error} />
          </div>
        ) : (
          <>
            <header className="flex items-start gap-3 border-b border-zinc-200 px-5 py-4">
              <span className="flex size-9 shrink-0 items-center justify-center text-white" style={{ background: w.type.color }}>
                {(() => {
                  const I = iconOf(w.type.icon);
                  return <I className="size-4" />;
                })()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-zinc-500">
                  {w.ref} · {w.type.name}
                </div>
                <input
                  aria-label="Title"
                  value={title ?? w.title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => title !== null && title.trim() && title !== w.title && change.mutate({ title: title.trim() })}
                  className="mt-0.5 w-full border border-transparent bg-transparent text-lg font-semibold tracking-tight hover:border-zinc-200 focus:border-accent-600 focus:outline-none"
                />
              </div>
              <button type="button" aria-label="Close" onClick={onClose} className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink">
                <X className="size-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-4 border-b border-zinc-100 px-5 py-4 sm:grid-cols-2">
                <Field label="State">
                  <Listbox label="State" value={w.state.key} options={(type?.states ?? [w.state]).map((s) => ({ value: s.key, label: s.label, description: s.kind === 'done' ? 'Finished' : s.kind === 'active' ? 'Being worked on' : 'Waiting to be picked up' }))} onChange={(state) => change.mutate({ state })} />
                </Field>
                <Field label="Priority">
                  <Listbox label="Priority" value={w.priority} options={WORK_PRIORITIES.map((p) => ({ value: p, label: WORK_PRIORITY_LABEL[p] }))} onChange={(priority) => change.mutate({ priority })} />
                </Field>
                <Field label="Assigned to">
                  <Listbox
                    label="Assigned to"
                    searchable
                    value={w.assignee?.id ?? '__none'}
                    disabled={!manager}
                    options={[{ value: '__none', label: 'Nobody' }, ...assignees]}
                    onChange={(v) => change.mutate({ assigneeId: v === '__none' ? null : v })}
                  />
                </Field>
                <Field label="Due">
                  <DateTimePicker value={w.dueAt ? toLocalWall(w.dueAt) : ''} onChange={(v) => change.mutate({ dueAt: v ? new Date(v).toISOString() : null })} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="About">
                    <EntityPick value={w.entity ? { id: w.entity.id, name: w.entity.name } : null} onChange={(e) => change.mutate({ entityId: e?.id ?? null })} />
                  </Field>
                </div>
              </div>
              {!w.assignee && !manager && (
                <div className="border-b border-zinc-100 px-5 py-3">
                  <Button size="sm" variant="secondary" icon={UserRound} loading={change.isPending} onClick={() => change.mutate({ assigneeId: me.id })}>
                    Take it
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-zinc-100 px-5 py-3 text-xs text-zinc-600">
                <span>Opened {relTime(w.createdAt)}{w.requester.name ? ` by ${w.requester.name}` : ''}</span>
                {w.respondBy && (
                  <span className={cx(!w.firstResponseAt && new Date(w.respondBy) < new Date() && 'font-medium text-red-700')}>
                    <Clock className="me-1 inline size-3.5" />
                    {w.firstResponseAt ? 'Answered' : 'Answer by'} {dateTime(w.firstResponseAt ?? w.respondBy)}
                  </span>
                )}
                {w.resolveBy && (
                  <span className={cx(!w.resolvedAt && new Date(w.resolveBy) < new Date() && 'font-medium text-red-700')}>
                    <Check className="me-1 inline size-3.5" />
                    {w.resolvedAt ? 'Finished' : 'Finish by'} {dateTime(w.resolvedAt ?? w.resolveBy)}
                  </span>
                )}
                {w.breached && (
                  <span className="inline-flex items-center gap-1 font-medium text-red-700">
                    <AlertTriangle className="size-3.5" /> Past its service time
                  </span>
                )}
              </div>
              {w.description && <p className="border-b border-zinc-100 px-5 py-4 text-sm whitespace-pre-wrap text-zinc-800">{w.description}</p>}
              <ol className="space-y-4 px-5 py-4">
                {w.events.map((e) => (
                  <li key={e.id} className={cx('text-sm', e.kind === 'comment' ? '' : 'text-zinc-500')}>
                    {e.kind === 'comment' ? (
                      <div className={cx('border px-3 py-2.5', e.internal ? 'border-amber-200 bg-amber-50' : 'border-zinc-200 bg-zinc-50')}>
                        <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                          <b className="font-semibold text-zinc-800">{e.actor?.name ?? 'Someone'}</b> {relTime(e.createdAt)}
                          {e.internal && <span className="bg-amber-100 px-1.5 py-px font-medium text-amber-900">Team only</span>}
                        </div>
                        <p className="whitespace-pre-wrap">{e.body}</p>
                      </div>
                    ) : (
                      <span>
                        <b className="font-medium text-zinc-700">{e.actor?.name ?? 'Someone'}</b> {describe(e, type)} · {relTime(e.createdAt)}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
            <footer className="border-t border-zinc-200 bg-zinc-50 p-4">
              <Textarea aria-label="Reply" placeholder="Write a comment" value={reply} onChange={(e) => setReply(e.target.value)} className="min-h-20" />
              <div className="mt-2 flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-zinc-600">
                  <input type="checkbox" className="size-4 accent-accent-600" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Team only
                </label>
                <Button size="sm" icon={MessageSquare} loading={send.isPending} disabled={!reply.trim()} onClick={() => send.mutate()}>
                  Comment
                </Button>
              </div>
            </footer>
          </>
        )}
      </aside>
    </div>,
    document.body,
  );
}

/** An instant as the `YYYY-MM-DDTHH:MM` the date picker reads, in the viewer's own zone. */
const toLocalWall = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** What happened, in a few words. */
function describe(e: WorkDetailDto['events'][number], type: WorkTypeDto | undefined): string {
  const label = (k: unknown) => type?.states.find((s) => s.key === k)?.label ?? String(k);
  const d = e.data as Record<string, string | null | undefined>;
  switch (e.kind) {
    case 'created':
      return 'opened it';
    case 'state':
      return `moved it from ${label(d.from)} to ${label(d.to)}`;
    case 'priority':
      return `changed the priority from ${d.from} to ${d.to}`;
    case 'assign':
      return d.to ? 'assigned it' : 'took the assignment off';
    case 'due':
      return d.to ? `set the due date to ${dateTime(d.to)}` : 'cleared the due date';
    case 'edited':
      return d.field === 'title' ? 'renamed it' : d.field === 'entity' ? 'changed what it is about' : 'edited the description';
    default:
      return e.kind;
  }
}

/** Opens a new piece of work. */
function NewWork({ types, onClose, onMade }: { types: WorkTypeDto[]; onClose(): void; onMade(id: string): void }) {
  const { tenantId, project, can } = useProject();
  const qc = useQueryClient();
  const assignees = useAssignees();
  const [type, setType] = useState(types[0]?.key ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<WorkPriority>('normal');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [about, setAbout] = useState<{ id: string; name: string } | null>(null);
  const make = useMutation({
    mutationFn: () => api.createWork(tenantId, project.key, { type, title, description, priority, assigneeId: assignee, entityId: about?.id ?? null, dueAt: due ? new Date(due).toISOString() : null }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['work', tenantId, project.key] });
      onMade(d.id);
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="New work"
      description="A ticket, a task, a visit: whatever this project tracks."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={Plus} loading={make.isPending} disabled={!title.trim() || !type} onClick={() => make.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={make.error} />
        {types.length > 1 && (
          <Field label="Kind">
            <Listbox label="Kind" value={type} options={types.map((t) => ({ value: t.key, label: t.name, description: t.description || undefined }))} onChange={setType} />
          </Field>
        )}
        <Field label="Title" required>
          <Input autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Details">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-24" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priority">
            <Listbox label="Priority" value={priority} options={WORK_PRIORITIES.map((p) => ({ value: p, label: WORK_PRIORITY_LABEL[p] }))} onChange={(v) => setPriority(v as WorkPriority)} />
          </Field>
          <Field label="Due">
            <DateTimePicker value={due} onChange={setDue} />
          </Field>
        </div>
        {can('manager') && (
          <Field label="Assign to">
            <Listbox label="Assign to" searchable value={assignee ?? '__none'} options={[{ value: '__none', label: 'Nobody yet' }, ...assignees]} onChange={(v) => setAssignee(v === '__none' ? null : v)} />
          </Field>
        )}
        <Field label="About">
          <EntityPick value={about} onChange={setAbout} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Work: tickets, tasks, visits and maintenance jobs for this project. */
export function WorkTab() {
  const { tenantId, project, base, can } = useProject();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { item?: string };
  const [q, setQ] = useState('');
  const [typeKey, setTypeKey] = useState('__all');
  // The tab says which part of the list (not finished, finished, everything); the stage narrows it to one of the project's stages.
  const [tab, setTab] = useState<'open' | 'done' | '__all'>('open');
  const [stage, setStage] = useState('__any');
  const state = stage !== '__any' ? stage : tab;
  const [assignee, setAssignee] = useState('__all');
  const [priority, setPriority] = useState('__all');
  const [overdue, setOverdue] = useState(false);
  const [sort, setSort] = useState<'updated' | 'due' | 'priority' | 'created'>('updated');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const assignees = useAssignees();
  const types = useQuery({ queryKey: ['work-types', tenantId, project.key], queryFn: () => api.workTypes(tenantId, project.key) });
  const query = { ...(typeKey !== '__all' && { type: typeKey }), ...(state !== '__all' && { state }), ...(assignee !== '__all' && { assignee: assignee as 'me' | 'none' }), ...(priority !== '__all' && { priority: priority as WorkPriority }), ...(overdue && { overdue: true }), ...(q.trim() && { q: q.trim() }), sort, page, pageSize: 25 };
  const list = useQuery({ queryKey: ['work', tenantId, project.key, query], queryFn: () => api.work(tenantId, project.key, query as never), placeholderData: (p) => p, enabled: !!types.data?.length });
  useEffect(() => setPage(1), [typeKey, tab, stage, assignee, priority, overdue, q, sort]);
  const open = (id: string | null) => void navigate({ to: `${base}/work`, search: (id ? { item: id } : {}) as never, replace: true });
  const stateOptions = [{ value: '__any', label: 'Any stage' }, ...[...new Map((types.data ?? []).flatMap((t) => t.states).map((s) => [s.key, s])).values()].map((s) => ({ value: s.key, label: s.label }))];

  if (types.isPending) return <Loading />;
  if (types.isError) return <ErrorNotice error={types.error} />;
  if (!types.data.length)
    return (
      <>
        <SectionHead title="Work" description="Tickets, tasks, visits and maintenance jobs, with owners, due dates and a conversation." />
        <EmptyState icon={Ticket} title="No kinds of work yet" action={can('manager') ? <Button icon={Settings2} onClick={() => void navigate({ to: `${base}/work-types` })}>Set up work types</Button> : undefined}>
          Decide what this project tracks (tickets, tasks, visits), what states each moves through and how fast it should be answered. Then people can open work, and forms can open it for them.
        </EmptyState>
      </>
    );
  const items = list.data?.items ?? [];
  return (
    <div className="space-y-4">
      <SectionHead
        title="Work"
        description="Tickets, tasks, visits and maintenance jobs, with owners, due dates and a conversation."
        actions={
          <div className="flex gap-2">
            {can('manager') && (
              <Button size="sm" variant="secondary" icon={Settings2} onClick={() => void navigate({ to: `${base}/work-types` })}>
                Types
              </Button>
            )}
            <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
              New
            </Button>
          </div>
        }
      />
      <Tabs
        value={tab}
        onChange={(t) => (setTab(t), setStage('__any'))}
        tabs={[
          { id: 'open', label: 'Open', icon: CircleDot },
          { id: 'done', label: 'Resolved', icon: CheckCircle2 },
          { id: '__all', label: 'All', icon: ListChecks },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-64 max-w-full">
          <Input icon={Search} aria-label="Search work" placeholder="Search by title or number" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {types.data.length > 1 && <Listbox compact label="Kind" className="w-40" value={typeKey} options={[{ value: '__all', label: 'Every kind' }, ...types.data.map((t) => ({ value: t.key, label: t.name }))]} onChange={setTypeKey} />}
        <Listbox compact label="Stage" className="w-48" value={stage} options={stateOptions} onChange={setStage} />
        <Listbox compact label="Assigned to" className="w-44" searchable value={assignee} options={[{ value: '__all', label: 'Anyone' }, { value: 'me', label: 'Me' }, { value: 'none', label: 'Nobody' }, ...assignees]} onChange={setAssignee} />
        <Listbox compact label="Priority" className="w-36" value={priority} options={[{ value: '__all', label: 'Any priority' }, ...WORK_PRIORITIES.map((p) => ({ value: p, label: WORK_PRIORITY_LABEL[p] }))]} onChange={(v) => setPriority(v as WorkPriority)} />
        <button type="button" aria-pressed={overdue} onClick={() => setOverdue(!overdue)} className={cx('inline-flex h-8 items-center gap-1.5 border px-3 text-[13px]', overdue ? 'border-red-600 bg-red-50 font-medium text-red-800' : 'border-zinc-300 bg-snow text-zinc-700 hover:border-zinc-500')}>
          <AlertTriangle className="size-3.5" /> Overdue
        </button>
        <Listbox compact label="Sort" className="ms-auto w-44" value={sort} options={[{ value: 'updated', label: 'Latest activity' }, { value: 'due', label: 'Due soonest' }, { value: 'priority', label: 'Most urgent' }, { value: 'created', label: 'Newest' }]} onChange={(v) => setSort(v as typeof sort)} />
      </div>
      <ErrorNotice error={list.error} />
      {list.isPending ? (
        <Loading />
      ) : !items.length ? (
        <div className="border border-dashed border-zinc-300 bg-snow px-6 py-12 text-center text-sm text-zinc-500">{q || typeKey !== '__all' || assignee !== '__all' || priority !== '__all' || overdue || tab !== 'open' || stage !== '__any' ? 'Nothing matches these filters.' : 'Nothing to do. New work appears here.'}</div>
      ) : (
        <ul className="divide-y divide-zinc-100 border border-zinc-200 bg-snow">
          {items.map((w) => {
            const I = iconOf(w.type.icon);
            return (
              <li key={w.id}>
                <button type="button" onClick={() => open(w.id)} className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-start hover:bg-zinc-50">
                  <span className="flex size-8 items-center justify-center text-white" style={{ background: w.type.color }}>
                    <I className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="shrink-0 font-mono text-xs text-zinc-500">{w.ref}</span>
                      <span className="truncate font-medium">{w.title}</span>
                      {w.commentCount > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-zinc-500">
                          <MessageSquare className="size-3.5" /> {w.commentCount}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                      <PriorityMark priority={w.priority} />
                      {w.entity && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3.5" /> {w.entity.name}
                        </span>
                      )}
                      <Due at={w.dueAt} late={w.overdue} />
                      {w.breached && (
                        <span className="inline-flex items-center gap-1 font-medium text-red-700">
                          <ChevronsUp className="size-3.5" /> Past service time
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="hidden text-xs text-zinc-600 sm:block">{w.assignee?.name ?? <i className="text-zinc-400">Nobody</i>}</span>
                    <StatePill state={w.state} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {list.data && list.data.total > list.data.pageSize && (
        <div className="flex items-center justify-between text-sm text-zinc-600">
          <span>
            {(page - 1) * list.data.pageSize + 1}–{Math.min(page * list.data.pageSize, list.data.total)} of {list.data.total}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page * list.data.pageSize >= list.data.total} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
      {creating && (
        <NewWork
          types={types.data}
          onClose={() => setCreating(false)}
          onMade={(id) => {
            setCreating(false);
            open(id);
          }}
        />
      )}
      {search.item && <WorkSheet id={search.item} types={types.data} onClose={() => open(null)} />}
    </div>
  );
}
