import { cx } from '@grids/ui';
import type { PermissionGroupDto } from '@grids/schema';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useState } from 'react';

/**
 * Picks the permissions a member holds, from the permission tree: tick any number of them.
 * Everything below a ticked permission is covered by it and shown ticked.
 */
export function PermissionPicker({ groups, value, onChange }: { groups: PermissionGroupDto[]; value: string[]; onChange(v: string[]): void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const children = (parent: string | null) => groups.filter((g) => g.parent === parent);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const names = value.flatMap((id) => groups.find((g) => g.id === id)?.name ?? []);
  const label = !names.length ? 'Select permissions' : names.length === 1 ? names[0]! : `${names.length} permissions`;
  const term = q.trim().toLowerCase();

  const row = (g: PermissionGroupDto, covered: boolean, depth: number) => {
    const own = value.includes(g.id);
    const kids = children(g.id);
    const isOpen = expanded.has(g.id);
    return (
      <li key={g.id}>
        <div className="flex items-center gap-1 py-1 pe-3 hover:bg-zinc-50" style={{ paddingInlineStart: 8 + depth * 20 }}>
          {kids.length && !term ? (
            <button type="button" aria-label={isOpen ? `Collapse ${g.name}` : `Expand ${g.name}`} aria-expanded={isOpen} onClick={() => setExpanded((s) => { const x = new Set(s); if (!x.delete(g.id)) x.add(g.id); return x; })} className="p-0.5 text-zinc-500 hover:text-ink">
              {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4 rtl:rotate-180" />}
            </button>
          ) : (
            <span className="size-5" />
          )}
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-accent-600 disabled:opacity-60" checked={own || covered} disabled={covered && !own} title={covered && !own ? 'Included through a parent permission' : undefined} onChange={() => toggle(g.id)} />
            <span className="truncate">{g.name}</span>
          </label>
        </div>
        {isOpen && !term && <ul>{kids.map((k) => row(k, covered || own, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx('flex min-h-9 w-full items-center gap-2 border bg-snow px-3 py-1.5 text-start text-sm hover:border-zinc-500 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600', open ? 'border-accent-600' : 'border-zinc-300')}
      >
        <span className={cx('min-w-0 flex-1 truncate', !names.length && 'text-zinc-400')}>{label}</span>
        <ChevronDown className={cx('size-4 shrink-0 text-zinc-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-1 border border-zinc-300 bg-snow">
          <div className="relative border-b border-zinc-200 p-2">
            <Search className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input aria-label="Search permissions" placeholder="Search permissions" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-full border border-zinc-300 bg-snow ps-8 pe-2 text-sm focus:border-accent-600 focus:outline-none" />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {term ? (
              groups.filter((g) => g.name.toLowerCase().includes(term)).map((g) => row(g, false, 0))
            ) : (
              children(null).map((g) => row(g, false, 0))
            )}
            {term && !groups.some((g) => g.name.toLowerCase().includes(term)) && <li className="px-3 py-2 text-xs text-zinc-500">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
