import type { LucideIcon } from 'lucide-react';
import { Switch, cx } from '@grids/ui';
import type { ReactNode } from 'react';

/** A titled box of settings: an icon, a name and a line about it above its fields. */
export function Card({
  title,
  description,
  icon: I,
  children,
  action,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="border border-zinc-200 bg-snow">
      <header className="flex items-center gap-3 border-b border-zinc-100 px-5 py-3.5">
        <span className="flex size-8 shrink-0 items-center justify-center bg-accent-50 text-accent-700">
          <I className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
        </div>
        {action}
      </header>
      {children && <div className="space-y-5 p-5">{children}</div>}
    </section>
  );
}

/** A setting with its switch at the end of the row. */
export function ToggleLine({ label, description, checked, onChange, disabled }: { label: string; description: string; checked: boolean; onChange(v: boolean): void; disabled?: boolean }) {
  return (
    <div className={cx('flex items-center justify-between gap-4 py-3', disabled && 'opacity-60')}>
      <div className="min-w-0 text-sm leading-tight">
        <div className="font-medium text-ink">{label}</div>
        <div className="mt-0.5 text-xs text-zinc-500">{description}</div>
      </div>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}
