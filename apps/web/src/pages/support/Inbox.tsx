import { ting } from '@grids/viz';
import { Board } from './Board';
import { FilterMenu, type FilterCategory, type FilterValue } from './FilterMenu';
import { StatsPanel } from './Stats';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { TicketSummary } from '@grids/schema';
import {
  Button,
  EmptyState,
  ErrorNotice,
  Input,
  Listbox,
  Loading,
  Pagination,
  RefreshControl,
  Tabs,
  cx,
  useLiveInterval,
  usePagination,
} from '@grids/ui';
import {
  Building2,
  CheckCircle2,
  CircleDashed,
  Columns3,
  Network,
  OctagonX,
  List,
  CircleDot,
  Flag,
  FolderKanban,
  Globe2,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Plus,
  Rows3,
  Sparkles,
  Search,
  Star,
  Tag,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { useT } from '../../i18n';
import { NoAccess, useCan, useMe, useWorkspace } from '../../session';
import { NewTicket } from './NewTicket';
import {
  Avatar,
  LabelChip,
  PRIORITY_LABEL,
  PriorityIcon,
  dotIcon,
  priorityIcon,
  useHandlers,
  stageIcon,
  StagePill,
  labelsOf,
  useDesk,
} from './shared';

type Tab = 'overview' | 'new' | 'active' | 'resolved' | 'favorites' | 'all';
type View = 'everything' | 'mine' | 'unassigned' | 'help' | 'grids';
type Group = 'none' | 'stage' | 'assignee' | 'project';

const VIEWS: { id: View; label: string; icon: typeof Inbox }[] = [
  { id: 'everything', label: 'Everything', icon: Inbox },
  { id: 'mine', label: 'Assigned to me', icon: UserRound },
  { id: 'unassigned', label: 'Unassigned', icon: CircleDot },
  { id: 'help', label: 'From the help window', icon: LifeBuoy },
  { id: 'grids', label: 'With the Grids team', icon: Building2 },
];

/**
 * The organisation's support inbox, in the Linear way: one dense list you can scan and move through from the keyboard,
 * with saved views, filters and grouping. Each row opens a ticket with the conversation and its properties.
 */
/** 15m, 3h, 2d, 5w: short enough that the column never needs "ago". */
function short(at: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 10080) return `${Math.floor(m / 1440)}d`;
  return `${Math.floor(m / 10080)}w`;
}

export function SupportPage() {
  const t = useT();
  const ws = useWorkspace();
  const can = useCan();
  const navigate = useNavigate();
  const live = useLiveInterval();
  const id = ws.tenant.id;
  const manager = can('support.manage');
  const [tab, setTab] = useState<Tab>('active');
  const [view, setView] = useState<View>('everything');
  const [group, setGroup] = useState<Group>('none');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValue>({});
  const [page, setPage] = usePagination([tab, view, q, filters], 25);
  const [layoutPref, setLayout] = useState<'list' | 'board'>('list');
  // The board only exists on the All tab; the other tabs are always a list.
  const layout = tab === 'all' ? layoutPref : 'list';
  const [cursor, setCursor] = useState(0);
  const [creating, setCreating] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const desk = useDesk(id, can('support.view'));
  const handlers = useHandlers(id, manager);
  // Projects are named on tickets by their key; the groups show their names.
  const projects = useQuery({
    queryKey: ['projects', id, false],
    queryFn: () => api.projects(id, false),
    staleTime: 60_000,
    enabled: can('support.view'),
  });
  const projectName = (key: string) => projects.data?.find((p) => p.key === key)?.name ?? key;
  const categories = useMemo<FilterCategory[]>(
    () => [
      {
        id: 'priority',
        label: 'Priority',
        icon: Flag,
        options: (['urgent', 'high', 'normal', 'low'] as const).map((p) => ({
          value: p,
          label: PRIORITY_LABEL[p],
          icon: priorityIcon(p),
        })),
      },
      {
        id: 'stage',
        label: 'Stage',
        icon: CircleDashed,
        options: (desk.data?.stages ?? []).map((s) => ({
          value: s.key,
          label: s.label,
          icon: stageIcon(s.kind, s.key),
        })),
      },
      ...(manager
        ? [
            {
              id: 'assignee',
              label: 'Assignee',
              icon: UserRound,
              options: [
                { value: 'me', label: 'Me', icon: UserRound },
                { value: 'none', label: 'Unassigned', icon: CircleDot },
                ...(handlers.data ?? []).map((h) => ({ value: h.id, label: h.name })),
              ],
            },
          ]
        : []),
      {
        id: 'label',
        label: 'Labels',
        icon: Tag,
        options: (desk.data?.labels ?? []).map((l) => ({
          value: l.key,
          label: l.label,
          icon: dotIcon(l.color),
        })),
      },
    ],
    [desk.data, handlers.data, manager],
  );
  const query = useMemo(
    () => ({
      status:
        tab === 'all' || tab === 'overview' || tab === 'favorites' || tab === 'new'
          ? undefined
          : tab,
      ...(view === 'mine' && { assignee: 'me' }),
      ...(view === 'unassigned' && { assignee: 'none' }),
      ...(view === 'help' && { channel: 'help' }),
      ...(tab === 'favorites' && { favorite: 'true' }),
      ...(tab === 'new' && { untouched: 'true' }),
      ...(view === 'grids' && { audience: 'platform' }),
      ...Object.fromEntries(
        Object.entries(filters)
          .filter(([, v]) => v.length)
          .map(([k, v]) => [k, v.join(',')]),
      ),
      ...(q.trim() && { q: q.trim() }),
      ...(layout === 'board' ? { page: 1, pageSize: 100 } : page),
    }),
    [tab, view, filters, q, page, layout],
  );
  const tickets = useQuery({
    queryKey: ['tickets', id, query],
    queryFn: () => api.tickets(id, query),
    placeholderData: keepPreviousData,
    refetchInterval: live,
    enabled: can('support.view'),
  });
  const items = tickets.data?.items ?? [];
  // How many requests nobody has touched yet (the badge on the New tab).
  const fresh = useQuery({
    queryKey: ['tickets', id, 'fresh'],
    queryFn: () => api.tickets(id, { untouched: 'true', page: 1, pageSize: 5 }),
    refetchInterval: live,
    enabled: can('support.view'),
  });
  // A ting when a new request shows up while the page is open (not for ones this person made, and not when the view changes).
  const me = useMe();
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem('grids-desk-sound') !== 'off';
    } catch {
      return true;
    }
  });
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    known.current = null;
  }, [query]);
  useEffect(() => {
    const rows = tickets.data?.items;
    if (!rows || tickets.isPlaceholderData) return;
    const before = known.current;
    known.current = new Set(rows.map((r) => r.id));
    if (
      before &&
      sound &&
      rows.some(
        (r) =>
          !before.has(r.id) &&
          r.createdBy.id !== me.id &&
          Date.now() - new Date(r.createdAt).getTime() < 5 * 60_000,
      )
    )
      ting();
  }, [tickets.data, tickets.isPlaceholderData, sound, me.id]);
  const qc = useQueryClient();
  const move = useMutation({
    mutationFn: ({ ticket, stage }: { ticket: TicketSummary; stage: string }) =>
      api.updateOrgTicket(id, ticket.id, { stage }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['tickets', id] }),
  });
  const open = (ticket: TicketSummary) =>
    void navigate({
      to: '/o/$tenantId/support/$ticketId',
      params: { tenantId: id, ticketId: ticket.id },
    });

  // Rows grouped the way the person asked, in the order the organisation set its stages.
  const groups = useMemo(() => {
    if (group === 'none') return [{ key: 'all', title: '', rows: items }];
    const by = new Map<string, TicketSummary[]>();
    for (const r of items) {
      const k =
        group === 'stage'
          ? (r.stage?.key ?? 'none')
          : group === 'project'
            ? (r.sourceProject ?? 'none')
            : (r.assignee?.id ?? 'none');
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    const order = group === 'stage' ? (desk.data?.stages.map((s) => s.key) ?? []) : [];
    const title = (k: string, rows: TicketSummary[]) =>
      group === 'stage'
        ? (rows[0]?.stage?.label ?? 'No stage')
        : group === 'project'
          ? k === 'none'
            ? 'No project'
            : projectName(k)
          : k === 'none'
            ? 'Unassigned'
            : (rows[0]?.assignee?.name ?? 'Someone');
    return [...by.entries()]
      .sort(
        ([a], [b]) =>
          (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) -
          (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
      )
      .map(([k, rows]) => ({ key: k, title: title(k, rows), rows }));
  }, [group, items, desk.data, projects.data]);
  const flat = groups.flatMap((g) => g.rows);

  // Keyboard: j and k (or the arrows) move, Enter opens, / searches, c makes a ticket.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        el.closest(
          'input, textarea, select, [contenteditable], dialog, [role=dialog], [role=listbox]',
        ) ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (e.key === 'j' || e.key === 'ArrowDown')
        (e.preventDefault(), setCursor((c) => Math.min(flat.length - 1, c + 1)));
      else if (e.key === 'k' || e.key === 'ArrowUp')
        (e.preventDefault(), setCursor((c) => Math.max(0, c - 1)));
      else if (e.key === 'Enter' && flat[cursor]) open(flat[cursor]!);
      else if (e.key === '/') (e.preventDefault(), search.current?.focus());
      else if (e.key === 'c' && can('support.create')) (e.preventDefault(), setCreating(true));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  useEffect(() => setCursor(0), [tab, view, q, filters, group]);
  useEffect(() => {
    document
      .querySelector<HTMLElement>('[data-cursor="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!can('support.view')) return <NoAccess what="support" />;
  const filtered =
    Object.values(filters).some((v) => v.length) || !!q.trim() || view !== 'everything';
  return (
    <div className="-mt-2">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="me-auto flex items-center gap-2.5 text-xl font-semibold tracking-tight">
          <LifeBuoy className="size-5 text-zinc-500" /> {t('web.nav.support')}
        </h1>
        <RefreshControl queryKeys={[['tickets', id]]} />
        <button
          type="button"
          aria-pressed={sound}
          aria-label={sound ? 'Turn the new-request sound off' : 'Turn the new-request sound on'}
          title={sound ? 'Sound on for new requests' : 'Sound off'}
          onClick={() => {
            const next = !sound;
            setSound(next);
            try {
              localStorage.setItem('grids-desk-sound', next ? 'on' : 'off');
            } catch {
              /* private window */
            }
            if (next) ting();
          }}
          className="flex h-9 w-9 items-center justify-center text-zinc-500 hover:bg-zinc-100 hover:text-ink"
        >
          {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        </button>
        {can('support.create') && (
          <Button icon={Plus} onClick={() => setCreating(true)}>
            New ticket
          </Button>
        )}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ...(manager
            ? [{ id: 'overview' as const, label: 'Overview', icon: LayoutDashboard }]
            : []),
          { id: 'new', label: 'New', icon: Sparkles, count: fresh.data?.total || undefined },
          { id: 'active', label: 'Open', icon: CircleDot },
          { id: 'resolved', label: 'Resolved', icon: CheckCircle2 },
          { id: 'favorites', label: 'Favorites', icon: Star },
          { id: 'all', label: 'All', icon: ListChecks },
        ]}
      />
      {tab === 'overview' ? (
        <StatsPanel />
      ) : (
        <>
          {/* Views, and the filters that narrow them. */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <Listbox
              searchable
              label="View"
              className="w-56"
              value={view}
              onChange={(v) => setView(v as View)}
              options={VIEWS.filter(
                (v) => manager || v.id === 'everything' || v.id === 'grids',
              ).map((v) => ({ value: v.id, label: v.label, icon: v.icon }))}
            />
            <div className="w-56">
              <Input
                ref={search}
                icon={Search}
                aria-label="Search tickets"
                placeholder="Search tickets, people, labels ( / )"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <FilterMenu categories={categories} value={filters} onChange={setFilters} />
            {filtered && (
              <button
                type="button"
                onClick={() => (setView('everything'), setQ(''), setFilters({}))}
                className="inline-flex h-9 items-center gap-1 text-xs text-zinc-500 hover:text-ink"
              >
                <X className="size-3.5" /> Clear
              </button>
            )}
            {tab === 'all' && (
              <button
                type="button"
                onClick={() => setLayout(layout === 'list' ? 'board' : 'list')}
                className="ms-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-zinc-700 hover:bg-zinc-100"
                title={layout === 'list' ? 'Show as a board' : 'Show as a list'}
              >
                {layout === 'list' ? <Columns3 className="size-4" /> : <List className="size-4" />}
                {layout === 'list' ? 'Board' : 'List'}
              </button>
            )}
            <Listbox
              searchable
              align="end"
              label="Group by"
              className={cx('w-36', tab !== 'all' && 'ms-auto', layout === 'board' && 'hidden')}
              value={group}
              onChange={(g) => setGroup(g as Group)}
              options={[
                { value: 'none' as Group, label: 'No grouping', icon: Rows3 },
                { value: 'stage' as Group, label: 'Group by stage', icon: CircleDashed },
                { value: 'project' as Group, label: 'Group by project', icon: FolderKanban },
                ...(manager
                  ? [{ value: 'assignee' as Group, label: 'Group by assignee', icon: UserRound }]
                  : []),
              ]}
            />
          </div>
          <ErrorNotice error={tickets.error} />
          {layout === 'board' ? (
            tickets.isPending ? (
              <Loading />
            ) : (
              <Board
                items={items}
                desk={desk.data}
                show={(k) =>
                  tab === 'active' || tab === 'new'
                    ? k !== 'done'
                    : tab === 'resolved'
                      ? k === 'done'
                      : true
                }
                onOpen={open}
                onMove={(ticket, stage) => move.mutate({ ticket, stage })}
                onCreate={can('support.create') ? () => setCreating(true) : undefined}
              />
            )
          ) : (
            <div className="border border-zinc-200 bg-snow">
              {tickets.isPending ? (
                <Loading />
              ) : (
                <>
                  <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-zinc-200 bg-zinc-50 ps-4 pe-6 py-1.5 text-xs font-medium text-zinc-500">
                    <span className="w-4" />
                    <span className="w-14">ID</span>
                    <span>Title</span>
                    <span className="flex items-center justify-end gap-3">
                      <span className="w-44">Status</span>
                      <span className="w-10" />
                      <span className="hidden w-28 lg:block">Requester</span>
                      <span className="w-[22px] text-center" title="Assignee">
                        To
                      </span>
                      <span className="w-12 text-end">Updated</span>
                    </span>
                  </div>
                  {!items.length && (
                    <EmptyState
                      icon={LifeBuoy}
                      title={
                        filtered
                          ? 'Nothing matches'
                          : tab === 'resolved'
                            ? 'Nothing resolved yet'
                            : tab === 'new'
                              ? 'Nothing new'
                              : tab === 'favorites'
                                ? 'No favorites yet'
                                : 'Inbox zero'
                      }
                    >
                      {filtered
                        ? 'Try a different view or clear the filters.'
                        : tab === 'favorites'
                          ? 'Star a ticket (the star at the top of it) to find it here.'
                          : 'New requests from your team and from people using your pages appear here.'}
                    </EmptyState>
                  )}
                  {groups.map((g) => (
                    <section key={g.key}>
                      {g.title && (
                        <h2 className="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-1.5 text-xs font-semibold text-zinc-700">
                          {group === 'stage' && g.rows[0]?.stage && (
                            <span
                              className={cx(
                                'size-2 rounded-full',
                                g.rows[0].stage.kind === 'done'
                                  ? 'bg-emerald-500'
                                  : g.rows[0].stage.kind === 'active'
                                    ? 'bg-amber-500'
                                    : 'bg-zinc-400',
                              )}
                            />
                          )}
                          {group === 'assignee' && <Avatar name={g.title} size={16} />}
                          {g.title}{' '}
                          <span className="font-normal text-zinc-500">{g.rows.length}</span>
                        </h2>
                      )}
                      <ul>
                        {g.rows.map((r) => {
                          const idx = flat.indexOf(r);
                          const active = idx === cursor;
                          const labels = labelsOf(desk.data, r.labels);
                          return (
                            <li
                              key={r.id}
                              data-cursor={active}
                              className={cx(
                                'border-b border-zinc-100 last:border-b-0',
                                active &&
                                  'bg-accent-50/60 shadow-[inset_2px_0_0_var(--color-accent-600)]',
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => open(r)}
                                onMouseMove={() => idx !== cursor && setCursor(idx)}
                                className="grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 ps-4 pe-6 py-2 text-start text-sm hover:bg-zinc-50"
                              >
                                <PriorityIcon priority={r.priority} />
                                <span className="w-14 font-mono text-xs text-zinc-500 tabular-nums">
                                  #{r.number}
                                </span>
                                <span className="flex min-w-0 items-center gap-2">
                                  <span
                                    className={cx(
                                      'truncate',
                                      r.stage?.kind === 'done' ? 'text-zinc-500' : 'font-medium',
                                    )}
                                  >
                                    {r.subject}
                                  </span>
                                  {labels.slice(0, 3).map((l) => (
                                    <LabelChip key={l.key} label={l} />
                                  ))}
                                  {labels.length > 3 && (
                                    <span className="text-xs text-zinc-400">
                                      +{labels.length - 3}
                                    </span>
                                  )}
                                  {r.subTotal > 0 && (
                                    <span
                                      className="inline-flex shrink-0 items-center gap-1 text-xs text-zinc-400"
                                      title={`${r.subDone} of ${r.subTotal} sub-issues done`}
                                    >
                                      <Network className="size-3.5" /> {r.subDone}/{r.subTotal}
                                    </span>
                                  )}
                                  {r.blockedBy > 0 && (
                                    <OctagonX
                                      className="size-3.5 shrink-0 text-red-600"
                                      aria-label="Blocked"
                                    />
                                  )}
                                  {r.messageCount > 1 && (
                                    <span className="shrink-0 text-xs text-zinc-400">
                                      {r.messageCount}
                                    </span>
                                  )}
                                </span>
                                <span className="flex items-center justify-end gap-3">
                                  <span className="flex w-44 min-w-0 justify-start">
                                    <StagePill
                                      stage={
                                        r.stage ??
                                        (r.status === 'resolved' || r.status === 'closed'
                                          ? {
                                              key: r.status,
                                              label: r.status[0]!.toUpperCase() + r.status.slice(1),
                                              kind: 'done',
                                            }
                                          : {
                                              key: r.status,
                                              label:
                                                r.audience === 'platform' ? 'With Grids' : 'Open',
                                              kind: 'open',
                                            })
                                      }
                                    />
                                  </span>
                                  <span className="flex w-10 items-center justify-start gap-1.5">
                                    {r.audience === 'platform' && (
                                      <Building2
                                        className="size-3.5 text-violet-500"
                                        aria-label="With the Grids team"
                                      />
                                    )}
                                    {r.channel === 'help' && (
                                      <Globe2
                                        className="size-3.5 text-sky-500"
                                        aria-label="From the help window"
                                      />
                                    )}
                                  </span>
                                  <span className="hidden w-28 truncate text-xs text-zinc-500 lg:block">
                                    {r.createdBy.name}
                                  </span>
                                  {r.assignee ? (
                                    <Avatar name={r.assignee.name} />
                                  ) : (
                                    <span
                                      className="size-[22px] rounded-full border border-dashed border-zinc-300"
                                      title="Unassigned"
                                    />
                                  )}
                                  <span className="w-12 text-end text-xs whitespace-nowrap text-zinc-400">
                                    {short(r.updatedAt)}
                                  </span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </>
              )}
              {tickets.data && tickets.data.total > 0 && (
                <Pagination
                  {...page}
                  total={tickets.data.total}
                  onChange={setPage}
                  sizes={[25, 50, 100]}
                />
              )}
            </div>
          )}
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-400">
            <span>
              <kbd className="border border-zinc-300 px-1">j</kbd>{' '}
              <kbd className="border border-zinc-300 px-1">k</kbd> move
            </span>
            <span>
              <kbd className="border border-zinc-300 px-1">Enter</kbd> open
            </span>
            <span>
              <kbd className="border border-zinc-300 px-1">/</kbd> search
            </span>
            {can('support.create') && (
              <span>
                <kbd className="border border-zinc-300 px-1">c</kbd> new ticket
              </span>
            )}
          </p>
        </>
      )}
      {creating && <NewTicket onClose={() => setCreating(false)} />}
    </div>
  );
}
