import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { EntityDetail, EntitySummary } from '@grids/schema';
import { Button, EmptyState, Listbox, cx } from '@grids/ui';
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsLeft, ChevronsRight, ChevronsUpDown, Layers, Maximize2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { iconOf, useProject } from './context';

const PAGE = 200;
/** The most places "Open everything" will open, so a very large branch cannot lock the page. */
const LIMIT = 500;
const W = 232;
const H = 76;
const GAP_X = 72;
const GAP_Y = 18;

type Place = Pick<EntitySummary, 'id' | 'name' | 'type' | 'childCount'>;
type Data = { place: Place; role: 'above' | 'self' | 'below'; open: boolean; loading: boolean; shown: number; onToggle(id: string): void; base: string; moreAbove: number; onMoreAbove(): void };

/** One place as a card, in the style of an asset in a lineage graph: its kind and name, and what is around it. */
function PlaceCard({ data }: NodeProps<Node<Data>>) {
  const { place, role, open, loading, shown, onToggle, base, moreAbove, onMoreAbove } = data;
  const Icon = iconOf(place.type.icon);
  const kids = place.childCount;
  return (
    <div className={cx('pointer-events-auto relative w-[232px] border bg-snow shadow-sm', role === 'self' ? 'border-accent-600 shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand-600)_18%,transparent)]' : 'border-zinc-300 hover:border-zinc-500')}>
      {moreAbove > 0 ? (
        <>
          <Handle type="target" position={Position.Left} className="!pointer-events-none !opacity-0" />
          <button
            type="button"
            onClick={onMoreAbove}
            aria-label={`Show the ${moreAbove === 1 ? 'place' : `${moreAbove} places`} above`}
            title={`Show ${moreAbove} more above`}
            className="nodrag absolute top-1/2 -left-3 z-10 flex size-6 -translate-y-1/2 items-center justify-center border border-zinc-300 bg-snow text-zinc-600 shadow-sm hover:border-accent-600 hover:bg-accent-600 hover:text-white"
          >
            <ChevronLeft className="size-4" />
          </button>
        </>
      ) : (
        <Handle type="target" position={Position.Left} className="!size-2 !border-zinc-400 !bg-snow" />
      )}
      <Link to={`${base}/entities/${place.id}`} className="flex items-center gap-2.5 px-2.5 pt-2.5 pb-2">
        <span className="flex size-8 shrink-0 items-center justify-center text-white" style={{ background: place.type.color }}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-tight font-semibold">{place.name}</span>
          <span className="block truncate text-[11px] text-zinc-500">{place.type.name}</span>
        </span>
      </Link>
      <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-500">
        <span>{role === 'above' ? 'Above' : role === 'self' ? 'This place' : kids ? `Has ${kids.toLocaleString()} ${kids === 1 ? 'child' : 'children'}` : 'No children'}</span>
        {role !== 'above' && open && shown < kids && <span className="tabular-nums">{shown}/{kids} shown</span>}
      </div>
      {role === 'above' || kids === 0 ? (
        <Handle type="source" position={Position.Right} className="!size-2 !border-zinc-400 !bg-snow" />
      ) : (
        <>
          <Handle type="source" position={Position.Right} className="!pointer-events-none !opacity-0" />
          <button
            type="button"
            onClick={() => onToggle(place.id)}
            aria-expanded={open}
            aria-label={`${open ? 'Close' : 'Open'} ${place.name}`}
            title={open ? 'Close' : `Show ${kids.toLocaleString()} ${kids === 1 ? 'child' : 'children'}`}
            className="nodrag absolute top-1/2 -right-3 z-10 flex size-6 -translate-y-1/2 items-center justify-center border border-zinc-300 bg-snow text-zinc-600 shadow-sm hover:border-accent-600 hover:bg-accent-600 hover:text-white"
          >
            {loading ? <span className="size-3 animate-spin rounded-full border-2 border-zinc-300 border-t-accent-600" /> : open ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </>
      )}
    </div>
  );
}

const nodeTypes = { place: PlaceCard };

/** Where each place goes: a column per level, the places above on the left, this one in the middle, everything under it to the right. */
function layout(root: Place, above: Place[], kids: Record<string, EntitySummary[]>, open: Set<string>): { place: Place; role: Data['role']; x: number; y: number; parent: string | null }[] {
  const out: { place: Place; role: Data['role']; x: number; y: number; parent: string | null }[] = [];
  let row = 0;
  const walk = (p: Place, depth: number, parent: string | null): number => {
    const list = open.has(p.id) ? (kids[p.id] ?? []) : [];
    const ys = list.map((c) => walk(c, depth + 1, p.id));
    const y = ys.length ? (ys[0]! + ys[ys.length - 1]!) / 2 : row++ * (H + GAP_Y);
    out.push({ place: p, role: depth === 0 ? 'self' : 'below', x: (depth + above.length) * (W + GAP_X), y, parent });
    return y;
  };
  const ry = walk(root, 0, null);
  above.forEach((p, i) => out.push({ place: p, role: 'above', x: i * (W + GAP_X), y: ry, parent: i ? above[i - 1]!.id : null }));
  // The chain above links in to the one below it, and the last one to this place.
  const self = out.find((n) => n.role === 'self')!;
  self.parent = above.at(-1)?.id ?? null;
  return out;
}

function Graph({ root, above }: { root: Place; above: Place[] }) {
  const { tenantId, project, base } = useProject();
  const qc = useQueryClient();
  const flow = useReactFlow();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [kids, setKids] = useState<Record<string, EntitySummary[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [capped, setCapped] = useState(false);
  // Nothing above it is loaded at first; the places above open a step at a time (the `<` on the left card) or all at once.
  const [aboveCount, setAboveCount] = useState(0);
  const shownAbove = above.slice(above.length - aboveCount);
  const fetchKids = useCallback((id: string) => qc.fetchQuery({ queryKey: ['lineage', tenantId, project.key, id], queryFn: () => api.entities(tenantId, project.key, { parentId: id, pageSize: PAGE }), staleTime: 30_000 }), [qc, tenantId, project.key]);

  const toggle = useCallback(
    async (id: string) => {
      if (open.has(id)) {
        setOpen((o) => (o.delete(id), new Set(o)));
        return;
      }
      setLoading((l) => new Set(l).add(id));
      try {
        const page = await fetchKids(id);
        setKids((k) => ({ ...k, [id]: page.items }));
        setOpen((o) => new Set(o).add(id));
      } finally {
        setLoading((l) => (l.delete(id), new Set(l)));
      }
    },
    [open, fetchKids],
  );
  // The first level is open from the start.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (root.childCount > 0) void toggle(root.id);
  }, [root, toggle]);

  /** Opens every branch, a level at a time, until the last places are reached (or the limit). */
  const openAll = async () => {
    const nextOpen = new Set<string>();
    const nextKids: Record<string, EntitySummary[]> = {};
    let level: Place[] = [root];
    let seen = 0;
    setCapped(false);
    setBusy(0);
    while (level.length) {
      const pages = await Promise.all(level.filter((n) => n.childCount > 0).map((n) => fetchKids(n.id).then((p) => ({ n, p }))));
      level = [];
      for (const { n, p } of pages) {
        nextOpen.add(n.id);
        nextKids[n.id] = p.items;
        seen += p.items.length;
        level.push(...p.items);
      }
      setBusy(seen);
      setKids((k) => ({ ...k, ...nextKids }));
      setOpen(new Set(nextOpen));
      if (seen >= LIMIT) {
        setCapped(true);
        break;
      }
    }
    setBusy(null);
  };

  /** Opens one more level: every place showing that has children and is still closed. */
  const nextGeneration = async () => {
    const targets = placed.filter((n) => n.role !== 'above' && !open.has(n.place.id) && n.place.childCount > 0).map((n) => n.place);
    if (!targets.length) return;
    setBusy(0);
    try {
      const pages = await Promise.all(targets.map((p) => fetchKids(p.id).then((r) => ({ p, r }))));
      setKids((k) => ({ ...k, ...Object.fromEntries(pages.map(({ p, r }) => [p.id, r.items])) }));
      setOpen((o) => new Set([...o, ...pages.map(({ p }) => p.id)]));
    } finally {
      setBusy(null);
    }
  };

  const placed = useMemo(() => layout(root, shownAbove, kids, open), [root, shownAbove.length, kids, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const nodes: Node<Data>[] = placed.map(({ place, role, x, y }) => ({
    id: place.id,
    type: 'place',
    position: { x, y },
    draggable: false,
    data: { place, role, open: open.has(place.id), loading: loading.has(place.id), shown: kids[place.id]?.length ?? 0, onToggle: (id) => void toggle(id), base, moreAbove: place.id === (shownAbove[0]?.id ?? root.id) ? above.length - aboveCount : 0, onMoreAbove: () => setAboveCount((c) => Math.min(above.length, c + 1)) },
  }));
  const edges: Edge[] = placed.flatMap((n) => (n.parent ? [{ id: `${n.parent}>${n.place.id}`, source: n.parent, target: n.place.id, type: 'default', style: { stroke: 'var(--color-zinc-400)', strokeWidth: 1.5 } }] : []));
  const count = placed.filter((n) => n.role === 'below').length;
  // Keep the whole graph in view as it grows.
  useEffect(() => {
    const t = setTimeout(() => void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 250 }), 60);
    return () => clearTimeout(t);
  }, [placed.length, flow]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
        <Listbox
          compact
          label="Expand"
          value={null}
          disabled={busy !== null}
          trigger={{
            className: 'inline-flex h-8 items-center gap-2 border border-zinc-300 bg-snow px-3 text-[13px] font-medium text-zinc-800 hover:border-zinc-500',
            children: (
              <>
                <ChevronsUpDown className="size-4" /> {busy !== null ? `Opening… ${busy.toLocaleString()}` : 'Expand'} <ChevronDown className="size-3.5 text-zinc-500" />
              </>
            ),
          }}
          options={[
            { value: 'next', label: 'Next generation', description: 'Open one more level of children', icon: ChevronsRight },
            { value: 'children', label: 'All children', description: 'Open every branch, down to the last place', icon: ChevronsUpDown },
            { value: 'ancestors', label: 'All ancestors', description: 'Show every place above it', icon: ChevronsLeft },
            { value: 'reset', label: 'Collapse', description: 'Back to this place and its children', icon: ChevronsDownUp },
          ]}
          onChange={(v) => {
            if (v === 'next') void nextGeneration();
            else if (v === 'children') void openAll();
            else if (v === 'ancestors') setAboveCount(above.length);
            else (setOpen(new Set(kids[root.id] ? [root.id] : [])), setAboveCount(0), setCapped(false));
          }}
        />
        <Button size="sm" variant="ghost" icon={Maximize2} onClick={() => void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 250 })}>
          Fit
        </Button>
        <span className="ms-auto text-xs text-zinc-500">
          {above.length > 0 && `${aboveCount}/${above.length} above · `}
          {count.toLocaleString()} shown below
        </span>
        {capped && <span className="w-full text-xs text-amber-700">Stopped at {LIMIT} places. Open the branches you need one by one.</span>}
      </div>
      <div className="h-[34rem] bg-zinc-50" dir="ltr">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          nodesDraggable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="var(--color-zinc-300)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

/** Where a place sits and what is under it, as a graph: the places above on the left, this one in the middle, and everything beneath it opening to the right, down to the last. */
export function EntityLineage({ entity }: { entity: Pick<EntityDetail, 'id' | 'name' | 'type' | 'childCount' | 'ancestors'> }) {
  const above: Place[] = entity.ancestors.map((a) => ({ id: a.id, name: a.name, type: { key: '', name: a.typeName, icon: 'layers', color: '#6b7280' }, childCount: 0 }));
  if (!above.length && entity.childCount === 0)
    return (
      <div className="p-4">
        <EmptyState icon={Layers} title="Nothing in its lineage yet">
          It has no places above it and none under it. Places placed in it, or above it, show here.
        </EmptyState>
      </div>
    );
  return (
    <ReactFlowProvider>
      <Graph root={{ id: entity.id, name: entity.name, type: entity.type, childCount: entity.childCount }} above={above} />
    </ReactFlowProvider>
  );
}

/** The same lineage as an indented list: open any place to see what is in it, and keep going to the last one. */
export function EntityLineageList({ entity }: { entity: Pick<EntityDetail, 'id' | 'name' | 'type' | 'childCount'> }) {
  const { tenantId, project, base } = useProject();
  const qc = useQueryClient();
  const root: Place = { id: entity.id, name: entity.name, type: entity.type, childCount: entity.childCount };
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [kids, setKids] = useState<Record<string, EntitySummary[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const fetchKids = useCallback((id: string) => qc.fetchQuery({ queryKey: ['lineage', tenantId, project.key, id], queryFn: () => api.entities(tenantId, project.key, { parentId: id, pageSize: PAGE }), staleTime: 30_000 }), [qc, tenantId, project.key]);
  const toggle = async (id: string) => {
    if (open.has(id)) return setOpen((o) => (o.delete(id), new Set(o)));
    setLoading((l) => new Set(l).add(id));
    try {
      const page = await fetchKids(id);
      setKids((k) => ({ ...k, [id]: page.items }));
      setOpen((o) => new Set(o).add(id));
    } finally {
      setLoading((l) => (l.delete(id), new Set(l)));
    }
  };
  // The first level is open from the start.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !root.childCount) return;
    started.current = true;
    void toggle(root.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = (p: Place, depth: number): { place: Place; depth: number }[] => [{ place: p, depth }, ...(open.has(p.id) ? (kids[p.id] ?? []).flatMap((c) => visible(c, depth + 1)) : [])];
  const rows = (open.has(root.id) ? (kids[root.id] ?? []) : []).flatMap((c) => visible(c, 0));
  if (!entity.childCount)
    return (
      <div className="p-4">
        <EmptyState icon={Layers} title="No children yet">
          Places or things placed in this {entity.type.name.toLowerCase()} are listed here.
        </EmptyState>
      </div>
    );
  return (
    <div>
      <ul className="divide-y divide-zinc-100">
        {rows.map(({ place: c, depth }) => {
          const I = iconOf(c.type.icon);
          const isOpen = open.has(c.id);
          return (
            <li key={c.id} className="flex items-center gap-2 py-1.5 pe-4 hover:bg-zinc-50" style={{ paddingInlineStart: 16 + depth * 24 }}>
              {c.childCount > 0 ? (
                <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? 'Close' : 'Open'} ${c.name}`} onClick={() => void toggle(c.id)} className="flex size-6 shrink-0 items-center justify-center text-zinc-500 hover:bg-zinc-100 hover:text-accent-700">
                  {loading.has(c.id) ? <span className="size-3 animate-spin rounded-full border-2 border-zinc-300 border-t-accent-600" /> : <ChevronRight className={cx('size-4 transition-transform rtl:rotate-180', isOpen && 'rotate-90 rtl:rotate-90')} />}
                </button>
              ) : (
                <span className="size-6 shrink-0" aria-hidden />
              )}
              <Link to={`${base}/entities/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-0.5 text-sm">
                <span className="flex size-8 shrink-0 items-center justify-center text-white" style={{ background: c.type.color }}>
                  <I className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="shrink-0 text-xs text-zinc-500">{c.type.name}</span>
                {c.childCount > 0 && <span className="shrink-0 border border-zinc-200 bg-zinc-50 px-1.5 text-[11px] text-zinc-500">{c.childCount.toLocaleString()} {c.childCount === 1 ? 'child' : 'children'}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
