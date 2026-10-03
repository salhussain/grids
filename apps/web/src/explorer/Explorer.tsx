import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { DashboardDto, MapOverlayDto, PlaceNode, SearchHit } from '@grids/schema';
import { applyColorMode, cx, Spinner } from '@grids/ui';
import { ArrowUp, Check, ChevronRight, Layers, Map as MapIcon, Moon, PanelRightClose, PanelRightOpen, Satellite, Search, Sun, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DashboardFilterBar } from '../viz/DashboardFilters';
import { FreshnessBadge } from '../viz/Freshness';
import { useScheme } from '../viz/scheme';
import { WidgetView } from '../viz/WidgetView';
import { NO_DATA, scaleFor } from './colors';
import { ExplorerMap, type Basemap, type PlaceCollection, type PlaceFeature } from './ExplorerMap';
import type { ExplorerSource } from './source';

type Search = { entity?: string; overlay?: string; dashboard?: string };

/** Explorer state lives in the URL, so every view is a shareable link. */
function useExplorerSearch(): [Search, (patch: Partial<Search>) => void] {
  const search = useRouterState({ select: (s) => s.location.search }) as Search;
  const navigate = useNavigate();
  const set = (patch: Partial<Search>) =>
    void navigate({ to: '.', search: ((prev: Search) => {
      const next = { ...prev, ...patch };
      for (const k of Object.keys(next) as (keyof Search)[]) if (!next[k]) delete next[k];
      return next;
    }) as never });
  return [search, set];
}

/** Floating "glass" surface over the map (follows the colour mode). */
const glass = 'rounded-2xl border border-zinc-200/80 bg-snow/85 shadow-[var(--shadow-raised)] backdrop-blur-xl';
const SHEET_W = 460;

const windowLabel = (o: MapOverlayDto) =>
  o.hours === null
    ? 'Latest values'
    : o.hours % (24 * 7) === 0
      ? `Last ${o.hours / (24 * 7) === 1 ? 'week' : `${o.hours / (24 * 7)} weeks`}`
      : o.hours % 24 === 0
        ? `Last ${o.hours / 24} days`
        : `Last ${o.hours} hours`;
const AGG_LABEL: Record<string, string> = { sum: 'total', avg: 'average', min: 'minimum', max: 'maximum', count: 'reports', distinct: 'places reporting', last: 'latest' };

export interface ExplorerProps {
  source: ExplorerSource;
  title: string;
  subtitle?: string;
  logo?: ReactNode;
  /** Top-right controls (account, studio link). */
  actions?: ReactNode;
  /** Shown in the layers card when the project has no overlays (e.g. a link to set them up). */
  emptyOverlays?: ReactNode;
  live?: ReactNode;
  /** Brand colour (outlines, accents). */
  accent: string;
  /** The organisation's basemap style URLs. */
  mapStyles?: { light: string | null; dark: string | null };
}

/**
 * The map-first project explorer (spec §9). The map fills the screen; layers,
 * the place trail and the place's dashboards float over it as glass cards.
 */
export function Explorer({ source, title, subtitle, logo, actions, emptyOverlays, live, accent, mapStyles }: ExplorerProps) {
  const scheme = useScheme();
  const [search, setSearch] = useExplorerSearch();
  const entity = search.entity ?? null;
  const [sheetOpen, setSheetOpen] = useState(true);
  const [basemap, setBasemap] = useState<Basemap>('map');

  const here = useQuery({ queryKey: [...source.keys.explore, entity], queryFn: () => source.explore(entity), placeholderData: (p) => p });
  // A place without places inside it is shown among its siblings.
  const leaf = !!here.data?.entity && here.data.children.features.length === 0;
  const parentId = leaf ? (here.data!.ancestors.at(-1)?.id ?? null) : null;
  const parent = useQuery({ queryKey: [...source.keys.explore, parentId], queryFn: () => source.explore(parentId), enabled: leaf });
  const shownAt = leaf ? parentId : entity;

  const overlays = useQuery({ queryKey: source.keys.overlays, queryFn: () => source.overlays() });
  const overlay = overlays.data?.find((o) => o.key === search.overlay) ?? null;
  const values = useQuery({
    queryKey: [...source.keys.overlays, 'values', overlay?.key, shownAt],
    queryFn: () => source.overlay(overlay!.key, shownAt),
    enabled: !!overlay,
    placeholderData: (p) => p,
  });

  const scale = useMemo(() => (overlay && values.data ? scaleFor(overlay, values.data.min, values.data.max) : null), [overlay, values.data]);
  const places: PlaceCollection | undefined = (overlay ? values.data?.features : leaf ? parent.data?.children : here.data?.children) as PlaceCollection | undefined;
  const fmt = (v: number) => `${v.toLocaleString(undefined, { maximumFractionDigits: overlay?.decimals ?? 0 })}${overlay?.unit ? ` ${overlay.unit}` : ''}`;
  const colorOf = useMemo(() => (scale ? (p: PlaceFeature['properties']) => scale.color((p.value as number | null) ?? null) : undefined), [scale]);
  const detailOf = useMemo(
    () => (overlay ? (p: PlaceFeature['properties']) => (p.value === null || p.value === undefined ? 'No data' : fmt(p.value as number)) : undefined),
    [overlay],
  );
  const noData = !!overlay && !!values.data && values.data.min === null;
  const level = overlay?.level ? null : ((leaf ? parent.data?.childLevel : here.data?.childLevel) ?? null);
  const placeName = here.data?.entity?.name ?? title;
  const go = (id: string | null) => setSearch({ entity: id ?? undefined });
  const right = sheetOpen ? SHEET_W + 32 : 16;

  return (
    <div className="explorer fixed inset-0 overflow-hidden bg-canvas text-ink">
      <ExplorerMap
        places={places}
        self={(here.data?.self as PlaceFeature | null) ?? null}
        bounds={here.data?.bounds ?? null}
        colorOf={colorOf}
        detailOf={detailOf}
        onSelect={(p) => go(p.id)}
        display={overlay?.display}
        basemap={basemap}
        scheme={scheme}
        styles={mapStyles}
        accent={accent}
        padding={{ top: 96, right: right + 24, bottom: 96, left: 360 }}
      />

      {/* Top: brand, search, controls — floating pills, no bar. */}
      <div className="pointer-events-none absolute inset-x-4 top-4 z-30 flex items-start gap-3">
        <div className={cx(glass, 'pointer-events-auto flex min-w-0 items-center gap-3 py-2 ps-2 pe-4')}>
          {logo}
          <div className="min-w-0">
            <div className="truncate text-[15px] leading-tight font-semibold">{title}</div>
            {subtitle && <div className="truncate text-xs text-zinc-500">{subtitle}</div>}
          </div>
        </div>
        <div className="pointer-events-auto mx-auto">
          <PlaceSearch source={source} onPick={(h) => go(h.id)} />
        </div>
        <div className={cx(glass, 'pointer-events-auto flex items-center gap-1 p-1.5')}>
          {live && <div className="px-1.5">{live}</div>}
          <ModeToggle />
          {actions}
        </div>
      </div>

      {/* Layers */}
      <section className={cx(glass, 'absolute top-24 left-4 z-20 flex max-h-[calc(100%-12rem)] w-[320px] max-w-[calc(100%-2rem)] flex-col overflow-hidden')} aria-label="Map layers">
        <header className="flex items-center gap-2.5 border-b border-zinc-200/80 px-4 py-3">
          <span className="flex size-7 items-center justify-center rounded-lg text-white" style={{ background: accent }}>
            <Layers className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Layers</div>
            <div className="truncate text-xs text-zinc-500">{level ? `Colouring ${level.toLowerCase()} in ${placeName}` : `Inside ${placeName}`}</div>
          </div>
          {(here.isFetching || values.isFetching) && <Spinner className="ms-auto size-4" />}
        </header>
        <LayerList
          overlays={overlays.data ?? []}
          selected={overlay}
          onPick={(k) => setSearch({ overlay: k ?? undefined })}
          empty={emptyOverlays}
          detail={
            overlay && (
              <div className="space-y-3 px-4 pt-1 pb-4">
                <div className="text-xs text-zinc-500">
                  {windowLabel(overlay)} · {AGG_LABEL[overlay.aggregation]} {overlay.elementName.toLowerCase()}
                </div>
                {noData ? (
                  <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs leading-relaxed text-zinc-600">
                    Nothing to colour here: {placeName} has no {overlay.name.replace(/\s*\(.*\)$/, '').toLowerCase()} data at this level. Try another place or layer.
                  </p>
                ) : (
                  scale && <Legend scale={scale} />
                )}
                {values.data && <FreshnessBadge value={values.data.freshness} compact />}
              </div>
            )
          }
        />
      </section>

      {/* Place trail (bottom centre of the map area) */}
      <div className="pointer-events-none absolute bottom-5 left-0 z-20 flex justify-center px-4 transition-[right]" style={{ right }}>
        <nav aria-label="Place" className={cx(glass, 'pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto py-1.5 ps-1.5 pe-4 text-sm')}>
          <button
            type="button"
            onClick={() => go(here.data?.ancestors.at(-1)?.id ?? null)}
            disabled={!here.data?.entity}
            aria-label="Up one level"
            className="flex size-8 shrink-0 items-center justify-center bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
          <button type="button" onClick={() => go(null)} className="shrink-0 px-2 py-1 text-zinc-600 hover:text-ink">
            {title}
          </button>
          {here.data?.ancestors.map((a) => (
            <span key={a.id} className="flex shrink-0 items-center gap-1">
              <ChevronRight className="size-3.5 text-zinc-400" />
              <button type="button" onClick={() => go(a.id)} className="px-2 py-1 text-zinc-600 hover:text-ink">
                {a.name}
              </button>
            </span>
          ))}
          {here.data?.entity && (
            <span className="flex shrink-0 items-center gap-1">
              <ChevronRight className="size-3.5 text-zinc-400" />
              <span className="px-2 py-1 font-semibold" style={{ color: accent }}>
                {here.data.entity.name}
              </span>
            </span>
          )}
        </nav>
      </div>

      {/* Basemap */}
      <div className={cx(glass, 'absolute bottom-5 left-16 z-20 flex gap-0.5 rounded-xl p-1 text-xs')}>
        {(
          [
            ['map', MapIcon, 'Map'],
            ['satellite', Satellite, 'Satellite'],
          ] as const
        ).map(([b, Icon, label]) => (
          <button key={b} type="button" onClick={() => setBasemap(b)} aria-pressed={basemap === b} className={cx('flex items-center gap-1.5 px-2.5 py-1.5', basemap === b ? 'bg-ink text-canvas' : 'text-zinc-600 hover:bg-zinc-100')}>
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Dashboards sheet */}
      {sheetOpen ? (
        <aside className={cx(glass, 'absolute top-24 right-4 bottom-4 z-20 flex flex-col overflow-hidden')} style={{ width: `min(${SHEET_W}px, calc(100% - 2rem))` }} aria-label="Dashboards">
          <DashboardSheet source={source} title={title} explore={here.data} accent={accent} onNavigate={go} dashboardKey={search.dashboard} onDashboard={(k) => setSearch({ dashboard: k })} onClose={() => setSheetOpen(false)} />
        </aside>
      ) : (
        <button type="button" onClick={() => setSheetOpen(true)} className={cx(glass, 'absolute top-24 right-4 z-20 flex items-center gap-2 px-4 py-2.5 text-sm font-medium')}>
          <PanelRightOpen className="size-4" /> Dashboards
        </button>
      )}
    </div>
  );
}

/** Day / night for the explorer (the person's colour mode). */
function ModeToggle() {
  const scheme = useScheme();
  return (
    <button
      type="button"
      onClick={() => applyColorMode(scheme === 'dark' ? 'light' : 'dark')}
      aria-label={scheme === 'dark' ? 'Switch to day' : 'Switch to night'}
      title={scheme === 'dark' ? 'Day' : 'Night'}
      className="flex size-9 items-center justify-center text-zinc-600 hover:bg-zinc-100 hover:text-ink"
    >
      {scheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

function Legend({ scale }: { scale: NonNullable<ReturnType<typeof scaleFor>> }) {
  if (scale.gradient)
    return (
      <div>
        <div className="h-2 w-full" style={{ background: `linear-gradient(to right, ${scale.gradient.stops.join(', ')})` }} />
        <div className="mt-1.5 flex justify-between text-xs text-zinc-500 tabular-nums">
          <span>{scale.gradient.min}</span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: NO_DATA }} /> No data
          </span>
          <span>{scale.gradient.max}</span>
        </div>
      </div>
    );
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {scale.legend.map((l) => (
        <span key={l.label} className="flex items-center gap-1.5 bg-zinc-100 py-0.5 ps-1 pe-2 tabular-nums">
          <span className="size-3 rounded-full" style={{ background: l.color }} />
          {l.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5 bg-zinc-100 py-0.5 ps-1 pe-2 text-zinc-500">
        <span className="size-3 rounded-full" style={{ background: NO_DATA }} />
        No data
      </span>
    </div>
  );
}

/** Every layer, always visible; the active one opens to show its legend. */
function LayerList({ overlays, selected, onPick, empty, detail }: { overlays: MapOverlayDto[]; selected: MapOverlayDto | null; onPick(k: string | null): void; empty?: ReactNode; detail: ReactNode }) {
  const groups = useMemo(() => {
    const m = new Map<string, MapOverlayDto[]>();
    for (const o of overlays) m.set(o.group, [...(m.get(o.group) ?? []), o]);
    return [...m.entries()];
  }, [overlays]);
  if (!overlays.length) return <p className="px-4 py-4 text-sm text-zinc-600">{empty ?? 'No map layers are available here yet.'}</p>;
  const row = (active: boolean) =>
    cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm transition-colors', active ? 'bg-accent-50 font-medium text-accent-800' : 'text-zinc-700 hover:bg-zinc-100');
  return (
    <div className="min-h-0 overflow-y-auto p-2" role="radiogroup" aria-label="Map layer">
      <button type="button" role="radio" aria-checked={!selected} onClick={() => onPick(null)} className={row(!selected)}>
        <Radio on={!selected} /> Places only
      </button>
      {groups.map(([g, list]) => (
        <div key={g} className="mt-2">
          <div className="px-2.5 pt-1 pb-1 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">{g}</div>
          {list.map((o) => {
            const on = o.key === selected?.key;
            return (
              <div key={o.key} className={cx(on && 'rounded-xl bg-accent-50/60 ring-1 ring-accent-100')}>
                <button type="button" role="radio" aria-checked={on} onClick={() => onPick(on ? null : o.key)} className={row(on)}>
                  <Radio on={on} />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                </button>
                {on && detail}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
const Radio = ({ on }: { on: boolean }) => (
  <span className={cx('flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-accent-600 bg-accent-600 text-white' : 'border-zinc-300')}>{on && <Check className="size-2.5" strokeWidth={3} />}</span>
);

function PlaceSearch({ source, onPick }: { source: ExplorerSource; onPick(h: SearchHit): void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const hits = useQuery({ queryKey: [...source.keys.search, debounced], queryFn: () => source.search(debounced), enabled: debounced.length > 0 });
  return (
    <div ref={box} className="relative w-[min(420px,36vw)]">
      <Search className="pointer-events-none absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2 text-zinc-400" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search location…"
        aria-label="Search location"
        className="h-12 w-full rounded-2xl border border-zinc-200/80 bg-snow/85 ps-11 pe-10 text-sm text-ink shadow-[var(--shadow-raised)] backdrop-blur-xl placeholder:text-zinc-400 focus:border-accent-600 focus:ring-4 focus:ring-accent-600/15 focus:outline-none"
      />
      {q && (
        <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-zinc-400 hover:text-ink">
          <X className="size-4" />
        </button>
      )}
      {open && !debounced && (
        <div className={cx(glass, 'absolute top-14 right-0 left-0 z-40 max-h-[70vh] overflow-y-auto bg-snow/95 py-2')}>
          <div className="px-4 pb-1 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">Browse places</div>
          <PlaceTree
            source={source}
            parent={null}
            depth={0}
            onPick={(n) => {
              onPick({ ...n, path: '' });
              setOpen(false);
            }}
          />
        </div>
      )}
      {open && debounced && (
        <ul className={cx(glass, 'absolute top-14 right-0 left-0 z-40 max-h-80 overflow-y-auto bg-snow/95 py-1.5')} role="listbox">
          {hits.data?.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">No places match “{debounced}”</li>}
          {hits.data?.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(h);
                  setOpen(false);
                  setQ('');
                }}
                className="flex w-full items-baseline justify-between gap-3 rounded-none px-4 py-2 text-start hover:bg-zinc-100"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{h.name}</span>
                  {h.path && <span className="block truncate text-xs text-zinc-500">{h.path}</span>}
                </span>
                <span className="shrink-0 bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">{h.type.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The place hierarchy, expanded lazily level by level. */
function PlaceTree({ source, parent, depth, onPick }: { source: ExplorerSource; parent: string | null; depth: number; onPick(n: PlaceNode): void }) {
  const nodes = useQuery({ queryKey: [...source.keys.search, 'tree', parent], queryFn: () => source.places(parent) });
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  if (nodes.isPending)
    return (
      <div className="py-1.5" style={{ paddingInlineStart: 16 + depth * 18 }}>
        <Spinner className="size-3.5" />
      </div>
    );
  return (
    <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Places' : undefined}>
      {nodes.data?.map((n) => {
        const expanded = openIds.has(n.id);
        return (
          <li key={n.id} role="treeitem" aria-expanded={n.hasChildren ? expanded : undefined}>
            <div className="group flex items-center gap-1 pe-3 hover:bg-zinc-100" style={{ paddingInlineStart: 8 + depth * 18 }}>
              <button
                type="button"
                aria-label={expanded ? `Collapse ${n.name}` : `Expand ${n.name}`}
                disabled={!n.hasChildren}
                onClick={() => setOpenIds((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; })}
                className="flex size-6 shrink-0 items-center justify-center text-zinc-400 hover:text-ink disabled:invisible"
              >
                <ChevronRight className={cx('size-3.5 transition-transform', expanded && 'rotate-90')} />
              </button>
              <button type="button" onClick={() => onPick(n)} className="flex min-w-0 flex-1 items-baseline justify-between gap-3 rounded-none py-1.5 text-start">
                <span className="truncate text-sm">{n.name}</span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {n.type.name}
                  {n.childCount > 0 && ` · ${n.childCount}`}
                </span>
              </button>
            </div>
            {expanded && <PlaceTree source={source} parent={n.id} depth={depth + 1} onPick={onPick} />}
          </li>
        );
      })}
    </ul>
  );
}

function DashboardSheet({
  source,
  title,
  explore,
  accent,
  onNavigate,
  dashboardKey,
  onDashboard,
  onClose,
}: {
  source: ExplorerSource;
  title: string;
  explore: Awaited<ReturnType<ExplorerSource['explore']>> | undefined;
  accent: string;
  onNavigate(id: string | null): void;
  dashboardKey?: string;
  onDashboard(k: string): void;
  onClose(): void;
}) {
  const dashboards = useQuery({ queryKey: source.keys.dashboards, queryFn: () => source.dashboards() });
  const names = useQuery({ queryKey: source.keys.names, queryFn: () => source.names() });
  const [hours, setHours] = useState<number | undefined>();
  const list = dashboards.data ?? [];
  const d: DashboardDto | undefined = list.find((x) => x.key === dashboardKey) ?? list[0];
  const place = explore?.entity;
  const params = { entity: place?.id, hours };
  const widgets = d?.widgets.filter((w) => w.type !== 'map') ?? [];
  const inside = explore?.children.features.length ?? 0;
  return (
    <>
      <div className="relative shrink-0 overflow-hidden px-6 pt-5 pb-4">
        {/* A soft wash of the brand colour behind the place name. */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.12]" style={{ background: `radial-gradient(120% 140% at 0% 0%, ${accent}, transparent 60%)` }} />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-[0.1em] uppercase" style={{ color: accent }}>
              {place ? place.type.name : 'Overview'}
            </div>
            <h2 className="mt-1 truncate text-[26px] leading-tight font-semibold tracking-[-0.02em]">{place?.name ?? title}</h2>
            <div className="mt-1 text-sm text-zinc-500">
              {inside > 0 && explore?.childLevel ? `${inside} ${explore.childLevel.toLowerCase()} inside` : place ? `In ${explore?.ancestors.at(-1)?.name ?? title}` : 'All places'}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Hide dashboards" className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink">
            <PanelRightClose className="size-4" />
          </button>
        </div>
        {list.length > 1 && (
          <div role="tablist" aria-label="Dashboards" className="relative mt-4 flex gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1">
            {list.map((x) => (
              <button
                key={x.key}
                role="tab"
                aria-selected={x.key === d?.key}
                onClick={() => onDashboard(x.key)}
                className={cx('shrink-0 px-3 py-1.5 text-sm whitespace-nowrap', x.key === d?.key ? 'bg-snow font-medium text-ink shadow-sm' : 'text-zinc-600 hover:text-ink')}
              >
                {x.name}
              </button>
            ))}
          </div>
        )}
        <div className="relative mt-3 flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium text-zinc-700">{list.length <= 1 ? (d?.name ?? 'Dashboards') : d?.description || d?.name}</span>
          {d?.filters.period && <DashboardFilterBar filters={{ areaType: null, period: true }} params={{ hours }} onChange={(p) => setHours(p.hours)} areas={undefined} areaLabel="" />}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-zinc-200/80 p-4">
        {dashboards.isPending ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-6" />
          </div>
        ) : !d ? (
          <p className="px-2 py-16 text-center text-sm text-zinc-500">No dashboards here yet.</p>
        ) : (
          <div className="grid grid-cols-12 gap-3">
            {widgets.map((w) => (
              <WidgetView
                key={`${d.key}-${w.id}`}
                layout="stack"
                widget={w}
                names={names.data}
                queryKey={[...source.keys.widget, d.key, params]}
                load={(p = {}) => source.widget(d, w, { ...params, ...p })}
                onSelectEntity={(id) => onNavigate(id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
