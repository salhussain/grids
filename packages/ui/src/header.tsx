import { Check, Menu, Moon, Sun } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from './components';
import { Flag } from './flags';
import type { ColorMode } from './mode';

export { Flag };

export interface LanguageOption {
  code: string;
  /** The language's own name, e.g. "Français". */
  label: string;
  /** Marks a machine or unreviewed translation. */
  draft?: boolean;
}

/**
 * Language menu: a flag and native name for each language offered. The same
 * control on the sign-in pages, the workspace and the explorer.
 */
export function LanguageMenu({
  value,
  options,
  onChange,
  label,
  draftLabel,
  className,
  rounded,
}: {
  value: string;
  options: LanguageOption[];
  onChange(code: string): void;
  /** Accessible name, e.g. "Language". */
  label: string;
  draftLabel?: string;
  className?: string;
  /** Soft corners on the list and its rows (the public portal). */
  rounded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setActive(
      Math.max(
        0,
        options.findIndex((l) => l.code === value),
      ),
    );
    list.current?.focus();
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (options.length < 2) return null;
  const current = options.find((l) => l.code === value) ?? options[0]!;
  const close = () => (setOpen(false), button.current?.focus());
  const choose = (code: string) => (onChange(code), close());
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => (i + 1) % options.length);
    else if (e.key === 'ArrowUp') setActive((i) => (i - 1 + options.length) % options.length);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(options.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') choose(options[active]!.code);
    else if (e.key === 'Escape' || e.key === 'Tab') return close();
    else return;
    e.preventDefault();
  };

  return (
    <div ref={wrap} className={cx('relative', className)}>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        title={current.label}
        className={cx('flex size-9 items-center justify-center rounded-full hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent-600', open && 'bg-zinc-100')}
      >
        <Flag code={current.code} round />
      </button>
      {open && (
        <ul
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`lang-${options[active]?.code}`}
          onKeyDown={onKey}
          className={cx(
            'absolute end-0 top-full z-50 mt-1 min-w-56 border border-zinc-300 bg-snow whitespace-nowrap shadow-lg focus:outline-none',
            rounded ? 'rounded-[16px] p-1.5' : 'py-1',
          )}
        >
          {options.map((l, i) => (
            <li
              key={l.code}
              id={`lang-${l.code}`}
              role="option"
              lang={l.code}
              aria-selected={l.code === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(l.code)}
              className={cx(
                'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-ink',
                rounded && 'rounded-[10px]',
                i === active && 'bg-zinc-100',
                l.code === value && 'font-semibold',
              )}
            >
              <Flag code={l.code} />
              <span>{l.label}</span>
              {l.draft && draftLabel && (
                <span className="font-mono text-[10px] tracking-wide text-amber-700 uppercase">
                  {draftLabel}
                </span>
              )}
              <Check
                className={cx('ms-auto size-3.5 text-accent-700', l.code !== value && 'invisible')}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Whether the operating system is in dark mode (live). */
export function useSystemDark() {
  const [dark, setDark] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/**
 * Light/dark toggle. Follows the operating system until clicked, and always shows
 * the mode it switches to; picking the system's own mode goes back to following it.
 */
export function ThemeToggle({
  mode,
  onChange,
  labels,
  className,
}: {
  mode: ColorMode;
  onChange(next: ColorMode): void;
  /** Accessible names for switching to each mode. */
  labels: { toLight: string; toDark: string };
  className?: string;
}) {
  const systemDark = useSystemDark();
  const dark = mode === 'system' ? systemDark : mode === 'dark';
  const label = dark ? labels.toLight : labels.toDark;
  const icon =
    'absolute size-5 transition-[opacity,transform] duration-[400ms] motion-reduce:transition-none';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => onChange(dark === systemDark ? (dark ? 'light' : 'dark') : 'system')}
      className={cx(
        'relative flex size-9 shrink-0 items-center justify-center rounded-full text-ink hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent-600',
        className,
      )}
    >
      <Sun
        className={cx(
          icon,
          dark ? 'scale-100 rotate-0 opacity-100' : 'scale-60 -rotate-90 opacity-0',
        )}
      />
      <Moon
        className={cx(
          icon,
          dark ? 'scale-60 rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100',
        )}
      />
    </button>
  );
}

const SIDEBAR_KEY = 'grids.sidebarCollapsed';

/** Whether the desktop side menu is hidden; remembered on this device. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, set] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    set((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1');
      } catch {
        /* storage unavailable: still collapses for this page */
      }
      return !c;
    });
  return [collapsed, toggle];
}

/** Hamburger: toggles the side menu on desktop, opens it as a drawer on small screens. */
export function MenuButton({
  label,
  onToggle,
  onOpenDrawer,
  className,
}: {
  label: string;
  onToggle(): void;
  onOpenDrawer(): void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => (window.matchMedia('(min-width: 1024px)').matches ? onToggle() : onOpenDrawer())}
      className={cx('-ms-2 flex size-9 shrink-0 items-center justify-center text-zinc-600 hover:bg-zinc-100 hover:text-ink', className)}
    >
      <Menu className="size-5" />
    </button>
  );
}
