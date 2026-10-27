import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '@grids/ui';

/** Stable 0–359 hue from a name, so each organisation keeps its own colour. */
function hue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** Flat square monogram for an organisation or person, in a colour of its own. */
export function Avatar({
  name,
  className = 'size-9 text-[13px]',
}: {
  name: string;
  className?: string;
}) {
  const h = hue(name);
  return (
    <span
      aria-hidden
      style={{ backgroundColor: `oklch(0.55 0.15 ${h})` }}
      className={cx('inline-flex shrink-0 items-center justify-center font-semibold tracking-wide text-white', className)}
    >
      {initials(name)}
    </span>
  );
}

const TONE = {
  default: { chip: 'bg-accent-50 text-accent-700 ring-accent-100', value: 'text-ink' },
  warn: { chip: 'bg-amber-50 text-amber-700 ring-amber-200', value: 'text-amber-700' },
  bad: { chip: 'bg-red-50 text-red-700 ring-red-200', value: 'text-red-700' },
  good: { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', value: 'text-ink' },
} as const;

/** KPI tile: big number, icon chip, one line of context. Links through when `to` is set. */
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
  tone?: keyof typeof TONE;
  to?: '/tenants' | '/support' | '/billing' | '/logs/emails';
}) {
  const t = TONE[tone];
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[13px] font-medium text-zinc-500">{label}</div>
        <span className={cx('flex size-8 items-center justify-center ring-1', t.chip)}>
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
      </div>
      <div
        className={cx(
          'num mt-3 text-[30px] leading-none font-semibold tracking-[-0.03em]',
          t.value,
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-2 truncate text-xs text-zinc-500">{sub}</div>}
    </>
  );
  const cls =
    'group block border border-zinc-200 bg-snow p-5 transition-colors hover:border-zinc-400';
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Filter chip row (status filters). */
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
    <div
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap gap-px border border-zinc-300 bg-zinc-300"
    >
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

/** Small inline fact: icon + text, used in hero meta rows. */
export function Fact({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-zinc-600">
      <Icon className="size-3.5 text-zinc-400" strokeWidth={1.75} />
      {children}
    </span>
  );
}
