import { useQuery } from '@tanstack/react-query';
import { cx } from '@grids/ui';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { useProject } from './context';

export type ScopeEntity = { id: string; name: string; type: string };

/** A level of the entity tree; children load when their parent is opened. */
function Level({ parent, depth, picked, covered, toggle }: { parent: string | null; depth: number; picked: ScopeEntity[]; covered: boolean; toggle(e: ScopeEntity): void }) {
  const { tenantId, project } = useProject();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const nodes = useQuery({ queryKey: ['places', tenantId, project.key, parent], queryFn: () => api.places(tenantId, project.key, parent) });
  if (nodes.isPending) return <li className="px-3 py-1.5 text-xs text-zinc-500" style={{ paddingInlineStart: 12 + depth * 20 }}>Loading…</li>;
  return (
    <>
      {nodes.data?.map((n) => {
        const isOpen = open.has(n.id);
        const own = picked.some((p) => p.id === n.id);
        // Everything under a ticked entity (or the whole project) is included.
        const inherited = covered && !own;
        return (
          <li key={n.id}>
            <div className="flex items-center gap-1 py-1 pe-3 hover:bg-zinc-50" style={{ paddingInlineStart: 8 + depth * 20 }}>
              {n.hasChildren ? (
                <button type="button" aria-label={isOpen ? `Collapse ${n.name}` : `Expand ${n.name}`} aria-expanded={isOpen} onClick={() => setOpen((s) => { const x = new Set(s); if (!x.delete(n.id)) x.add(n.id); return x; })} className="p-0.5 text-zinc-500 hover:text-ink">
                  {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4 rtl:rotate-180" />}
                </button>
              ) : (
                <span className="size-5" />
              )}
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-accent-600 disabled:opacity-60" checked={own || covered} disabled={inherited} title={inherited ? 'Included through a parent' : undefined} onChange={() => toggle({ id: n.id, name: n.name, type: n.type.name })} />
                <span className="truncate">{n.name}</span>
                <span className="shrink-0 text-xs text-zinc-500">{n.type.name}</span>
              </label>
            </div>
            {isOpen && (
              <ul>
                <Level parent={n.id} depth={depth + 1} picked={picked} covered={covered || own} toggle={toggle} />
              </ul>
            )}
          </li>
        );
      })}
      {nodes.data && !nodes.data.length && depth <= 1 && <li className="px-3 py-2 text-xs text-zinc-500">No entities yet</li>}
    </>
  );
}

/**
 * Limits a member to some entities (each with everything under it). Nothing picked = the whole project.
 * Opens a panel with a searchable, expandable tree of checkboxes.
 */
export function ScopePicker({ value, onChange }: { value: ScopeEntity[] | null; onChange(v: ScopeEntity[] | null): void }) {
  const { tenantId, project } = useProject();
  const [open, setOpen] = useState(false);
  const [rootOpen, setRootOpen] = useState(true);
  const [q, setQ] = useState('');
  const hits = useQuery({ queryKey: ['scope-search', tenantId, project.key, q], queryFn: () => api.searchPlaces(tenantId, project.key, q), enabled: open && q.trim().length > 0 });
  const list = value ?? [];
  const toggle = (e: ScopeEntity) => onChange(list.some((v) => v.id === e.id) ? list.filter((v) => v.id !== e.id) : [...list, e]);
  const label = value === null ? project.name : !value.length ? 'Select entities' : value.length === 1 ? value[0]!.name : `${value.length} entities`;
  return (
    <div>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx('flex min-h-9 w-full items-center gap-2 border bg-snow px-3 py-1.5 text-start text-sm hover:border-zinc-500 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600', open ? 'border-accent-600' : 'border-zinc-300')}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown className={cx('size-4 shrink-0 text-zinc-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-1 border border-zinc-300 bg-snow">
          <div className="relative border-b border-zinc-200 p-2">
            <Search className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input aria-label="Search entities" placeholder="Search entities" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-full border border-zinc-300 bg-snow ps-8 pe-2 text-sm focus:border-accent-600 focus:outline-none" />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {q.trim() ? (
              <>
                {hits.data?.map((h) => (
                  <li key={h.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50">
                      <input type="checkbox" className="size-4 accent-accent-600" checked={list.some((v) => v.id === h.id)} onChange={() => toggle({ id: h.id, name: h.name, type: h.type.name })} />
                      <span className="truncate">{h.name}</span>
                      <span className="shrink-0 text-xs text-zinc-500">{h.path ? `${h.path} › ` : ''}{h.type.name}</span>
                    </label>
                  </li>
                ))}
                {hits.data && !hits.data.length && <li className="px-3 py-2 text-xs text-zinc-500">No matches</li>}
              </>
            ) : (
              <>
                <li>
                  <div className="flex items-center gap-1 py-1 ps-2 pe-3 hover:bg-zinc-50">
                    <button type="button" aria-label={rootOpen ? `Collapse ${project.name}` : `Expand ${project.name}`} aria-expanded={rootOpen} onClick={() => setRootOpen(!rootOpen)} className="p-0.5 text-zinc-500 hover:text-ink">
                      {rootOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4 rtl:rotate-180" />}
                    </button>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-medium">
                      <input type="checkbox" className="size-4 accent-accent-600" checked={value === null} onChange={() => onChange(value === null ? [] : null)} />
                      <span className="truncate">{project.name}</span>
                      <span className="shrink-0 text-xs font-normal text-zinc-500">Whole project</span>
                    </label>
                  </div>
                  {rootOpen && (
                    <ul>
                      <Level parent={null} depth={1} picked={list} covered={value === null} toggle={toggle} />
                    </ul>
                  )}
                </li>
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
