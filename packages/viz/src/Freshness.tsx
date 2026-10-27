import type { Freshness } from '@grids/schema';
import { cx, relTime } from '@grids/ui';

const LABEL = { fresh: 'Fresh', warning: 'Delayed', stale: 'Stale', unknown: 'No data yet' } as const;
const TONE = {
  fresh: 'border-accent-600/30 bg-accent-50 text-accent-700',
  warning: 'border-amber-300 bg-amber-50 text-amber-800',
  stale: 'border-[#7a1f24]/30 bg-[#7a1f24]/5 text-[#7a1f24]',
  unknown: 'border-zinc-300 bg-zinc-50 text-zinc-600',
} as const;

const every = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`);

/** "Fresh · updated 2 minutes ago · expected every 5 min" (spec §8). */
export function FreshnessBadge({ value, compact }: { value: Freshness | undefined; compact?: boolean }) {
  if (!value) return null;
  // Read from the source when asked: nothing to age, so it says so and when it was last queried.
  if (value.live)
    return (
      <span
        className="inline-flex items-center border border-accent-600/30 bg-accent-50 px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-accent-700"
        title={value.lastUpdated ? `Read from the source when opened. Last queried ${relTime(value.lastUpdated)}` : 'Read from the source when opened'}
      >
        Live
      </span>
    );
  const parts = [
    value.lastUpdated ? `Updated ${relTime(value.lastUpdated)}` : null,
    value.expectedMinutes ? `expected every ${every(value.expectedMinutes)}` : null,
  ].filter(Boolean);
  return (
    <span
      className={cx('inline-flex items-center border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', TONE[value.status])}
      title={parts.join(' · ') || undefined}
    >
      {LABEL[value.status]}
      {!compact && parts.length > 0 && <span className="font-normal opacity-80">· {parts.join(' · ')}</span>}
    </span>
  );
}

/** Whether change events are streaming (pages refetch on change while live). */
export function LiveIndicator({ status }: { status: 'connecting' | 'live' | 'offline' }) {
  if (status === 'connecting') return null;
  const live = status === 'live';
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-xs whitespace-nowrap', live ? 'border-zinc-300 text-zinc-700' : 'border-zinc-300 text-zinc-500')}
      title={live ? 'Updates as data changes' : 'Live updates paused; reconnecting. Pages still refresh periodically.'}
    >
      <span className={cx('size-1.5', live ? 'bg-emerald-500' : 'bg-zinc-400')} aria-hidden />
      {live ? 'Live' : 'Reconnecting'}
    </span>
  );
}
