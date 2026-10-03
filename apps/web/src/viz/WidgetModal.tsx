import { useQuery } from '@tanstack/react-query';
import { PERIOD_HOURS, type DashboardParams, type QueryResult, type Widget } from '@grids/schema';
import { cx, ErrorNotice, Select, Spinner } from '@grids/ui';
import { BarChart3, Download, Table2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FreshnessBadge } from './Freshness';
import { WidgetBody } from './WidgetView';

const PERIOD_LABEL: Record<number, string> = { 24: 'Last 24 hours', 168: 'Last 7 days', 720: 'Last 30 days', 2160: 'Last 90 days', 8760: 'Last 12 months' };
const INTERVALS = ['day', 'week', 'month'] as const;
const pretty = (k: string) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** The result as a plain table (for the table view and CSV). */
function tabulate(r: QueryResult, names: Record<string, string>): { columns: string[]; rows: unknown[][] } {
  switch (r.kind) {
    case 'series': {
      const keys = [...new Set(r.rows.map((x) => String(x.key)))];
      const byT = new Map<string, Record<string, unknown>>();
      for (const x of r.rows) byT.set(String(x.t), { ...(byT.get(String(x.t)) ?? {}), [String(x.key)]: x.value });
      return { columns: ['Period', ...keys.map((k) => names[k] ?? pretty(k))], rows: [...byT.entries()].map(([t, v]) => [t.slice(0, 10), ...keys.map((k) => v[k] ?? null)]) };
    }
    case 'breakdown':
      return { columns: ['Category', 'Value'], rows: r.rows.map((x) => [x.label, x.value]) };
    case 'kpi':
      return { columns: ['Value', 'Previous period'], rows: r.rows.map((x) => [x.value, x.previous ?? null]) };
    default: {
      const cols = r.columns ?? Object.keys(r.rows[0] ?? {});
      return { columns: cols.map(pretty), rows: r.rows.map((x) => cols.map((c) => x[c] ?? null)) };
    }
  }
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A visual opened large, with its own period, interval, table view and CSV export. */
export function WidgetModal({
  widget,
  queryKey,
  load,
  names = {},
  onSelectEntity,
  onClose,
}: {
  widget: Widget;
  queryKey: unknown[];
  load: (params?: DashboardParams) => Promise<QueryResult>;
  names?: Record<string, string>;
  onSelectEntity?: (id: string) => void;
  onClose(): void;
}) {
  const [period, setPeriod] = useState<string>('');
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [interval, setInterval] = useState<DashboardParams['interval']>();
  const [view, setView] = useState<'chart' | 'table'>(widget.type === 'table' ? 'table' : 'chart');
  const series = widget.query?.kind === 'series';
  const timed = !!widget.query && 'range' in widget.query && !('latest' in widget.query && widget.query.latest);
  const params: DashboardParams = { ...(period === 'custom' ? { from, to } : period ? { hours: Number(period) } : {}), ...(interval && { interval }) };
  const q = useQuery({ queryKey: [...queryKey, widget.id, 'expanded', params], queryFn: () => load(params), placeholderData: (p) => p });
  const table = useMemo(() => (q.data ? tabulate(q.data, names) : null), [q.data, names]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const download = () => {
    if (!table) return;
    const csv = [table.columns, ...table.rows].map((r) => r.map(csvCell).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${(widget.title || 'data').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // A portal, so it sits above every panel whatever stacking context opened it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={widget.title || 'Chart'} className="flex h-[min(760px,92vh)] w-[min(1180px,96vw)] flex-col border border-zinc-200 bg-snow shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 pt-5 pb-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">{widget.title || 'Chart'}</h2>
            {q.data && (
              <div className="mt-1.5">
                <FreshnessBadge value={q.data.freshness} />
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink">
            <X className="size-5" />
          </button>
        </header>
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-6 py-3">
          {timed && (
            <>
              <Select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-44">
                <option value="">Default period</option>
                {PERIOD_HOURS.map((h) => (
                  <option key={h} value={h}>
                    {PERIOD_LABEL[h]}
                  </option>
                ))}
                <option value="custom">Custom dates…</option>
              </Select>
              {period === 'custom' && (
                <span className="flex items-center gap-1.5 text-sm text-zinc-600">
                  <input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 border border-zinc-300 bg-snow px-2 text-sm" />
                  –
                  <input type="date" aria-label="To" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="h-9 border border-zinc-300 bg-snow px-2 text-sm" />
                </span>
              )}
            </>
          )}
          {series && (
            <Select aria-label="Interval" value={interval ?? ''} onChange={(e) => setInterval((e.target.value || undefined) as DashboardParams['interval'])} className="w-36">
              <option value="">Default interval</option>
              {INTERVALS.map((i) => (
                <option key={i} value={i}>
                  By {i}
                </option>
              ))}
            </Select>
          )}
          <div className="ms-auto flex items-center gap-2">
            {widget.type !== 'table' && (
              <div className="flex border border-zinc-300" role="group" aria-label="View">
                {(
                  [
                    ['chart', BarChart3, 'Chart'],
                    ['table', Table2, 'Table'],
                  ] as const
                ).map(([v, Icon, label]) => (
                  <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cx('flex h-9 items-center gap-1.5 px-3 text-sm', view === v ? 'bg-ink text-canvas' : 'bg-snow hover:bg-zinc-100')}>
                    <Icon className="size-4" /> {label}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={download} disabled={!table} className="flex h-9 items-center gap-1.5 border border-zinc-300 bg-snow px-3 text-sm hover:bg-zinc-100 disabled:opacity-50">
              <Download className="size-4" /> CSV
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 p-6">
          {q.isFetching && (
            <div className="absolute top-3 right-4">
              <Spinner className="size-4 text-zinc-400" />
            </div>
          )}
          {q.isError ? (
            <ErrorNotice error={q.error} />
          ) : !q.data ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-6 text-zinc-400" />
            </div>
          ) : view === 'table' && table ? (
            <div className="h-full overflow-auto border border-zinc-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500">
                  <tr>
                    {table.columns.map((c) => (
                      <th key={c} className="border-b border-zinc-200 px-3 py-2 text-start font-medium whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r, i) => (
                    <tr key={i} className="border-b border-zinc-100 last:border-0">
                      {r.map((v, j) => (
                        <td key={j} className={cx('px-3 py-1.5 whitespace-nowrap', typeof v === 'number' && 'num text-end')}>
                          {v === null || v === undefined ? '–' : typeof v === 'number' ? v.toLocaleString() : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={cx('h-full', widget.type === 'kpi' && 'mx-auto flex max-w-md items-center')}>
              <div className="h-full w-full">
                <WidgetBody widget={widget} result={q.data} names={names} onSelectEntity={onSelectEntity} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
