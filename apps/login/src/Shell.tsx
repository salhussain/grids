import { applyColorMode, cx, storedColorMode, type ColorMode } from '@grids/ui';
import type { LocaleCode } from '@grids/i18n';
import { Check, ChevronDown, Moon, Sun } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Branding } from './api';
import { applyBrand } from './brand';
import { Flag } from './flags';
import { isDraft, useI18n, useT } from './i18n';

/** The Grids mark: four squares. */
export function GridsMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" className="fill-accent-600" />
      <path d="M9 9h6v6H9zM17 9h6v6h-6zM9 17h6v6H9zM17 17h6v6h-6z" className="fill-on-accent" />
    </svg>
  );
}

function OrgMark({ org, className }: { org: Branding | null; className?: string }) {
  if (org?.logo) return <img src={org.logo} alt="" className={cx('object-contain', className)} />;
  return <GridsMark className={className} />;
}

/**
 * Full-page backdrop: a faint grid where cells in the brand colour fade in, hold
 * and fade out at random. Reads the brand and theme from CSS each frame, so it
 * follows tenant colours and the light/dark toggle without re-mounting.
 */
function GridBackground() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const root = document.documentElement;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const SIZE = 44;
    let cols = 0;
    let rows = 0;
    type Cell = { c: number; r: number; t0: number; dur: number; peak: number };
    let lit: Cell[] = [];
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const spawn = (now: number, initial: boolean): Cell => ({
      c: Math.floor(Math.random() * cols),
      r: Math.floor(Math.random() * rows),
      t0: now + (initial ? rand(-6000, 4000) : rand(0, 2500)),
      dur: rand(4000, 8000),
      peak: rand(0.35, 1),
    });
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      cols = Math.ceil(width / SIZE) + 1;
      rows = Math.ceil(height / SIZE) + 1;
      const now = performance.now();
      lit = Array.from({ length: Math.round(cols * rows * 0.07) }, () => spawn(now, true));
    };
    const draw = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const dark = root.getAttribute('data-theme') === 'dark';
      const s = SIZE * dpr;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(22,22,22,0.06)';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      for (let c = 0; c <= cols; c++) {
        ctx.moveTo(c * s + 0.5, 0);
        ctx.lineTo(c * s + 0.5, canvas.height);
      }
      for (let r = 0; r <= rows; r++) {
        ctx.moveTo(0, r * s + 0.5);
        ctx.lineTo(canvas.width, r * s + 0.5);
      }
      ctx.stroke();
      const max = dark ? 0.32 : 0.22;
      ctx.fillStyle = getComputedStyle(root).getPropertyValue('--brand-600').trim() || '#0f62fe';
      lit.forEach((cell, i) => {
        const p = reduce ? 0.5 : (now - cell.t0) / cell.dur;
        if (p >= 1) return void (lit[i] = spawn(now, false));
        if (p <= 0) return;
        ctx.globalAlpha = Math.sin(p * Math.PI) ** 2 * cell.peak * max;
        ctx.fillRect(cell.c * s + 2 * dpr, cell.r * s + 2 * dpr, s - 3 * dpr, s - 3 * dpr);
      });
      ctx.globalAlpha = 1;
    };

    let frame = 0;
    const loop = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(loop);
    };
    resize();
    const onResize = () => (resize(), draw(performance.now()));
    window.addEventListener('resize', onResize);
    // With reduced motion the cells stay still; redraw only when the theme or brand changes.
    const observer = new MutationObserver(() => draw(performance.now()));
    if (reduce) {
      draw(performance.now());
      observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    } else frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}

/** Language menu: flag and native name for each language the organisation offers. */
function LanguagePicker() {
  const { locale, available, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, available.findIndex((l) => l.code === locale)));
    list.current?.focus();
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (available.length < 2) return null;
  const current = available.find((l) => l.code === locale) ?? available[0]!;
  const close = () => (setOpen(false), button.current?.focus());
  const choose = (code: LocaleCode) => (setLocale(code), close());
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => (i + 1) % available.length);
    else if (e.key === 'ArrowUp') setActive((i) => (i - 1 + available.length) % available.length);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(available.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') choose(available[active]!.code);
    else if (e.key === 'Escape' || e.key === 'Tab') return close();
    else return;
    e.preventDefault();
  };

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t('common.language')}: ${current.nativeName}`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 border border-zinc-300 bg-snow px-2.5 text-sm text-ink hover:border-zinc-500 focus-visible:outline-2 focus-visible:outline-accent-600"
      >
        <Flag code={current.code} />
        <span>{current.nativeName}</span>
        <ChevronDown className={cx('size-3.5 text-zinc-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-label={t('common.language')}
          aria-activedescendant={`lang-${available[active]?.code}`}
          onKeyDown={onKey}
          className="absolute end-0 top-full z-20 mt-1 min-w-56 border border-zinc-300 bg-snow py-1 whitespace-nowrap shadow-lg focus:outline-none"
        >
          {available.map((l, i) => (
            <li
              key={l.code}
              id={`lang-${l.code}`}
              role="option"
              lang={l.code}
              aria-selected={l.code === locale}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(l.code)}
              className={cx('flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-ink', i === active && 'bg-zinc-100', l.code === locale && 'font-semibold')}
            >
              <Flag code={l.code} />
              <span>{l.nativeName}</span>
              {isDraft(l.code) && <span className="font-mono text-[10px] tracking-wide text-amber-700 uppercase">{t('common.draftTranslation')}</span>}
              <Check className={cx('ms-auto size-3.5 text-accent-700', l.code !== locale && 'invisible')} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Light/dark toggle. Follows the operating system until clicked, and always shows
 * the mode it switches to; picking the system's own mode goes back to following it.
 */
function ThemeToggle() {
  const t = useT();
  const [mode, setMode] = useState<ColorMode>(storedColorMode);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const [systemDark, setSystemDark] = useState(media.matches);
  useEffect(() => applyColorMode(mode), [mode]);
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const dark = mode === 'system' ? systemDark : mode === 'dark';
  const label = `${t('common.appearance')}: ${dark ? t('common.light') : t('common.dark')}`;
  const icon = 'absolute size-[17px] transition-[opacity,transform] duration-[400ms] motion-reduce:transition-none';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setMode(dark === systemDark ? (dark ? 'light' : 'dark') : 'system')}
      className="relative flex size-9 items-center justify-center border border-zinc-300 bg-snow text-ink hover:border-zinc-500 focus-visible:outline-2 focus-visible:outline-accent-600"
    >
      <Sun className={cx(icon, dark ? 'scale-100 rotate-0 opacity-100' : 'scale-60 -rotate-90 opacity-0')} />
      <Moon className={cx(icon, dark ? 'scale-60 rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100')} />
    </button>
  );
}

/** Frame shared by every page of the login app: one card centred over the grid. */
export function Shell({ org, children }: { org: Branding | null; children: ReactNode }) {
  const { locale, t } = useI18n();
  const name = org ? org.appName || org.name : 'Grids';
  useEffect(() => applyBrand(org?.primaryColor), [org?.primaryColor]);
  useEffect(() => {
    document.title = `${t('auth.signIn.title')} · ${name}`;
  }, [name, t]);
  return (
    <div className="relative flex min-h-full flex-col overflow-hidden bg-canvas">
      <GridBackground />
      <header className="relative z-10 flex justify-end gap-2 p-4">
        <LanguagePicker />
        <ThemeToggle />
      </header>
      <main className="relative flex flex-1 items-center justify-center px-4 pt-2 pb-8">
        <div className="w-full max-w-[420px] border border-zinc-200 bg-snow px-[22px] pt-8 pb-7 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-12px_rgb(0_0_0/0.18)] sm:px-9 sm:pt-10 sm:pb-9">
          <div className="mb-8 flex items-center gap-2.5">
            <OrgMark org={org} className="size-[30px]" />
            <span className="truncate font-semibold tracking-tight text-ink">{name}</span>
          </div>
          {children}
        </div>
      </main>
      <footer className="relative flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 p-4 text-xs text-zinc-500">
        <span>
          © {new Date().getFullYear()} {org?.name ?? 'Grids'}
        </span>
        {org && (
          <span className="flex items-center gap-1.5">
            <GridsMark className="size-3.5" /> {t('common.poweredBy')}
          </span>
        )}
        {isDraft(locale) && (
          <span className="border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800" title={t('common.draftTranslation')}>
            {t('common.draftTranslation')}
          </span>
        )}
        <a href="#" className="hover:text-ink">
          {t('common.privacy')}
        </a>
        <a href="#" className="hover:text-ink">
          {t('common.terms')}
        </a>
      </footer>
    </div>
  );
}
