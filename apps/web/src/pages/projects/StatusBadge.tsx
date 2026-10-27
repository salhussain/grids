import { cx } from '@grids/ui';

/**
 * A project's status: "Live" is a blinking dot with the label in the project colour;
 * "Draft" is a still grey dot with grey text. No border or background.
 */
export function StatusBadge({ status, color, className }: { status: 'draft' | 'live'; color: string; className?: string }) {
  const live = status === 'live';
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-xs font-medium', !live && 'text-zinc-500', className)} style={live ? { color } : undefined}>
      <span
        aria-hidden
        className={cx('size-2 rounded-full', live ? 'animate-pulse motion-reduce:animate-none' : 'bg-zinc-400')}
        style={live ? { background: color } : undefined}
      />
      {live ? 'Live' : 'Draft'}
    </span>
  );
}
