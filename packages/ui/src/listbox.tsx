import { Check, ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cx } from './components';
import type { ColorMode } from './mode';

export interface ListboxOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Text used for type-ahead (defaults to the label when it is a string). */
  text?: string;
}

/**
 * A styled single-select (replaces the native dropdown popup): button + listbox
 * with keyboard support (arrows, Home/End, type-ahead, Enter/Space, Escape).
 */
export function Listbox<T extends string>({
  value,
  options,
  onChange,
  label,
  placeholder = 'Choose…',
  className,
  align = 'start',
  compact,
  disabled,
}: {
  value: T | null;
  options: ListboxOption<NoInfer<T>>[];
  onChange(v: T): void;
  /** Accessible name. */
  label: string;
  placeholder?: string;
  className?: string;
  align?: 'start' | 'end';
  /** Smaller trigger (toolbars). */
  compact?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const current = options.find((o) => o.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    list.current?.focus();
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);  
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    onChange(o.value);
    setOpen(false);
    root.current?.querySelector('button')?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(options.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(options.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') choose(active);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      if (e.key === 'Escape') root.current?.querySelector('button')?.focus();
      return;
    } else if (e.key.length === 1) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const i = options.findIndex((o) => (o.text ?? (typeof o.label === 'string' ? o.label : '')).toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
      return;
    } else return;
    e.preventDefault();
  };

  const Icon = current?.icon;
  return (
    <div ref={root} className={cx('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={label}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cx(
          'flex w-full items-center gap-2 border border-zinc-300 bg-snow text-start text-ink transition-colors hover:border-zinc-500 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600 disabled:opacity-50',
          compact ? 'h-8 px-2.5 text-[13px]' : 'min-h-9 px-3 py-1.5 text-sm',
          open && 'border-accent-600',
        )}
      >
        {Icon && <Icon className="size-4 shrink-0 text-zinc-500" />}
        <span className={cx('min-w-0 flex-1 truncate', !current && 'text-zinc-400')}>{current ? current.label : placeholder}</span>
        <ChevronDown className={cx('size-4 shrink-0 text-zinc-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-o${active}`}
          onKeyDown={onKey}
          className={cx(
            'absolute z-50 mt-1 max-h-72 min-w-full overflow-auto border border-zinc-300 bg-snow py-1 shadow-lg focus:outline-none',
            align === 'end' ? 'end-0' : 'start-0',
          )}
        >
          {options.map((o, i) => {
            const selected = o.value === value;
            const OIcon = o.icon;
            return (
              <li
                key={o.value}
                id={`${id}-o${i}`}
                data-index={i}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(i);
                }}
                className={cx('flex cursor-pointer items-start gap-2.5 px-3 py-2 text-sm whitespace-nowrap', i === active && 'bg-zinc-100', selected && 'font-medium')}
              >
                {OIcon && <OIcon className="mt-0.5 size-4 shrink-0 text-zinc-500" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-ink">{o.label}</span>
                  {o.description && <span className="block text-xs font-normal whitespace-normal text-zinc-500">{o.description}</span>}
                </span>
                <Check className={cx('mt-0.5 size-4 shrink-0 text-accent-600', !selected && 'invisible')} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Light / dark / system as a compact segmented control. */
export function ModeSwitch({
  value,
  onChange,
  labels = { light: 'Light', dark: 'Dark', system: 'System', group: 'Appearance' },
  className,
}: {
  value: ColorMode;
  onChange(m: ColorMode): void;
  labels?: { light: string; dark: string; system: string; group: string };
  className?: string;
}) {
  const opts = [
    { v: 'light', icon: Sun },
    { v: 'dark', icon: Moon },
    { v: 'system', icon: Monitor },
  ] as const;
  return (
    <div role="radiogroup" aria-label={labels.group} className={cx('flex h-8 border border-zinc-300 bg-snow', className)}>
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          aria-label={labels[o.v]}
          title={labels[o.v]}
          onClick={() => onChange(o.v)}
          className={cx(
            'flex w-8 items-center justify-center transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600',
            value === o.v ? 'bg-ink text-canvas' : 'text-zinc-500 hover:text-ink',
          )}
        >
          <o.icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
