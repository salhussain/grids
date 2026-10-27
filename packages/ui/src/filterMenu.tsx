import { cx } from './components';
import { Check, ChevronRight, ListFilter, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

type Icon = ComponentType<{ className?: string }>;
export interface FilterOption {
  value: string;
  label: string;
  icon?: Icon;
}
export interface FilterCategory {
  id: string;
  label: string;
  icon: Icon;
  options: FilterOption[];
}
export type FilterValue = Record<string, string[]>;

/** One category's options: a search box and a tick-list, several can be picked. */
function Flyout({
  cat,
  picked,
  onToggle,
}: {
  cat: FilterCategory;
  picked: string[];
  onToggle(v: string): void;
}) {
  const [q, setQ] = useState('');
  const shown = cat.options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div
      role="menu"
      aria-label={cat.label}
      className="absolute start-full top-0 z-50 ms-1 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-snow shadow-xl"
    >
      <div className="border-b border-zinc-100 px-3 py-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter…"
          aria-label={`Filter ${cat.label}`}
          className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
        />
      </div>
      <ul className="max-h-72 overflow-y-auto p-1">
        {shown.map((o) => {
          const on = picked.includes(o.value);
          return (
            <li key={o.value}>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => onToggle(o.value)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-zinc-100"
              >
                <span
                  className={cx(
                    'flex size-4 shrink-0 items-center justify-center rounded border',
                    on ? 'border-accent-600 bg-accent-600 text-white' : 'border-zinc-300',
                  )}
                >
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                {o.icon && <o.icon className="size-4 shrink-0" />}
                <span className="truncate">{o.label}</span>
              </button>
            </li>
          );
        })}
        {!shown.length && (
          <li className="px-2 py-4 text-center text-sm text-zinc-400">Nothing matches.</li>
        )}
      </ul>
    </div>
  );
}

/**
 * "Filter" button with a menu of what can be filtered on (priority, stage, label, person…); pointing at one opens
 * its options beside it, where several can be ticked. What is on shows as chips that can be taken off one by one.
 */
export function FilterMenu({
  categories,
  value,
  onChange,
}: {
  categories: FilterCategory[];
  value: FilterValue;
  onChange(v: FilterValue): void;
}) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) =>
      !box.current?.contains(e.target as Node) && (setOpen(false), setCat(null));
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (setOpen(false), setCat(null));
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => (
      document.removeEventListener('mousedown', away),
      document.removeEventListener('keydown', esc)
    );
  }, [open]);
  const toggle = (id: string, v: string) => {
    const cur = value[id] ?? [];
    onChange({ ...value, [id]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  const shown = useMemo(
    () => categories.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase())),
    [categories, q],
  );
  const active = categories.filter((c) => (value[c.id] ?? []).length);
  return (
    <>
      <div ref={box} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => (setOpen(!open), setCat(null), setQ(''))}
          className={cx(
            'inline-flex h-9 items-center gap-1.5 px-2.5 text-sm text-zinc-700 hover:bg-zinc-100',
            open && 'bg-zinc-100',
          )}
        >
          <ListFilter className="size-4" /> Filter
          {active.length > 0 && (
            <span className="num rounded-full bg-accent-600 px-1.5 text-[11px] leading-4 font-semibold text-on-accent">
              {active.reduce((n, c) => n + (value[c.id] ?? []).length, 0)}
            </span>
          )}
        </button>
        {open && (
          <div
            role="menu"
            aria-label="Add filter"
            className="absolute start-0 top-full z-40 mt-1 w-60 rounded-xl border border-zinc-200 bg-snow shadow-xl"
          >
            <div className="border-b border-zinc-100 px-3 py-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Add filter…"
                aria-label="Add filter"
                className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
              />
            </div>
            <ul className="p-1">
              {shown.map((c) => (
                <li key={c.id} className="relative" onMouseEnter={() => setCat(c.id)}>
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    onClick={() => setCat(c.id)}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-zinc-100',
                      cat === c.id && 'bg-zinc-100',
                    )}
                  >
                    <c.icon className="size-4 shrink-0 text-zinc-600" />
                    <span className="flex-1">{c.label}</span>
                    {(value[c.id] ?? []).length > 0 && (
                      <span className="num text-xs text-accent-700">
                        {(value[c.id] ?? []).length}
                      </span>
                    )}
                    <ChevronRight className="size-3.5 text-zinc-400" />
                  </button>
                  {cat === c.id && (
                    <Flyout
                      key={c.id}
                      cat={c}
                      picked={value[c.id] ?? []}
                      onToggle={(v) => toggle(c.id, v)}
                    />
                  )}
                </li>
              ))}
              {!shown.length && (
                <li className="px-2 py-4 text-center text-sm text-zinc-400">
                  Nothing to filter by.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
      {active.map((c) => {
        const names = (value[c.id] ?? []).map(
          (v) => c.options.find((o) => o.value === v)?.label ?? v,
        );
        return (
          <span
            key={c.id}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-100 ps-2.5 pe-1 text-sm"
          >
            <c.icon className="size-3.5 text-zinc-500" />
            <span className="text-zinc-500">{c.label}</span>
            <span className="max-w-48 truncate font-medium">
              {names.length > 2 ? `${names.length} selected` : names.join(', ')}
            </span>
            <button
              type="button"
              aria-label={`Remove the ${c.label} filter`}
              onClick={() => onChange({ ...value, [c.id]: [] })}
              className="p-1 text-zinc-400 hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          </span>
        );
      })}
    </>
  );
}
