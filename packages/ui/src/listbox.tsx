import { Check, ChevronDown, Monitor, Moon, Search, Sun } from 'lucide-react';
import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
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
  searchable,
  onSearch,
  id: triggerId,
  invalid,
  values,
  onChangeMany,
  trigger,
}: {
  value: T | null;
  /** Several choices at once: pass `values` and `onChangeMany`; the list stays open while ticking. */
  values?: T[];
  onChangeMany?(v: T[]): void;
  /** Shows the list from a plain button with this look and content instead of a select box. */
  trigger?: { className: string; children: ReactNode };
  options: ListboxOption<NoInfer<T>>[];
  onChange?(v: T): void;
  /** Accessible name (omit when a <label for> points at `id`). */
  label?: string;
  id?: string;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
  align?: 'start' | 'end';
  /** Smaller trigger (toolbars). */
  compact?: boolean;
  disabled?: boolean;
  /** A search box at the top of the list that filters the options. */
  searchable?: boolean;
  /** The options come from somewhere that does the searching (a server): called as the person types, and the list is shown as given instead of being filtered here. */
  onSearch?(query: string): void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<CSSProperties | null>(null);
  const typed = useRef({ text: '', at: 0 });
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const multiple = !!values;
  const picked = multiple ? options.filter((o) => values.includes(o.value)) : [];
  const current = options.find((o) => o.value === value) ?? null;
  const textOf = (o: ListboxOption<T>) => (o.text ?? (typeof o.label === 'string' ? o.label : '')).toLowerCase();
  const shown = searchable && !onSearch && query.trim() ? options.filter((o) => `${textOf(o)} ${typeof o.description === 'string' ? o.description.toLowerCase() : ''}`.includes(query.trim().toLowerCase())) : options;

  useEffect(() => {
    if (!open) {
      setQuery('');
      onSearch?.('');
      return;
    }
    setActive(Math.max(0, options.findIndex((o) => (multiple ? values.includes(o.value) : o.value === value))));
    (searchable ? search.current : list.current)?.focus();
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // The list floats over everything (a dialog's scrolling body or footer must not clip it): it is placed
  // against the viewport below the button, or above it when there is no room, and never taller than the room.
  useLayoutEffect(() => {
    if (!open) return setBox(null);
    const place = () => {
      const r = root.current?.querySelector('button')?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 220 && above > below;
      const rtl = getComputedStyle(root.current!).direction === 'rtl';
      const fromEnd = (align === 'end') !== rtl;
      // The list is drawn on the page body, outside any project: it takes the colour of the project it was opened from.
      const scope = root.current?.closest('.brand-scope');
      const look = scope ? getComputedStyle(scope) : null;
      const brand = look && look.getPropertyValue('--brand-600').trim() ? ({ '--brand-600': look.getPropertyValue('--brand-600').trim(), '--brand-contrast': look.getPropertyValue('--brand-contrast').trim() } as CSSProperties) : {};
      setBox({
        ...brand,
        position: 'fixed',
        minWidth: trigger ? Math.max(r.width, 320) : r.width,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: Math.max(120, Math.min(400, up ? above : below)),
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
        ...(fromEnd ? { right: window.innerWidth - r.right } : { left: r.left }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align]);

  // Keep the active option in view by scrolling the list itself (scrollIntoView would also scroll the page behind).
  useEffect(() => {
    const ul = list.current;
    const el = ul?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!ul || !el) return;
    if (el.offsetTop < ul.scrollTop) ul.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = el.offsetTop + el.offsetHeight - ul.clientHeight;
  }, [active, open, box]);

  const choose = (i: number) => {
    const o = shown[i];
    if (!o) return;
    if (multiple) {
      onChangeMany?.(values.includes(o.value) ? values.filter((v) => v !== o.value) : [...values, o.value]);
      setActive(i);
      return;
    }
    onChange?.(o.value);
    setOpen(false);
    root.current?.querySelector('button')?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(shown.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Home' && !searchable) setActive(0);
    else if (e.key === 'End' && !searchable) setActive(shown.length - 1);
    else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) choose(active);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      if (e.key === 'Escape') root.current?.querySelector('button')?.focus();
      return;
    } else if (e.key.length === 1) {
      if (searchable) return; // typing goes to the search box
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const i = shown.findIndex((o) => textOf(o).startsWith(typed.current.text));
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
        id={triggerId}
        disabled={disabled}
        aria-invalid={invalid || undefined}
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
        className={
          trigger
            ? cx('focus-visible:outline-2 focus-visible:outline-accent-600 disabled:opacity-50', trigger.className)
            : cx(
                'flex w-full items-center gap-2 border border-zinc-300 bg-snow text-start text-ink transition-colors hover:border-zinc-500 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600 disabled:opacity-50',
                compact ? 'h-8 px-2.5 text-[13px]' : 'min-h-9 px-3 py-1.5 text-sm',
                invalid ? 'border-red-500' : open && 'border-accent-600',
              )
        }
      >
        {trigger ? (
          trigger.children
        ) : multiple ? (
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {picked.length === 0 && <span className="text-zinc-400">{placeholder}</span>}
            {picked.map((o) => {
              const PIcon = o.icon;
              return (
                <span key={o.value} className="inline-flex items-center gap-1.5 border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-[13px]">
                  {PIcon && <PIcon className="size-3.5 text-zinc-500" />}
                  {o.label}
                </span>
              );
            })}
          </span>
        ) : (
          <>
            {Icon && <Icon className="size-4 shrink-0 text-zinc-500" />}
            <span className={cx('min-w-0 flex-1 truncate', !current && 'text-zinc-400')}>{current ? current.label : placeholder}</span>
          </>
        )}
        {!trigger && <ChevronDown className={cx('size-4 shrink-0 text-zinc-500 transition-transform', open && 'rotate-180')} />}
      </button>
      {open &&
        box &&
        createPortal(
        <div
          ref={pop}
          onKeyDown={onKey}
          style={box}
          className="z-[100] flex flex-col border border-zinc-300 bg-snow text-ink shadow-lg"
        >
          {searchable && (
            <div className="relative shrink-0 border-b border-zinc-200 p-2">
              <Search className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                ref={search}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  onSearch?.(e.target.value);
                  setActive(0);
                }}
                aria-label={`Search ${label ?? ''}`}
                placeholder="Search"
                className="h-8 w-full border border-zinc-300 bg-snow ps-8 pe-2 text-sm focus:border-accent-600 focus:outline-none"
              />
            </div>
          )}
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-multiselectable={multiple || undefined}
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-o${active}`}
          className="relative min-h-0 flex-1 overflow-auto py-1 focus:outline-none"
        >
          {!shown.length && <li className="px-3 py-3 text-sm text-zinc-500">Nothing matches.</li>}
          {shown.map((o, i) => {
            const selected = multiple ? values.includes(o.value) : o.value === value;
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
                className={cx('flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm whitespace-nowrap', i === active && 'bg-zinc-100', selected && 'font-medium')}
              >
                {OIcon && <OIcon className="size-4 shrink-0 text-zinc-500" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-ink">{o.label}</span>
                  {o.description && <span className="block text-xs font-normal whitespace-normal text-zinc-500">{o.description}</span>}
                </span>
                <Check className={cx('size-4 shrink-0 text-accent-600', !selected && 'invisible')} />
              </li>
            );
          })}
        </ul>
        </div>,
        root.current?.closest('dialog') ?? document.body,
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

/** Text of an <option>'s children (they may be several strings and numbers). */
const textOf = (n: ReactNode): string =>
  Children.toArray(n)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement(c) ? textOf((c.props as { children?: ReactNode }).children) : ''))
    .join('');

/** The <option>s inside a select's children, however they are wrapped (fragments, arrays, maps). */
function optionsOf(children: ReactNode, out: ListboxOption<string>[] = []): ListboxOption<string>[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const el = c as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;
    if (el.type === Fragment || el.type === 'optgroup') optionsOf(el.props.children, out);
    else if (el.type === 'option') {
      const label = textOf(el.props.children);
      out.push({ value: String(el.props.value ?? label), label, text: label });
    }
  });
  return out;
}

const SEARCH_FROM = 8;

/**
 * Drop-in for the native <select>: same <option> children and onChange(e.target.value),
 * drawn as the app's own dropdown (searchable once the list is long).
 */
export function Select({ className, children, value, onChange, disabled, id, icon, searchable, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { icon?: React.ComponentType<{ className?: string }>; /** Always show the search box (otherwise only for long lists). */ searchable?: boolean }) {
  const options = optionsOf(children).map((o) => (icon ? { ...o, icon } : o));
  const w = className && /(^|\s)(\w+:)?w-/.test(className) ? '' : 'w-full';
  const v = value === undefined || value === null ? '' : String(value);
  return (
    <Listbox
      id={id}
      value={v}
      options={options}
      label={props['aria-label']}
      invalid={props['aria-invalid'] === true || props['aria-invalid'] === 'true'}
      disabled={disabled}
      searchable={searchable ?? options.length > SEARCH_FROM}
      placeholder=""
      className={cx(w, className)}
      onChange={(next) => onChange?.({ target: { value: next }, currentTarget: { value: next } } as unknown as React.ChangeEvent<HTMLSelectElement>)}
    />
  );
}
