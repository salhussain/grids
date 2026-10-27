import { useIsFetching, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { ReportingConfig, type ReportingPeriod, type DashboardDto, type MapOverlayDto, type PlaceNode, type SearchHit } from '@grids/schema';
import {
  applyColorMode,
  cx,
  Switch,
  DatePicker,
  Spinner,
  storedColorMode,
  ThemeToggle,
  type ColorMode,
} from '@grids/ui';
import {
  Check,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CalendarDays,
  Compass,
  Eye,
  EyeOff,
  Globe2,
  Layers,
  Map as MapIcon,
  Maximize2,
  RefreshCw,
  Settings,
  Moon,
  Mountain,
  MountainSnow,
  PanelRightOpen,
  Route,
  Satellite,
  Search,
  Square,
  Sun,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FreshnessBadge } from '../Freshness';
import { useScheme } from '../scheme';
import { RefreshContext, WidgetView } from '../WidgetView';
import { NO_DATA, formatOverlayValue, scaleFor } from './colors';
import { ExplorerMap, RASTER_BASES, type Basemap, type MapCompare, type MapLayer, type PlaceCollection, type PlaceFeature } from './ExplorerMap';
import { iconOf } from '../icons';
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
const glass = 'rounded-[16px] border border-zinc-200/80 bg-snow/85 shadow-[var(--shadow-raised)] backdrop-blur-xl';
const SHEET_W = 460;

const windowLabel = (o: MapOverlayDto) =>
  o.hours === null
    ? 'Latest values'
    : o.hours % (24 * 7) === 0
      ? `Last ${o.hours / (24 * 7) === 1 ? 'week' : `${o.hours / (24 * 7)} weeks`}`
      : o.hours % 24 === 0
        ? `Last ${o.hours / 24} days`
        : `Last ${o.hours} hours`;
const AGG_LABEL: Record<string, string> = { sum: 'sum of', avg: 'average', min: 'minimum', max: 'maximum', count: 'count of', distinct: 'places reporting', last: 'latest' };

export interface ExplorerProps {
  source: ExplorerSource;
  title: string;
  subtitle?: string;
  logo?: ReactNode;
  /** Top-right controls (account, studio link). */
  actions?: ReactNode;
  /** Shown at the very end of the header, after the time settings. */
  endActions?: ReactNode;
  /** Shown in the layers card when the project has no overlays (e.g. a link to set them up). */
  emptyOverlays?: ReactNode;
  live?: ReactNode;
  /** Brand colour (outlines, accents). */
  accent: string;
  /** The organisation's basemap style URLs. */
  mapStyles?: { light: string | null; dark: string | null };
  /** Show the explorer's own light/dark toggle (off when `actions` bring one). */
  modeToggle?: boolean;
  /** Replaces the logo and title in the header (e.g. a project switcher). */
  switcher?: ReactNode;
  /** What the project shows: the map, the dashboards, or both. */
  layout?: 'map' | 'both' | 'dashboard';
  /** With both: a map layer being on gives the map the whole view. */
  hideOnLayer?: boolean;
  /** With both: whether the dashboard panel starts open. */
  panelStart?: 'open' | 'collapsed';
  /** A help button sits in the bottom-right corner: the map controls and credit lift above it. */
  helpCorner?: boolean;
  /** The signed-in person's saved period and refresh (else this device's). */
  savedView?: ViewPrefs | null;
  /** Called when they change either, to save it to their account. */
  onSaveView?(v: ViewPrefs): void;
  /** The reporting periods this project offers (the standard ones when absent). */
  reporting?: ReportingConfig;
  /** Keep the chosen reporting period between visits (default). Off: it starts clear every time the page loads. */
  rememberPeriod?: boolean;
}

/**
 * The map-first project explorer (spec §9). The map fills the screen; layers,
 * the place trail and the place's dashboards float over it as glass cards.
 */
export function Explorer({
  source,
  title,
  subtitle,
  logo,
  actions,
  endActions,
  emptyOverlays,
  live,
  accent,
  mapStyles,
  modeToggle = true,
  switcher,
  layout = 'both',
  hideOnLayer = true,
  panelStart = 'open',
  helpCorner = false,
  savedView,
  onSaveView,
  reporting,
  rememberPeriod = true,
}: ExplorerProps) {
  const scheme = useScheme();
  const [search, setSearch] = useExplorerSearch();
  const entity = search.entity ?? null;
  const [sheetOpen, setSheetOpen] = useState(panelStart !== 'collapsed');
  const [expanded, setExpanded] = useState(false);
  // The project decides whether people get a reporting period and auto-refresh, and the default refresh rate.
  const reportingConfig = useMemo(() => reporting ?? ReportingConfig.parse({}), [reporting]);
  const periodOn = reportingConfig.enabled;
  const refreshOn = reportingConfig.refresh.enabled;
  // The period follows the person across dashboards (and visits). The refresh rate does not: it starts at the project's default on every page load.
  const [period, setPeriod] = useState<Period>(() => (rememberPeriod ? storedPeriod() : {}));
  const [refresh, setRefresh] = useState<RefreshSettings>({ every: reportingConfig.refresh.every, pauseHidden: reportingConfig.refresh.pauseHidden });
  const defaultKey = `${reportingConfig.refresh.every}|${reportingConfig.refresh.pauseHidden}`;
  useEffect(() => {
    setRefresh({ every: reportingConfig.refresh.every, pauseHidden: reportingConfig.refresh.pauseHidden });
    // When the project's own default changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultKey]);
  // A saved account preference wins over this device's; it arrives once the person has loaded.
  const savedKey = savedView ? JSON.stringify(savedView) : '';
  useEffect(() => {
    if (!savedView) return;
    const p: Period = savedView.periodId ? { id: savedView.periodId } : savedView.from && savedView.to ? { from: savedView.from, to: savedView.to } : {};
    if (rememberPeriod) setPeriod(p);
    // Only when the saved value itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  const save = (p: Period) => onSaveView?.(p.id ? { periodId: p.id } : p.from && p.to ? { from: p.from, to: p.to } : {});
  // The dates the period means today (a rolling period moves on by itself); none when the project turns the picker off.
  const effective = periodOn ? resolvePeriod(period, reportingConfig) : {};
  // Auto-refresh as it applies: off when the project turns it off.
  const polling: RefreshSettings = refreshOn ? refresh : { every: 0, pauseHidden: true };
  const view = {
    period,
    onPeriod: (p: Period) => {
      setPeriod(p);
      if (rememberPeriod) remember(PERIOD_KEY, JSON.stringify(p));
      save(p);
    },
    refresh,
    onRefresh: (r: RefreshSettings) => setRefresh(r),
  };
  const [basemap, setBasemap] = useState<Basemap>(storedBasemap);
  const [globe, setGlobe] = useState(storedGlobe);
  const pickGlobe = (g: boolean) => {
    setGlobe(g);
    try {
      localStorage.setItem(GLOBE_KEY, g ? 'globe' : 'flat');
    } catch {
      /* storage unavailable: still applies for this visit */
    }
  };
  const pickBasemap = (b: Basemap) => {
    setBasemap(b);
    try {
      localStorage.setItem(BASEMAP_KEY, b);
    } catch {
      /* storage unavailable: still applies for this visit */
    }
  };

  const here = useQuery({ queryKey: [...source.keys.explore, entity], queryFn: () => source.explore(entity), placeholderData: (p) => p });
  // A place without places inside it is shown among its siblings.
  const leaf = !!here.data?.entity && here.data.children.features.length === 0;
  const parentId = leaf ? (here.data!.ancestors.at(-1)?.id ?? null) : null;
  const parent = useQuery({ queryKey: [...source.keys.explore, parentId], queryFn: () => source.explore(parentId), enabled: leaf });
  const shownAt = leaf ? parentId : entity;

  const overlays = useQuery({ queryKey: source.keys.overlays, queryFn: () => source.overlays() });
  // Several layers can be on at once: the URL lists them bottom to top (`overlay=a,b,c`).
  const keysOn = useMemo(() => {
    const known = new Set((overlays.data ?? []).map((o) => o.key));
    return (search.overlay ?? '').split(',').filter((k, i, all) => known.has(k) && all.indexOf(k) === i);
  }, [search.overlay, overlays.data]);
  const active = useMemo(() => keysOn.map((k) => overlays.data!.find((o) => o.key === k)!), [keysOn, overlays.data]);
  const setLayers = (keys: string[]) => setSearch({ overlay: keys.length ? keys.join(',') : undefined });
  // Per layer: how opaque it is, and whether it is hidden without being taken off the list.
  const [look, setLook] = useState<Record<string, { opacity: number; hidden: boolean }>>({});
  const lookOf = (k: string) => look[k] ?? { opacity: 1, hidden: false };
  // Turning a layer on gives the map the whole view; turning every layer off brings the panel back.
  const anyLayer = keysOn.length > 0;
  useEffect(() => {
    if (layout === 'both' && hideOnLayer) setSheetOpen(anyLayer ? false : panelStart !== 'collapsed');
  }, [anyLayer, layout, hideOnLayer, panelStart]);
  const valueQueries = useQueries({
    queries: active.map((o) => ({
      queryKey: [...source.keys.overlays, 'values', o.key, shownAt, effective],
      queryFn: () => source.overlay(o.key, shownAt, effective),
      placeholderData: (p: unknown) => p as never,
      refetchInterval: polling.every > 0 ? polling.every * 1000 : false,
      refetchIntervalInBackground: !polling.pauseHidden,
    })),
  });
  const stack = active.map((o, i) => {
    const data = valueQueries[i]?.data;
    const scale = data ? scaleFor(o, data.min, data.max) : null;
    const fmtValue = (v: number) => formatOverlayValue(o, v);
    return { overlay: o, data, scale, fmtValue, noData: !!data && data.min === null, fetching: !!valueQueries[i]?.isFetching };
  });
  const stackSig = stack.map((x, i) => `${x.overlay.key}:${valueQueries[i]?.dataUpdatedAt ?? 0}`).join('|');
  const mapLayers: MapLayer[] = useMemo(
    () =>
      stack.flatMap((x) => {
        const l = lookOf(x.overlay.key);
        if (!x.data || !x.scale || l.hidden) return [];
        const scale = x.scale;
        return [
          {
            key: x.overlay.key,
            name: x.overlay.name,
            features: x.data.features as PlaceCollection,
            colorOf: (p: PlaceFeature['properties']) => scale.color((p.value as number | null) ?? null),
            detailOf: (p: PlaceFeature['properties']) => (p.value === null || p.value === undefined ? null : x.fmtValue(p.value as number)),
            display: x.overlay.display ?? 'shade',
            opacity: l.opacity,
          },
        ];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stackSig, look, active],
  );
  const overlayFetching = valueQueries.some((q) => q.isFetching);
  // Compare: two of the layers side by side, split by a divider you drag.
  const [cmp, setCmp] = useState<{ on: boolean; left: string | null; right: string | null; x: number }>({ on: false, left: null, right: null, x: 50 });
  const shown = mapLayers;
  const leftKey = shown.find((l) => l.key === cmp.left)?.key ?? shown[0]?.key;
  const rightKey = shown.find((l) => l.key === cmp.right)?.key ?? shown.at(-1)?.key;
  const compare: MapCompare | null = useMemo(() => {
    const left = shown.find((l) => l.key === leftKey);
    const right = shown.find((l) => l.key === rightKey);
    return cmp.on && shown.length >= 2 && left && right && left !== right ? { left, right, x: cmp.x, onX: (x) => setCmp((c) => ({ ...c, x })) } : null;
  }, [cmp.on, cmp.x, shown, leftKey, rightKey]);
  // Places the map shows by themselves: the selected place's contents.
  const places: PlaceCollection | undefined = (leaf ? parent.data?.children : here.data?.children) as PlaceCollection | undefined;
  const noData = stack.length > 0 && stack.every((x) => x.noData);
  const level = (leaf ? parent.data?.childLevel : here.data?.childLevel) ?? null;
  const topLevel = stack.at(-1)?.overlay.level;
  const placeName = here.data?.entity?.name ?? title;
  const go = (id: string | null) => setSearch({ entity: id ?? undefined });
  // The dashboards panel (and its button) only exist when there is something to show in it.
  const dashboardList = useQuery({ queryKey: source.keys.dashboards, queryFn: () => source.dashboards() });
  // Whether the current place has anything inside it (mapped or not), for the trailing ">".
  const hasTimeSettings = (dashboardList.data?.length ?? 0) > 0 || (overlays.data?.length ?? 0) > 0;
  const nextPlaces = useQuery({ queryKey: [...source.keys.explore, 'places', entity ?? null], queryFn: () => source.places(entity ?? null) });
  const hasDashboards = layout === 'both' && (dashboardList.data ?? []).some((d) => d.widgets.some((w) => w.type !== 'map'));
  const right = hasDashboards && sheetOpen ? SHEET_W + 32 : 16;
  const mapShown = layout !== 'dashboard';

  return (
    <RefreshContext.Provider value={{ every: polling.every, background: !polling.pauseHidden }}>
    <div className="explorer fixed inset-0 overflow-hidden bg-canvas text-ink" style={{ '--ex-right': `${right}px`, '--ex-bottom': helpCorner ? '76px' : '20px' } as React.CSSProperties}>
      {mapShown && (
      <ExplorerMap
        places={places}
        self={(here.data?.self as PlaceFeature | null) ?? null}
        bounds={here.data?.bounds ?? null}
        layers={mapLayers}
        compare={compare}
        onSelect={(p) => go(p.id)}
        basemap={basemap}
        globe={globe}
        scheme={scheme}
        styles={mapStyles}
        accent={accent}
        padding={{ top: 150, right: right + 24, bottom: 96, left: 360 }}
      />
      )}

      {/* Header: the project, place search and controls in one bar over the map. */}
      <header className="absolute inset-x-0 top-0 z-30 flex h-16 items-center gap-3 border-b border-zinc-200/80 bg-snow/90 px-3 shadow-[0_1px_2px_rgb(0_0_0/0.04)] backdrop-blur-xl sm:px-4">
        <div className="flex min-w-0 shrink items-center gap-3 lg:flex-1 lg:basis-0">
          {switcher ?? (
            <>
              {logo}
              <div className="min-w-0">
                <div className="truncate text-[15px] leading-tight font-semibold">{title}</div>
                {subtitle && <div className="truncate text-xs text-zinc-500">{subtitle}</div>}
              </div>
            </>
          )}
        </div>
        <div className="mx-auto min-w-0 flex-1 sm:flex-none">
          <PlaceSearch source={source} onPick={(h) => go(h.id)} />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 lg:flex-1 lg:basis-0">
          {live && <div className="hidden px-1 sm:block">{live}</div>}
          {modeToggle && <ModeToggle />}
          {actions}
          {hasTimeSettings && (periodOn || refreshOn) && <TimeSettingsMenu source={source} reporting={reportingConfig} {...view} />}
          {endActions}
        </div>
      </header>

      {/* Layers */}
      {mapShown && (
      <section
        className={cx(
          glass,
          'absolute top-32 left-4 z-20 flex max-h-[calc(100%-14rem)] w-[320px] max-w-[calc(100%-2rem)] flex-col overflow-hidden',
        )}
        aria-label="Map layers"
      >
        <header className="flex items-center gap-2.5 border-b border-zinc-200/80 px-4 py-3">
          <span className="flex size-7 items-center justify-center rounded-[10px] text-white" style={{ background: accent }}>
            <Layers className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Layers</div>
            <div className="truncate text-xs text-zinc-500">{topLevel ? `Colouring ${topLevel.replace(/_/g, ' ')} in ${placeName}` : level ? `${level} in ${placeName}` : `Inside ${placeName}`}</div>
          </div>
          {(here.isFetching || overlayFetching) && <Spinner className="ms-auto size-4" />}
        </header>
        {keysOn.length >= 2 && (
          <div className="space-y-2 border-b border-zinc-200/80 px-4 py-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              Compare layers using slider
              <Switch checked={cmp.on} onChange={(on) => setCmp((c) => ({ ...c, on }))} label="Compare layers using slider" />
            </label>
            {cmp.on && (
              <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500">
                {([['Left', 'left', leftKey], ['Right', 'right', rightKey]] as const).map(([name, side, current]) => (
                  <label key={side} className="min-w-0">
                    {name}
                    <select value={current ?? ''} onChange={(e) => setCmp((c) => ({ ...c, [side]: e.target.value }))} className="mt-0.5 h-8 w-full rounded-[8px] border border-zinc-300 bg-snow px-2 text-sm text-ink">
                      {stack.map((x) => (
                        <option key={x.overlay.key} value={x.overlay.key}>
                          {x.overlay.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        <LayerList
          overlays={overlays.data ?? []}
          on={keysOn}
          onChange={setLayers}
          empty={emptyOverlays}
          look={lookOf}
          setLook={(k, patch) => setLook({ ...look, [k]: { ...lookOf(k), ...patch } })}
          detail={(k) => {
            const x = stack.find((y) => y.overlay.key === k);
            if (!x) return null;
            const o = x.overlay;
            return (
              <div className="space-y-3 px-4 pt-1 pb-3">
                <div className="text-xs text-zinc-500">
                  {windowLabel(o)} · {AGG_LABEL[o.aggregation]} {o.elementName.toLowerCase()}
                </div>
                {x.noData ? (
                  <p className="rounded-[10px] bg-zinc-100 px-3 py-2 text-xs leading-relaxed text-zinc-600">
                    Nothing to colour here: {placeName} has no {o.name.replace(/\s*\(.*\)$/, '').toLowerCase()} data at this level. Try another place or layer.
                  </p>
                ) : (
                  x.scale && <Legend scale={x.scale} />
                )}
                {x.data && <FreshnessBadge value={x.data.freshness} compact />}
              </div>
            );
          }}
        />
      </section>
      )}

      {/* Place trail (top of the map area, just under the header, clear of the layers panel) */}
      <div className="absolute inset-x-0 top-16 z-20 flex items-center border-b border-zinc-200/80 bg-zinc-100/90 backdrop-blur-xl">
        <nav aria-label="Place" className="flex h-11 min-w-0 flex-1 items-center gap-1 overflow-x-auto px-3 text-sm sm:px-4">
          <button
            type="button"
            onClick={() => go(null)}
            className={cx('shrink-0 px-2 py-1', here.data?.entity ? 'text-zinc-600 hover:text-ink' : 'font-semibold')}
            style={here.data?.entity ? undefined : { color: accent }}
          >
            {title}
          </button>
          {here.data?.ancestors.map((a, i) => (
            <span key={a.id} className="flex shrink-0 items-center gap-0.5">
              <PlaceStep source={source} from={i === 0 ? null : here.data!.ancestors[i - 1]!.id} current={a.id} onPick={go} />
              <button type="button" onClick={() => go(a.id)} className="px-2 py-1 text-zinc-600 hover:text-ink">
                {a.name}
              </button>
            </span>
          ))}
          {here.data?.entity && (
            <span className="flex shrink-0 items-center gap-0.5">
              <PlaceStep source={source} from={here.data.ancestors.at(-1)?.id ?? null} current={here.data.entity.id} onPick={go} />
              <span className="px-2 py-1 font-semibold" style={{ color: accent }}>
                {here.data.entity.name}
              </span>
            </span>
          )}
          {!!nextPlaces.data?.length && <PlaceStep source={source} from={here.data?.entity?.id ?? null} current={null} onPick={go} />}
        </nav>
        {/* When the data was last updated; the period and refresh settings are behind the gear in the header. */}
        {hasTimeSettings && refreshOn && (
          <div className="shrink-0 pe-3 sm:pe-4">
            <UpdatedStatus source={source} />
          </div>
        )}
      </div>

      {/* Basemap: a button in the zoom stack that opens the choices. */}
      {mapShown && <BasemapMenu value={basemap} onChange={pickBasemap} globe={globe} onGlobe={pickGlobe} right={right} />}

      {/* Dashboards sheet */}
      {!hasDashboards ? null : sheetOpen ? (
        <>
        <aside
          className={cx(
            glass,
            'absolute top-32 right-4 bottom-4 z-20 flex flex-col overflow-hidden',
          )}
          style={{ width: `min(${SHEET_W}px, calc(100% - 2rem))` }}
          aria-label="Dashboards"
        >
          <DashboardSheet
            source={source}
            title={title}
            explore={here.data}
            accent={accent}
            onNavigate={go}
            dashboardKey={search.dashboard}
            onDashboard={(k) => setSearch({ dashboard: k })}
            onExpand={() => setExpanded(true)}
            period={effective}
          />
        </aside>
        {/* Collapse: a round button straddling the sheet's left edge. */}
        <button
          type="button"
          onClick={() => setSheetOpen(false)}
          aria-label="Hide dashboards"
          title="Hide dashboards"
          className="absolute z-30 flex size-9 items-center justify-center rounded-full border border-zinc-200 bg-snow text-zinc-600 shadow-raised hover:text-ink"
          style={{ top: 'calc(8rem + 28px)', right: `calc(1rem + min(${SHEET_W}px, 100% - 2rem) - 18px)` }}
        >
          <ChevronRight className="size-4 rtl:rotate-180" />
        </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={cx(
            glass,
            'absolute top-32 right-4 z-20 flex items-center gap-2 px-4 py-2.5 text-sm font-medium',
          )}
        >
          <PanelRightOpen className="size-4" /> Dashboards
        </button>
      )}

      {expanded && hasDashboards && (
        <ExpandedDashboards onClose={() => setExpanded(false)}>
          <DashboardPage embedded period={effective} source={source} title={title} explore={here.data} accent={accent} onNavigate={(id) => (go(id), setExpanded(false))} dashboardKey={search.dashboard} onDashboard={(k) => setSearch({ dashboard: k })} />
        </ExpandedDashboards>
      )}

      {layout === 'dashboard' && (
        <DashboardPage period={effective} source={source} title={title} explore={here.data} accent={accent} onNavigate={go} dashboardKey={search.dashboard} onDashboard={(k) => setSearch({ dashboard: k })} />
      )}
    </div>
    </RefreshContext.Provider>
  );
}

const PERIOD_KEY = 'grids.period';
/** The dates a period boils down to when it is used. */
interface Window {
  hours?: number;
  from?: string;
  to?: string;
}
/** The person's choice: one of the project's reporting periods (by id), or their own dates. None = each widget's own. */
interface Period extends Window {
  id?: string;
}
/** What is saved to the account: the reporting period. (The refresh rate is the project's own default.) */
export interface ViewPrefs {
  periodId?: string;
  from?: string;
  to?: string;
}
interface RefreshSettings {
  /** Seconds between refreshes; 0 = off. */
  every: number;
  /** Stop refreshing while this tab is in the background. */
  pauseHidden: boolean;
}
const REFRESH_CHOICES: [number, string][] = [
  [0, 'Off'],
  [30, '30 s'],
  [60, '1 min'],
  [300, '5 min'],
  [900, '15 min'],
];
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: still applies for this visit */
  }
}
const storedPeriod = (): Period => {
  try {
    const p = JSON.parse(localStorage.getItem(PERIOD_KEY) ?? '{}') as Period;
    if (p.id) return { id: p.id };
    return p.from && p.to ? { from: p.from, to: p.to } : {};
  } catch {
    return {};
  }
};
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Hours each unit stands for when looking back (months and years are the usual 30 and 365 days). */
const UNIT_HOURS = { hours: 1, days: 24, weeks: 168, months: 720, years: 8760 } as const;
function addUnits(from: Date, unit: ReportingPeriod['unit'], n: number): Date {
  const d = new Date(from);
  if (unit === 'hours') d.setHours(d.getHours() + n);
  else if (unit === 'days') d.setDate(d.getDate() + n);
  else if (unit === 'weeks') d.setDate(d.getDate() + n * 7);
  else if (unit === 'months') d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
  return d;
}
/** The dates one of the project's reporting periods means today: looking back is a recent window, looking ahead a range from today. */
function windowOf(r: ReportingPeriod): Window {
  if (r.n < 0) return { hours: Math.min(Math.abs(r.n) * UNIT_HOURS[r.unit], 3650 * 24) };
  const today = new Date();
  return { from: isoDay(today), to: isoDay(addUnits(today, r.unit, r.n)) };
}
/** What a choice means today: a configured period becomes its dates; custom dates pass through. */
function resolvePeriod(p: Period, reporting: ReportingConfig): Window {
  const found = p.id ? reporting.periods.find((r) => r.id === p.id && !r.hidden) : undefined;
  if (found) return windowOf(found);
  return p.from && p.to ? { from: p.from, to: p.to } : {};
}

/** A clock that re-renders every `ms` while mounted. */
function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}
const ago = (t: number, now: number) => {
  if (!t) return 'not yet';
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 10 ? 'just now' : s < 60 ? `${s} seconds ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The settings themselves: reporting period, auto-refresh and "Refresh now". Shown in a dialog. */
function TimeSettings({ source, reporting, period, onPeriod, refresh, onRefresh }: { source: ExplorerSource; reporting: ReportingConfig; period: Period; onPeriod(p: Period): void; refresh: RefreshSettings; onRefresh(r: RefreshSettings): void }) {
  const qc = useQueryClient();
  const fetching = useIsFetching({ queryKey: source.keys.widget }) + useIsFetching({ queryKey: source.keys.overlays }) > 0;
  const [custom, setCustom] = useState(!!period.from && !period.id);
  const [draft, setDraft] = useState<{ from: string; to: string }>({ from: period.from ?? '', to: period.to ?? '' });
  const now = useNow(1000);
  const updated = lastUpdated(qc, source);
  const next = refresh.every > 0 && updated ? Math.max(0, Math.round((updated + refresh.every * 1000 - now) / 1000)) : null;
  const heading = 'text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase';
  return (
    <div className="text-sm">
      {reporting.enabled && (
        <>
      <div className="flex items-center justify-between gap-3">
        <div className={heading}>Reporting period</div>
        {(period.id || period.from) && (
          <button type="button" title="Go back to each widget's own period" className="text-xs text-zinc-500 underline hover:text-ink" onClick={() => (setCustom(false), onPeriod({}))}>
            Clear
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-500">Applies to every dashboard widget and map layer. Without one, each widget uses its own period.</p>
      <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-[13px]" role="radiogroup" aria-label="Reporting period">
        {reporting.periods.filter((r) => !r.hidden).map((r) => {
          const on = !custom && period.id === r.id;
          return (
            <button key={r.id} type="button" role="radio" aria-checked={on} onClick={() => (setCustom(false), onPeriod({ id: r.id }))} className={cx('rounded-[10px] border px-3 py-2 text-start', on ? 'border-accent-600 bg-accent-50 text-accent-800' : 'border-zinc-200 text-zinc-700 hover:border-zinc-400')}>
              <span className={cx('block', on && 'font-semibold')}>{r.label}</span>
            </button>
          );
        })}
        {reporting.allowCustom && (
          <button type="button" role="radio" aria-checked={custom} onClick={() => setCustom(true)} className={cx('rounded-[10px] border px-3 py-2 text-start', custom ? 'border-accent-600 bg-accent-50 font-semibold text-accent-800' : 'border-dashed border-zinc-300 text-zinc-700 hover:border-zinc-500')}>
            Custom dates
          </button>
        )}
      </div>
      {custom && reporting.allowCustom && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <DatePicker aria-label="From" placeholder="From" value={draft.from} max={draft.to || undefined} clearable={false} onChange={(v) => setDraft({ ...draft, from: v })} />
          <DatePicker aria-label="To" placeholder="To" value={draft.to} min={draft.from || undefined} clearable={false} onChange={(v) => setDraft({ ...draft, to: v })} />
          <button
            type="button"
            disabled={!draft.from || !draft.to}
            onClick={() => onPeriod({ from: draft.from, to: draft.to })}
            className="col-span-2 h-9 rounded-[10px] bg-accent-600 text-[13px] font-medium text-on-accent hover:bg-accent-700 disabled:opacity-50"
          >
            Apply range
          </button>
        </div>
      )}

        </>
      )}

      {reporting.refresh.enabled && (
        <>
      <div className={cx(heading, reporting.enabled && 'mt-5 border-t border-zinc-100 pt-4')}>Auto-refresh</div>
      <div className="mt-2.5 flex gap-0.5 rounded-[12px] bg-zinc-100 p-[3px] text-[13px]" role="radiogroup" aria-label="Auto-refresh">
        {REFRESH_CHOICES.map(([v, l]) => {
          const on = refresh.every === v;
          return (
            <button key={v} type="button" role="radio" aria-checked={on} onClick={() => onRefresh({ ...refresh, every: v })} className={cx('flex-1 rounded-[9px] py-1.5 text-center', on ? 'bg-accent-600 font-medium text-on-accent' : 'text-zinc-600 hover:text-ink')}>
              {l}
            </button>
          );
        })}
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[13px]">
        <input type="checkbox" role="switch" checked={refresh.pauseHidden} onChange={(e) => onRefresh({ ...refresh, pauseHidden: e.target.checked })} className="peer sr-only" />
        <span className="relative h-5 w-[34px] shrink-0 rounded-full bg-zinc-300 transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-accent-600 peer-checked:after:translate-x-[14px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-600" />
        Pause while this tab is in the background
      </label>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-100 pt-3.5">
        <span className="text-xs text-zinc-500">
          Refreshed {ago(updated, now)}
          {next !== null ? ` · next in ${clock(next)}` : refresh.every === 0 ? ' · auto-refresh off' : ''}
        </span>
        <RefreshNow source={source} fetching={fetching} />
      </div>
        </>
      )}
    </div>
  );
}

/** The gear in the header: opens the period and refresh settings as a dropdown under it. */
function TimeSettingsMenu(props: { source: ExplorerSource; reporting: ReportingConfig; period: Period; onPeriod(p: Period): void; refresh: RefreshSettings; onRefresh(r: RefreshSettings): void }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // The month list opens in its own layer; a click in it is not a click outside.
    const down = (e: MouseEvent) => !btn.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('[role="listbox"]') && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Reporting period and auto-refresh"
        title="Reporting period and auto-refresh"
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setAt({ top: r.bottom + 8, left: Math.max(8, Math.min(r.right - 392, window.innerWidth - 400)) });
          setOpen(!open);
        }}
        className={cx('flex size-9 shrink-0 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 hover:text-ink', open && 'bg-zinc-100 text-ink')}
      >
        <Settings className="size-5" />
      </button>
      {open &&
        at &&
        createPortal(
          <div ref={pop} role="dialog" aria-label="Reporting period and auto-refresh" style={{ top: at.top, left: at.left }} className="fixed z-[100] max-h-[calc(100vh-5rem)] w-[392px] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[18px] border border-zinc-200 bg-snow p-4 shadow-[0_18px_40px_rgb(16_24_40/0.22)]">
            <TimeSettings {...props} />
          </div>,
          document.body,
        )}
    </>
  );
}

const lastUpdated = (qc: ReturnType<typeof useQueryClient>, source: ExplorerSource) =>
  Math.max(0, ...[...qc.getQueryCache().findAll({ queryKey: source.keys.widget }), ...qc.getQueryCache().findAll({ queryKey: [...source.keys.overlays, 'values'] })].map((q) => q.state.dataUpdatedAt));

function RefreshNow({ source, fetching }: { source: ExplorerSource; fetching: boolean }) {
  const qc = useQueryClient();
  return (
    <button
      type="button"
      onClick={() => {
        void qc.invalidateQueries({ queryKey: source.keys.widget });
        void qc.invalidateQueries({ queryKey: [...source.keys.overlays, 'values'] });
      }}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-accent-600 px-3 text-[13px] font-medium text-on-accent hover:bg-accent-700"
    >
      <RefreshCw className={cx('size-3.5', fetching && 'animate-spin')} /> Refresh now
    </button>
  );
}

/** The breadcrumb strip's status: when the data was last updated (click to refresh now). */
function UpdatedStatus({ source }: { source: ExplorerSource }) {
  const qc = useQueryClient();
  const fetching = useIsFetching({ queryKey: source.keys.widget }) + useIsFetching({ queryKey: source.keys.overlays }) > 0;
  const now = useNow(15_000);
  const updated = lastUpdated(qc, source);
  return (
    <button
      type="button"
      title="Refresh now"
      onClick={() => {
        void qc.invalidateQueries({ queryKey: source.keys.widget });
        void qc.invalidateQueries({ queryKey: [...source.keys.overlays, 'values'] });
      }}
      className="flex shrink-0 items-center gap-1.5 rounded-[8px] px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-200/70 hover:text-ink"
    >
      <RefreshCw className={cx('size-3.5', fetching && 'animate-spin')} />
      <span className="hidden sm:inline">Refreshed {ago(updated, now)}</span>
    </button>
  );
}

/** The dashboards at full size, as a pop-up over the map. */
function ExpandedDashboards({ children, onClose }: { children: ReactNode; onClose(): void }) {
  useEffect(() => {
    // Esc closes the widget pop-up first (if one is open over this), then this one.
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[data-widget-modal]') && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Dashboards" className="relative flex h-[min(900px,94vh)] w-[min(1280px,96vw)] flex-col overflow-hidden rounded-[20px] bg-canvas shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute end-3 top-3 z-10 flex size-9 items-center justify-center rounded-full border border-zinc-200 bg-snow text-zinc-600 shadow-sm hover:text-ink"
        >
          <X className="size-4" />
        </button>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** The dashboards-only layout: the whole view is the place's dashboard. */
function DashboardPage({
  source,
  title,
  explore,
  accent,
  onNavigate,
  dashboardKey,
  onDashboard,
  embedded,
  period,
}: {
  source: ExplorerSource;
  title: string;
  explore: Awaited<ReturnType<ExplorerSource['explore']>> | undefined;
  accent: string;
  onNavigate(id: string | null): void;
  dashboardKey?: string;
  onDashboard(k: string): void;
  /** Inside the pop-up: fills its container instead of the page. */
  embedded?: boolean;
  period: Window;
}) {
  const dashboards = useQuery({ queryKey: source.keys.dashboards, queryFn: () => source.dashboards() });
  const names = useQuery({ queryKey: source.keys.names, queryFn: () => source.names() });
  const list = dashboards.data ?? [];
  const d: DashboardDto | undefined = list.find((x) => x.key === dashboardKey) ?? list[0];
  const place = explore?.entity;
  const params = { entity: place?.id, ...period };
  const inside = explore?.children.features.length ?? 0;
  return (
    <div className={cx(embedded ? 'h-full overflow-y-auto' : 'absolute inset-x-0 top-[108px] bottom-0 overflow-y-auto bg-canvas')}>
      <div className={cx('mx-auto max-w-[1180px] px-4 py-6 sm:px-6', embedded && 'pt-14')}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-[0.1em] uppercase" style={{ color: accent }}>
              {place ? place.type.name : 'Overview'}
            </div>
            <h1 className="mt-1 text-[32px] leading-tight font-semibold tracking-[-0.02em] break-words">{place?.name ?? title}</h1>
            <div className="mt-1 text-sm text-zinc-500">
              {inside > 0 && explore?.childLevel ? `${inside} ${explore.childLevel.toLowerCase()} inside` : place ? `In ${explore?.ancestors.at(-1)?.name ?? title}` : 'All places'}
              
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 border-t border-zinc-200 pt-4">
          {list.length > 1 ? (
            <DashboardMenu list={list} current={d?.key ?? null} onPick={onDashboard} accent={accent} large />
          ) : (
            <span className="truncate text-[22px] font-semibold tracking-tight">{d?.name ?? 'Dashboards'}</span>
          )}
          {list.length > 1 && <span className="ms-auto shrink-0 text-sm text-zinc-500">{list.length} dashboards</span>}
        </div>
        {d?.description && <p className="mt-4 max-w-3xl text-sm leading-relaxed text-zinc-600">{d.description}</p>}

        <div className="mt-5 pb-10">
          {dashboards.isPending ? (
            <div className="flex justify-center py-24">
              <Spinner className="size-6" />
            </div>
          ) : !d ? (
            <p className="rounded-[16px] border border-zinc-200 bg-snow px-4 py-16 text-center text-sm text-zinc-500">No dashboards here yet.</p>
          ) : (
            <div className="grid grid-cols-12 gap-4">
              {d.widgets.map((w) => (
                <WidgetView
                  key={`${d.key}-${w.id}`}
                  layout="grid"
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
      </div>
    </div>
  );
}

const GLOBE_KEY = 'grids.projection';
const storedGlobe = () => {
  try {
    return localStorage.getItem(GLOBE_KEY) !== 'flat';
  } catch {
    return true;
  }
};
const BASEMAP_KEY = 'grids.basemap';
/** The base map this person picked last (remembered on this device), else the standard map. */
function storedBasemap(): Basemap {
  try {
    const v = localStorage.getItem(BASEMAP_KEY);
    return v === 'map' || (v && v in RASTER_BASES) ? (v as Basemap) : 'map';
  } catch {
    return 'map';
  }
}

/** The dashboard's title as a menu: pick another dashboard (searchable, each with its icon). */
function DashboardMenu({ list, current, onPick, accent, large }: { list: DashboardDto[]; current: string | null; onPick(k: string): void; accent: string; large?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const now = list.find((x) => x.key === current) ?? list[0];
  useEffect(() => {
    if (!open) {
      setQ('');
      return;
    }
    const down = (e: MouseEvent) => !btn.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  const shown = list.filter((x) => !q.trim() || `${x.name} ${x.description}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 328)) });
          setOpen(!open);
        }}
        className="flex min-w-0 items-center gap-2 text-start"
      >
        <span className={cx('truncate font-semibold', large ? 'text-[22px] tracking-tight' : 'text-[17px]')}>{now?.name}</span>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
          <ChevronRight className={cx('size-3.5 transition-transform', open ? '-rotate-90' : 'rotate-90')} />
        </span>
      </button>
      {open &&
        at &&
        createPortal(
          <div ref={pop} role="menu" aria-label="Dashboards" style={{ top: at.top, left: at.left }} className={cx(glass, 'fixed z-[100] flex max-h-[min(26rem,70vh)] w-80 flex-col p-2 text-sm')}>
            <div className="relative shrink-0">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                autoFocus
                aria-label="Search dashboards"
                placeholder="Search dashboards"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && shown[0]) (onPick(shown[0].key), setOpen(false));
                }}
                className="h-9 w-full rounded-[10px] border border-zinc-300 bg-snow ps-9 pe-3 text-sm focus:border-accent-600 focus:outline-none"
              />
            </div>
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
              {shown.map((x) => {
                const Icon = iconOf(x.icon);
                const on = x.key === now?.key;
                return (
                  <button
                    key={x.key}
                    type="button"
                    role="menuitem"
                    onClick={() => (onPick(x.key), setOpen(false))}
                    className={cx('flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-start', on ? 'bg-accent-50' : 'hover:bg-zinc-100')}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px]" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block truncate', on ? 'font-semibold' : 'font-medium')}>{x.name}</span>
                      <span className="block truncate text-xs text-zinc-500">
                        {x.widgets.filter((w) => w.type !== 'map').length} widgets
                      </span>
                    </span>
                    {on && <Check className="size-4 shrink-0" style={{ color: accent }} />}
                  </button>
                );
              })}
              {!shown.length && <p className="px-3 py-4 text-sm text-zinc-500">No matching dashboards.</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** The ">" between places: opens the places inside the one before it, to jump straight to any of them. */
function PlaceStep({ source, from, current, onPick }: { source: ExplorerSource; from: string | null; current: string | null; onPick(id: string): void }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // Every place inside, mapped or not (the map itself only draws those with a location).
  const inside = useQuery({ queryKey: [...source.keys.explore, 'places', from], queryFn: () => source.places(from), enabled: open });
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !btn.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  const places = inside.data ?? [];
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Places inside"
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 248)) });
          setOpen(!open);
        }}
        className={cx('flex size-6 shrink-0 items-center justify-center rounded-[8px] text-zinc-400 hover:bg-zinc-200 hover:text-ink', open && 'bg-zinc-200 text-ink')}
      >
        <ChevronRight className={cx('size-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      {open &&
        at &&
        createPortal(
          <div ref={pop} role="menu" aria-label="Places inside" style={{ top: at.top, left: at.left }} className={cx(glass, 'fixed z-50 max-h-[min(22rem,60vh)] w-60 overflow-y-auto p-1.5 text-sm')}>
            {inside.isPending && <div className="flex justify-center py-4"><Spinner className="size-4" /></div>}
            {!inside.isPending && !places.length && <div className="px-3 py-2 text-zinc-500">Nothing inside</div>}
            {places.map((f) => (
              <button
                key={f.id}
                type="button"
                role="menuitem"
                onClick={() => (setOpen(false), onPick(f.id))}
                className={cx('flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-2 text-start', f.id === current ? 'bg-accent-50 font-medium text-accent-800' : 'text-zinc-700 hover:bg-zinc-100')}
              >
                <span className="min-w-0">
                  <span className="block truncate">{f.name}</span>
                  <span className="block truncate text-xs font-normal text-zinc-500">{f.type.name}</span>
                </span>
                {f.id === current && <Check className="size-4 shrink-0" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Map style button, in the same stack as the zoom controls; opens a small menu of styles. */
function BasemapMenu({ value, onChange, globe, onGlobe, right }: { value: Basemap; onChange(b: Basemap): void; globe: boolean; onGlobe(g: boolean): void; right: number }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const options = [
    ['map', MapIcon, 'Map'],
    ['streets', Route, 'Streets'],
    ['topo', Mountain, 'Topographic'],
    ['natgeo', Compass, 'National Geographic'],
    ['relief', MountainSnow, 'Shaded relief'],
    ['grey', Sun, 'Light grey'],
    ['dark', Moon, 'Dark grey'],
    ['satellite', Satellite, 'Satellite'],
  ] as const;
  return (
    // Directly above the zoom buttons (87px tall, 60px up from the bottom), on the same right edge.
    <div ref={box} className="absolute z-20 transition-[right] duration-200" style={{ right, bottom: 60 + 87 + 8 }}>
      <button
        type="button"
        aria-label="Map style"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Map style"
        onClick={() => setOpen(!open)}
        className={cx('flex size-[29px] items-center justify-center rounded-[12px] bg-snow text-zinc-700 shadow-raised hover:bg-zinc-100', open && 'text-accent-700')}
      >
        <Layers className="size-4" />
      </button>
      {open && (
        <div role="menu" aria-label="Map style" className={cx(glass, 'absolute end-[37px] bottom-0 flex min-w-48 flex-col rounded-[16px] p-1.5 text-sm')}>
          <div role="radiogroup" aria-label="Map view" className="mb-1.5 flex gap-1 rounded-[10px] bg-zinc-100 p-1">
            {(
              [
                [true, Globe2, 'Globe'],
                [false, Square, 'Flat'],
              ] as const
            ).map(([g, Icon, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={globe === g}
                onClick={() => onGlobe(g)}
                className={cx('flex flex-1 items-center justify-center gap-1.5 rounded-[8px] px-2 py-1.5 text-xs font-medium', globe === g ? 'bg-snow text-ink shadow-surface' : 'text-zinc-600 hover:text-ink')}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>
          {options.map(([b, Icon, label]) => (
            <button
              key={b}
              type="button"
              role="menuitemradio"
              aria-checked={value === b}
              onClick={() => (onChange(b), setOpen(false))}
              className={cx('flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-start', value === b ? 'bg-accent-600 text-on-accent' : 'text-zinc-700 hover:bg-zinc-100')}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Light / dark for the explorer (remembered on this device), the same toggle as everywhere else. */
function ModeToggle() {
  const [mode, setMode] = useState<ColorMode>(storedColorMode);
  return (
    <ThemeToggle
      mode={mode}
      onChange={(m) => {
        setMode(m);
        applyColorMode(m);
      }}
      labels={{ toLight: 'Switch to light mode', toDark: 'Switch to dark mode' }}
    />
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

/** Every layer, with a tick to put it on the map; the ones on are listed above with their stacking order, opacity and legend. */
function LayerList({
  overlays,
  on,
  onChange,
  empty,
  detail,
  look,
  setLook,
}: {
  overlays: MapOverlayDto[];
  /** Keys of the layers on, bottom to top. */
  on: string[];
  onChange(keys: string[]): void;
  empty?: ReactNode;
  detail(key: string): ReactNode;
  look(key: string): { opacity: number; hidden: boolean };
  setLook(key: string, patch: Partial<{ opacity: number; hidden: boolean }>): void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, MapOverlayDto[]>();
    for (const o of overlays) m.set(o.group, [...(m.get(o.group) ?? []), o]);
    return [...m.entries()];
  }, [overlays]);
  if (!overlays.length) return <p className="px-4 py-4 text-sm text-zinc-600">{empty ?? 'No map layers are available here yet.'}</p>;
  const byKey = new Map(overlays.map((o) => [o.key, o]));
  const toggle = (k: string) => onChange(on.includes(k) ? on.filter((x) => x !== k) : [...on, k]);
  // Moving "up" puts a layer over the one above it.
  const move = (k: string, by: 1 | -1) => {
    const i = on.indexOf(k);
    const j = i + by;
    if (i < 0 || j < 0 || j >= on.length) return;
    const next = [...on];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const row = (active: boolean) =>
    cx('flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-start text-sm transition-colors', active ? 'bg-accent-50 font-medium text-accent-800' : 'text-zinc-700 hover:bg-zinc-100');
  return (
    <div className="min-h-0 overflow-y-auto p-2">
      {on.length > 0 && (
        <div className="mb-2 border-b border-zinc-200/80 pb-2">
          <div className="flex items-center px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
            On the map
            <button type="button" onClick={() => onChange([])} className="ms-auto font-medium tracking-normal normal-case text-accent-700 hover:underline">
              Clear all
            </button>
          </div>
          <ul className="space-y-2">
            {[...on].reverse().map((k, shown) => {
              const o = byKey.get(k);
              if (!o) return null;
              const l = look(k);
              const top = shown === 0;
              const bottom = shown === on.length - 1;
              return (
                <li key={k} className="rounded-[14px] bg-accent-50/60 ring-1 ring-accent-100">
                  <div className="flex items-center gap-1 px-2.5 pt-2">
                    <button type="button" aria-pressed={!l.hidden} aria-label={l.hidden ? `Show ${o.name}` : `Hide ${o.name}`} onClick={() => setLook(k, { hidden: !l.hidden })} className="flex size-6 shrink-0 items-center justify-center rounded-[8px] text-zinc-600 hover:bg-white/70">
                      {l.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                    <span className={cx('min-w-0 flex-1 truncate text-sm font-medium', l.hidden && 'text-zinc-400 line-through')}>{o.name}</span>
                    <button type="button" aria-label={`Move ${o.name} up`} disabled={top} onClick={() => move(k, 1)} className="flex size-6 items-center justify-center rounded-[8px] text-zinc-600 hover:bg-white/70 disabled:opacity-30">
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button type="button" aria-label={`Move ${o.name} down`} disabled={bottom} onClick={() => move(k, -1)} className="flex size-6 items-center justify-center rounded-[8px] text-zinc-600 hover:bg-white/70 disabled:opacity-30">
                      <ArrowDown className="size-3.5" />
                    </button>
                    <button type="button" aria-label={`Remove ${o.name}`} onClick={() => toggle(k)} className="flex size-6 items-center justify-center rounded-[8px] text-zinc-500 hover:bg-white/70 hover:text-ink">
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <label className="flex items-center gap-2.5 px-3 pt-1.5 text-xs text-zinc-500">
                    Opacity
                    <input type="range" min={10} max={100} value={Math.round(l.opacity * 100)} onChange={(e) => setLook(k, { opacity: Number(e.target.value) / 100 })} className="min-w-0 flex-1 accent-[var(--color-accent-600)]" aria-label={`${o.name} opacity`} />
                    <span className="w-8 text-end tabular-nums">{Math.round(l.opacity * 100)}%</span>
                  </label>
                  {!l.hidden && detail(k)}
                  {l.hidden && <div className="pb-2" />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {groups.map(([g, list]) => (
        <div key={g} className="mt-2 first:mt-0">
          <div className="px-2.5 pt-1 pb-1 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">{g}</div>
          {list.map((o) => {
            const checked = on.includes(o.key);
            return (
              <button key={o.key} type="button" role="checkbox" aria-checked={checked} onClick={() => toggle(o.key)} className={row(checked)}>
                <Tick on={checked} />
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
const Tick = ({ on }: { on: boolean }) => (
  <span className={cx('flex size-4 shrink-0 items-center justify-center rounded-[5px] border', on ? 'border-accent-600 bg-accent-600 text-white' : 'border-zinc-300')}>{on && <Check className="size-2.5" strokeWidth={3} />}</span>
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
    <div ref={box} className="relative w-full sm:w-[min(440px,36vw)]">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-zinc-400" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search location…"
        aria-label="Search location"
        className="h-10 w-full rounded-[14px] border border-zinc-300 bg-snow ps-10 pe-9 text-sm text-ink placeholder:text-zinc-400 hover:border-zinc-400 focus:border-accent-600 focus:ring-4 focus:ring-accent-600/15 focus:outline-none"
      />
      {q && (
        <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-zinc-400 hover:text-ink">
          <X className="size-4" />
        </button>
      )}
      {open && !debounced && (
        <div
          className={cx(
            glass,
            'absolute top-12 right-0 left-0 z-40 max-h-[70vh] overflow-y-auto bg-snow/95 py-2',
          )}
        >
          <div className="px-4 pb-1 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
            Browse places
          </div>
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
        <ul
          className={cx(
            glass,
            'absolute top-12 right-0 left-0 z-40 max-h-80 overflow-y-auto bg-snow/95 py-1.5',
          )}
          role="listbox"
        >
          {hits.data?.length === 0 && (
            <li className="px-4 py-3 text-sm text-zinc-500">No places match “{debounced}”</li>
          )}
          {hits.data?.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(h);
                  setOpen(false);
                  setQ('');
                }}
                className="mx-1.5 flex w-[calc(100%-0.75rem)] items-baseline justify-between gap-3 rounded-[10px] px-3 py-2 text-start hover:bg-zinc-100"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{h.name}</span>
                  {h.path && <span className="block truncate text-xs text-zinc-500">{h.path}</span>}
                </span>
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">{h.type.name}</span>
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
            <div className="group mx-1.5 flex items-center gap-1 rounded-[10px] pe-3 hover:bg-zinc-100" style={{ paddingInlineStart: 4 + depth * 18 }}>
              <button
                type="button"
                aria-label={expanded ? `Collapse ${n.name}` : `Expand ${n.name}`}
                disabled={!n.hasChildren}
                onClick={() => setOpenIds((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; })}
                className="flex size-6 shrink-0 items-center justify-center text-zinc-400 hover:text-ink disabled:invisible"
              >
                <ChevronRight className={cx('size-3.5 transition-transform', expanded && 'rotate-90')} />
              </button>
              <button type="button" onClick={() => onPick(n)} className="flex min-w-0 flex-1 items-baseline justify-between gap-3 rounded-[8px] py-1.5 text-start">
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
  onExpand,
  period,
}: {
  source: ExplorerSource;
  title: string;
  explore: Awaited<ReturnType<ExplorerSource['explore']>> | undefined;
  accent: string;
  onNavigate(id: string | null): void;
  dashboardKey?: string;
  onDashboard(k: string): void;
  onExpand(): void;
  period: Window;
}) {
  const dashboards = useQuery({ queryKey: source.keys.dashboards, queryFn: () => source.dashboards() });
  const names = useQuery({ queryKey: source.keys.names, queryFn: () => source.names() });
  const list = dashboards.data ?? [];
  const d: DashboardDto | undefined = list.find((x) => x.key === dashboardKey) ?? list[0];
  const place = explore?.entity;
  const params = { entity: place?.id, ...period };
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
            <h2 className="mt-1 text-[26px] leading-tight font-semibold tracking-[-0.02em] break-words">{place?.name ?? title}</h2>
            {inside > 0 && explore?.childLevel && <div className="mt-1 text-sm text-zinc-500">{`${inside} ${explore.childLevel.toLowerCase()} inside`}</div>}
          </div>
        </div>
      </div>
      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-zinc-200/80 px-6">
        {list.length > 1 ? (
          <DashboardMenu list={list} current={d?.key ?? null} onPick={onDashboard} accent={accent} />
        ) : (
          <span className="truncate text-[17px] font-semibold">{d?.name ?? 'Dashboards'}</span>
        )}
        {list.length > 1 && <span className="ms-auto shrink-0 text-xs text-zinc-500">{list.length} dashboards</span>}
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand dashboards"
          title="Expand to a full-size view"
          className={cx('flex size-8 shrink-0 items-center justify-center rounded-[10px] text-zinc-500 hover:bg-zinc-100 hover:text-ink', list.length <= 1 && 'ms-auto')}
        >
          <Maximize2 className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-zinc-200/80 p-4">
        {d?.description && (
          <div className="mb-3 px-2">
            <span className="text-sm leading-relaxed text-zinc-600">{d.description}</span>
          </div>
        )}
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
