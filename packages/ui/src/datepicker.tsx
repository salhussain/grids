import { Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './components';

/** Dates travel as "YYYY-MM-DD" strings (what <input type="date"> used), in the viewer's own time zone. */
const parse = (v: string | null | undefined): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  t.setDate(Math.min(d.getDate(), new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
  return t;
};
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** A region in its own colour (a project's): the same steps the app derives for its brand colour. */
/** The colour of the project a field sits in (the pop-up is drawn on the page body, outside it), when none is given. */
function scopeAccent(el: Element | null): string | undefined {
  const scope = el?.closest('.brand-scope');
  const v = scope ? getComputedStyle(scope).getPropertyValue('--brand-600').trim() : '';
  return /^#[0-9a-f]{6}$/i.test(v) ? v : undefined;
}

function tint(accent: string | undefined): { className?: string; style?: CSSProperties } {
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return {};
  const n = parseInt(accent.slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return { className: 'brand-scope', style: { '--brand-600': accent, '--brand-contrast': lum > 0.6 ? '#161616' : '#ffffff' } as CSSProperties };
}

const locale = () => (typeof document !== 'undefined' && document.documentElement.lang) || undefined;

/**
 * A date field with a calendar in the app's own style (instead of the browser's picker).
 * Monday-first; arrow keys move by day and week, PageUp/PageDown by month, Enter picks.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Select a date',
  disabled,
  clearable = true,
  className,
  id,
  invalid,
  accent,
  ...rest
}: {
  value: string | null | undefined;
  onChange(v: string): void;
  /** Colour for the selected day and the focus ring (a project's colour); the app's brand colour when omitted. */
  accent?: string;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  id?: string;
  invalid?: boolean;
  'aria-label'?: string;
}) {
  const auto = useId();
  const selected = parse(value);
  const lo = parse(min);
  const hi = parse(max);
  const [open, setOpen] = useState(false);
  // The day the keyboard is on, and so the month being shown.
  const [focus, setFocus] = useState<Date>(() => selected ?? new Date());
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<CSSProperties | null>(null);
  const today = new Date();
  const [found, setFound] = useState<string | undefined>();
  const brand = tint(accent ?? found);
  useEffect(() => {
    if (open && !accent) setFound(scopeAccent(box.current));
  }, [open, accent]);

  useEffect(() => {
    if (!open) return;
    setFocus(selected ?? clampDay(new Date()));
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  // The calendar floats over everything (a dialog's body must not grow or clip it): below the field, or above when short of room.
  useLayoutEffect(() => {
    if (!open) return setAt(null);
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r) return;
      const need = 380;
      const up = window.innerHeight - r.bottom < need && r.top > window.innerHeight - r.bottom;
      const rtl = getComputedStyle(trigger.current!).direction === 'rtl';
      setAt({
        position: 'fixed',
        width: 288,
        maxWidth: 'calc(100vw - 16px)',
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
        ...(rtl ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, Math.min(r.left, window.innerWidth - 296)) }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (open) grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }, [open, focus]);

  function clampDay(d: Date) {
    if (lo && d < lo) return lo;
    if (hi && d > hi) return hi;
    return d;
  }
  const outside = (d: Date) => (!!lo && d < lo) || (!!hi && d > hi);
  const pick = (d: Date) => {
    if (outside(d)) return;
    onChange(iso(d));
    setOpen(false);
    trigger.current?.focus();
  };

  const fmt = useMemo(() => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }), []);
  const monthName = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(focus);
  const weekdays = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale(), { weekday: 'short' });
    const monday = new Date(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) => f.format(addDays(monday, i)));
  }, []);
  // Six weeks starting on the Monday on or before the 1st.
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));

  const onKey = (e: React.KeyboardEvent) => {
    const move = (d: Date) => (e.preventDefault(), setFocus(d));
    if (e.key === 'ArrowLeft') move(addDays(focus, -1));
    else if (e.key === 'ArrowRight') move(addDays(focus, 1));
    else if (e.key === 'ArrowUp') move(addDays(focus, -7));
    else if (e.key === 'ArrowDown') move(addDays(focus, 7));
    else if (e.key === 'PageUp') move(addMonths(focus, e.shiftKey ? -12 : -1));
    else if (e.key === 'PageDown') move(addMonths(focus, e.shiftKey ? 12 : 1));
    else if (e.key === 'Home') move(addDays(focus, -((focus.getDay() + 6) % 7)));
    else if (e.key === 'End') move(addDays(focus, 6 - ((focus.getDay() + 6) % 7)));
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
  };

  const nav = 'flex size-8 items-center justify-center text-zinc-600 hover:bg-zinc-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-600';
  return (
    <div ref={box} className={cx('relative', brand.className, className)} style={brand.style}>
      <button
        ref={trigger}
        id={id ?? auto}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-label={rest['aria-label']}
        onClick={() => setOpen(!open)}
        className={cx(
          'flex h-9 w-full items-center gap-2 border bg-snow px-3 text-start text-sm transition-colors hover:border-zinc-500 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600 disabled:opacity-50',
          invalid ? 'border-red-500' : open ? 'border-accent-600' : 'border-zinc-300',
        )}
      >
        <Calendar className="size-4 shrink-0 text-zinc-500" />
        <span className={cx('min-w-0 flex-1 truncate', !selected && 'text-zinc-400')}>{selected ? fmt.format(selected) : placeholder}</span>
      </button>
      {open && at && createPortal(
        <div ref={panel} role="dialog" aria-label="Choose a date" onKeyDown={onKey} style={{ ...at, ...brand.style }} className={cx('z-[100] border border-zinc-300 bg-snow p-3 shadow-lg', brand.className)}>
          <div className="mb-2 flex items-center justify-between gap-1">
            <div className="flex">
              <button type="button" aria-label="Previous year" className={nav} onClick={() => setFocus(addMonths(focus, -12))}>
                <ChevronsLeft className="size-4 rtl:rotate-180" />
              </button>
              <button type="button" aria-label="Previous month" className={nav} onClick={() => setFocus(addMonths(focus, -1))}>
                <ChevronLeft className="size-4 rtl:rotate-180" />
              </button>
            </div>
            <div className="text-sm font-semibold capitalize" aria-live="polite">
              {monthName}
            </div>
            <div className="flex">
              <button type="button" aria-label="Next month" className={nav} onClick={() => setFocus(addMonths(focus, 1))}>
                <ChevronRight className="size-4 rtl:rotate-180" />
              </button>
              <button type="button" aria-label="Next year" className={nav} onClick={() => setFocus(addMonths(focus, 12))}>
                <ChevronsRight className="size-4 rtl:rotate-180" />
              </button>
            </div>
          </div>
          <div ref={grid} role="grid" aria-label={monthName} className="grid grid-cols-7 text-center text-sm">
            {weekdays.map((w) => (
              <div key={w} role="columnheader" className="py-1.5 text-[11px] font-medium text-zinc-500 uppercase">
                {w}
              </div>
            ))}
            {days.map((d) => {
              const inMonth = d.getMonth() === focus.getMonth();
              const isSel = !!selected && sameDay(d, selected);
              const isToday = sameDay(d, today);
              const off = outside(d);
              return (
                <button
                  key={d.getTime()}
                  type="button"
                  role="gridcell"
                  tabIndex={sameDay(d, focus) ? 0 : -1}
                  aria-selected={isSel}
                  aria-current={isToday ? 'date' : undefined}
                  disabled={off}
                  onClick={() => pick(d)}
                  className={cx(
                    'flex h-9 items-center justify-center transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600',
                    isSel ? 'bg-accent-600 font-semibold text-on-accent' : off ? 'text-zinc-300' : inMonth ? 'text-ink hover:bg-zinc-100' : 'text-zinc-400 hover:bg-zinc-100',
                    isToday && !isSel && 'font-semibold text-accent-700 ring-1 ring-inset ring-accent-600',
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2 text-sm">
            {clearable ? (
              <button
                type="button"
                className="px-2 py-1 text-zinc-600 hover:text-ink"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                Clear
              </button>
            ) : (
              <span />
            )}
            <button type="button" disabled={outside(today)} className="px-2 py-1 font-medium text-accent-700 hover:underline disabled:text-zinc-300 disabled:no-underline" onClick={() => pick(today)}>
              Today
            </button>
          </div>
        </div>,
        box.current?.closest('dialog') ?? document.body,
      )}
    </div>
  );
}

/**
 * A time of day ("HH:MM", 24-hour): type it, or open the list and pick the hour and the minute.
 */
export function TimePicker({
  value,
  onChange,
  disabled,
  accent,
  className,
  step = 5,
  'aria-label': label = 'Time',
}: {
  value: string;
  onChange(v: string): void;
  disabled?: boolean;
  accent?: string;
  className?: string;
  /** Minutes between the choices in the list. */
  step?: number;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<CSSProperties | null>(null);
  const [found, setFound] = useState<string | undefined>();
  const brand = tint(accent ?? found);
  useEffect(() => {
    if (open && !accent) setFound(scopeAccent(box.current));
  }, [open, accent]);
  const [h, m] = /^(\d{2}):(\d{2})$/.test(value) ? value.split(':').map(Number) : [null, null];
  const commit = (t: string) => {
    const x = /^(\d{1,2})[:.]?(\d{2})?$/.exec(t.trim());
    const hh = x ? Math.min(23, Number(x[1])) : null;
    const mm = x ? Math.min(59, Number(x[2] ?? 0)) : 0;
    const clean = hh === null ? '' : `${pad(hh)}:${pad(mm)}`;
    setText(clean);
    onChange(clean);
  };
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return setAt(null);
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const up = window.innerHeight - r.bottom < 280 && r.top > window.innerHeight - r.bottom;
      setAt({ position: 'fixed', width: 168, ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }), left: Math.max(8, Math.min(r.right - 168, window.innerWidth - 176)) });
    };
    place();
    // The page moving under the popup moves it too; scrolling the lists inside it does not.
    const onScroll = (e: Event) => !panel.current?.contains(e.target as Node) && place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);
  // Bring the chosen hour and minute into view once, when the list opens (not again as it is scrolled or moved).
  const centred = useRef(false);
  useEffect(() => {
    if (!open) centred.current = false;
    else if (at && !centred.current) {
      centred.current = true;
      panel.current?.querySelectorAll('[aria-selected="true"]').forEach((el) => el.scrollIntoView({ block: 'center' }));
    }
  }, [open, at]);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  const cell = (on: boolean) => cx('flex h-8 w-full items-center justify-center text-sm tabular-nums', on ? 'bg-accent-600 font-semibold text-on-accent' : 'text-ink hover:bg-zinc-100');
  return (
    <div ref={box} className={cx('relative', brand.className, className)} style={brand.style}>
      <input
        aria-label={label}
        inputMode="numeric"
        placeholder="HH:MM"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'ArrowDown' && !open) setOpen(true);
          if (e.key === 'Escape') setOpen(false);
        }}
        className="h-9 w-full border border-zinc-300 bg-snow ps-3 pe-9 text-sm tabular-nums focus:border-accent-600 focus:outline-none disabled:opacity-50"
      />
      <button type="button" disabled={disabled} aria-label="Pick a time" aria-expanded={open} onClick={() => setOpen(!open)} className="absolute inset-y-0 end-0 flex w-9 items-center justify-center text-zinc-500 hover:text-ink disabled:opacity-50">
        <Clock className="size-4" />
      </button>
      {open && at && createPortal(
        <div ref={panel} role="dialog" aria-label="Choose a time" style={{ ...at, ...brand.style }} className={cx('z-[100] border border-zinc-300 bg-snow p-2 shadow-lg', brand.className)}>
          <div className="grid grid-cols-2 gap-2">
            <div role="listbox" aria-label="Hour" className="max-h-56 overflow-y-auto">
              {hours.map((x) => (
                <button key={x} type="button" role="option" aria-selected={x === h} className={cell(x === h)} onClick={() => onChange(`${pad(x)}:${pad(m ?? 0)}`)}>
                  {pad(x)}
                </button>
              ))}
            </div>
            <div role="listbox" aria-label="Minute" className="max-h-56 overflow-y-auto">
              {minutes.map((x) => (
                <button
                  key={x}
                  type="button"
                  role="option"
                  aria-selected={x === m}
                  className={cell(x === m)}
                  onClick={() => {
                    onChange(`${pad(h ?? 0)}:${pad(x)}`);
                    setOpen(false);
                  }}
                >
                  {pad(x)}
                </button>
              ))}
            </div>
          </div>
        </div>,
        box.current?.closest('dialog') ?? document.body,
      )}
    </div>
  );
}

/** A date and a time ("YYYY-MM-DDTHH:MM"): the calendar above plus a time you can type or pick. */
export function DateTimePicker({
  value,
  onChange,
  invalid,
  className,
  id,
  accent,
}: {
  value: string | null | undefined;
  onChange(v: string): void;
  invalid?: boolean;
  className?: string;
  id?: string;
  /** Colour for the selection (a project's colour); the app's brand colour when omitted. */
  accent?: string;
}) {
  const date = (value ?? '').slice(0, 10);
  const time = (value ?? '').slice(11, 16);
  return (
    <div className={cx('flex gap-2', className)}>
      <DatePicker id={id} value={date} invalid={invalid} accent={accent} className="min-w-0 flex-1" onChange={(d) => onChange(d ? `${d}T${time || '00:00'}` : '')} />
      <TimePicker value={time} accent={accent} disabled={!date} className="w-28 shrink-0" onChange={(t) => onChange(date ? `${date}T${t || '00:00'}` : '')} />
    </div>
  );
}
