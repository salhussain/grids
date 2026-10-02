import { applyColorMode, cx, storedColorMode, type ColorMode } from '@grids/ui';
import { BarChart3, ClipboardList, Globe, Monitor, Moon, Sun, Workflow } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
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

/** Decorative animated grid in the brand colour. Deterministic so it never reflows. */
function GridArt() {
  const COLS = 24;
  const ROWS = 18;
  const SIZE = 20;
  const cells = Array.from({ length: COLS * ROWS }, (_, i) => i).filter((i) => (i * 7919) % 23 < 2);
  return (
    <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox={`0 0 ${COLS * SIZE} ${ROWS * SIZE}`} aria-hidden>
      <defs>
        <pattern id="g" width={SIZE} height={SIZE} patternUnits="userSpaceOnUse">
          <path d={`M${SIZE} 0H0v${SIZE}`} fill="none" stroke="white" strokeOpacity="0.05" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)" />
      {cells.map((i) => (
        <rect
          key={i}
          className="grid-cell fill-accent-500"
          x={(i % COLS) * SIZE + 0.5}
          y={Math.floor(i / COLS) * SIZE + 0.5}
          width={SIZE - 1}
          height={SIZE - 1}
          style={{ animationDelay: `${((i * 0.61) % 9).toFixed(2)}s` }}
        />
      ))}
    </svg>
  );
}

/** Left half on large screens: who you are signing in to. */
function BrandPanel({ org }: { org: Branding | null }) {
  const t = useT();
  const name = org ? org.appName || org.name : 'Grids';
  const points = [
    { icon: ClipboardList, text: t('auth.brand.points.collect') },
    { icon: Workflow, text: t('auth.brand.points.automate') },
    { icon: BarChart3, text: t('auth.brand.points.insight') },
  ];
  return (
    <aside className="chrome relative hidden overflow-hidden bg-chrome text-white lg:flex lg:w-[44%] lg:max-w-[640px] lg:flex-col">
      <GridArt />
      <div className="absolute inset-0 bg-gradient-to-t from-chrome via-chrome/80 to-chrome/30" />
      <div className="relative flex h-full flex-col p-10 xl:p-14">
        <div className="flex items-center gap-3">
          <OrgMark org={org} className="size-9" />
          <span className="text-lg font-semibold tracking-tight">{name}</span>
        </div>
        <div className="mt-auto max-w-md">
          <h2 className="text-[34px] leading-[1.15] font-semibold tracking-tight">{org?.welcomeMessage || t('auth.brand.headline')}</h2>
          <ul className="mt-8 space-y-4">
            {points.map((p) => (
              <li key={p.text} className="flex items-start gap-3 text-[15px] text-zinc-300">
                <span className="flex size-8 shrink-0 items-center justify-center border border-white/15 bg-white/5">
                  <p.icon className="size-4 text-accent-500" />
                </span>
                <span className="pt-1">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
        {org && (
          <div className="mt-12 flex items-center gap-2 text-xs text-zinc-500">
            <GridsMark className="size-4" /> {t('common.poweredBy')}
          </div>
        )}
      </div>
    </aside>
  );
}

function LanguagePicker() {
  const { locale, available, setLocale, t } = useI18n();
  if (available.length < 2) return null;
  return (
    <label className="relative flex items-center">
      <span className="sr-only">{t('common.language')}</span>
      <Globe className="pointer-events-none absolute start-2.5 size-4 text-zinc-500" />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as typeof locale)}
        className="h-9 appearance-none border border-zinc-300 bg-snow ps-8 pe-3 text-sm text-ink hover:border-zinc-500 focus:outline-2 focus:outline-accent-600"
      >
        {available.map((l) => (
          <option key={l.code} value={l.code}>
            {l.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}

function ModePicker() {
  const t = useT();
  const [mode, setMode] = useState<ColorMode>(storedColorMode);
  useEffect(() => applyColorMode(mode), [mode]);
  const opts = [
    { v: 'light', icon: Sun, label: t('common.light') },
    { v: 'dark', icon: Moon, label: t('common.dark') },
    { v: 'system', icon: Monitor, label: t('common.system') },
  ] as const;
  return (
    <div role="radiogroup" aria-label={t('common.appearance')} className="flex border border-zinc-300 bg-snow">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={mode === o.v}
          title={o.label}
          aria-label={o.label}
          onClick={() => setMode(o.v)}
          className={cx(
            'flex size-[34px] items-center justify-center transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600',
            mode === o.v ? 'bg-ink text-canvas' : 'text-zinc-500 hover:text-ink',
          )}
        >
          <o.icon className="size-4" />
        </button>
      ))}
    </div>
  );
}

/** Split-screen frame shared by every page of the login app. */
export function Shell({ org, children }: { org: Branding | null; children: ReactNode }) {
  const { locale, t } = useI18n();
  useEffect(() => applyBrand(org?.primaryColor), [org?.primaryColor]);
  useEffect(() => {
    document.title = `${t('auth.signIn.title')} · ${org ? org.appName || org.name : 'Grids'}`;
  }, [org, t]);
  return (
    <div className="flex min-h-full bg-canvas">
      <BrandPanel org={org} />
      <div className="flex min-w-0 flex-1 flex-col bg-snow">
        <header className="flex items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-2.5 lg:invisible">
            <OrgMark org={org} className="size-7" />
            <span className="truncate font-semibold tracking-tight text-ink">{org ? org.appName || org.name : 'Grids'}</span>
          </div>
          <div className="flex items-center gap-2">
            <LanguagePicker />
            <ModePicker />
          </div>
        </header>
        <main className="flex flex-1 items-start justify-center px-5 pt-6 pb-12 sm:items-center sm:px-8 sm:pt-0">
          <div className="w-full max-w-[400px]">{children}</div>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-xs text-zinc-500 sm:px-8">
          <span>© {new Date().getFullYear()} {org?.name ?? 'Grids'}</span>
          <span className="flex items-center gap-4">
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
          </span>
        </footer>
      </div>
    </div>
  );
}
