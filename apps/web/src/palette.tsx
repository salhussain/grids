import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { cx } from '@grids/ui';
import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api';
import { useT } from './i18n';
import { iconOf } from './pages/projects/context';
import { useWorkspace } from './session';

export interface PaletteLink {
  label: string;
  href: string;
  icon: LucideIcon;
}

interface Entry {
  group: string;
  label: string;
  href: string;
  icon?: LucideIcon;
  color?: string;
}

/** Opens on ⌘K / Ctrl+K anywhere in the workspace. */
export function usePaletteShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

/** Search-and-jump: projects first, then the pages the person can open. */
export function CommandPalette({ open, onClose, links }: { open: boolean; onClose(): void; links: PaletteLink[] }) {
  const ws = useWorkspace();
  const t = useT();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const projects = useQuery({
    queryKey: ['projects', ws.tenant.id, false],
    queryFn: () => api.projects(ws.tenant.id, false),
    enabled: open,
  });

  const entries = useMemo<Entry[]>(() => {
    const all: Entry[] = [
      ...(projects.data ?? []).map((p) => ({
        group: t('web.nav.projects'),
        label: p.name,
        href: `/o/${ws.tenant.id}/p/${p.key}`,
        icon: iconOf(p.icon),
        color: p.color,
      })),
      ...links.map((l) => ({ group: t('web.shell.goTo'), ...l })),
    ];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((e) => e.label.toLowerCase().includes(needle)) : all;
  }, [projects.data, links, q, t, ws.tenant.id]);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);
  useEffect(() => setActive(0), [q]);

  if (!open) return null;
  const go = (e: Entry | undefined) => {
    if (!e) return;
    onClose();
    void navigate({ to: e.href });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => Math.min(entries.length - 1, i + 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
    else if (e.key === 'Enter') go(entries[active]);
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
  };

  let last = '';
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 pt-[12vh] backdrop-blur-[3px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={t('web.shell.search')} className="w-full max-w-xl border border-zinc-300 bg-snow shadow-raised">
        <label className="flex h-13 items-center gap-3 border-b border-zinc-200 px-4 text-zinc-500">
          <Search className="size-[18px] shrink-0" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('web.shell.searchPlaceholder')}
            aria-label={t('web.shell.search')}
            aria-activedescendant={entries[active] ? `pal-${active}` : undefined}
            className="h-12 min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink shadow-none outline-none"
          />
          <kbd className="border border-zinc-300 bg-zinc-50 px-1.5 font-mono text-[10.5px] text-zinc-500">Esc</kbd>
        </label>
        <ul role="listbox" className="max-h-[340px] overflow-y-auto p-1.5">
          {!entries.length && <li className="px-3 py-6 text-center text-sm text-zinc-500">{t('web.shell.noMatches')}</li>}
          {entries.map((e, i) => {
            const head = e.group !== last ? ((last = e.group), e.group) : null;
            const Icon = e.icon;
            return (
              <li key={`${e.group}-${e.href}`} role="presentation">
                {head && <div className="px-3 pt-2.5 pb-1 font-mono text-[10px] tracking-[0.08em] text-zinc-500 uppercase">{head}</div>}
                <div
                  id={`pal-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(e)}
                  className={cx('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm', i === active ? 'bg-zinc-100 text-ink' : 'text-zinc-700')}
                >
                  {e.color ? (
                    <span className="flex size-6 shrink-0 items-center justify-center text-white" style={{ background: e.color }}>
                      {Icon && <Icon className="size-3.5" />}
                    </span>
                  ) : (
                    Icon && <Icon className="size-4 shrink-0 text-zinc-500" strokeWidth={1.75} />
                  )}
                  <span className="truncate">{e.label}</span>
                  {i === active && <CornerDownLeft className="ms-auto size-3.5 shrink-0 text-zinc-400" />}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
