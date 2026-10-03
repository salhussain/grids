import { useIsFetching, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Pause, Play, RefreshCw } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { cx } from './components';

// ---------------------------------------------------------------- auto refresh

export const REFRESH_MS = 15_000;
const STORAGE_KEY = 'grids.autoRefresh';

const AutoRefreshCtx = createContext<{ enabled: boolean; setEnabled: (v: boolean) => void }>({
  enabled: true,
  setEnabled: () => {},
});

/** Remembers (per browser) whether live pages auto-refresh. */
export function AutoRefreshProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? 'on' : 'off');
    } catch {
      /* storage unavailable: keep in memory */
    }
  }, []);
  return (
    <AutoRefreshCtx.Provider value={{ enabled, setEnabled }}>{children}</AutoRefreshCtx.Provider>
  );
}

/** `refetchInterval` for live data: 15s while enabled and the tab is visible. */
export function useLiveInterval(): number | false {
  return useContext(AutoRefreshCtx).enabled ? REFRESH_MS : false;
}

/**
 * Refresh control for a page: last-updated time, manual refresh (spins while any
 * of the page's queries fetch) and an auto-refresh pause/resume toggle.
 */
export function RefreshControl({ queryKeys }: { queryKeys: QueryKey[] }) {
  const qc = useQueryClient();
  const { enabled, setEnabled } = useContext(AutoRefreshCtx);
  const fetching =
    useIsFetching({ predicate: (q) => queryKeys.some((k) => matches(q.queryKey, k)) }) > 0;
  const updatedAt = Math.max(
    0,
    ...qc
      .getQueryCache()
      .findAll({ predicate: (q) => queryKeys.some((k) => matches(q.queryKey, k)) })
      .map((q) => q.state.dataUpdatedAt),
  );
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const ago = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;

  return (
    <div className="flex items-center border border-zinc-300 bg-snow text-xs text-zinc-600">
      <span className="num hidden px-3 sm:inline" aria-live="polite">
        {ago === null
          ? 'Loading…'
          : ago < 2
            ? 'Updated just now'
            : `Updated ${ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`} ago`}
      </span>
      <button
        onClick={() => setEnabled(!enabled)}
        title={
          enabled
            ? 'Auto-refresh every 15s is on. Click to pause.'
            : 'Auto-refresh paused. Click to resume.'
        }
        aria-label={enabled ? 'Pause auto-refresh' : 'Resume auto-refresh'}
        aria-pressed={enabled}
        className="flex h-9 items-center gap-1.5 border-l border-zinc-300 px-2.5 hover:bg-zinc-100 sm:border-l"
      >
        {enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        <span className="hidden md:inline">{enabled ? 'Auto 15s' : 'Paused'}</span>
      </button>
      <button
        onClick={() => queryKeys.forEach((queryKey) => void qc.invalidateQueries({ queryKey }))}
        aria-label="Refresh now"
        title="Refresh now"
        className="flex h-9 w-9 items-center justify-center border-l border-zinc-300 hover:bg-zinc-100"
      >
        <RefreshCw className={cx('size-4', fetching && 'animate-spin text-accent-600')} />
      </button>
    </div>
  );
}

const matches = (key: QueryKey, prefix: QueryKey) =>
  prefix.every((p, i) => JSON.stringify(key[i]) === JSON.stringify(p));

// ---------------------------------------------------------------- pagination

export interface PageState {
  page: number;
  pageSize: number;
}

/** Page state that resets to page 1 whenever `resetOn` (filters) change. */
export function usePagination(resetOn: unknown[] = [], pageSize = 25) {
  const [state, setState] = useState<PageState>({ page: 1, pageSize });
  const dep = JSON.stringify(resetOn);
  useEffect(() => setState((s) => ({ ...s, page: 1 })), [dep]);
  return [state, setState] as const;
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  sizes = [10, 25, 50, 100],
}: PageState & { total: number; onChange: (s: PageState) => void; sizes?: number[] }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-5 py-2.5 text-sm text-zinc-600"
    >
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline">Rows per page</span>
        <select
          aria-label="Rows per page"
          value={pageSize}
          onChange={(e) => onChange({ page: 1, pageSize: Number(e.target.value) })}
          className="h-8 border border-zinc-300 bg-snow px-2 text-sm focus:border-accent-600 focus:outline-none"
        >
          {sizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <span className="num" aria-live="polite">
          {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
        </span>
        <div className="flex">
          <button
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onChange({ page: page - 1, pageSize })}
            className="flex size-8 items-center justify-center border border-zinc-300 bg-snow hover:bg-zinc-100 disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="num flex h-8 items-center border-y border-zinc-300 bg-snow px-3 text-xs">
            {page} / {pages}
          </span>
          <button
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => onChange({ page: page + 1, pageSize })}
            className="flex size-8 items-center justify-center border border-zinc-300 bg-snow hover:bg-zinc-100 disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );
}
