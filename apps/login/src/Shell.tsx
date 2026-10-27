import {
  applyColorMode,
  cx,
  LanguageMenu,
  storedColorMode,
  ThemeToggle,
  type ColorMode,
} from '@grids/ui';
import type { LocaleCode } from '@grids/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Branding } from './api';
import { applyBrand } from './brand';
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

/** Language menu: the languages the organisation offers. */
function LanguagePicker() {
  const { locale, available, setLocale, t } = useI18n();
  return (
    <LanguageMenu
      value={locale}
      onChange={(code) => setLocale(code as LocaleCode)}
      label={t('common.language')}
      draftLabel={t('common.draftTranslation')}
      options={available.map((l) => ({
        code: l.code,
        label: l.nativeName,
        draft: isDraft(l.code),
      }))}
    />
  );
}

/** Light/dark toggle, remembered on this device. */
function ModeToggle() {
  const t = useT();
  const [mode, setMode] = useState<ColorMode>(storedColorMode);
  useEffect(() => applyColorMode(mode), [mode]);
  return (
    <ThemeToggle
      mode={mode}
      onChange={setMode}
      labels={{
        toLight: `${t('common.appearance')}: ${t('common.light')}`,
        toDark: `${t('common.appearance')}: ${t('common.dark')}`,
      }}
    />
  );
}

/** Frame shared by every page of the login app: one card centred over the grid. */
export function Shell({ org: orgBranding, children }: { org: Branding | null; children: ReactNode }) {
  const { locale, t } = useI18n();
  const platform = usePlatformBranding(!orgBranding);
  // Without an organisation, the platform's own branding (console › Platform settings).
  const org = orgBranding;
  const own = org?.signin?.ownLinks ? org.signin : null;
  const name = org ? org.appName || org.name : (platform?.appName ?? 'Grids');
  useEffect(() => applyBrand(org?.primaryColor ?? platform?.primaryColor), [org?.primaryColor, platform?.primaryColor]);
  useEffect(() => {
    document.title = `${t('auth.signIn.title')} · ${name}`;
  }, [name, t]);
  return (
    <div className="relative flex min-h-full flex-col overflow-hidden bg-canvas">
      <GridBackground />
      <header className="relative z-10 flex justify-end gap-2 p-4">
        <LanguagePicker />
        <ModeToggle />
      </header>
      <main className="relative flex flex-1 items-center justify-center px-4 pt-2 pb-8">
        <div className="w-full max-w-[420px] border border-zinc-200 bg-snow px-[22px] pt-8 pb-7 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-12px_rgb(0_0_0/0.18)] sm:px-9 sm:pt-10 sm:pb-9">
          <div className="mb-8 flex items-center gap-2.5">
            {org || !platform?.logo ? <OrgMark org={org} className="size-[30px]" /> : <img src={platform.logo} alt="" className="size-[30px] object-contain" />}
            <span className="truncate font-semibold tracking-tight text-ink">{name}</span>
          </div>
          {children}
        </div>
      </main>
      <footer className="relative flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 p-4 text-xs text-zinc-500">
        <span>
          © {new Date().getFullYear()} {org?.name ?? platform?.appName ?? 'Grids'}
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
        {own ? (
          <>
            {own.privacyUrl && (
              <a href={own.privacyUrl} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
                {t('common.privacy')}
              </a>
            )}
            {own.termsUrl && (
              <a href={own.termsUrl} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
                {t('common.terms')}
              </a>
            )}
          </>
        ) : (
          <>
            <a href="#" className="hover:text-ink">
              {t('common.privacy')}
            </a>
            <a href="#" className="hover:text-ink">
              {t('common.terms')}
            </a>
          </>
        )}
      </footer>
    </div>
  );
}

interface PlatformBranding {
  appName: string;
  primaryColor: string;
  logo: string | null;
  welcomeMessage: string;
}

/** The platform's look, used when the page isn't for a specific organisation. */
function usePlatformBranding(enabled: boolean) {
  const [b, setB] = useState<PlatformBranding | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch('/ui/api/platform', { headers: { 'x-grids-request': '1' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { branding: PlatformBranding | null } | null) => live && setB(d?.branding ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [enabled]);
  return b;
}
