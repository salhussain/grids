import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { confirmDialog, Button, Dialog, EmptyState, ErrorNotice, KeyValues, Listbox, Loading, Tag, cx, dateTime, relTime, useToast } from '@grids/ui';
import { Activity, ArrowDownRight, Sigma, Download, Maximize2, X, FileDown, GitCompare, ImageDown, Eye, List, Network, ArrowUpRight, ChevronRight, ClipboardList, Info, Layers, MapPin, Minus, Pencil, Trash2, History as HistoryIcon, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../../api';
import { Chart, type ChartOption } from '@grids/viz';
import { MapView } from '@grids/viz';
import { brandColor, INK, useScheme } from '@grids/viz';
import { iconOf, useProject } from './context';
import { EntityDialog, fmtAttr, useTypes } from './EntitiesTab';
import { Avatar } from '../../ui';
import { linesPng, saveCsv, saveFile } from '../activityExport';
import { EntityLineage, EntityLineageList } from './EntityLineage';

const AGG_WORD = { sum: 'Total', avg: 'Average', min: 'Lowest', max: 'Highest', last: 'Latest', count: 'Count' } as const;

type Tab = 'overview' | 'forms' | 'data' | 'lineage' | 'history';

/** A card with an icon, a title and a line of help, and room for a button at the end. */
function Card({ icon: I, title, text, actions, flush, children }: { icon: LucideIcon; title: string; text?: string; actions?: React.ReactNode; flush?: boolean; children: React.ReactNode }) {
  return (
    <section className="border border-zinc-200 bg-snow">
      <header className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center bg-accent-50 text-accent-700">
          <I className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          {text && <p className="text-xs text-zinc-500">{text}</p>}
        </div>
        {actions}
      </header>
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

/** A reading's recent values as a small line. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 160;
  const h = 30;
  const mx = Math.max(...values);
  const mn = Math.min(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - mn) / Math.max(1, mx - mn)) * (h - 8)] as const);
  const last = pts.at(-1)!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-2 h-[30px] w-full" aria-hidden>
      <polyline fill="none" stroke="var(--brand-600)" strokeWidth="1.8" points={pts.map((p) => p.join(',')).join(' ')} />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill="var(--brand-600)" />
    </svg>
  );
}

const Delta = ({ now, before }: { now: number; before: number | undefined }) =>
  before === undefined ? null : now === before ? (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
      <Minus className="size-3.5" /> no change
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-600">
      {now > before ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {now > before ? '+' : '−'}
      {Math.abs(Math.round((now - before) * 100) / 100).toLocaleString()} since last
    </span>
  );

export function EntityPage() {
  const { tenantId, project, base, can } = useProject();
  const { entityId } = useParams({ strict: false }) as { entityId: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const types = useTypes();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [chartFor, setChartFor] = useState<string | null>(null);
  const [openChange, setOpenChange] = useState<number | null>(null);
  const [contains, setContains] = useState<'graph' | 'list'>('graph');
  const [element, setElement] = useState<string | null>(null);
  const e = useQuery({ queryKey: ['entity', tenantId, project.key, entityId], queryFn: () => api.entity(tenantId, project.key, entityId) });
  const children = useQuery({
    queryKey: ['entities', tenantId, project.key, 'children', entityId],
    queryFn: () => api.entities(tenantId, project.key, { parentId: entityId, pageSize: 50 }),
  });
  const forms = useQuery({ queryKey: ['forms', tenantId, project.key], queryFn: () => api.forms(tenantId, project.key) });
  const remove = useMutation({
    mutationFn: () => api.deleteEntity(tenantId, project.key, entityId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['entities', tenantId, project.key] });
      void navigate({ to: `${base}/entities` });
    },
  });
  // The recent readings behind the first few tiles: how each moved, and its little line.
  const lead = e.data?.latest.filter((l) => typeof l.value === 'number').slice(0, 3) ?? [];
  const trends = useQueries({
    queries: lead.map((l) => ({ queryKey: ['series', tenantId, project.key, entityId, l.element, l.rolledUp], queryFn: () => api.series(tenantId, project.key, entityId, l.element, l.rolledUp) })),
  });
  // The forms that are about this kind of place, and what has been sent for this one.
  const aboutIt = forms.data?.filter((f) => f.subjectType?.key === e.data?.type.key && f.currentVersion) ?? [];
  const sent = useQueries({
    queries: aboutIt.map((f) => ({ queryKey: ['submissions', tenantId, project.key, f.key, { entityId, page: 1, pageSize: 1 }], queryFn: () => api.submissions(tenantId, project.key, f.key, { page: 1, pageSize: 1, entityId }) })),
  });
  if (e.isPending) return <Loading />;
  if (e.isError) return <ErrorNotice error={e.error} />;
  const x = e.data;
  const type = types.data?.find((t) => t.key === x.type.key);
  const Icon = iconOf(x.type.icon);
  const selected = element ?? x.latest[0]?.element ?? null;
  const kids = children.data?.items ?? [];
  const canEdit = can('manager') && !x.shared;
  const located = !!(x.geometry || x.point);
  const coords = x.point?.coordinates ?? (x.geometry?.type === 'Point' ? (x.geometry.coordinates as number[]) : null);
  // The type's own key numbers (marked as summary attributes) lead the tiles.
  const keyAttrs = (type?.attributes ?? []).filter((a) => a.summary && x.attributes[a.key] !== undefined && x.attributes[a.key] !== null && x.attributes[a.key] !== '').slice(0, 2);
  const features = {
    type: 'FeatureCollection' as const,
    features: [x.geometry, x.point].flatMap((g) => (g ? [{ type: 'Feature' as const, geometry: g, properties: { name: x.name, color: x.type.color, icon: x.type.icon, marker: type?.marker.style ?? 'dot' } }] : [])),
  };
  const tabs: [Tab, string, number | null][] = [
    ['overview', 'Overview', null],
    ...(aboutIt.length ? ([['forms', 'Forms', aboutIt.length]] as [Tab, string, number][]) : []),
    ['data', 'Data', x.latest.length],
    ['lineage', 'Lineage', children.data?.total ?? 0],
    ['history', 'History', x.history.length],
  ];
  /** What a history entry changed: each field with what it was before (from the entries older than it) and what it became. */
  const changeParts = (index: number): { label: string; before: string | null; after: string | null }[] => {
    const h = x.history[index]!;
    const defs = new Map((type?.attributes ?? []).map((a) => [a.key, a]));
    const older = x.history.slice(index + 1); // newest first, so the rest are earlier
    const was = (k: string) => older.find((o) => k in o.changes)?.changes[k];
    const show = (k: string, v: unknown): string | null => {
      if (v === undefined || v === null || v === '') return null;
      if (k === 'parent') return 'another parent';
      if (k === 'geometry' || k === 'geom') return 'a shape';
      if (typeof v === 'object') return 'changed';
      return fmtAttr(defs.get(k), v);
    };
    return Object.entries(h.changes)
      .filter(([k]) => k !== 'created')
      .map(([k, v]) => ({
        label: k === 'name' ? 'Name' : k === 'parent' ? 'Parent' : k === 'geometry' || k === 'geom' ? 'Shape' : (defs.get(k)?.label ?? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())),
        before: show(k, was(k)),
        after: show(k, v),
      }));
  };
  /** Every field as it stood at one history entry, with what it was before and after; `changed` marks the ones that entry touched. */
  const fieldsAt = (index: number): { label: string; before: string | null; after: string | null; changed: boolean }[] => {
    const h = x.history[index]!;
    const defs = type?.attributes ?? [];
    const keys = ['name', ...defs.map((d) => d.key), ...Object.keys(h.changes).filter((k) => k !== 'created' && k !== 'name' && k !== 'parent' && !defs.some((d) => d.key === k))];
    const upto = x.history.slice(index); // this entry and the older ones: how it stood just after
    const prior = x.history.slice(index + 1); // how it stood just before
    const everChanged = (k: string) => x.history.some((e) => k in e.changes);
    const val = (k: string, v: unknown) => (v === undefined || v === null || v === '' ? null : k === 'geometry' || k === 'geom' ? 'a shape' : typeof v === 'object' ? 'changed' : fmtAttr(defs.find((d) => d.key === k), v));
    const current = (k: string) => (k === 'name' ? x.name : x.attributes[k]);
    const at = (list: typeof upto, k: string) => {
      const e = list.find((o) => k in o.changes);
      // Never recorded in the history: it is still as it is now.
      return e ? e.changes[k] : everChanged(k) ? undefined : current(k);
    };
    // A new place had nothing before: everything it was made with is new.
    const created = 'created' in h.changes;
    const rows = keys.map((k) => {
      const changed = created ? val(k, at(upto, k)) !== null : k in h.changes;
      return { label: k === 'name' ? 'Name' : (defs.find((d) => d.key === k)?.label ?? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())), before: created ? null : changed ? val(k, at(prior, k)) : val(k, at(upto, k)), after: val(k, at(upto, k)), changed };
    });
    if (created) {
      if (x.parent) rows.splice(1, 0, { label: 'Parent', before: null, after: x.parent.name, changed: true });
    } else if ('parent' in h.changes) rows.splice(1, 0, { label: 'Parent', before: null, after: 'another parent', changed: true });
    else if (x.parent) rows.splice(1, 0, { label: 'Parent', before: x.parent.name, after: x.parent.name, changed: false });
    // Fields with nothing in them, before and after, are not worth a row.
    return rows.filter((r) => r.changed || r.before !== null || r.after !== null);
  };
  const historyTable = (list: typeof x.history, compact = false) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50 text-[11px] tracking-wider text-zinc-500 uppercase">
            <th className={cx('px-4 py-2 text-start font-medium', !compact && 'w-44')}>When</th>
            {!compact && <th className="w-56 px-4 py-2 text-start font-medium">By</th>}
            <th className="px-4 py-2 text-start font-medium">What changed</th>
          </tr>
        </thead>
        <tbody>
          {list.map((h) => {
            const index = x.history.indexOf(h);
            const created = 'created' in h.changes;
            const n = changeParts(index).filter((p) => !(created && p.label === 'Name')).length;
            const by = h.actor ?? h.source;
            return (
              <tr key={index} onClick={() => setOpenChange(index)} className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 last:border-0">
                <td className="px-4 py-3 align-middle whitespace-nowrap">
                  <div className="font-medium text-zinc-800">{relTime(h.at)}</div>
                  <div className="text-xs text-zinc-500">{dateTime(h.at)}</div>
                  {compact && <div className="text-xs text-zinc-500">{by}</div>}
                </td>
                {!compact && (
                  <td className="px-4 py-3 align-middle">
                    <span className="flex items-center gap-2.5 text-zinc-800">
                      <Avatar name={by} className="size-7 text-[10px]" /> {by}
                    </span>
                  </td>
                )}
                <td className="px-4 py-3 align-middle">
                  <div className="flex items-center gap-2.5">
                    <span className={cx('inline-flex h-6 items-center px-2 text-xs font-medium', created ? 'bg-emerald-100 text-emerald-900' : 'bg-accent-50 text-accent-800')}>{created ? 'Created' : 'Changed'}</span>
                    <span className="text-[13px] text-zinc-600">{n === 0 ? 'No fields' : `${n} ${n === 1 ? 'field' : 'fields'}`}</span>
                    <button type="button" aria-label="See what changed" title="See what changed" onClick={(ev) => (ev.stopPropagation(), setOpenChange(index))} className="ms-auto inline-flex size-8 items-center justify-center text-zinc-500 hover:bg-accent-50 hover:text-accent-800">
                      <Eye className="size-4" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  const emptyHint = (I: LucideIcon, title: string, text: string) => (
    <div className="flex items-center gap-3 border border-dashed border-zinc-300 bg-zinc-50 px-4 py-4 text-sm text-zinc-500">
      <span className="flex size-9 shrink-0 items-center justify-center border border-zinc-200 bg-snow text-zinc-400">
        <I className="size-4" />
      </span>
      <div>
        <b className="block font-medium text-ink">{title}</b>
        {text}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-zinc-500">
        <Link to={`${base}/entities`} className="hover:text-accent-700">
          Entities
        </Link>
        {x.ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-1">
            <ChevronRight className="size-3.5 rtl:rotate-180" />
            <Link to={`${base}/entities/${a.id}`} className="hover:text-accent-700">
              {a.name}
            </Link>
          </span>
        ))}
      </nav>

      {/* Hero: the place on the map (or a quiet grid), then who it is and what can be done */}
      <section className="overflow-hidden border border-zinc-200 bg-snow">
        <div
          className="h-32 sm:h-40"
          style={
            located
              ? undefined
              : {
                  backgroundColor: `color-mix(in srgb, ${project.color} 8%, var(--color-snow))`,
                  backgroundImage: `linear-gradient(color-mix(in srgb, ${project.color} 14%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, ${project.color} 14%, transparent) 1px, transparent 1px)`,
                  backgroundSize: '18px 18px',
                }
          }
        >
          {located && <MapView label={`Location of ${x.name}`} data={features} />}
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 px-5 pb-5">
          <span className="-mt-7 flex size-16 shrink-0 items-center justify-center border-4 border-snow text-white" style={{ background: x.type.color }}>
            <Icon className="size-7" strokeWidth={1.6} />
          </span>
          <div className="min-w-0 flex-1 basis-56 pt-3">
            <h2 className="text-2xl font-semibold tracking-tight">{x.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-zinc-500">
              <Tag>{x.type.name}</Tag>
              {x.shared && <Tag>Shared</Tag>}
              <span className="font-mono text-xs">{x.code}</span>
              <span>· updated {relTime(x.updatedAt)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <>
                <Button icon={Pencil} onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <button
                  type="button"
                  aria-label={`Delete ${x.name}`}
                  title="Delete"
                  disabled={remove.isPending}
                  onClick={async () => (await confirmDialog(`Delete ${x.name}?`, { confirmLabel: 'Delete', danger: true })) && remove.mutate()}
                  className="inline-flex h-9 items-center gap-2 border border-zinc-300 bg-snow px-3 text-sm text-zinc-500 hover:border-zinc-500 hover:text-red-700 disabled:opacity-50"
                >
                  <Trash2 className="size-4" /> Delete
                </button>
              </>
            )}
          </div>
        </div>
      </section>
      <ErrorNotice error={remove.error} />

      {/* The numbers that matter, then the rest behind tabs */}
      {(keyAttrs.length > 0 || lead.length > 0 || (children.data?.total ?? 0) > 0) && (
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
        {keyAttrs.map((a) => (
          <div key={a.key} className="flex flex-col border border-zinc-200 bg-snow p-4">
            <span className="text-xs text-zinc-500">{a.label}</span>
            <span className="num mt-1 text-[26px] leading-tight font-semibold tracking-tight">{fmtAttr(a, x.attributes[a.key])}</span>
            <span className="mt-auto pt-2 text-[11px] text-zinc-400">Recorded on the {x.type.name.toLowerCase()}</span>
          </div>
        ))}
        {lead.map((l, i) => {
          const pts = (trends[i]?.data ?? []).map((p) => Number(p.value)).filter((n) => Number.isFinite(n));
          return (
            <button key={l.element} type="button" onClick={() => setChartFor(l.element)} className="flex flex-col border border-zinc-200 bg-snow p-4 text-start hover:border-accent-600">
              <span className="text-xs text-zinc-500">{l.name}</span>
              <span className="num mt-1 text-[26px] leading-tight font-semibold tracking-tight">
                {(l.value as number).toLocaleString()}
                {l.unit && <small className="ms-1 text-[13px] font-normal text-zinc-500">{l.unit}</small>}
              </span>
              <Delta now={l.value as number} before={pts.length > 1 ? pts[pts.length - 2] : undefined} />
              <Spark values={pts.slice(-14)} />
              <span className="mt-1 text-[11px] text-zinc-400">{l.rolledUp ? `${AGG_WORD[l.aggregation ?? 'sum']} of ${l.places} ${l.places === 1 ? 'place' : 'places'}` : dateTime(l.at)}</span>
            </button>
          );
        })}
        <button type="button" onClick={() => setTab('lineage')} className="flex flex-col border border-zinc-200 bg-snow p-4 text-start hover:border-accent-600">
          <span className="text-xs text-zinc-500">Lineage</span>
          <span className="num mt-1 text-[26px] leading-tight font-semibold tracking-tight">
            {(children.data?.total ?? 0).toLocaleString()}
            <small className="ms-1 text-[13px] font-normal text-zinc-500">{children.data?.total === 1 ? 'child' : 'children'}</small>
          </span>
          <span className="mt-auto truncate pt-2 text-[11px] text-zinc-400">{kids.length ? kids.slice(0, 3).map((k) => k.name).join(', ') : 'Nothing under it yet'}</span>
        </button>
      </section>
      )}

      <div role="tablist" aria-label="Sections" className="flex gap-0.5 overflow-x-auto border-b border-zinc-200">
        {tabs.map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx('-mb-px inline-flex items-center gap-2 border-b-[3px] px-4 py-2.5 text-sm whitespace-nowrap', tab === k ? 'border-accent-600 font-medium text-ink' : 'border-transparent text-zinc-500 hover:text-ink')}
          >
            {label}
            {n !== null && <span className="border border-zinc-200 bg-zinc-50 px-1.5 text-[11px] text-zinc-500">{n}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <Card icon={Info} title="Details" text="What the project records about it, and where it is">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-3 xl:grid-cols-4">
              <div className="min-w-0">
                <dt className="text-xs text-zinc-500">Code</dt>
                <dd className="mt-0.5 font-mono text-sm font-medium break-words">{x.code}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-zinc-500">Parent</dt>
                <dd className="mt-0.5 text-sm font-medium break-words">{x.parent ? <Link to={`${base}/entities/${x.parent.id}`} className="text-accent-700 hover:underline">{x.parent.name}</Link> : <span className="text-zinc-400">None</span>}</dd>
              </div>
              {(type?.attributes ?? []).map((a) => {
                const empty = x.attributes[a.key] === undefined || x.attributes[a.key] === null || x.attributes[a.key] === '';
                return (
                  <div key={a.key} className="min-w-0">
                    <dt className="text-xs text-zinc-500">{a.label}</dt>
                    <dd className={cx('mt-0.5 text-sm break-words', empty ? 'text-zinc-400' : 'font-medium')}>{fmtAttr(a, x.attributes[a.key])}</dd>
                  </div>
                );
              })}
              {located ? (
                <>
                  {coords && (
                    <>
                      <div className="min-w-0">
                        <dt className="text-xs text-zinc-500">Latitude</dt>
                        <dd className="mt-0.5 font-mono text-[13px] font-medium">{coords[1]!.toFixed(5)}°</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs text-zinc-500">Longitude</dt>
                        <dd className="mt-0.5 font-mono text-[13px] font-medium">{coords[0]!.toFixed(5)}°</dd>
                      </div>
                    </>
                  )}
                  {x.geometry && x.geometry.type !== 'Point' && (
                    <div className="min-w-0">
                      <dt className="text-xs text-zinc-500">Boundary</dt>
                      <dd className="mt-0.5 text-sm font-medium">{x.geometry.type}</dd>
                    </div>
                  )}
                </>
              ) : (
                <div className="min-w-0">
                  <dt className="text-xs text-zinc-500">Location</dt>
                  <dd className="mt-0.5 text-sm text-zinc-400">{canEdit ? 'Not set. Add one with Edit.' : 'Not set'}</dd>
                </div>
              )}
            </dl>
          </Card>
          {x.latest.length > 0 && selected && (
            <Card
              icon={Activity}
              title="Trend"
              text={x.latest.find((l) => l.element === selected)?.name ?? 'How a reading has moved over time'}
              actions={
                <div className="flex items-center gap-1">
                  {x.latest.length > 1 && <Listbox compact align="end" label="Reading" value={selected} onChange={setElement} options={x.latest.map((l) => ({ value: l.element, label: l.name }))} />}
                  <button type="button" aria-label="Open the trend large" title="Open large" onClick={() => setChartFor(selected)} className="p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-ink">
                    <Maximize2 className="size-4" />
                  </button>
                </div>
              }
              flush
            >
              <Series bare entityId={x.id} element={selected} rolled={!!x.latest.find((l) => l.element === selected)?.rolledUp} name={x.latest.find((l) => l.element === selected)?.name ?? selected} unit={x.latest.find((l) => l.element === selected)?.unit ?? ''} />
            </Card>
          )}
        </div>
      )}

      {tab === 'forms' && (
        <Card icon={ClipboardList} title={`Forms ${aboutIt.length}`} text={`Forms about this ${x.type.name.toLowerCase()}, and what has been sent for it`} flush>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50 text-[11px] tracking-wider text-zinc-500 uppercase">
                  <th className="px-4 py-2 text-start font-medium">Form</th>
                  <th className="px-4 py-2 text-start font-medium">Open</th>
                  <th className="px-4 py-2 text-end font-medium">Sent for it</th>
                  <th className="px-4 py-2 text-end font-medium">Last sent</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {aboutIt.map((f, i) => {
                  const page = sent[i]?.data;
                  const last = page?.items[0]?.submittedAt;
                  const open = f.availability.state === 'open';
                  const state = { open: 'Open', not_yet: 'Not yet open', closed: 'Closed', full: 'Full', limit: 'Limit reached' }[f.availability.state];
                  return (
                    <tr key={f.key} className="border-b border-zinc-100 align-top hover:bg-zinc-50">
                      <td className="px-4 py-3">
                        <div className="font-medium">{f.name}</div>
                        {f.description && <div className="max-w-md text-xs text-zinc-500">{f.description}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cx('inline-flex h-[22px] items-center px-2 text-xs font-medium', open ? 'bg-emerald-100 text-emerald-900' : 'bg-zinc-100 text-zinc-600')} title={f.availability.message ?? undefined}>
                          {state}
                        </span>
                      </td>
                      <td className="num px-4 py-3 text-end font-medium">{page ? page.total.toLocaleString() : '–'}</td>
                      <td className="px-4 py-3 text-end text-xs text-zinc-500">{last ? relTime(last) : '—'}</td>
                      <td className="px-4 py-3 text-end">
                        {f.canFill && open ? (
                          <Link to={`${base}/forms/${f.key}/fill`} search={{ entity: x.id }} className="inline-flex h-8 items-center gap-1.5 bg-accent-600 px-3 text-sm font-medium text-on-accent hover:bg-accent-700">
                            <ClipboardList className="size-4" /> Fill in
                          </Link>
                        ) : (
                          <span className="text-xs text-zinc-400" title={f.availability.message ?? undefined}>
                            {f.canFill ? state : 'No access'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'data' && !x.latest.length && (
        <Card icon={Activity} title="Latest values" text="The most recent reading of each indicator. Pick one to see it over time.">
          <EmptyState icon={Activity} title="No readings yet">
            Numbers recorded for this {x.type.name.toLowerCase()} by forms, jobs or the API appear here with their value and trend.
          </EmptyState>
        </Card>
      )}

      {tab === 'data' && x.latest.length > 0 && (
        <Card icon={Activity} title="Latest values" text={x.latest.some((l) => l.rolledUp) ? 'The most recent reading of each indicator. Where nothing is recorded here, it is combined from the places under it.' : 'The most recent reading of each indicator. Pick one to see it over time.'} flush>
                      <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50 text-[11px] tracking-wider text-zinc-500 uppercase">
                    <th className="px-4 py-2 text-start font-medium">Indicator</th>
                    <th className="px-4 py-2 text-end font-medium">Value</th>
                    <th className="px-4 py-2 text-end font-medium">Read</th>
                    <th className="w-12 px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {x.latest.map((l) => (
                    <tr key={l.element} tabIndex={0} onClick={() => setChartFor(l.element)} onKeyDown={(ev) => ev.key === 'Enter' && setChartFor(l.element)} className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50">
                      <td className="px-4 py-2.5">
                        {l.name}
                        {l.rolledUp && (
                          <span className="ms-2 inline-flex items-center gap-1 border border-zinc-200 bg-zinc-50 px-1.5 py-px align-middle text-[11px] text-zinc-500" title="Not recorded here: combined from the places under it">
                            <Sigma className="size-3" /> {AGG_WORD[l.aggregation ?? 'sum']} of {l.places} {l.places === 1 ? 'place' : 'places'}
                          </span>
                        )}
                      </td>
                      <td className="num px-4 py-2.5 text-end font-medium">
                        {typeof l.value === 'number' ? l.value.toLocaleString() : (l.value ?? '—')} {l.unit}
                      </td>
                      <td className="px-4 py-2.5 text-end text-xs text-zinc-500">{dateTime(l.at)}</td>
                      <td className="px-4 py-2.5 text-end">
                        <button type="button" aria-label={`See ${l.name} over time`} title="See it over time" onClick={(ev) => (ev.stopPropagation(), setChartFor(l.element))} className="inline-flex size-8 items-center justify-center text-zinc-500 hover:bg-accent-50 hover:text-accent-800">
                          <Activity className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
        </Card>
      )}

      {tab === 'lineage' && (
        <Card
          icon={Layers}
          title={`Lineage ${(children.data?.total ?? 0).toLocaleString()}`}
          text={contains === 'graph' ? 'Where it sits, and everything under it, down to the last place' : 'Places and things directly under it'}
          flush
          actions={
            kids.length > 0 || x.ancestors.length > 0 ? (
              <span className="flex border border-zinc-300" role="group" aria-label="Show as">
                {(
                  [
                    ['graph', 'Graph', Network],
                    ['list', 'List', List],
                  ] as const
                ).map(([k, label, I]) => (
                  <button key={k} type="button" aria-pressed={contains === k} onClick={() => setContains(k)} className={cx('inline-flex h-8 items-center gap-1.5 px-2.5 text-[13px]', contains === k ? 'bg-accent-600 text-white' : 'bg-snow text-zinc-700 hover:bg-zinc-50')}>
                    <I className="size-3.5" /> {label}
                  </button>
                ))}
              </span>
            ) : undefined
          }
        >
          {contains === 'graph' ? (
            <EntityLineage entity={x} />
          ) : (
            <EntityLineageList entity={x} />
          )}
        </Card>
      )}

      {tab === 'history' && (
        <Card icon={HistoryIcon} title="History" text="Every change, and who made it" flush>
          {historyTable(x.history)}
        </Card>
      )}

      {chartFor && <ReadingDialog entityId={x.id} entityName={x.name} reading={x.latest.find((l) => l.element === chartFor)} all={x.latest.filter((l) => typeof l.value === 'number')} onClose={() => setChartFor(null)} />}
      {openChange !== null && x.history[openChange] && (
        <Dialog
          open
          wide
          onClose={() => setOpenChange(null)}
          title={'created' in x.history[openChange]!.changes ? 'Created' : 'What changed'}
          description={`${dateTime(x.history[openChange]!.at)} · ${x.history[openChange]!.actor ?? x.history[openChange]!.source}`}
          footer={<Button onClick={() => setOpenChange(null)}>Close</Button>}
        >
          <p className="mb-2 text-xs text-zinc-500">Every field is shown. The ones this entry changed are highlighted.</p>
          <div className="overflow-x-auto border border-zinc-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-[11px] tracking-wider text-zinc-500 uppercase">
                  <th className="px-3 py-2 text-start font-medium">Field</th>
                  <th className="px-3 py-2 text-start font-medium">Before</th>
                  <th className="px-3 py-2 text-start font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {fieldsAt(openChange).map((p) => (
                  <tr key={p.label} className={cx('border-t border-zinc-100 align-top', !p.changed && 'text-zinc-600')}>
                    <td className={cx('px-3 py-2', p.changed ? 'font-medium text-ink' : 'text-zinc-500')}>{p.label}</td>
                    <td className={cx('px-3 py-2 break-words', p.changed && p.before !== null && 'bg-red-50 text-red-800')}>
                      {p.before === null ? <span className="text-zinc-400 italic">{p.changed ? 'none' : '—'}</span> : p.changed ? <s>{p.before}</s> : p.before}
                    </td>
                    <td className={cx('px-3 py-2 break-words', p.changed && p.after !== null && 'bg-emerald-50 text-emerald-900')}>
                      {p.after === null ? <span className="text-zinc-400 italic">{p.changed ? 'cleared' : '—'}</span> : p.after}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Dialog>
      )}
      {editing && types.data && <EntityDialog types={types.data} defaultType={x.type.key} entity={x} onClose={() => setEditing(false)} />}
    </div>
  );
}

const LINES = ['#2f6b69', '#c7842b', '#7c5cc4', '#c9577f', '#3b82a0', '#6b8e23'];

/** Readings over time, large: pick how far back, set others beside it to compare, then keep it as a CSV or a picture. */
function ReadingDialog({ entityId, entityName, reading, all, onClose }: { entityId: string; entityName: string; reading: { element: string; name: string; unit: string; rolledUp?: boolean } | undefined; all: { element: string; name: string; unit: string; rolledUp?: boolean }[]; onClose(): void }) {
  const { tenantId, project } = useProject();
  const toast = useToast();
  const scheme = useScheme();
  const [range, setRange] = useState<'all' | '30' | '90' | '365'>('all');
  const [also, setAlso] = useState<string[]>([]);
  const [scale, setScale] = useState<'same' | 'own'>('same');
  const picked = reading ? [reading, ...all.filter((r) => also.includes(r.element))] : [];
  const loaded = useQueries({
    queries: picked.map((r) => ({ queryKey: ['series', tenantId, project.key, entityId, r.element, !!r.rolledUp], queryFn: () => api.series(tenantId, project.key, entityId, r.element, !!r.rolledUp) })),
  });
  const since = range === 'all' ? 0 : Date.now() - Number(range) * 86_400_000;
  const lines = picked.map((r, i) => {
    const pts = (loaded[i]?.data ?? []).filter((p) => new Date(p.at).getTime() >= since && p.value !== null && Number.isFinite(Number(p.value))).map((p) => ({ at: p.at, value: Number(p.value) }));
    const top = Math.max(1, ...pts.map((p) => p.value));
    return { r, color: i === 0 ? project.color : LINES[(i % (LINES.length - 1)) + 1]!, raw: pts, shown: scale === 'own' && picked.length > 1 ? pts.map((p) => ({ at: p.at, value: Math.round((p.value / top) * 1000) / 10 })) : pts };
  });
  const many = picked.length > 1;
  const units = [...new Set(picked.map((r) => r.unit).filter(Boolean))];
  const yLabel = many ? (scale === 'own' ? 'Share of its own highest (%)' : units.length === 1 ? units[0]! : 'Value (mixed units)') : `${reading?.name ?? ''}${reading?.unit ? ` (${reading.unit})` : ''}`;
  const title = many ? `${reading?.name} and ${picked.length - 1} more` : (reading?.name ?? '');
  const loadingAny = loaded.some((q) => q.isPending);
  const hasData = lines.some((l) => l.raw.length > 0);
  const option = useMemo<ChartOption>(() => {
    const ink = INK[scheme];
    return {
      grid: { left: 40, right: 28, top: many ? 48 : 24, bottom: 52, containLabel: true },
      legend: many ? { top: 0, left: 40, itemGap: 20, textStyle: { color: ink.text, fontSize: 13 }, icon: 'rect', itemWidth: 12, itemHeight: 12 } : undefined,
      tooltip: { trigger: 'axis', backgroundColor: ink.tooltip, borderColor: ink.axis, borderRadius: 0, textStyle: { color: ink.text } },
      xAxis: { type: 'time', name: 'Date', nameLocation: 'middle', nameGap: 34, nameTextStyle: { color: ink.muted, fontSize: 12 }, axisLabel: { color: ink.muted, hideOverlap: true }, axisLine: { lineStyle: { color: ink.axis } } },
      yAxis: { type: 'value', name: yLabel, nameLocation: 'middle', nameRotate: 90, nameGap: 48, nameTextStyle: { color: ink.muted, fontSize: 12 }, axisLabel: { color: ink.muted }, splitLine: { lineStyle: { color: ink.grid } } },
      series: lines.map((l) => ({ name: l.r.name, type: 'line' as const, showSymbol: l.shown.length < 40, symbolSize: 8, lineStyle: { width: 2, color: l.color }, itemStyle: { color: l.color }, color: l.color, data: l.shown.map((p) => [p.at, p.value]) })),
    };
  }, [lines.map((l) => `${l.r.element}:${l.shown.length}:${l.color}`).join('|'), scheme, scale, yLabel, many]); // eslint-disable-line react-hooks/exhaustive-deps
  const file = `${project.key}-${(reading?.name ?? 'readings').toLowerCase().replace(/[^a-z0-9]+/g, '-')}${many ? '-compared' : ''}`;
  const subtitle = `${entityName}${range === 'all' ? '' : `, last ${range} days`}`;
  const csv = () => {
    const times = [...new Set(lines.flatMap((l) => l.raw.map((p) => p.at)))].sort();
    saveCsv(file, ['At', ...lines.map((l) => (l.r.unit ? `${l.r.name} (${l.r.unit})` : l.r.name))], times.map((t) => [t, ...lines.map((l) => l.raw.find((p) => p.at === t)?.value ?? '')]));
  };
  const png = async () => {
    try {
      saveFile(await linesPng(lines.map((l) => ({ name: l.r.name, color: l.color, points: l.shown })), title, subtitle, yLabel), `${file}.png`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The picture could not be made');
    }
  };
  const others = all.filter((r) => r.element !== reading?.element);
  return (
    <Dialog open wide onClose={onClose} title={title} description={`${entityName}${!many && reading?.unit ? ` · ${reading.unit}` : ''}`} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">How far back</span>
          <Listbox<'all' | '30' | '90' | '365'> compact label="How far back" value={range} onChange={setRange} options={[{ value: 'all', label: 'All of it' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: 'A year' }]} />
          {others.length > 0 && (
            <Listbox
              compact
              label="Compare with"
              value={null}
              values={also}
              onChangeMany={setAlso}
              trigger={{
                className: cx('inline-flex h-8 items-center gap-1.5 border px-3 text-[13px] font-medium', also.length ? 'border-accent-600 bg-accent-50 text-accent-800' : 'border-zinc-300 bg-snow text-zinc-700 hover:border-zinc-500'),
                children: (
                  <>
                    <GitCompare className="size-4" /> {also.length ? `Comparing ${also.length + 1}` : 'Compare with'}
                  </>
                ),
              }}
              options={others.map((r) => ({ value: r.element, label: r.name, description: r.unit || undefined }))}
            />
          )}
          {also.length > 0 && (
            <button type="button" onClick={() => (setAlso([]), setScale('same'))} className="inline-flex h-8 items-center gap-1.5 px-2 text-[13px] text-zinc-600 hover:bg-zinc-100 hover:text-ink">
              <X className="size-3.5" /> Clear
            </button>
          )}
          <Listbox
            compact
            align="end"
            label="Download"
            value={null}
            className="ms-auto"
            disabled={!hasData}
            trigger={{
              className: 'ms-auto inline-flex h-8 items-center gap-1.5 border border-zinc-300 bg-snow px-3 text-[13px] font-medium hover:border-zinc-500 disabled:opacity-45',
              children: (
                <>
                  <Download className="size-4" /> Download
                </>
              ),
            }}
            options={[
              { value: 'csv', label: 'CSV', description: 'For a spreadsheet', icon: FileDown },
              { value: 'png', label: 'PNG', description: 'A picture to share', icon: ImageDown },
            ]}
            onChange={(v) => (v === 'csv' ? csv() : void png())}
          />
        </div>
        <ErrorNotice error={loaded.find((q) => q.error)?.error} />
        {loadingAny ? (
          <div className="grid h-80 place-items-center text-sm text-zinc-500">Loading…</div>
        ) : !hasData ? (
          <div className="grid h-80 place-items-center text-sm text-zinc-500">No readings in this period.</div>
        ) : (
          <div className="border border-zinc-200">
            <div className="h-80 p-2">
              <Chart option={option} label={`${title} over time`} />
            </div>
            {many && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-100 bg-zinc-50 px-3 py-2">
                <span className="flex border border-zinc-300" role="group" aria-label="Scale">
                  {(
                    [
                      ['same', 'Actual values'],
                      ['own', 'Relative (%)'],
                    ] as const
                  ).map(([k, label]) => (
                    <button key={k} type="button" aria-pressed={scale === k} onClick={() => setScale(k)} className={cx('h-8 px-3 text-[13px]', scale === k ? 'bg-accent-600 text-white' : 'bg-snow text-zinc-700 hover:bg-zinc-50')}>
                      {label}
                    </button>
                  ))}
                </span>
                <p className="min-w-0 flex-1 text-xs text-zinc-500">
                  {scale === 'own'
                    ? 'Each line is shown as a share of its own highest value, so you can see how they move together whatever their size.'
                    : units.length > 1
                      ? 'These are counted in different things, so the smaller ones look flat. Choose Relative (%) to compare how they move.'
                      : 'All on the same axis, in their real values.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Series({ entityId, element, name, unit, bare, rolled }: { entityId: string; element: string; name: string; unit?: string; bare?: boolean; rolled?: boolean }) {
  const { tenantId, project } = useProject();
  const scheme = useScheme();
  const s = useQuery({ queryKey: ['series', tenantId, project.key, entityId, element, !!rolled], queryFn: () => api.series(tenantId, project.key, entityId, element, !!rolled) });
  const option = useMemo<ChartOption>(() => {
    const ink = INK[scheme];
    return {
      grid: { left: 40, right: 28, top: 24, bottom: 52, containLabel: true },
      tooltip: { trigger: 'axis', backgroundColor: ink.tooltip, borderColor: ink.axis, borderRadius: 0, textStyle: { color: ink.text } },
      xAxis: { type: 'time', name: 'Date', nameLocation: 'middle', nameGap: 34, nameTextStyle: { color: ink.muted, fontSize: 12 }, axisLabel: { color: ink.muted, hideOverlap: true }, axisLine: { lineStyle: { color: ink.axis } } },
      yAxis: { type: 'value', name: `${name}${unit ? ` (${unit})` : ''}`, nameLocation: 'middle', nameRotate: 90, nameGap: 48, nameTextStyle: { color: ink.muted, fontSize: 12 }, axisLabel: { color: ink.muted }, splitLine: { lineStyle: { color: ink.grid } } },
      series: [{ name, type: 'line', showSymbol: (s.data?.length ?? 0) < 40, symbolSize: 8, lineStyle: { width: 2, color: project.color }, itemStyle: { color: project.color }, color: project.color, data: (s.data ?? []).map((p) => [p.at, p.value]) }],
    };
  }, [s.data, scheme, name, unit, project.color]);
  return (
    <div className={cx('h-72 px-2 pt-3', !bare && 'border-t border-zinc-200')}>
      <Chart option={option} label={`${name} over time`} />
    </div>
  );
}
