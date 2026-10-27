import { cx } from '@grids/ui';
import type { LucideIcon } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

export interface SettingsSection<T extends string> {
  id: T;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** A small number or word at the end of the entry. */
  count?: ReactNode;
}

/** Settings pages: the sections down the left (as in a project), the chosen one on the right. */
export function SettingsLayout<T extends string>({
  sections,
  value,
  onChange,
  label,
  children,
}: {
  sections: SettingsSection<T>[];
  value: T;
  onChange(id: T): void;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label={label} className="lg:sticky lg:top-20 lg:self-start">
        <div className="flex gap-1 overflow-x-auto pb-2 lg:block lg:overflow-visible lg:pb-0">
          {sections.map((s) => {
            const open = value === s.id;
            return (
              <div key={s.id} className="contents lg:block">
                <button
                  type="button"
                  aria-current={open ? 'page' : undefined}
                  onClick={() => onChange(s.id)}
                  className={cx(
                    'flex w-full shrink-0 items-center gap-2.5 border-s-2 px-2 py-1.5 text-start text-sm whitespace-nowrap transition-colors',
                    open
                      ? 'border-accent-600 bg-accent-50 font-medium text-ink'
                      : 'border-transparent text-zinc-600 hover:bg-zinc-100 hover:text-ink',
                  )}
                >
                  <s.icon className="size-4 shrink-0" />
                  <span className="flex-1">{s.label}</span>
                  {s.count !== undefined && (
                    <span className="num text-xs text-zinc-400">{s.count}</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * A titled box of a settings page, as in a project's settings: a thick edge in the organisation's colour, a tinted
 * heading with what it is for, then the fields.
 */
export function SettingsBlock({
  id,
  title,
  description,
  bare,
  children,
}: {
  id?: string;
  /** Kept for callers; the heading carries no icon. */ icon?: LucideIcon;
  title: string;
  description?: string;
  plain?: boolean;
  /** No card and no heading: just the content. */
  bare?: boolean;
  children: ReactNode;
}) {
  if (bare)
    return (
      <section id={id} className="mb-8 min-w-0 scroll-mt-24 space-y-5 last:mb-0">
        {children}
      </section>
    );
  const color = 'var(--brand-600)';
  return (
    <section
      id={id}
      className="mb-6 scroll-mt-24 border border-s-[3px] border-zinc-200 bg-snow last:mb-0"
      style={{ borderInlineStartColor: color }}
    >
      <header
        className="border-b px-5 py-3.5"
        style={{
          background: `color-mix(in srgb, ${color} 7%, var(--color-snow))`,
          borderBottomColor: `color-mix(in srgb, ${color} 18%, var(--color-zinc-200))`,
        }}
      >
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
      </header>
      <div className="min-w-0 space-y-5 p-5">{children}</div>
    </section>
  );
}
