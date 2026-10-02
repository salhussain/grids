import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { DashboardDto, MapOverlayDto, PlaceNode, SearchHit } from '@grids/schema';
import { cx, Spinner } from '@grids/ui';
import { ChevronDown, ChevronLeft, ChevronRight, Globe2, Layers, Map as MapIcon, Satellite, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DashboardFilterBar } from '../viz/DashboardFilters';
import { FreshnessBadge } from '../viz/Freshness';
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

/** Forces the dark scheme while mounted (the explorer is a dark, map-first view). */
function useDarkScheme() {
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    return () => {
      if (prev) root.setAttribute('data-theme', prev);
    };
  }, []);
}

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
  /** Right side of the top bar (account, menu). */
  actions?: ReactNode;
  /** Shown in the overlay panel when the project has no overlays (e.g. a link to set them up). */
  emptyOverlays?: ReactNode;
  live?: ReactNode;
  /** Brand colour (outlines, overlay header). */
  accent: string;
}

/** The map-first project explorer (spec §9): overlays on the left, the place's dashboards on the right. */
export function Explorer({ source, title, subtitle, logo, actions, emptyOverlays, live, accent }: ExplorerProps) {
  useDarkScheme();
  const [search, setSearch] = useExplorerSearch();
  const entity = search.entity ?? null;
  const [panelOpen, setPanelOpen] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>('dark');

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
  const noData = overlay && values.data && values.data.min === null;
  const level = overlay?.level ? null : (leaf ? parent.data?.childLevel : here.data?.childLevel) ?? null;
  const placeName = here.data?.entity?.name ?? title;

  const select = (p: PlaceFeature['properties']) => setSearch({ entity: p.id });

  return (
    <div className="explorer fixed inset-0 flex flex-col bg-[#0b1626] text-white">
      {/* Top bar */}
      <header className="relative z-30 flex h-16 shrink-0 items-center gap-4 border-b border-black/40 bg-[#26272b] px-4 text-white shadow-[0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex min-w-0 items-center gap-3">
          {logo}
          <div className="min-w-0">
            <div className="truncate text-[15px] leading-tight font-semibold">{title}</div>
            {subtitle && <div className="truncate text-xs text-white/55">{subtitle}</div>}
          </div>
        </div>
        <div className="ms-auto flex items-center gap-3">
          {live}
          <PlaceSearch source={source} onPick={(h) => setSearch({ entity: h.id })} />
          {actions}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Map */}
        <div className="relative min-w-0 flex-1">
          <ExplorerMap
            places={places}
            self={(here.data?.self as PlaceFeature | null) ?? null}
            bounds={here.data?.bounds ?? null}
            colorOf={colorOf}
            detailOf={detailOf}
            onSelect={select}
            basemap={basemap}
            accent={accent}
            padding={{ top: 60, right: 60, bottom: 60, left: 420 }}
          />

          {/* Overlay panel */}
          <section className="absolute top-4 left-4 z-10 w-[340px] max-w-[calc(100%-2rem)] shadow-2xl shadow-black/40" aria-label="Map overlays">
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              aria-expanded={listOpen}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-start text-[13px] font-semibold tracking-wide text-on-accent uppercase"
              style={{ background: accent }}
            >
              <span className="flex items-center gap-2">
                <Layers className="size-4" />
                Map overlays{level ? ` (${level})` : ''}
              </span>
              <ChevronDown className={cx('size-4 transition-transform', listOpen && 'rotate-180')} />
            </button>
            <div className="bg-[#16223a]/95 text-[#e6ecf7] backdrop-blur">
              {listOpen ? (
                <OverlayList overlays={overlays.data ?? []} selected={overlay?.key} onPick={(k) => { setSearch({ overlay: k ?? undefined }); setListOpen(false); }} empty={emptyOverlays} />
              ) : overlay ? (
                <div className="space-y-3 px-4 py-4">
                  <div>
                    <div className="text-[15px] font-medium text-white">{overlay.name}</div>
                    <div className="mt-0.5 text-xs text-[#9fb0cf]">
                      {windowLabel(overlay)} · {AGG_LABEL[overlay.aggregation]} {overlay.elementName.toLowerCase()}
                    </div>
                  </div>
                  {noData ? (
                    <p className="text-sm leading-relaxed text-[#c9d4ea]">
                      Select an area with valid data. {placeName} has no {overlay.name.replace(/\s*\(.*\)$/, '').toLowerCase()} data at this level.
                    </p>
                  ) : (
                    scale && <Legend scale={scale} />
                  )}
                  <div className="flex items-center justify-between gap-2">
                    {values.data && <FreshnessBadge value={values.data.freshness} compact />}
                    <button type="button" onClick={() => setSearch({ overlay: undefined })} className="text-xs text-[#9fb0cf] hover:text-white">
                      Clear overlay
                    </button>
                  </div>
                </div>
              ) : (
                <p className="px-4 py-4 text-sm leading-relaxed text-[#c9d4ea]">
                  {overlays.data?.length ? (
                    <>Choose an overlay to colour the map. Click a place to explore inside it.</>
                  ) : (
                    emptyOverlays ?? 'No map overlays are available here yet.'
                  )}
                </p>
              )}
            </div>
          </section>

          {/* Basemap toggle */}
          <div className="absolute bottom-6 left-4 z-10 flex border border-white/15 bg-[#26272b]/95 text-xs text-white/85 shadow-lg">
            {(
              [
                ['dark', MapIcon, 'Dark'],
                ['satellite', Satellite, 'Satellite'],
              ] as const
            ).map(([b, Icon, label]) => (
              <button key={b} type="button" onClick={() => setBasemap(b)} aria-pressed={basemap === b} className={cx('flex items-center gap-1.5 px-3 py-2', basemap === b ? 'bg-white/12 text-white' : 'hover:bg-white/5')}>
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>
          {(here.isFetching || values.isFetching) && (
            <div className="absolute top-4 right-4 z-10 bg-[#26272b]/90 p-2">
              <Spinner className="size-4 text-white" />
            </div>
          )}
        </div>

        {/* Sidebar toggle */}
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          aria-label={panelOpen ? 'Hide dashboards' : 'Show dashboards'}
          className="absolute top-1/2 z-20 flex h-16 w-6 -translate-y-1/2 items-center justify-center bg-[#26272b] text-white/75 shadow-lg hover:text-white"
          style={{ right: panelOpen ? 'min(520px, 100%)' : 0 }}
        >
          {panelOpen ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>

        {/* Dashboards */}
        {panelOpen && (
          <aside className="z-10 flex w-[min(520px,100%)] shrink-0 flex-col overflow-hidden border-s border-black/40 bg-[#1c1d20]" aria-label="Dashboards">
            <DashboardPanel source={source} title={title} explore={here.data} entity={entity} onNavigate={(id) => setSearch({ entity: id ?? undefined })} dashboardKey={search.dashboard} onDashboard={(k) => setSearch({ dashboard: k })} />
          </aside>
        )}
      </div>
    </div>
  );
}

function Legend({ scale }: { scale: NonNullable<ReturnType<typeof scaleFor>> }) {
  if (scale.gradient)
    return (
      <div>
        <div className="h-2.5 w-full" style={{ background: `linear-gradient(to right, ${scale.gradient.stops.join(', ')})` }} />
        <div className="mt-1 flex justify-between text-xs text-[#9fb0cf] tabular-nums">
          <span>{scale.gradient.min}</span>
          <span>{scale.gradient.max}</span>
        </div>
        <LegendNoData />
      </div>
    );
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-[#c9d4ea]">
      {scale.legend.map((l) => (
        <li key={l.label} className="flex items-center gap-2 tabular-nums">
          <span className="size-3 shrink-0" style={{ background: l.color }} />
          {l.label}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span className="size-3 shrink-0" style={{ background: NO_DATA }} />
        No data
      </li>
    </ul>
  );
}
const LegendNoData = () => (
  <div className="mt-2 flex items-center gap-2 text-xs text-[#9fb0cf]">
    <span className="size-3" style={{ background: NO_DATA }} /> No data
  </div>
);

function OverlayList({ overlays, selected, onPick, empty }: { overlays: MapOverlayDto[]; selected?: string; onPick(k: string | null): void; empty?: ReactNode }) {
  const groups = useMemo(() => {
    const m = new Map<string, MapOverlayDto[]>();
    for (const o of overlays) m.set(o.group, [...(m.get(o.group) ?? []), o]);
    return [...m.entries()];
  }, [overlays]);
  if (!overlays.length) return <p className="px-4 py-4 text-sm text-[#c9d4ea]">{empty ?? 'No map overlays are available here yet.'}</p>;
  return (
    <div className="max-h-[60vh] overflow-y-auto py-2" role="listbox" aria-label="Choose an overlay">
      <button type="button" role="option" aria-selected={!selected} onClick={() => onPick(null)} className={cx('block w-full px-4 py-2 text-start text-sm', !selected ? 'text-white' : 'text-[#9fb0cf] hover:bg-white/5')}>
        No overlay
      </button>
      {groups.map(([g, list]) => (
        <div key={g} className="mt-1">
          <div className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-[0.12em] text-[#7f91b3] uppercase">{g}</div>
          {list.map((o) => (
            <button
              key={o.key}
              type="button"
              role="option"
              aria-selected={o.key === selected}
              onClick={() => onPick(o.key)}
              className={cx('flex w-full items-center gap-3 px-4 py-2 text-start text-sm', o.key === selected ? 'bg-white/10 text-white' : 'text-[#dbe3f3] hover:bg-white/5')}
            >
              <span className={cx('size-2.5 shrink-0 border', o.key === selected ? 'border-white bg-white' : 'border-[#7f91b3]')} />
              {o.name}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

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
    <div ref={box} className="relative w-[min(380px,40vw)]">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-white/55" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search location…"
        aria-label="Search location"
        className="h-10 w-full rounded-full border border-white/10 bg-[#1b1c1f] ps-10 pe-9 text-sm text-white placeholder:text-white/45 focus:border-white/30 focus:outline-none"
      />
      {q && (
        <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="absolute top-1/2 right-3 -translate-y-1/2 text-white/55 hover:text-white">
          <X className="size-4" />
        </button>
      )}
      {open && !debounced && (
        <div className="absolute top-12 right-0 left-0 z-40 max-h-[70vh] overflow-y-auto border border-white/10 bg-[#26272b] py-2 shadow-2xl">
          <div className="px-4 pb-1 text-[11px] font-semibold tracking-[0.12em] text-white/45 uppercase">Browse places</div>
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
        <ul className="absolute top-12 right-0 left-0 z-40 max-h-80 overflow-y-auto border border-white/10 bg-[#26272b] py-1 shadow-2xl" role="listbox">
          {hits.data?.length === 0 && <li className="px-4 py-3 text-sm text-white/55">No places match “{debounced}”</li>}
          {hits.data?.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(h);
                  setOpen(false);
                  setQ('');
                }}
                className="flex w-full items-baseline justify-between gap-3 px-4 py-2 text-start hover:bg-white/5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-white">{h.name}</span>
                  {h.path && <span className="block truncate text-xs text-white/55">{h.path}</span>}
                </span>
                <span className="shrink-0 text-xs text-white/45">{h.type.name}</span>
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
        <Spinner className="size-3.5 text-white/55" />
      </div>
    );
  return (
    <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Places' : undefined}>
      {nodes.data?.map((n) => {
        const expanded = openIds.has(n.id);
        return (
          <li key={n.id} role="treeitem" aria-expanded={n.hasChildren ? expanded : undefined}>
            <div className="group flex items-center gap-1 pe-3 hover:bg-white/5" style={{ paddingInlineStart: 8 + depth * 18 }}>
              <button
                type="button"
                aria-label={expanded ? `Collapse ${n.name}` : `Expand ${n.name}`}
                disabled={!n.hasChildren}
                onClick={() => setOpenIds((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; })}
                className="flex size-6 shrink-0 items-center justify-center text-white/55 hover:text-white disabled:invisible"
              >
                <ChevronRight className={cx('size-3.5 transition-transform', expanded && 'rotate-90')} />
              </button>
              <button type="button" onClick={() => onPick(n)} className="flex min-w-0 flex-1 items-baseline justify-between gap-3 py-1.5 text-start">
                <span className="truncate text-sm text-white">{n.name}</span>
                <span className="shrink-0 text-xs text-white/45">
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

function DashboardPanel({
  source,
  title,
  explore,
  entity,
  onNavigate,
  dashboardKey,
  onDashboard,
}: {
  source: ExplorerSource;
  title: string;
  explore: Awaited<ReturnType<ExplorerSource['explore']>> | undefined;
  entity: string | null;
  onNavigate(id: string | null): void;
  dashboardKey?: string;
  onDashboard(k: string): void;
}) {
  const dashboards = useQuery({ queryKey: source.keys.dashboards, queryFn: () => source.dashboards() });
  const names = useQuery({ queryKey: source.keys.names, queryFn: () => source.names() });
  const [hours, setHours] = useState<number | undefined>();
  const list = dashboards.data ?? [];
  const d: DashboardDto | undefined = list.find((x) => x.key === dashboardKey) ?? list[0];
  const place = explore?.entity;
  const params = { entity: place?.id, hours };
  const widgets = d?.widgets.filter((w) => w.type !== 'map') ?? [];
  return (
    <>
      <div className="shrink-0 border-b border-black/40 bg-[#232427] px-6 pt-5 pb-4">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-white/55">
          <button type="button" onClick={() => onNavigate(null)} className="flex items-center gap-1 hover:text-white">
            <Globe2 className="size-3.5" /> {title}
          </button>
          {explore?.ancestors.map((a) => (
            <span key={a.id} className="flex items-center gap-1">
              <ChevronRight className="size-3 text-white/30" />
              <button type="button" onClick={() => onNavigate(a.id)} className="hover:text-white">
                {a.name}
              </button>
            </span>
          ))}
        </nav>
        <h2 className="mt-2 text-[30px] leading-tight font-light tracking-tight text-white">{place?.name ?? title}</h2>
        {place && <div className="mt-1 text-sm text-white/55">{place.type.name}</div>}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/40 bg-[#1f2023] px-6 py-3">
        {list.length > 1 ? (
          <label className="relative flex items-center">
            <span className="sr-only">Dashboard</span>
            <select
              value={d?.key}
              onChange={(e) => onDashboard(e.target.value)}
              className="appearance-none bg-transparent pe-7 text-[17px] font-medium text-white focus:outline-none"
            >
              {list.map((x) => (
                <option key={x.key} value={x.key} className="bg-[#26272b]">
                  {x.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 size-4 text-white/75" />
          </label>
        ) : (
          <span className="text-[17px] font-medium text-white">{d?.name ?? 'Dashboards'}</span>
        )}
        {d?.filters.period && (
          <DashboardFilterBar filters={{ areaType: null, period: true }} params={{ hours }} onChange={(p) => setHours(p.hours)} areas={undefined} areaLabel="" />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {dashboards.isPending ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-6 text-white/55" />
          </div>
        ) : !d ? (
          <p className="px-2 py-16 text-center text-sm text-white/55">No dashboards here yet.</p>
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
        {entity && !place && <p className="py-4 text-center text-xs text-white/45">Loading place…</p>}
      </div>
    </>
  );
}
