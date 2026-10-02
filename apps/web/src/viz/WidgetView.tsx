import { useQuery } from '@tanstack/react-query';
import type { DashboardParams, QueryResult, Widget } from '@grids/schema';
import { cx, ErrorNotice, Spinner } from '@grids/ui';
import { ArrowDownRight, ArrowUpRight, Maximize2, Minus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Chart, type ChartOption } from './Chart';
import { FreshnessBadge } from './Freshness';
import { MapView, type FeatureCollection } from './MapView';
import { WidgetModal } from './WidgetModal';
import { brandColor, CATEGORICAL, INK, STATUS, thresholdColor, useScheme, type Scheme } from './scheme';

export const ROW_HEIGHT = 128;
// Literal classes so Tailwind generates them: full width on small screens.
const SPAN: Record<number, string> = {
  2: 'md:col-span-3 xl:col-span-2', 3: 'md:col-span-3', 4: 'md:col-span-6 xl:col-span-4', 5: 'md:col-span-6 xl:col-span-5',
  6: 'md:col-span-6', 7: 'xl:col-span-7', 8: 'xl:col-span-8', 9: 'xl:col-span-9', 10: 'xl:col-span-10', 11: 'xl:col-span-11', 12: '',
};
const pretty = (key: string) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function useFormat(decimals?: number) {
  return useMemo(() => {
    const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals ?? 1 });
    return (v: unknown) => (v === null || v === undefined || v === '' ? '–' : typeof v === 'number' ? nf.format(v) : String(v));
  }, [decimals]);
}

function baseChart(scheme: Scheme): ChartOption {
  const ink = INK[scheme];
  return {
    animationDuration: 300,
    textStyle: { fontFamily: 'IBM Plex Sans, system-ui, sans-serif', color: ink.muted },
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: ink.tooltip,
      borderColor: ink.axis,
      borderRadius: 0,
      textStyle: { color: ink.text, fontSize: 12 },
      extraCssText: 'box-shadow: 0 2px 8px rgba(0,0,0,.18);',
    },
  };
}

/** A colour with alpha, for area gradients and heat cells. */
const alpha = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
const valueFormatter = (unit?: string) => (v: unknown) => `${typeof v === 'number' ? v.toLocaleString() : (v ?? '–')}${unit ? ` ${unit}` : ''}`;

function LineWidget({ result, names, scheme, unit, area, stacked }: { result: QueryResult; names: Record<string, string>; scheme: Scheme; unit?: string; area?: boolean; stacked?: boolean }) {
  const option = useMemo<ChartOption>(() => {
    const keys = [...new Set(result.rows.map((r) => String(r.key)))];
    const ink = INK[scheme];
    const palette = keys.length === 1 ? [brandColor()] : CATEGORICAL[scheme];
    return {
      ...baseChart(scheme),
      color: palette,
      grid: { left: 8, right: 16, top: keys.length > 1 ? 36 : 16, bottom: 8, containLabel: true },
      legend: keys.length > 1 ? { top: 0, left: 0, icon: 'rect', itemWidth: 10, itemHeight: 10, textStyle: { color: ink.muted } } : undefined,
      tooltip: { ...(baseChart(scheme).tooltip as object), trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: ink.axis } }, valueFormatter: valueFormatter(unit) },
      xAxis: { type: 'time', axisLine: { lineStyle: { color: ink.axis } }, axisLabel: { color: ink.muted, hideOverlap: true }, splitLine: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: ink.muted }, splitLine: { lineStyle: { color: ink.grid, type: 'dashed' } } },
      series: keys.map((k, i) => {
        const c = palette[i % palette.length]!;
        // One series, or an area chart: a soft gradient under the line.
        const fill = area || keys.length === 1;
        return {
          name: names[k] ?? pretty(k),
          type: 'line',
          smooth: 0.25,
          showSymbol: false,
          symbolSize: 7,
          lineStyle: { width: 2.25 },
          stack: area && stacked ? 'total' : undefined,
          areaStyle: fill ? { opacity: 1, color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: alpha(c, area ? 0.45 : 0.22) }, { offset: 1, color: alpha(c, 0.02) }] } } : undefined,
          emphasis: { focus: 'series' },
          data: result.rows.filter((r) => r.key === k).map((r) => [r.t, r.value]),
        };
      }),
    };
  }, [result, names, scheme, unit, area, stacked]);
  return <Chart option={option} label={area ? 'Area chart' : 'Line chart'} />;
}

/**
 * Bars by category (breakdown), grouped or stacked per element (breakdown with
 * several elements), or over time (series).
 */
function BarWidget({ result, names, scheme, horizontal, stacked, unit }: { result: QueryResult; names: Record<string, string>; scheme: Scheme; horizontal?: boolean; stacked?: boolean; unit?: string }) {
  const option = useMemo<ChartOption>(() => {
    const ink = INK[scheme];
    const time = result.kind === 'series';
    const keyed = time || result.rows.some((r) => r.key !== undefined && r.key !== null);
    const keys = keyed ? [...new Set(result.rows.map((r) => String(r.key)))] : [''];
    const cats = [...new Set(result.rows.map((r) => String(time ? r.t : r.label)))];
    const ordered = horizontal && !time ? [...cats].reverse() : cats;
    const palette = keys.length === 1 ? [brandColor()] : CATEGORICAL[scheme];
    const catAxis = {
      type: 'category',
      data: ordered.map((c) => (time ? new Date(c).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : c)),
      axisLine: { lineStyle: { color: ink.axis } },
      axisTick: { show: false },
      axisLabel: { color: ink.muted, width: 120, overflow: 'truncate', interval: time ? 'auto' : 0, hideOverlap: true },
    };
    const valAxis = { type: 'value', axisLabel: { color: ink.muted }, splitLine: { lineStyle: { color: ink.grid, type: 'dashed' } } };
    const value = (k: string, c: string) => result.rows.find((r) => String(time ? r.t : r.label) === c && (!keyed || String(r.key) === k))?.value ?? null;
    return {
      ...baseChart(scheme),
      color: palette,
      grid: { left: 8, right: 16, top: keys.length > 1 ? 36 : 16, bottom: 8, containLabel: true },
      legend: keys.length > 1 ? { top: 0, left: 0, icon: 'rect', itemWidth: 10, itemHeight: 10, textStyle: { color: ink.muted } } : undefined,
      tooltip: { ...(baseChart(scheme).tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: alpha(ink.axis, 0.25) } }, valueFormatter: valueFormatter(unit) },
      xAxis: horizontal ? valAxis : catAxis,
      yAxis: horizontal ? catAxis : valAxis,
      series: keys.map((k) => ({
        name: k ? (names[k] ?? pretty(k)) : undefined,
        type: 'bar',
        stack: stacked ? 'total' : undefined,
        barMaxWidth: 32,
        itemStyle: { borderRadius: stacked && keys.length > 1 ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] },
        barGap: '12%',
        emphasis: { focus: 'series' },
        label: { show: keys.length === 1 && ordered.length <= 12, position: horizontal ? 'right' : 'top', color: ink.muted, fontSize: 11 },
        data: ordered.map((c) => value(k, c)),
      })),
    };
  }, [result, names, scheme, horizontal, stacked, unit]);
  return <Chart option={option} label="Bar chart" />;
}

function GaugeWidget({ result, widget, scheme }: { result: QueryResult; widget: Widget; scheme: Scheme }) {
  const o = widget.options;
  const option = useMemo<ChartOption>(() => {
    const ink = INK[scheme];
    const value = Number(result.rows[0]?.value ?? 0);
    const max = o.max ?? Math.max(10, Math.ceil((value * 1.25) / 10) * 10);
    const st = STATUS[scheme];
    // Bands: good up to warn, amber to alert, red beyond (flipped when higher is better).
    const bands: [number, string][] =
      o.warn !== undefined || o.alert !== undefined
        ? o.invert
          ? [
              [Math.min(1, (o.alert ?? o.warn ?? max) / max), st.bad],
              [Math.min(1, (o.warn ?? o.alert ?? max) / max), st.warn],
              [1, st.good],
            ]
          : [
              [Math.min(1, (o.warn ?? o.alert ?? max) / max), st.good],
              [Math.min(1, (o.alert ?? max) / max), st.warn],
              [1, st.bad],
            ]
        : [[1, brandColor()]];
    return {
      series: [
        {
          type: 'gauge',
          min: 0,
          max,
          startAngle: 205,
          endAngle: -25,
          radius: '96%',
          center: ['50%', '62%'],
          progress: { show: bands.length === 1, width: 14, itemStyle: { color: brandColor() } },
          axisLine: { lineStyle: { width: 14, color: bands.length === 1 ? [[1, ink.grid]] : bands } },
          pointer: { show: bands.length > 1, length: '58%', width: 4, itemStyle: { color: ink.text } },
          anchor: { show: bands.length > 1, size: 10, itemStyle: { color: ink.text } },
          axisTick: { show: false },
          splitLine: { length: 6, distance: -14, lineStyle: { color: ink.surface, width: 2 } },
          splitNumber: 4,
          axisLabel: { distance: 18, color: ink.muted, fontSize: 10, formatter: (v: number) => Math.round(v).toLocaleString() },
          title: { show: false },
          detail: { valueAnimation: true, offsetCenter: [0, '28%'], fontSize: 28, fontWeight: 600, color: ink.text, formatter: (v: number) => `${v.toLocaleString(undefined, { maximumFractionDigits: o.decimals ?? 0 })}${o.unit ? ` ${o.unit}` : ''}` },
          data: [{ value }],
        },
      ],
    };
  }, [result, o, scheme]);
  return <Chart option={option} label="Gauge" />;
}

/** Places × indicators with tinted cells (Tupaia-style matrix). */
function MatrixWidget({ result, names, widget, scheme }: { result: QueryResult; names: Record<string, string>; widget: Widget; scheme: Scheme }) {
  const fmt = useFormat(widget.options.decimals ?? 0);
  const keys = [...new Set(result.rows.map((r) => String(r.key ?? '')))];
  const labels = [...new Set(result.rows.map((r) => String(r.label)))];
  const cell = new Map(result.rows.map((r) => [`${r.label}|${r.key ?? ''}`, r.value as number | null]));
  const maxBy = new Map(keys.map((k) => [k, Math.max(0, ...result.rows.filter((r) => String(r.key ?? '') === k).map((r) => Number(r.value) || 0))]));
  const o = widget.options;
  const thresholds = o.warn !== undefined || o.alert !== undefined;
  const brand = brandColor();
  const tint = (k: string, v: number | null) => {
    if (v === null || v === undefined) return undefined;
    if (thresholds) {
      const c = thresholdColor(v, o.warn, o.alert, scheme);
      return c === STATUS[scheme].good ? undefined : alpha(c, scheme === 'dark' ? 0.35 : 0.22);
    }
    const m = maxBy.get(k) || 0;
    return m ? alpha(brand, 0.06 + 0.5 * (v / m)) : undefined;
  };
  if (!labels.length) return <NoData />;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-snow text-xs text-zinc-500">
          <tr>
            <th className="border-b border-zinc-200 px-2 py-1.5 text-start font-medium" />
            {keys.map((k) => (
              <th key={k} className="border-b border-zinc-200 px-2 py-1.5 text-end font-medium">
                {names[k] ?? pretty(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l) => (
            <tr key={l}>
              <th scope="row" className="border-b border-zinc-100 px-2 py-1.5 text-start font-normal whitespace-nowrap">
                {l}
              </th>
              {keys.map((k) => {
                const v = cell.get(`${l}|${k}`) ?? null;
                return (
                  <td key={k} className="num border-b border-zinc-100 px-2 py-1.5 text-end" style={{ background: tint(k, v) }}>
                    {fmt(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PieWidget({ result, scheme }: { result: QueryResult; scheme: Scheme }) {
  const option = useMemo<ChartOption>(() => {
    const ink = INK[scheme];
    // More than 7 categories fold into "Other" (no generated hues).
    const sorted = [...result.rows].sort((a, b) => Number(b.value) - Number(a.value));
    const top = sorted.slice(0, 7);
    const rest = sorted.slice(7).reduce((s, r) => s + Number(r.value ?? 0), 0);
    const data = [...top.map((r) => ({ name: String(r.label), value: r.value })), ...(rest ? [{ name: 'Other', value: rest }] : [])];
    return {
      ...baseChart(scheme),
      color: CATEGORICAL[scheme],
      tooltip: { ...(baseChart(scheme).tooltip as object), trigger: 'item' },
      legend: { orient: 'vertical', right: 0, top: 'middle', icon: 'rect', itemWidth: 10, itemHeight: 10, textStyle: { color: ink.muted } },
      series: [
        {
          type: 'pie',
          radius: ['52%', '78%'],
          center: ['36%', '50%'],
          itemStyle: { borderColor: ink.surface, borderWidth: 2 },
          label: { show: false },
          data,
        },
      ],
    };
  }, [result, scheme]);
  return <Chart option={option} label="Pie chart" />;
}

function KpiWidget({ result, widget, scheme }: { result: QueryResult; widget: Widget; scheme: Scheme }) {
  const o = widget.options;
  const fmt = useFormat(o.decimals ?? 0);
  const row = result.rows[0] ?? {};
  const value = row.value as number | null;
  const previous = row.previous as number | null | undefined;
  const thresholded = o.warn !== undefined || o.alert !== undefined;
  const color = thresholded && value !== null ? thresholdColor(value, o.warn, o.alert, scheme) : undefined;
  let delta: { pct: number | null; diff: number } | null = null;
  if (typeof value === 'number' && typeof previous === 'number')
    delta = { diff: value - previous, pct: previous ? ((value - previous) / Math.abs(previous)) * 100 : null };
  const good = delta && delta.diff !== 0 ? (delta.diff > 0) !== !!o.invert : null;
  const Icon = !delta || delta.diff === 0 ? Minus : delta.diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="flex h-full flex-col justify-end">
      <div className="flex items-baseline gap-1.5">
        <span className="num text-[34px] leading-none font-semibold tracking-tight" style={color && color !== STATUS[scheme].good ? { color } : undefined}>
          {fmt(value)}
        </span>
        {o.unit && <span className="text-sm text-zinc-500">{o.unit}</span>}
      </div>
      {delta && (
        <div className={cx('mt-2 flex flex-wrap items-center gap-x-1 text-xs', good === null ? 'text-zinc-500' : good ? 'text-emerald-700' : 'text-red-700')}>
          <Icon className="size-3.5" />
          <span className="num font-medium whitespace-nowrap">
            {delta.diff > 0 ? '+' : ''}
            {fmt(delta.diff)}
            {delta.pct !== null && ` (${delta.pct > 0 ? '+' : ''}${Math.round(delta.pct)}%)`}
          </span>
          <span className="text-zinc-500">vs previous period</span>
        </div>
      )}
    </div>
  );
}

function TableWidget({ result }: { result: QueryResult }) {
  const fmt = useFormat(2);
  const cols = result.columns ?? Object.keys(result.rows[0] ?? {});
  if (!result.rows.length) return <p className="py-6 text-center text-sm text-zinc-500">No rows</p>;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-start text-sm">
        <thead className="sticky top-0 bg-snow text-xs text-zinc-500">
          <tr>
            {cols.map((c) => (
              <th key={c} className="border-b border-zinc-200 px-2 py-1.5 text-start font-medium whitespace-nowrap">
                {pretty(c === 'parent' ? 'in' : c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={i} className="border-b border-zinc-100 last:border-0">
              {cols.map((c) => (
                <td key={c} className={cx('px-2 py-1.5 whitespace-nowrap', typeof r[c] === 'number' && 'num text-end')}>
                  {typeof r[c] === 'boolean' ? (r[c] ? 'Yes' : 'No') : c === 'at' || c === 'updated' ? new Date(String(r[c])).toLocaleString() : fmt(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface WidgetViewProps {
  widget: Widget;
  queryKey: unknown[];
  /** Loads the widget's data; the pop-up passes its own parameters. */
  load: (params?: DashboardParams) => Promise<QueryResult>;
  /** Data element key → display name, for legends. */
  names?: Record<string, string>;
  onSelectEntity?: (id: string) => void;
  actions?: React.ReactNode;
  /** `stack`: a narrow column (explorer sidebar): full width, KPIs two-up. */
  layout?: 'grid' | 'stack';
  /** Offer the enlarged pop-up with its own filters (default: yes for charts). */
  expandable?: boolean;
}

/** Renders a loaded result by widget type (tile and pop-up). */
export function WidgetBody({ widget, result, names = {}, onSelectEntity }: { widget: Widget; result: QueryResult; names?: Record<string, string>; onSelectEntity?: (id: string) => void }) {
  const scheme = useScheme();
  const r = result;
  switch (widget.type) {
    case 'text':
      return <p className="text-sm whitespace-pre-line text-zinc-700">{widget.text}</p>;
    case 'kpi':
      return <KpiWidget result={r} widget={widget} scheme={scheme} />;
    case 'line':
      return r.rows.length ? <LineWidget result={r} names={names} scheme={scheme} unit={widget.options.unit} /> : <NoData />;
    case 'area':
      return r.rows.length ? <LineWidget result={r} names={names} scheme={scheme} unit={widget.options.unit} area stacked={widget.options.stacked} /> : <NoData />;
    case 'bar':
      return r.rows.length ? <BarWidget result={r} names={names} scheme={scheme} horizontal={widget.options.horizontal} stacked={widget.options.stacked} unit={widget.options.unit} /> : <NoData />;
    case 'gauge':
      return <GaugeWidget result={r} widget={widget} scheme={scheme} />;
    case 'matrix':
      return <MatrixWidget result={r} names={names} widget={widget} scheme={scheme} />;
    case 'pie':
      return r.rows.length ? <PieWidget result={r} scheme={scheme} /> : <NoData />;
    case 'map':
      return (
        <MapView
          data={r.features as FeatureCollection}
          label={widget.title || 'Map'}
          options={{ warn: widget.options.warn, alert: widget.options.alert, labelAttribute: widget.options.labelAttribute, unit: widget.options.unit, onSelect: onSelectEntity ? (p) => onSelectEntity(String(p.id)) : undefined }}
        />
      );
    case 'table':
      return <TableWidget result={r} />;
  }
}

/** One dashboard tile: fetches its query and renders by type; opens enlarged on click. */
export function WidgetView({ widget, queryKey, load, names = {}, onSelectEntity, actions, layout = 'grid', expandable }: WidgetViewProps) {
  const live = widget.options.refreshSeconds;
  const [open, setOpen] = useState(false);
  const canExpand = (expandable ?? true) && !!widget.query && widget.type !== 'map' && widget.type !== 'text';
  const clickBody = canExpand && widget.type !== 'table' && widget.type !== 'matrix';
  const q = useQuery({
    queryKey: [...queryKey, widget.id, widget.query],
    queryFn: () => load(),
    enabled: !!widget.query,
    refetchInterval: (live ?? 300) * 1000,
    placeholderData: (prev) => prev,
  });
  const body = () => {
    if (widget.type === 'text') return <p className="text-sm whitespace-pre-line text-zinc-700">{widget.text}</p>;
    if (q.isPending) return <div className="flex h-full items-center justify-center"><Spinner className="size-5 text-zinc-400" /></div>;
    if (q.isError) return <ErrorNotice error={q.error} />;
    return <WidgetBody widget={widget} result={q.data} names={names} onSelectEntity={onSelectEntity} />;
  };
  const flush = widget.type === 'map';
  return (
    <section
      className={cx(
        'group/w flex min-w-0 flex-col border border-zinc-200 bg-snow transition-colors',
        canExpand && 'hover:border-zinc-300',
        layout === 'stack' ? (widget.type === 'kpi' ? 'col-span-6' : 'col-span-12') : cx('col-span-12', SPAN[widget.w]),
      )}
      style={{ minHeight: layout === 'stack' ? (widget.type === 'kpi' ? ROW_HEIGHT : Math.min(widget.h, 3) * ROW_HEIGHT) : widget.h * ROW_HEIGHT }}
      aria-label={widget.title || widget.type}
    >
      {(widget.title || actions || canExpand) && (
        <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
          {canExpand ? (
            <button type="button" onClick={() => setOpen(true)} className={cx('min-w-0 text-start text-[13px] font-medium text-zinc-600 hover:text-ink', layout === 'stack' ? 'line-clamp-2' : 'truncate')} title="Open with filters">
              {widget.title}
            </button>
          ) : (
            <h3 className="truncate text-[13px] font-medium text-zinc-600">{widget.title}</h3>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {q.isFetching && !q.isPending && <Spinner className="size-3 text-zinc-400" />}
            {widget.type === 'map' && widget.query && q.data && <FreshnessBadge value={q.data.freshness} compact />}
            {actions}
            {canExpand && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={`Open ${widget.title || 'chart'}`}
                className="p-1 text-zinc-400 opacity-0 transition-opacity group-hover/w:opacity-100 focus:opacity-100 hover:text-ink"
              >
                <Maximize2 className="size-3.5" />
              </button>
            )}
          </div>
        </header>
      )}
      <div className={cx('min-h-0 flex-1', flush ? 'mt-2' : 'px-4 pt-1 pb-3', clickBody && 'cursor-zoom-in')} onClick={clickBody ? () => setOpen(true) : undefined}>
        {body()}
      </div>
      {open && <WidgetModal widget={widget} queryKey={queryKey} load={load} names={names} onSelectEntity={onSelectEntity} onClose={() => setOpen(false)} />}
    </section>
  );
}

const NoData = () => <p className="flex h-full items-center justify-center text-sm text-zinc-500">No data for this period</p>;
