import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_LABEL, type ActivitySummaryDto, type AuditCategory, type AuditEntryDto } from '@grids/schema';
import { Button, DatePicker, Dialog, ErrorNotice, Input, Listbox, Pagination, Panel, RefreshControl, Table, Td, cx, dateTime, relTime, useLiveInterval, usePagination, useToast } from '@grids/ui';
import { ArrowDownRight, ArrowUpRight, ChevronDown, Eye, Download, EyeOff, FileCheck, FileDown, Filter, Globe, ImageDown, History, LayoutDashboard, List, Mail, Maximize2, MapPin, Pencil, Rows3, Search, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Avatar } from '../ui';
import { browserOf, changesOf, describe } from './activityText';
import { daysCsv, daysPng, listPng, niceMax, saveCsv, saveFile } from './activityExport';

const ICON: Record<AuditCategory, LucideIcon> = { submission: FileCheck, approval: ShieldCheck, invitation: Mail, view: Eye, public: Globe, entity: MapPin, access: Users, change: Pencil };
/** One colour per kind, readable on light and dark. */
const COLOR: Record<AuditCategory, string> = { submission: 'var(--brand-600)', approval: '#3b82a0', invitation: '#8b6bb5', view: '#b9bec8', public: '#7c5cc4', entity: '#c7842b', access: '#c9577f', change: '#d9a21b' };

const who = (e: AuditEntryDto) => e.actorEmail ?? (e.category === 'public' || e.details.via === 'link' ? 'Visitor' : 'System');

/** A number that counts up to its value (and from the old value to a new one on refresh). */
function Counter({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(a + (value - a) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown.toLocaleString()}</>;
}

/** Which charts the person has put away, remembered in this browser. */
const HIDDEN_KEY = 'grids.activity.hidden';
const VIEW_KEY = 'grids.activity.view';
const readHidden = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the choice just does not stick */
  }
};

type ViewKey = 'overview' | 'table' | 'timeline';
const VIEWS: [ViewKey, string, LucideIcon][] = [
  ['overview', 'Overview', LayoutDashboard],
  ['table', 'Table', List],
  ['timeline', 'Timeline', Rows3],
];

/** A chart's card: titled and described, a fixed least height so cards line up, and buttons to open it large or put it away. */
function ChartCard({ id, title, icon: I, note, about, minHeight, onHide, onExpand, children, className }: { id: string; title: string; icon: LucideIcon; note?: string; about: string; minHeight: string; onHide(id: string): void; onExpand(id: string): void; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('flex flex-col border border-zinc-200 bg-snow p-4', className)} style={{ minHeight }}>
      <header className="mb-3 flex items-start gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center bg-accent-50 text-accent-700">
          <I className="size-4" strokeWidth={1.75} />
        </span>
        <div className="me-auto min-w-0">
          <h3 className="text-sm font-semibold">
            {title} {note && <span className="text-xs font-normal text-zinc-400">· {note}</span>}
          </h3>
          <p className="text-xs text-zinc-500">{about}</p>
        </div>
        <button type="button" aria-label={`Open ${title} large`} title="Expand" onClick={() => onExpand(id)} className="p-1 text-zinc-400 hover:bg-zinc-100 hover:text-ink">
          <Maximize2 className="size-4" />
        </button>
        <button type="button" aria-label={`Hide ${title}`} title="Hide" onClick={() => onHide(id)} className="p-1 text-zinc-400 hover:bg-zinc-100 hover:text-ink">
          <EyeOff className="size-4" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/** Events per day as bars in the project's colour, with both axes named. Picking a bar opens that day. */
function BarChart({ days, onDay }: { days: ActivitySummaryDto['days']; onDay(day: string): void }) {
  const top = niceMax(Math.max(1, ...days.map((d) => d.total)));
  // The bars grow from nothing the first time they are drawn.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const step = Math.ceil(days.length / 14);
  return (
    <div className="flex min-h-56 flex-1 gap-2">
      <div className="flex w-5 items-center justify-center" aria-hidden>
        <span className="-rotate-90 text-[11px] whitespace-nowrap text-zinc-400">Events per day</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col ps-9">
        <div className="relative flex flex-1 items-end gap-px border-b border-s border-zinc-200 ps-px sm:gap-1" role="img" aria-label={`Events per day, last ${days.length} days`}>
          {[0, 0.5, 1].map((f) => (
            <span key={f} aria-hidden className="pointer-events-none absolute inset-x-0" style={{ bottom: `${f * 100}%` }}>
              <i className={cx('absolute inset-x-0 border-t border-dashed', f === 0 ? 'border-transparent' : 'border-zinc-100')} />
              <b className="absolute -start-9 w-7 -translate-y-1/2 text-end text-[11px] font-normal text-zinc-400 tabular-nums">{top * f}</b>
            </span>
          ))}
          {days.map((d) => (
            <button
              key={d.day}
              type="button"
              onClick={() => onDay(d.day)}
              title={`${new Date(`${d.day}T00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${d.total} ${d.total === 1 ? 'event' : 'events'}${AUDIT_CATEGORIES.filter((c) => d.byCategory[c]).map((c) => `\n${AUDIT_CATEGORY_LABEL[c]}: ${d.byCategory[c]}`).join('')}`}
              className="group relative z-10 flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              <i className="block w-full bg-accent-600 transition-[height,opacity] duration-700 ease-out group-hover:bg-accent-700" style={{ height: ready ? `${(d.total / top) * 100}%` : 0, minHeight: d.total ? 3 : 2, opacity: d.total ? 1 : 0.15 }} />
            </button>
          ))}
        </div>
        <div className="mt-1 flex gap-px ps-px sm:gap-1" aria-hidden>
          {days.map((d, i) => {
            const dt = new Date(`${d.day}T00:00`);
            const label = i % step === 0 || i === days.length - 1;
            return (
              <span key={d.day} className="min-w-0 flex-1 text-center text-[11px] leading-tight text-zinc-400">
                {label && dt.getDate()}
                {label && (i === 0 || dt.getDate() === 1) && <span className="block text-[10px] uppercase">{dt.toLocaleDateString(undefined, { month: 'short' })}</span>}
              </span>
            );
          })}
        </div>
        <div className="mt-1 text-center text-[11px] text-zinc-400">Day · the last bar is today</div>
      </div>
    </div>
  );
}

/** A ranked list with a bar behind each row. With `limit`, it always has that many places: the rest are held open with faint placeholders. */
function RankList({ rows, limit, empty, percent }: { rows: { label: string; count: number }[]; limit?: number; empty?: string; percent?: boolean }) {
  const top = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((n, r) => n + r.count, 0);
  const shown = rows.slice(0, limit);
  const blanks = limit ? Math.max(0, limit - shown.length) : 0;
  if (!rows.length && !limit) return <p className="text-xs text-zinc-500">Nothing yet.</p>;
  return (
    <div className="flex flex-1 flex-col">
      <ul className="space-y-2.5">
        {shown.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 text-[13px]">
            <span className="truncate">{r.label}</span>
            <span className="text-zinc-500 tabular-nums">
              {r.count.toLocaleString()}
              {percent && total > 0 && <span className="ms-2 inline-block w-9 text-end text-xs text-zinc-400">{Math.round((r.count / total) * 100)}%</span>}
            </span>
            <span className="col-span-2 mt-1 h-1 bg-zinc-100">
              <i className="block h-full bg-accent-600" style={{ width: `${(r.count / top) * 100}%` }} />
            </span>
          </li>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <li key={`blank-${i}`} aria-hidden className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 text-[13px]">
            <span className="h-4 w-2/5 bg-zinc-100/80" />
            <span className="h-4 w-6 bg-zinc-100/80" />
            <span className="col-span-2 mt-1 h-1 border-t border-dashed border-zinc-200" />
          </li>
        ))}
      </ul>
      {blanks > 0 && empty && <p className="mt-auto pt-3 text-xs text-zinc-400">{empty}</p>}
    </div>
  );
}

const CARD_INFO = {
  days: { title: 'Last 14 days', icon: History, about: 'Events recorded each day, of every kind. Click a bar to open that day in the table.' },
  places: { title: 'Where from', icon: MapPin, about: 'Towns and countries activity came from, by address.' },
  people: { title: 'Most active', icon: Users, about: 'Who did the most. Visitors are people not signed in.' },
} as const;
type CardId = keyof typeof CARD_INFO;

/** A chart at full size, over the page: pick how far back, then keep it as a CSV or a picture. */
function ExpandDialog({ id, tenantId, project, accent, onDay, onClose }: { id: CardId; tenantId: string; project?: string; accent: () => string; onDay(day: string): void; onClose(): void }) {
  const toast = useToast();
  const isDays = id === 'days';
  const choices = isDays ? [14, 30, 90, 180] : [7, 30, 90, 180];
  const [range, setRange] = useState(isDays ? 30 : 30);
  const query = isDays ? { days: range } : { span: range, limit: 200 };
  const data = useQuery({
    queryKey: ['activity-expand', tenantId, project ?? '', id, range],
    queryFn: () => (project ? api.projectActivitySummary(tenantId, project, query) : api.activitySummary(tenantId, query)),
  });
  const info = CARD_INFO[id];
  const subtitle = isDays ? `Events per day, last ${range} days` : `${info.about} Last ${range} days.`;
  const rows = id === 'places' ? data.data?.places : data.data?.people;
  const name = `${project ?? 'organisation'}-activity-${id}-${range}d`;
  const csv = () => {
    if (isDays && data.data) {
      const c = daysCsv(data.data.days);
      saveCsv(name, c.head, c.rows);
    } else if (rows) saveCsv(name, [id === 'places' ? 'Place' : 'Person', 'Events'], rows.map((r) => [r.label, r.count]));
  };
  const png = async () => {
    try {
      const blob = isDays && data.data ? await daysPng(data.data.days, info.title.replace('14', String(range)), subtitle, accent()) : rows ? await listPng(rows, info.title, subtitle, accent()) : null;
      if (blob) saveFile(blob, `${name}.png`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The picture could not be made');
    }
  };
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={isDays ? `Last ${range} days` : info.title}
      description={info.about}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">How far back</span>
          <Listbox compact label="How far back" value={String(range)} onChange={(v) => setRange(Number(v))} options={choices.map((n) => ({ value: String(n), label: `${n} days` }))} />
          <Listbox
            compact
            align="end"
            label="Download"
            value={null}
            disabled={!data.data}
            className="ms-auto"
            trigger={{
              className: 'ms-auto inline-flex h-8 items-center gap-1.5 border border-zinc-300 bg-snow px-3 text-[13px] font-medium hover:border-zinc-500 disabled:opacity-45',
              children: (
                <>
                  <Download className="size-4" /> Download
                </>
              ),
            }}
            options={[
              { value: 'csv', label: 'CSV', description: 'For a spreadsheet', icon: FileDown },
              { value: 'png', label: 'PNG', description: 'A picture to share', icon: ImageDown },
            ]}
            onChange={(v) => (v === 'csv' ? csv() : void png())}
          />
        </div>
        <ErrorNotice error={data.error} />
        {!data.data ? (
          <div className="grid min-h-60 place-items-center text-sm text-zinc-500">Loading…</div>
        ) : isDays ? (
          <div className="flex min-h-72 flex-col">
            <BarChart days={data.data.days} onDay={(d) => (onClose(), onDay(d))} />
          </div>
        ) : (
          <div className="max-h-[60vh] min-h-60 overflow-y-auto pe-1">
            <RankList rows={rows ?? []} limit={Math.max(rows?.length ?? 0, 8)} percent empty={id === 'places' ? 'More places appear as people use the project from other addresses.' : 'More people appear here as they take part.'} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** The week in numbers, then the charts: the last fortnight day by day, and who and where from. Picking a day shows that day in the table. */
function Overview({ data, tenantId, project, accent, onDay }: { data: ActivitySummaryDto; tenantId: string; project?: string; accent: () => string; onDay(day: string): void }) {
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [expanded, setExpanded] = useState<CardId | null>(null);
  const put = (next: string[]) => {
    setHidden(next);
    remember(HIDDEN_KEY, JSON.stringify(next));
  };
  const tiles: [string, keyof ActivitySummaryDto['tiles'], LucideIcon][] = [
    ['Events this week', 'events', History],
    ['Submissions', 'submissions', FileCheck],
    ['Changes', 'changes', Pencil],
    ['Public visits', 'publicVisits', Globe],
  ];
  const away = (Object.keys(CARD_INFO) as CardId[]).filter((id) => hidden.includes(id));
  return (
    <div className="space-y-3">
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, k, I]) => {
          const t = data.tiles[k];
          const delta = t.before ? Math.round(((t.now - t.before) / t.before) * 100) : null;
          return (
            <div key={k} className="flex flex-col border border-zinc-200 bg-snow p-4">
              <div className="flex items-start justify-between">
                <span className="flex size-9 items-center justify-center bg-accent-50 text-accent-700">
                  <I className="size-[18px]" strokeWidth={1.75} />
                </span>
                {delta !== null && delta !== 0 && (
                  <span className={cx('inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium', delta > 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-zinc-100 text-zinc-600')}>
                    {delta > 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                    {Math.abs(delta)}%
                  </span>
                )}
              </div>
              <div className={cx('num mt-4 text-[28px] leading-none font-semibold tracking-tight tabular-nums', t.now === 0 && 'text-zinc-400')}>
                <Counter value={t.now} />
              </div>
              <div className="mt-2 text-sm font-medium">{label}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{t.before.toLocaleString()} the week before</div>
            </div>
          );
        })}
      </section>
      {away.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          Hidden:
          {away.map((id) => {
            const I = CARD_INFO[id].icon;
            return (
              <button key={id} type="button" onClick={() => put(hidden.filter((x) => x !== id))} className="inline-flex h-7 items-center gap-1.5 border border-dashed border-zinc-300 px-2 text-zinc-700 hover:border-accent-600 hover:text-accent-800">
                <I className="size-3.5" /> {CARD_INFO[id].title} <Eye className="size-3.5" />
              </button>
            );
          })}
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {!hidden.includes('days') && (
          <ChartCard id="days" {...CARD_INFO.days} minHeight="21rem" onHide={(id) => put([...hidden, id])} onExpand={() => setExpanded('days')} className="lg:col-span-2">
            <BarChart days={data.days} onDay={onDay} />
          </ChartCard>
        )}
        {(['places', 'people'] as const).map((id) =>
          hidden.includes(id) ? null : (
            <ChartCard key={id} id={id} {...CARD_INFO[id]} note="30 days" minHeight="17rem" onHide={(x) => put([...hidden, x])} onExpand={() => setExpanded(id)}>
              <RankList rows={id === 'places' ? data.places : data.people} limit={5} empty={id === 'places' ? 'More places appear as people use the project from other addresses.' : 'More people appear here as they take part.'} />
            </ChartCard>
          ),
        )}
      </div>
      {expanded && <ExpandDialog id={expanded} tenantId={tenantId} project={project} accent={accent} onDay={onDay} onClose={() => setExpanded(null)} />}
    </div>
  );
}

/** What happened, by whom, from where: for a project (its managers) or for the whole organisation. Switch between an overview, a table and a timeline. */
export function ActivityLog({ tenantId, project, queryKey }: { tenantId: string; project?: string; queryKey: string }) {
  const live = useLiveInterval();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<AuditCategory[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [view, setViewState] = useState<ViewKey>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === 'table' || v === 'timeline' ? v : 'overview';
    } catch {
      return 'overview';
    }
  });
  const setView = (v: ViewKey) => (setViewState(v), remember(VIEW_KEY, v));
  const [open, setOpen] = useState<AuditEntryDto | null>(null);
  const [page, setPage] = usePagination([q, category, from, to, project], 25);
  const listing = view !== 'overview';
  const query = listing ? { ...page, ...(q.trim() && { q: q.trim() }), ...(category.length > 0 && { category: category.join(',') }), ...(from && { from: new Date(`${from}T00:00:00`).toISOString() }), ...(to && { to: new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString() }) } : { page: 1, pageSize: 1 };
  const log = useQuery({
    queryKey: [queryKey, tenantId, project ?? '', query],
    queryFn: () => (project ? api.projectActivity(tenantId, project, query) : api.activity(tenantId, query)),
    placeholderData: keepPreviousData,
    refetchInterval: live,
    enabled: listing,
  });
  const summary = useQuery({
    queryKey: [`${queryKey}-summary`, tenantId, project ?? ''],
    queryFn: () => (project ? api.projectActivitySummary(tenantId, project) : api.activitySummary(tenantId)),
    refetchInterval: live,
    enabled: view === 'overview',
  });
  const items = log.data?.items ?? [];
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex border border-zinc-300" role="tablist" aria-label="View">
          {VIEWS.map(([k, label, I]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={cx('inline-flex h-8 items-center gap-1.5 border-s border-zinc-300 px-3 text-[13px] first:border-s-0', view === k ? 'bg-accent-600 text-white' : 'bg-snow text-zinc-700 hover:bg-zinc-50')}>
              <I className="size-4" /> {label}
            </button>
          ))}
        </span>
        <span className="ms-auto">
          <RefreshControl queryKeys={[[queryKey], [`${queryKey}-summary`]]} />
        </span>
      </div>
      <ErrorNotice error={log.error ?? summary.error} />
      {view === 'overview' && (
        <>
          {summary.data ? <Overview data={summary.data} tenantId={tenantId} project={project} accent={() => getComputedStyle(root.current ?? document.documentElement).getPropertyValue('--brand-600').trim() || '#2f6b69'} onDay={(d) => (setFrom(d), setTo(d), setView('table'))} /> : <div className="grid min-h-48 place-items-center border border-zinc-200 bg-snow text-sm text-zinc-500">Loading…</div>}
        </>
      )}
      {listing && (
        <>
          <div className="grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)_10rem_10rem]">
            <Listbox
              label="Kind of activity"
              value={null}
              values={category}
              onChangeMany={(v) => setCategory(v)}
              trigger={{
                className: cx('inline-flex h-9 w-full items-center gap-2 border px-3 text-start text-sm', category.length ? 'border-accent-600 bg-accent-50 text-accent-800' : 'border-zinc-300 bg-snow text-zinc-700 hover:border-zinc-500'),
                children: (
                  <>
                    <Filter className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{category.length === 0 ? 'All kinds' : category.length === 1 ? AUDIT_CATEGORY_LABEL[category[0]!] : `${category.length} kinds selected`}</span>
                    <ChevronDown className="size-4 shrink-0 text-zinc-500" />
                  </>
                ),
              }}
              options={AUDIT_CATEGORIES.map((c) => ({ value: c, label: AUDIT_CATEGORY_LABEL[c], icon: ICON[c] }))}
            />
            <Input icon={Search} placeholder="Search people, places, addresses, details…" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            <DatePicker value={from} onChange={setFrom} placeholder="From" max={to || undefined} />
            <DatePicker value={to} onChange={setTo} placeholder="To" min={from || undefined} />
          </div>
          <Panel flush title={`${log.data?.total?.toLocaleString() ?? '–'} entries`}>
            {view === 'table' ? <EntryTable items={items} showProject={!project} onOpen={setOpen} /> : <Timeline items={items} showProject={!project} onOpen={setOpen} />}
            {log.data && <Pagination {...page} total={log.data.total} onChange={setPage} />}
          </Panel>
        </>
      )}
      {open && <EntryDialog e={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

const EyeButton = ({ e, onOpen }: { e: AuditEntryDto; onOpen(e: AuditEntryDto): void }) => (
  <button type="button" aria-label={`See details: ${describe(e).what}`} title="Details" onClick={(ev) => (ev.stopPropagation(), onOpen(e))} className="inline-flex size-8 items-center justify-center text-zinc-500 hover:bg-accent-50 hover:text-accent-800">
    <Eye className="size-4" />
  </button>
);

function EntryTable({ items, showProject, onOpen }: { items: AuditEntryDto[]; showProject: boolean; onOpen(e: AuditEntryDto): void }) {
  return (
    <Table head={['When', 'Who', 'What', 'From', '']} empty="Nothing here yet.">
      {items.map((e) => {
        const d = describe(e);
        const I = ICON[e.category];
        return (
          <tr key={e.id} className="align-top hover:bg-zinc-50">
            <Td className="whitespace-nowrap text-xs text-zinc-500">
              <div className="text-zinc-700">{relTime(e.at)}</div>
              <div>{dateTime(e.at)}</div>
            </Td>
            <Td>
              {e.actorEmail ? (
                <span className="flex items-center gap-2 text-zinc-700">
                  <Avatar name={e.actorEmail} className="size-6 text-[10px]" /> {e.actorEmail}
                </span>
              ) : (
                <span className="text-zinc-500">{who(e)}</span>
              )}
            </Td>
            <Td>
              <div className="flex items-center gap-2.5">
                <I className="size-4 shrink-0 text-zinc-400" aria-hidden />
                <div className="min-w-0">
                  <div className="font-medium">{d.what}</div>
                  {d.detail && <div className="truncate text-xs text-zinc-500">{d.detail}</div>}
                  {showProject && e.project && <div className="text-xs text-zinc-400">in {e.project}</div>}
                </div>
              </div>
            </Td>
            <Td className="text-xs whitespace-nowrap">
              <div className="font-mono text-zinc-700">{e.ip ?? '–'}</div>
              <div className="text-zinc-500">{e.location ?? ''}</div>
            </Td>
            <Td className="text-end">
              <EyeButton e={e} onOpen={onOpen} />
            </Td>
          </tr>
        );
      })}
    </Table>
  );
}

const dayOf = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, new Date(today.getTime() - 86_400_000))) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
};

/** The same entries as a story, grouped by day with a marker for each kind. */
function Timeline({ items, showProject, onOpen }: { items: AuditEntryDto[]; showProject: boolean; onOpen(e: AuditEntryDto): void }) {
  if (!items.length) return <p className="px-4 py-10 text-center text-sm text-zinc-500">Nothing here yet.</p>;
  const days: [string, AuditEntryDto[]][] = [];
  for (const e of items) {
    const d = dayOf(e.at);
    const last = days.at(-1);
    if (last?.[0] === d) last[1].push(e);
    else days.push([d, [e]]);
  }
  return (
    <div className="px-4 pb-4">
      {days.map(([day, list]) => (
        <section key={day}>
          <h4 className="mt-4 mb-2 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">{day}</h4>
          <ol className="relative ms-3 border-s-2 border-zinc-200">
            {list.map((e) => {
              const d = describe(e);
              const I = ICON[e.category];
              return (
                <li key={e.id} className="group relative -ms-px flex items-center gap-3 py-2 ps-6 pe-2 hover:bg-zinc-50">
                  <span className="absolute -start-[13px] flex size-6 items-center justify-center rounded-full border-2 bg-snow" style={{ borderColor: COLOR[e.category], color: COLOR[e.category] }}>
                    <I className="size-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      <span className="font-medium">{who(e).split('@')[0]}</span> <span className="text-zinc-700">{d.what.charAt(0).toLowerCase() + d.what.slice(1)}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
                      <span>{relTime(e.at)}</span>
                      {e.location && <span>{e.location}</span>}
                      {e.ip && <span className="font-mono">{e.ip}</span>}
                      {d.detail && <span>{d.detail}</span>}
                      {showProject && e.project && <span>in {e.project}</span>}
                    </div>
                  </div>
                  <EyeButton e={e} onOpen={onOpen} />
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Everything recorded about one entry, with what it was before and after when it changed something. */
function EntryDialog({ e, onClose }: { e: AuditEntryDto; onClose(): void }) {
  const d = describe(e);
  const changes = changesOf(e.details);
  const submission = e.category === 'submission';
  const rest = Object.fromEntries(Object.entries(e.details).filter(([k]) => k !== 'changes' && k !== 'project'));
  const row = (label: string, value: string | null | undefined, mono = false) =>
    value ? (
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2 text-sm">
        <dt className="text-zinc-500">{label}</dt>
        <dd className={cx('break-words', mono && 'font-mono text-xs')}>{value}</dd>
      </div>
    ) : null;
  const ICON_ = ICON[e.category];
  return (
    <Dialog open wide onClose={onClose} title={d.what} description={d.detail}>
      <div className="space-y-5">
        {changes.length > 0 && (
          <section>
            <h4 className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">{submission ? 'What was sent' : 'What changed'}</h4>
            <div className="overflow-x-auto border border-zinc-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 text-start text-[11px] tracking-wider text-zinc-500 uppercase">
                    <th className="px-3 py-2 text-start font-medium">Field</th>
                    {!submission && <th className="px-3 py-2 text-start font-medium">Before</th>}
                    <th className="px-3 py-2 text-start font-medium">{submission ? 'Answer' : 'After'}</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c, i) => (
                    <tr key={i} className="border-t border-zinc-100 align-top">
                      <td className="px-3 py-2 font-medium">{c.field}</td>
                      {!submission && <td className={cx('px-3 py-2 break-words', c.before !== null && 'bg-red-50 text-red-800')}>{c.before === null ? <span className="text-zinc-400 italic">none</span> : <s>{c.before}</s>}</td>}
                      <td className={cx('px-3 py-2 break-words', c.after !== null && !submission && 'bg-emerald-50 text-emerald-900')}>{c.after === null ? <span className="text-zinc-400 italic">removed</span> : c.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <section>
          <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
            <ICON_ className="size-3.5" /> Who and where
          </h4>
          <dl className="divide-y divide-zinc-100">
            {row('When', dateTime(e.at))}
            {row('Who', e.actorEmail ?? (e.category === 'public' ? 'A visitor, not signed in' : 'System'))}
            {row('Kind', AUDIT_CATEGORY_LABEL[e.category])}
            {row('Project', e.project)}
            {row('Address', e.ip, true)}
            {row('Place', e.location)}
            {row('Browser', browserOf(e.userAgent))}
            {row('Action', e.action, true)}
          </dl>
        </section>
        {Object.keys(rest).length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-zinc-500 hover:text-ink">Technical details</summary>
            <pre className="mt-2 max-h-60 overflow-auto bg-zinc-50 p-3 font-mono text-xs leading-5">{JSON.stringify(rest, null, 2)}</pre>
          </details>
        )}
      </div>
    </Dialog>
  );
}
