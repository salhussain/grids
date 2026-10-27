import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '@grids/ui';

/** Stable 0–359 hue from a name, so each person or unit keeps its own colour. */
const hue = (name: string) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

const initialsOf = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** Flat square monogram for a person or unit, in a colour of its own. */
export function Avatar({ name, className = 'size-8 text-xs' }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: `oklch(0.55 0.15 ${hue(name)})` }}
      className={cx('inline-flex shrink-0 items-center justify-center font-semibold tracking-wide text-white', className)}
    >
      {initialsOf(name)}
    </span>
  );
}

const TONE = {
  default: 'bg-accent-50 text-accent-700 ring-accent-100',
  warn: 'bg-amber-50 text-amber-700 ring-amber-200',
  bad: 'bg-red-50 text-red-700 ring-red-200',
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
} as const;
export type Tone = keyof typeof TONE;

/** KPI tile: label with an icon chip, a big number, one line of context. Links through when `to` is set. */
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'default',
  to,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: LucideIcon;
  tone?: Tone;
  to?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[13px] font-medium text-zinc-500">{label}</div>
        <span className={cx('flex size-8 shrink-0 items-center justify-center ring-1', TONE[tone])}>
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
      </div>
      <div className="num mt-3 text-[30px] leading-none font-semibold tracking-[-0.03em] text-ink">{value}</div>
      {sub && <div className="mt-2 truncate text-xs text-zinc-500">{sub}</div>}
    </>
  );
  const cls = 'block border border-zinc-200 bg-snow p-5 transition-colors';
  return to ? (
    <Link to={to} className={cx(cls, 'hover:border-zinc-400')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Segmented filter row (status filters). */
export function Chips<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-px border border-zinc-300 bg-zinc-300">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors',
            value === o.value ? 'bg-ink text-canvas' : 'bg-snow text-zinc-700 hover:bg-zinc-50',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A thin usage bar; turns amber then red as it fills. */
export function Meter({ value, max, className }: { value: number; max: number | null; className?: string }) {
  const ratio = max ? Math.min(1, value / max) : 0;
  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemax={max ?? undefined}
      className={cx('h-1.5 bg-zinc-200', className)}
    >
      <div
        className={cx('h-full', ratio > 0.9 ? 'bg-red-600' : ratio > 0.75 ? 'bg-amber-500' : 'bg-accent-600')}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

/** Square icon tile used on cards (entity types, applications). */
export function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span className={cx('flex size-9 shrink-0 items-center justify-center border border-accent-100 bg-accent-50 text-accent-700', className)}>
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </span>
  );
}
