import { Link } from '@tanstack/react-router';
import { cx } from '@grids/ui';
import { Check, Search, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { iconOf } from '@grids/viz';
import { LogIn } from 'lucide-react';
import { signIn } from './auth';
import { useI18n } from './prefs';
import { useOptionalUser, usePortalProjects, type PortalProject } from './projects';

/**
 * The project name in the explorer's header. Clicking it opens a window with every project
 * this visitor can open, to switch without going back to the list.
 */
export function ProjectSwitcher({ currentTo, logo, name, subtitle }: { currentTo: string; logo: ReactNode; name: string; subtitle?: string }) {
  const { items } = usePortalProjects();
  const user = useOptionalUser();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const close = () => {
    setOpen(false);
    setQ('');
  };
  const shown = items.filter((p) => !q || `${p.name} ${p.org} ${p.description}`.toLowerCase().includes(q.toLowerCase()));
  const groups: [string, PortalProject[]][] = [
    ['Your projects', shown.filter((p) => p.mine)],
    ['Public projects', shown.filter((p) => !p.mine)],
  ];
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex min-w-0 items-center gap-3 rounded-[12px] py-1 pe-2 text-start hover:bg-zinc-100"
        title="All projects"
      >
        {logo}
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[15px] font-semibold">{name}</span>
          {subtitle && <span className="block truncate text-xs text-zinc-500">{subtitle}</span>}
        </span>
      </button>
      {open && (
        <Modal onClose={close}>
          <header className="shrink-0 bg-snow px-6 pt-5 pb-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Projects</h2>
                <p className="mt-0.5 text-sm text-zinc-500">Open another project.</p>
              </div>
              <button type="button" onClick={close} aria-label="Close" className="flex size-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-ink">
                <X className="size-4" />
              </button>
            </div>
            <div className="relative mt-4">
              <Search className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                autoFocus
                aria-label="Search projects"
                placeholder="Search projects"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-11 w-full rounded-[14px] border border-transparent bg-zinc-100 ps-11 pe-4 text-sm placeholder:text-zinc-500 focus:border-accent-600 focus:bg-snow focus:outline-none"
              />
            </div>
          </header>
          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto border-t border-zinc-200/80 px-6 py-6">
            {groups.map(([label, list]) =>
              list.length ? (
                <section key={label}>
                  <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
                    {label}
                    <span className="rounded-full bg-zinc-200/70 px-2 py-0.5 text-[10px] tracking-normal text-zinc-600">{list.length}</span>
                  </h3>
                  <ul className="grid gap-4 sm:grid-cols-2">
                    {list.map((p) => (
                      <Tile key={p.to} p={p} current={p.to === currentTo} onOpen={close} />
                    ))}
                  </ul>
                </section>
              ) : null,
            )}
            {!shown.length && <p className="py-8 text-center text-sm text-zinc-500">No matching projects.</p>}
          </div>
          {user === null && (
            <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-zinc-200/80 bg-snow px-6 py-3.5">
              <span className="me-auto text-sm text-zinc-600">Sign in to see the private projects you have access to.</span>
              <button
                type="button"
                onClick={() => void signIn({ returnTo: window.location.pathname })}
                className="inline-flex h-9 items-center gap-2 rounded-[12px] bg-accent-600 px-4 text-sm font-medium text-on-accent hover:bg-accent-700"
              >
                <LogIn className="size-4" /> {t('auth.signIn.submit')}
              </button>
            </footer>
          )}
        </Modal>
      )}
    </div>
  );
}

/** The window: a dimmed backdrop and a rounded panel; Esc or a click outside closes it. */
function Modal({ children, onClose }: { children: ReactNode; onClose(): void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Projects" className="flex max-h-[min(760px,92vh)] w-[min(880px,96vw)] flex-col overflow-hidden rounded-[20px] bg-canvas shadow-2xl">
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A project as a tile: a cover band, its logo, name, organisation and description. */
function Tile({ p, current, onOpen }: { p: PortalProject; current: boolean; onOpen(): void }) {
  return (
    <li>
      <Link
        to={p.to}
        onClick={onOpen}
        aria-current={current ? 'true' : undefined}
        style={{ '--pc': p.color } as React.CSSProperties}
        className={cx('group flex h-full flex-col overflow-hidden rounded-[16px] border bg-snow shadow-[0_1px_2px_rgb(16_24_40/0.06),0_4px_12px_rgb(16_24_40/0.04)] transition-[border-color,box-shadow]', current ? 'border-[var(--pc)] ring-2 ring-[var(--pc)]/25' : 'border-zinc-100 hover:border-[var(--pc)] hover:shadow-[0_2px_4px_rgb(16_24_40/0.08),0_8px_20px_rgb(16_24_40/0.1)]')}
      >
        <div
          className="relative h-24 bg-cover bg-center"
          style={
            p.cover
              ? { backgroundImage: `url("${p.cover}")` }
              : { backgroundColor: `color-mix(in srgb, ${p.color} 10%, var(--color-snow))`, backgroundImage: `linear-gradient(color-mix(in srgb, ${p.color} 18%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, ${p.color} 18%, transparent) 1px, transparent 1px)`, backgroundSize: '16px 16px' }
          }
        >
          <span className={cx('absolute end-3 top-3 rounded-full border bg-snow/90 px-2 py-0.5 text-[11px] font-medium', p.badge === 'Public' ? 'border-emerald-300 text-emerald-800' : 'border-zinc-300 text-zinc-700')}>
            {p.badge}
          </span>
          {p.logo ? (
            <img src={p.logo} alt="" className="absolute start-4 -bottom-5 size-11 rounded-[12px] border border-zinc-200 bg-snow object-contain p-1" />
          ) : (
            <span className="absolute start-4 -bottom-5 flex size-11 items-center justify-center rounded-[12px] border-2 border-snow" style={{ background: p.color, color: contrast(p.color) }}>
              {(() => {
                const Icon = iconOf(p.icon);
                return <Icon className="size-5" />;
              })()}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col p-4 pt-8">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-zinc-500">{p.org}</span>
            {current && <span className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: p.color, background: `color-mix(in srgb, ${p.color} 12%, transparent)` }}><Check className="size-3.5" /> Viewing</span>}
          </div>
          <h3 className="mt-0.5 font-semibold group-hover:text-[color-mix(in_srgb,var(--pc)_75%,var(--color-ink))]">{p.name}</h3>
          {p.description && <p className="mt-1.5 line-clamp-2 text-sm text-zinc-600">{p.description}</p>}
        </div>
      </Link>
    </li>
  );
}

/** Black or white, whichever reads better on `hex`. */
function contrast(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.5 ? '#161616' : '#ffffff';
}
