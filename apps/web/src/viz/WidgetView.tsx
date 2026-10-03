import { useQuery } from '@tanstack/react-query';
import type { QueryResult, Widget } from '@grids/schema';
import { cx, ErrorNotice, Spinner } from '@grids/ui';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useMemo } from 'react';
import { Chart, type ChartOption } from './Chart';
import { FreshnessBadge } from './Freshness';
import { MapView, type FeatureCollection } from './MapView';
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

function LineWidget({ result, names, scheme, unit }: { result: QueryResult; names: Record<string, string>; scheme: Scheme; unit?: string }) {
  const option = useMemo<ChartOption>(() => {
    const keys = [...new Set(result.rows.map((r) => String(r.key)))];
    const ink = INK[scheme];
    const palette = keys.length === 1 ? [brandColor()] : CATEGORICAL[scheme];
    return {
      ...baseChart(scheme),
      color: palette,
      grid: { left: 8, right: 16, top: keys.length > 1 ? 36 : 16, bottom: 8, containLabel: true },
      legend: keys.length > 1 ? { top: 0, left: 0, icon: 'rect', itemWidth: 10, itemHeight: 10, textStyle: { color: ink.muted } } : undefined,
      tooltip: { ...(baseChart(scheme).tooltip as object), trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: ink.axis } }, valueFormatter: (v: unknown) => `${typeof v === 'number' ? v.toLocaleString() : v}${unit ? ` ${unit}` : ''}` },
      xAxis: { type: 'time', axisLine: { lineStyle: { color: ink.axis } }, axisLabel: { color: ink.muted, hideOverlap: true }, splitLine: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: ink.muted }, splitLine: { lineStyle: { color: ink.grid } } },
      series: keys.map((k) => ({
        name: names[k] ?? pretty(k),
        type: 'line',
        showSymbol: false,
        symbolSize: 8,
        lineStyle: { width: 2 },
        emphasis: { focus: 'series' },
        data: result.rows.filter((r) => r.key === k).map((r) => [r.t, r.value]),
      })),
    };
  }, [result, names, scheme, unit]);
  return <Chart option={option} label="Line chart" />;
}

function BarWidget({ result, scheme, horizontal, unit }: { result: QueryResult; scheme: Scheme; horizontal?: boolean; unit?: string }) {
  const option = useMemo<ChartOption>(() => {
    const ink = INK[scheme];
    const rows = horizontal ? [...result.rows].reverse() : result.rows;
    const cat = { type: 'category', data: rows.map((r) => r.label), axisLine: { lineStyle: { color: ink.axis } }, axisTick: { show: false }, axisLabel: { color: ink.muted, width: 120, overflow: 'truncate', interval: 0, hideOverlap: true } };
    const val = { type: 'value', axisLabel: { color: ink.muted }, splitLine: { lineStyle: { color: ink.grid } } };
    return {
      ...baseChart(scheme),
      tooltip: { ...(baseChart(scheme).tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: unknown) => `${typeof v === 'number' ? v.toLocaleString() : v}${unit ? ` ${unit}` : ''}` },
      xAxis: horizontal ? val : cat,
      yAxis: horizontal ? cat : val,
      series: [{ type: 'bar', data: rows.map((r) => r.value), itemStyle: { color: brandColor() }, barMaxWidth: 28, label: { show: rows.length <= 12, position: horizontal ? 'right' : 'top', color: ink.muted, fontSize: 11 } }],
    };
  }, [result, scheme, horizontal, unit]);
  return <Chart option={option} label="Bar chart" />;
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
        <div className={cx('mt-2 flex items-center gap-1 text-xs', good === null ? 'text-zinc-500' : good ? 'text-emerald-700' : 'text-red-700')}>
          <Icon className="size-3.5" />
          <span className="num font-medium">
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
  load: () => Promise<QueryResult>;
  /** Data element key → display name, for legends. */
  names?: Record<string, string>;
  onSelectEntity?: (id: string) => void;
  actions?: React.ReactNode;
}

/** One dashboard tile: fetches its query and renders by type. */
export function WidgetView({ widget, queryKey, load, names = {}, onSelectEntity, actions }: WidgetViewProps) {
  const scheme = useScheme();
  const live = widget.options.refreshSeconds;
  const q = useQuery({
    queryKey: [...queryKey, widget.id, widget.query],
    queryFn: load,
    enabled: !!widget.query,
    refetchInterval: (live ?? 300) * 1000,
    placeholderData: (prev) => prev,
  });
  const body = () => {
    if (widget.type === 'text') return <p className="text-sm whitespace-pre-line text-zinc-700">{widget.text}</p>;
    if (q.isPending) return <div className="flex h-full items-center justify-center"><Spinner className="size-5 text-zinc-400" /></div>;
    if (q.isError) return <ErrorNotice error={q.error} />;
    const r = q.data;
    switch (widget.type) {
      case 'kpi':
        return <KpiWidget result={r} widget={widget} scheme={scheme} />;
      case 'line':
        return r.rows.length ? <LineWidget result={r} names={names} scheme={scheme} unit={widget.options.unit} /> : <NoData />;
      case 'bar':
        return r.rows.length ? <BarWidget result={r} scheme={scheme} horizontal={widget.options.horizontal} unit={widget.options.unit} /> : <NoData />;
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
  };
  const flush = widget.type === 'map';
  return (
    <section
      className={cx('col-span-12 flex min-w-0 flex-col border border-zinc-200 bg-snow', SPAN[widget.w])}
      style={{ minHeight: widget.h * ROW_HEIGHT }}
      aria-label={widget.title || widget.type}
    >
      {(widget.title || actions) && (
        <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
          <h3 className="truncate text-[13px] font-medium text-zinc-600">{widget.title}</h3>
          <div className="flex shrink-0 items-center gap-1.5">
            {q.isFetching && !q.isPending && <Spinner className="size-3 text-zinc-400" />}
            {widget.type === 'map' && widget.query && q.data && <FreshnessBadge value={q.data.freshness} compact />}
            {actions}
          </div>
        </header>
      )}
      <div className={cx('min-h-0 flex-1', flush ? 'mt-2' : 'px-4 pt-1 pb-3')}>{body()}</div>
    </section>
  );
}

const NoData = () => <p className="flex h-full items-center justify-center text-sm text-zinc-500">No data for this period</p>;
