import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { TicketDetail, TicketLinkKind } from '@grids/schema';
import { Button, Dialog, Listbox, cx, useToast } from '@grids/ui';
import {
  ArrowUpFromLine,
  Check,
  ChevronRight,
  Copy,
  CopyPlus,
  CornerDownRight,
  Flag,
  History,
  Link2,
  MoreHorizontal,
  OctagonX,
  Star,
  SquarePlus,
  Tag,
  UserRound,
} from 'lucide-react';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { api } from '../../api';
import {
  Avatar,
  PRIORITY_LABEL,
  PriorityIcon,
  dotIcon,
  priorityIcon,
  stageIcon,
  useDesk,
  useHandlers,
} from './shared';

type Icon = ComponentType<{ className?: string }>;
interface Item {
  id: string;
  label: string;
  icon: Icon;
  keys?: string;
  on?: boolean;
  run?: () => void;
  children?: Item[];
  divider?: boolean;
}

/** A menu whose entries can open a second level beside them, as Linear's "…" menu does. */
function Menu({ items, onDone }: { items: Item[]; onDone(): void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul role="menu" className="w-64 border border-zinc-200 bg-snow p-1.5 shadow-xl">
      {items.map((it) => (
        <li
          key={it.id}
          className={cx('relative', it.divider && 'mt-1 border-t border-zinc-100 pt-1')}
          onMouseEnter={() => setOpen(it.children ? it.id : null)}
        >
          <button
            type="button"
            role="menuitem"
            aria-haspopup={it.children ? 'menu' : undefined}
            onClick={() => (it.children ? setOpen(it.id) : (it.run?.(), onDone()))}
            className={cx(
              'flex w-full items-center gap-3 px-2.5 py-2 text-start text-[15px] hover:bg-zinc-100',
              open === it.id && 'bg-zinc-100',
            )}
          >
            <it.icon className="size-4 shrink-0 text-zinc-600" />
            <span className="flex-1">{it.label}</span>
            {it.on && <Check className="size-4 text-accent-700" />}
            {it.keys && <span className="text-xs text-zinc-400">{it.keys}</span>}
            {it.children && <ChevronRight className="size-3.5 text-zinc-400" />}
          </button>
          {it.children && open === it.id && (
            <div className="absolute start-full top-0 z-50 ms-1">
              <Menu items={it.children} onDone={onDone} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

const RELATED: { kind: TicketLinkKind; title: string }[] = [
  { kind: 'sub', title: 'Sub-issue' },
  { kind: 'parent', title: 'Parent issue' },
  { kind: 'blocks', title: 'Blocked issue' },
  { kind: 'blocked_by', title: 'Blocking issue' },
];

/** A new ticket made from this one, and linked to it: title, description, priority and who has it. */
export function CreateRelated({
  tenantId,
  from,
  kind,
  onClose,
  onChange,
}: {
  tenantId: string;
  from: TicketDetail;
  kind: TicketLinkKind;
  onClose(): void;
  onChange(d: TicketDetail): void;
}) {
  const toast = useToast();
  const handlers = useHandlers(tenantId);
  const desk = useDesk(tenantId);
  const [f, setF] = useState({
    subject: '',
    body: '',
    priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
    assignee: '__none',
    labels: [] as string[],
  });
  const title = RELATED.find((r) => r.kind === kind)!.title;
  const make = useMutation({
    mutationFn: async () => {
      const made = await api.createTicket(tenantId, {
        subject: f.subject.trim(),
        body: f.body.trim() || f.subject.trim(),
        priority: f.priority,
        audience: 'organisation',
      });
      if (f.assignee !== '__none' || f.labels.length)
        await api.updateOrgTicket(tenantId, made.id, {
          ...(f.assignee !== '__none' && { assigneeId: f.assignee }),
          ...(f.labels.length && { labels: f.labels }),
        });
      // The link as seen from the new ticket: if it is a sub-issue of this one, this is its parent.
      const back: Record<TicketLinkKind, TicketLinkKind> = {
        sub: 'parent',
        parent: 'sub',
        blocks: 'blocked_by',
        blocked_by: 'blocks',
        related: 'related',
      };
      await api.linkTicket(tenantId, made.id, { kind: back[kind], ticketId: from.id });
      return api.ticket(from.id);
    },
    onSuccess: (d) => (onChange(d), toast(`${title} created`), onClose()),
    onError: (e) => toast(e instanceof Error ? e.message : 'The ticket could not be created'),
  });
  const ok = f.subject.trim().length >= 4;
  const chip =
    'inline-flex h-8 items-center gap-2 border border-zinc-200 bg-snow px-2.5 text-sm text-zinc-700 hover:bg-zinc-50';
  const who = (handlers.data ?? []).find((h) => h.id === f.assignee);
  const Rel = kind === 'sub' ? CornerDownRight : kind === 'parent' ? ArrowUpFromLine : OctagonX;
  const relation = {
    sub: 'Sub-issue of',
    parent: 'Parent of',
    blocks: 'Blocked by',
    blocked_by: 'Blocking',
  }[kind as 'sub' | 'parent' | 'blocks' | 'blocked_by'];
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`New ${title.toLowerCase()}`}
      footer={
        <>
          <span className="me-auto hidden text-xs text-zinc-400 sm:inline">⌘↵ to create</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={make.isPending} disabled={!ok} onClick={() => make.mutate()}>
            Create {title.toLowerCase()}
          </Button>
        </>
      }
    >
      <div
        className="space-y-4"
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && ok && make.mutate()}
      >
        <div className="inline-flex max-w-full items-center gap-2 bg-zinc-100 px-2.5 py-1 text-sm text-zinc-600">
          <Rel className="size-4 shrink-0" />
          <span className="shrink-0">{relation}</span>
          <span className="shrink-0 font-mono text-xs text-zinc-500">#{from.number}</span>
          <span className="truncate text-zinc-800">{from.subject}</span>
        </div>
        <input
          autoFocus
          aria-label="Title"
          placeholder="Issue title"
          value={f.subject}
          maxLength={200}
          onChange={(e) => setF({ ...f, subject: e.target.value })}
          className="block w-full bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-zinc-300"
        />
        <textarea
          aria-label="Description"
          placeholder="Add description…"
          rows={5}
          value={f.body}
          onChange={(e) => setF({ ...f, body: e.target.value })}
          className="block w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-zinc-400"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4">
          <Listbox
            label="Priority"
            value={f.priority}
            onChange={(priority) => setF({ ...f, priority: priority as typeof f.priority })}
            trigger={{
              className: chip,
              children: (
                <>
                  <PriorityIcon priority={f.priority} /> {PRIORITY_LABEL[f.priority]}
                </>
              ),
            }}
            options={(['urgent', 'high', 'normal', 'low'] as const).map((p) => ({
              value: p,
              label: PRIORITY_LABEL[p],
              icon: priorityIcon(p),
            }))}
          />
          <Listbox
            searchable
            label="Assignee"
            value={f.assignee}
            onChange={(assignee) => setF({ ...f, assignee })}
            trigger={{
              className: chip,
              children: who ? (
                <>
                  <Avatar name={who.name} size={18} /> {who.name}
                </>
              ) : (
                <>
                  <UserRound className="size-4 text-zinc-500" /> Assignee
                </>
              ),
            }}
            options={[
              { value: '__none', label: 'Unassigned', icon: UserRound },
              ...(handlers.data ?? []).map((h) => ({ value: h.id, label: h.name })),
            ]}
          />
          <Listbox
            searchable
            label="Labels"
            value={null}
            values={f.labels}
            onChangeMany={(labels) => setF({ ...f, labels })}
            trigger={{
              className: chip,
              children: f.labels.length ? (
                <>
                  {f.labels.map((k) => {
                    const l = desk.data?.labels.find((x) => x.key === k);
                    return l ? (
                      <span key={k} className="inline-flex items-center gap-1.5">
                        <i className="size-2 rounded-full" style={{ background: l.color }} />
                        {l.label}
                      </span>
                    ) : null;
                  })}
                </>
              ) : (
                <>
                  <Tag className="size-4 text-zinc-500" /> Labels
                </>
              ),
            }}
            options={(desk.data?.labels ?? []).map((l) => ({
              value: l.key,
              label: l.label,
              icon: dotIcon(l.color),
            }))}
          />
        </div>
      </div>
    </Dialog>
  );
}

/** The star, and the "…" menu: create related tickets, mark as, copy, make a copy, favourite. */
export function TicketMenu({
  tenantId,
  t,
  editable,
  onChange,
  onHistory,
}: {
  tenantId: string;
  t: TicketDetail;
  editable: boolean;
  onChange(d: TicketDetail): void;
  onHistory?: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const desk = useDesk(tenantId);
  const [open, setOpen] = useState(false);
  const [related, setRelated] = useState<TicketLinkKind | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => (
      document.removeEventListener('mousedown', away),
      document.removeEventListener('keydown', esc)
    );
  }, [open]);
  const star = useMutation({
    mutationFn: () => api.setFavorite(t.id, !t.favorite),
    onSuccess: (d) => (
      onChange(d),
      toast(d.favorite ? 'Added to favorites' : 'Removed from favorites')
    ),
  });
  const patch = useMutation({
    mutationFn: (p: Parameters<typeof api.updateOrgTicket>[2]) =>
      api.updateOrgTicket(tenantId, t.id, p),
    onSuccess: onChange,
    onError: (e) => toast(e instanceof Error ? e.message : 'It could not be changed'),
  });
  const copy = (text: string, what: string) =>
    void navigator.clipboard?.writeText(text).then(() => toast(`${what} copied`));
  const duplicate = useMutation({
    mutationFn: async () => {
      const first = t.messages.find((m) => !m.internal && m.kind !== 'system' && !m.parentId);
      return api.createTicket(tenantId, {
        subject: `Copy of ${t.subject}`.slice(0, 200),
        body: first?.body || t.subject,
        priority: t.priority,
        audience: 'organisation',
      });
    },
    onSuccess: (d) =>
      void navigate({ to: '/o/$tenantId/support/$ticketId', params: { tenantId, ticketId: d.id } }),
    onError: (e) => toast(e instanceof Error ? e.message : 'It could not be copied'),
  });
  const org = editable && t.audience === 'organisation';
  const items: Item[] = [
    ...(org
      ? [
          {
            id: 'related',
            label: 'Create related',
            icon: SquarePlus,
            children: RELATED.map((r) => ({
              id: r.kind,
              label: `${r.title}…`,
              icon:
                r.kind === 'sub'
                  ? CornerDownRight
                  : r.kind === 'parent'
                    ? ArrowUpFromLine
                    : OctagonX,
              run: () => setRelated(r.kind),
            })),
          },
          {
            id: 'mark',
            label: 'Mark as',
            icon: Flag,
            children: [
              ...(desk.data?.stages ?? []).map((s) => ({
                id: `s-${s.key}`,
                label: s.label,
                icon: stageIcon(s.kind, s.key),
                on: t.stage?.key === s.key,
                run: () => patch.mutate({ stage: s.key }),
              })),
              ...(['urgent', 'high', 'normal', 'low'] as const).map((p, i) => ({
                id: `p-${p}`,
                label: `${PRIORITY_LABEL[p]} priority`,
                icon: priorityIcon(p),
                on: t.priority === p,
                divider: i === 0,
                run: () => patch.mutate({ priority: p }),
              })),
            ],
          } satisfies Item,
        ]
      : []),
    {
      id: 'copy',
      label: 'Copy',
      icon: Copy,
      divider: org,
      children: [
        {
          id: 'c-link',
          label: 'Copy link',
          icon: Link2,
          run: () => copy(window.location.href, 'Link'),
        },
        { id: 'c-id', label: 'Copy ID', icon: Copy, run: () => copy(`#${t.number}`, 'ID') },
        { id: 'c-title', label: 'Copy title', icon: Copy, run: () => copy(t.subject, 'Title') },
      ],
    },
    ...(org
      ? [{ id: 'dup', label: 'Make a copy…', icon: CopyPlus, run: () => duplicate.mutate() }]
      : []),
    {
      id: 'fav',
      label: t.favorite ? 'Remove from favorites' : 'Favorite',
      icon: Star,
      divider: true,
      run: () => star.mutate(),
    },
    ...(onHistory
      ? [
          {
            id: 'hist',
            label: 'Show description history',
            icon: History,
            divider: true,
            run: onHistory,
          },
        ]
      : []),
  ];
  return (
    <>
      <button
        type="button"
        aria-label={t.favorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={t.favorite}
        onClick={() => star.mutate()}
        className="flex size-8 items-center justify-center text-zinc-500 hover:bg-zinc-100 hover:text-ink"
      >
        <Star className={cx('size-4', t.favorite && 'fill-amber-400 text-amber-500')} />
      </button>
      <div ref={box} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More actions"
          onClick={() => setOpen(!open)}
          className={cx(
            'flex size-8 items-center justify-center text-zinc-500 hover:bg-zinc-100 hover:text-ink',
            open && 'bg-zinc-100',
          )}
        >
          <MoreHorizontal className="size-4" />
        </button>
        {open && (
          <div className="absolute end-0 top-full z-40 mt-1">
            <Menu items={items} onDone={() => setOpen(false)} />
          </div>
        )}
      </div>
      {related && (
        <CreateRelated
          tenantId={tenantId}
          from={t}
          kind={related}
          onClose={() => setRelated(null)}
          onChange={onChange}
        />
      )}
    </>
  );
}
