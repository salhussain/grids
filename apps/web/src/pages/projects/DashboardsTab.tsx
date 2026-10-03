import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  AGGREGATIONS,
  WIDGET_TYPES,
  applyParams,
  type DashboardParams,
  type DashboardDto,
  type QuerySpecInput,
  type Widget,
  type WidgetInput,
} from '@grids/schema';
import { Button, CopyField, Dialog, Empty, ErrorNotice, Field, Input, Loading, Select, SwitchField, Textarea, cx, useToast } from '@grids/ui';
import { ArrowDown, ArrowUp, BarChart3, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useWorkspace } from '../../session';
import { DashboardFilterBar } from '../../viz/DashboardFilters';
import { GroupSelect, LockBadge } from './permissions';
import { WidgetView } from '../../viz/WidgetView';
import { useElementNames, useProject } from './context';

export function DashboardsTab() {
  const { tenantId, project, can, base } = useProject();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const names = useElementNames();
  const list = useQuery({ queryKey: ['dashboards', tenantId, project.key], queryFn: () => api.dashboards(tenantId, project.key) });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DashboardDto | null>(null);
  const [widgetDialog, setWidgetDialog] = useState<{ index: number | null } | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const current = list.data?.find((d) => d.key === selected) ?? list.data?.[0] ?? null;
  const [params, setParams] = useState<DashboardParams>({});
  useEffect(() => setParams({}), [current?.key]);
  const areaType = current?.filters.areaType ?? null;
  const types = useQuery({ queryKey: ['types', tenantId, project.key], queryFn: () => api.types(tenantId, project.key), enabled: !!areaType || editing });
  const areas = useQuery({
    queryKey: ['areas', tenantId, project.key, areaType],
    queryFn: async () => (await api.entities(tenantId, project.key, { type: areaType!, pageSize: 200 })).items.map((e) => ({ id: e.id, name: e.name })),
    enabled: !!areaType,
  });
  useEffect(() => setDraft(current && editing ? structuredClone(current) : null), [current?.key, editing]);

  const save = useMutation({
    mutationFn: (d: DashboardDto) =>
      api.saveDashboard(tenantId, project.key, { key: d.key, name: d.name, description: d.description, widgets: d.widgets, isPublic: d.isPublic, filters: d.filters, permissionGroup: d.permissionGroup }, d.key),
    onSuccess: (data) => {
      qc.setQueryData(['dashboards', tenantId, project.key], data);
      setEditing(false);
      toast('Dashboard saved');
    },
  });
  const remove = useMutation({
    mutationFn: (key: string) => api.deleteDashboard(tenantId, project.key, key),
    onSuccess: (data) => {
      qc.setQueryData(['dashboards', tenantId, project.key], data);
      setEditing(false);
      setSelected(null);
    },
  });

  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorNotice error={list.error} />;
  if (!current)
    return (
      <div className="border border-zinc-200 bg-snow">
        <Empty icon={BarChart3} title="No dashboards yet" action={can('manager') ? <Button icon={Plus} onClick={() => setNewOpen(true)}>New dashboard</Button> : undefined}>
          Dashboards combine KPIs, charts, maps and tables over this project’s data.
        </Empty>
        {newOpen && <NewDashboard onClose={() => setNewOpen(false)} onCreated={(k) => setSelected(k)} />}
      </div>
    );

  const shown = editing && draft ? draft : current;
  const move = (i: number, d: -1 | 1) => {
    const w = [...draft!.widgets];
    const j = i + d;
    if (j < 0 || j >= w.length) return;
    [w[i], w[j]] = [w[j]!, w[i]!];
    setDraft({ ...draft!, widgets: w });
  };
  const publicUrl = `${window.location.origin}/public/${ws.tenant.slug}/${project.key}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Dashboards" className="flex flex-wrap gap-px border border-zinc-300 bg-zinc-300">
          {list.data.map((d) => (
            <button
              key={d.key}
              role="tab"
              aria-selected={d.key === current.key}
              onClick={() => {
                setSelected(d.key);
                setEditing(false);
              }}
              className={cx('px-3 py-1.5 text-sm', d.key === current.key ? 'bg-ink text-canvas' : 'bg-snow hover:bg-zinc-50')}
            >
              {d.name}
              {d.permissionGroup && <Lock className="ms-1.5 inline size-3 opacity-60" aria-label="Restricted" />}
            </button>
          ))}
        </div>
        {can('manager') && (
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button variant="danger" icon={Trash2} onClick={() => confirm(`Delete “${current.name}”?`) && remove.mutate(current.key)}>
                  Delete
                </Button>
                <Button variant="secondary" icon={Plus} onClick={() => setWidgetDialog({ index: null })}>
                  Add widget
                </Button>
                <Button onClick={() => draft && save.mutate(draft)} loading={save.isPending}>
                  Save dashboard
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" icon={Plus} onClick={() => setNewOpen(true)}>
                  New dashboard
                </Button>
                <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      <ErrorNotice error={save.error ?? remove.error} />
      {editing && draft && (
        <div className="grid gap-4 border border-dashed border-zinc-400 bg-snow p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Name">
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>
          <SwitchField
            label="Public"
            description={project.visibility === 'public' ? 'Visible without signing in' : 'Needs a public project'}
            checked={draft.isPublic}
            onChange={(v: boolean) => setDraft({ ...draft, isPublic: v })}
          />
          <Field label="Area filter" hint="Viewers pick one; every widget shows only its subtree">
            <Select value={draft.filters.areaType ?? ''} onChange={(e) => setDraft({ ...draft, filters: { ...draft.filters, areaType: e.target.value || null } })}>
              <option value="">None</option>
              {types.data?.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <SwitchField
            label="Period filter"
            description="Viewers choose the time window of charts and KPIs"
            checked={draft.filters.period}
            onChange={(v: boolean) => setDraft({ ...draft, filters: { ...draft.filters, period: v } })}
          />
          <GroupSelect label="Who can see this dashboard" value={draft.permissionGroup} onChange={(g) => setDraft({ ...draft, permissionGroup: g })} />
        </div>
      )}
      {!editing && (current.description || current.filters.areaType || current.filters.period) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-600">{current.description}</p>
          <DashboardFilterBar
            filters={current.filters}
            params={params}
            onChange={setParams}
            areas={areas.data}
            areaLabel={`All ${(types.data?.find((t) => t.key === areaType)?.plural ?? 'areas').toLowerCase()}`}
          />
        </div>
      )}
      {!editing && current.isPublic && project.visibility === 'public' && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-zinc-600">Public link:</span>
          <div className="min-w-0 flex-1 sm:max-w-md">
            <CopyField value={publicUrl} />
          </div>
        </div>
      )}
      <div className="grid grid-cols-12 gap-4">
        {shown.widgets.map((raw, i) => {
          const w = !editing && raw.query ? { ...raw, query: applyParams(raw.query, params, shown.filters) } : raw;
          return (
          <WidgetView
            key={`${shown.key}-${w.id}`}
            widget={w}
            names={names}
            queryKey={['widget', tenantId, project.key, shown.key]}
            // Saved widgets load by reference (permission-checked); drafts run their query.
            load={(p = {}) =>
              editing ? api.query(tenantId, project.key, applyParams(w.query!, p, shown.filters) as QuerySpecInput) : api.widget(tenantId, project.key, shown.key, w.id, { ...params, ...p })
            }
            onSelectEntity={(id) => void navigate({ to: `${base}/entities/${id}` })}
            actions={
              editing ? (
                <span className="flex items-center gap-0.5">
                  <LockBadge group={w.permissionGroup} />
                  <IconBtn label="Move earlier" onClick={() => move(i, -1)} icon={ArrowUp} />
                  <IconBtn label="Move later" onClick={() => move(i, 1)} icon={ArrowDown} />
                  <IconBtn label={`Edit ${w.title}`} onClick={() => setWidgetDialog({ index: i })} icon={Pencil} />
                  <IconBtn label={`Remove ${w.title}`} onClick={() => setDraft({ ...draft!, widgets: draft!.widgets.filter((_, j) => j !== i) })} icon={Trash2} />
                </span>
              ) : undefined
            }
          />
          );
        })}
      </div>
      {widgetDialog && draft && (
        <WidgetEditor
          initial={widgetDialog.index === null ? null : draft.widgets[widgetDialog.index]!}
          onClose={() => setWidgetDialog(null)}
          onSave={(w) => {
            const widgets = [...draft.widgets];
            if (widgetDialog.index === null) widgets.push(w);
            else widgets[widgetDialog.index] = w;
            setDraft({ ...draft, widgets });
            setWidgetDialog(null);
          }}
        />
      )}
      {newOpen && <NewDashboard onClose={() => setNewOpen(false)} onCreated={(k) => setSelected(k)} />}
    </div>
  );
}

const IconBtn = ({ label, onClick, icon: Icon }: { label: string; onClick(): void; icon: typeof Pencil }) => (
  <button type="button" onClick={onClick} aria-label={label} title={label} className="p-1 text-zinc-500 hover:bg-zinc-100 hover:text-ink">
    <Icon className="size-3.5" />
  </button>
);

function NewDashboard({ onClose, onCreated }: { onClose(): void; onCreated(key: string): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'd_$1') || 'dashboard';
  const create = useMutation({
    mutationFn: () => api.saveDashboard(tenantId, project.key, { key, name, widgets: [] }),
    onSuccess: (data) => {
      qc.setQueryData(['dashboards', tenantId, project.key], data);
      onCreated(key);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="New dashboard"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!name}>
            Create
          </Button>
        </>
      }
    >
      <ErrorNotice error={create.error} />
      <Field label="Name" hint={`Key: ${key}`}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}

/** Builds a widget and its query from the project's data model (no SQL). */
function WidgetEditor({ initial, onClose, onSave }: { initial: Widget | null; onClose(): void; onSave(w: Widget): void }) {
  const { tenantId, project } = useProject();
  const types = useQuery({ queryKey: ['types', tenantId, project.key], queryFn: () => api.types(tenantId, project.key) });
  const elements = useQuery({ queryKey: ['elements', tenantId, project.key], queryFn: () => api.elements(tenantId, project.key) });
  const datasets = useQuery({ queryKey: ['datasets', tenantId, project.key], queryFn: () => api.datasets(tenantId, project.key) });
  const [w, setW] = useState<WidgetInput>(
    initial ?? { id: `w${Date.now().toString(36)}`, type: 'kpi', title: '', w: 4, h: 2, options: {}, query: { kind: 'kpi', aggregation: 'sum', range: { lastHours: 24 * 30 } } },
  );
  const q = (w.query ?? {}) as Record<string, unknown> & { kind?: string };
  const setQ = (patch: Record<string, unknown>) => setW({ ...w, query: { ...q, ...patch } as QuerySpecInput });
  const setO = (patch: Record<string, unknown>) => setW({ ...w, options: { ...w.options, ...patch } });
  const kindFor = (type: string) =>
    ({ kpi: 'kpi', gauge: 'kpi', line: 'series', area: 'series', bar: q.kind === 'series' ? 'series' : 'breakdown', pie: 'breakdown', matrix: 'breakdown', map: 'geo', table: 'table', text: null })[type] ?? null;
  const changeType = (type: Widget['type']) => {
    const kind = kindFor(type);
    const defaults: Record<string, QuerySpecInput> = {
      kpi: { kind: 'kpi', aggregation: 'sum', range: { lastHours: 24 * 30 } },
      series: { kind: 'series', elements: elements.data?.[0] ? [elements.data[0].key] : [], aggregation: 'sum', interval: 'day', range: { lastHours: 24 * 30 } },
      breakdown: { kind: 'breakdown', by: 'parent', aggregation: 'sum', range: { lastHours: 24 * 30 } },
      geo: { kind: 'geo', entityType: types.data?.find((t) => t.geometry !== 'none')?.key },
      table: { kind: 'table', source: 'entities', limit: 50 },
    };
    setW({ ...w, type, query: kind ? (q.kind === kind ? (q as QuerySpecInput) : defaults[kind]) : undefined, w: type === 'kpi' ? 3 : type === 'gauge' ? 4 : type === 'map' || type === 'table' || type === 'matrix' ? 12 : 6, h: type === 'kpi' ? 1 : type === 'gauge' ? 2 : 3 });
  };
  const setBarKind = (kind: 'breakdown' | 'series') =>
    setW({
      ...w,
      query:
        kind === 'series'
          ? { kind: 'series', elements: elements.data?.[0] ? [elements.data[0].key] : [], aggregation: 'sum', interval: 'week', range: { lastHours: 24 * 90 } }
          : { kind: 'breakdown', by: 'parent', aggregation: 'sum', range: { lastHours: 24 * 30 } },
    });
  const Multi = ({ value, onChange }: { value: string[]; onChange(v: string[]): void }) => (
    <div className="flex flex-wrap gap-2">
      {elements.data?.map((e) => {
        const on = value.includes(e.key);
        return (
          <label key={e.key} className={cx('flex cursor-pointer items-center gap-2 border px-2.5 py-1.5 text-sm', on ? 'border-accent-600 bg-accent-50' : 'border-zinc-300')}>
            <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((k) => k !== e.key) : [...value, e.key])} className="size-4 accent-[var(--brand-600)]" />
            {e.name}
          </label>
        );
      })}
    </div>
  );
  const Thresholds = () => (
    <>
      <Field label="Warning at ≥">
        <Input type="number" step="any" value={w.options?.warn ?? ''} onChange={(e) => setO({ warn: e.target.value === '' ? undefined : Number(e.target.value) })} />
      </Field>
      <Field label="Alert at ≥">
        <Input type="number" step="any" value={w.options?.alert ?? ''} onChange={(e) => setO({ alert: e.target.value === '' ? undefined : Number(e.target.value) })} />
      </Field>
    </>
  );
  const range = (q.range ?? {}) as { lastHours?: number; lastMinutes?: number };
  const rangeDays = range.lastMinutes ? range.lastMinutes / 1440 : (range.lastHours ?? 720) / 24;

  const El = ({ label, value, onChange, optional }: { label: string; value?: string; onChange(v: string | undefined): void; optional?: string }) => (
    <Field label={label}>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        {optional && <option value="">{optional}</option>}
        {elements.data?.map((e) => (
          <option key={e.key} value={e.key}>
            {e.name}
          </option>
        ))}
      </Select>
    </Field>
  );
  const TypeSel = ({ geoOnly }: { geoOnly?: boolean }) => (
    <Field label="Entity type">
      <Select value={(q.entityType as string) ?? ''} onChange={(e) => setQ({ entityType: e.target.value || undefined })}>
        {!geoOnly && <option value="">All types</option>}
        {types.data
          ?.filter((t) => !geoOnly || t.geometry !== 'none')
          .map((t) => (
            <option key={t.key} value={t.key}>
              {t.plural}
            </option>
          ))}
      </Select>
    </Field>
  );
  const Agg = () => (
    <Field label="Aggregation">
      <Select value={(q.aggregation as string) ?? 'sum'} onChange={(e) => setQ({ aggregation: e.target.value })}>
        {AGGREGATIONS.map((a) => (
          <option key={a} value={a}>
            {a === 'distinct' ? 'distinct entities' : a}
          </option>
        ))}
      </Select>
    </Field>
  );
  const Range = () => (
    <Field label="Period (days)" hint="Ending now">
      <Input type="number" min={0.01} step="any" value={rangeDays} onChange={(e) => setQ({ range: { lastHours: Math.max(1, Math.round(Number(e.target.value) * 24)) } })} />
    </Field>
  );

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={initial ? 'Edit widget' : 'Add widget'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(w as Widget)}>Apply</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Type">
            <Select value={w.type} onChange={(e) => changeType(e.target.value as Widget['type'])}>
              {WIDGET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === 'kpi' ? 'KPI' : t[0]!.toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" className="sm:col-span-3">
            <Input value={w.title} onChange={(e) => setW({ ...w, title: e.target.value })} />
          </Field>
          <Field label="Width (of 12)">
            <Input type="number" min={2} max={12} value={w.w} onChange={(e) => setW({ ...w, w: Number(e.target.value) })} />
          </Field>
          <Field label="Height (rows)">
            <Input type="number" min={1} max={6} value={w.h} onChange={(e) => setW({ ...w, h: Number(e.target.value) })} />
          </Field>
          <div className="sm:col-span-2">
            <GroupSelect value={w.permissionGroup} onChange={(g) => setW({ ...w, permissionGroup: g ?? undefined })} />
          </div>
          <Field label="Unit">
            <Input value={w.options?.unit ?? ''} onChange={(e) => setO({ unit: e.target.value || undefined })} />
          </Field>
          <Field label="Decimals">
            <Input type="number" min={0} max={6} value={w.options?.decimals ?? ''} onChange={(e) => setO({ decimals: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </Field>
        </div>
        <div className="grid gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-3">
          {w.type === 'text' && (
            <Field label="Text" className="sm:col-span-3">
              <Textarea value={w.text ?? ''} onChange={(e) => setW({ ...w, text: e.target.value })} />
            </Field>
          )}
          {q.kind === 'kpi' && (
            <>
              <El label="Value" value={q.element as string} onChange={(v) => setQ({ element: v })} optional="Count of entities" />
              <TypeSel />
              {q.element ? <Agg /> : null}
              {q.element ? <Range /> : null}
              {q.element ? (
                <div className="flex flex-col gap-3 pt-5">
                  <SwitchField label="Latest value per entity" checked={!!q.latest} onChange={(v: boolean) => setQ({ latest: v })} />
                  <SwitchField label="Compare with previous period" checked={!!q.compare} onChange={(v: boolean) => setQ({ compare: v })} />
                  <SwitchField label="Lower is better" checked={!!w.options?.invert} onChange={(v: boolean) => setO({ invert: v })} />
                </div>
              ) : null}
              {w.type === 'gauge' && (
                <>
                  <Field label="Dial maximum (target)">
                    <Input type="number" step="any" value={w.options?.max ?? ''} onChange={(e) => setO({ max: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </Field>
                  <Thresholds />
                </>
              )}
            </>
          )}
          {w.type === 'bar' && (
            <Field label="Bars show">
              <Select value={q.kind === 'series' ? 'series' : 'breakdown'} onChange={(e) => setBarKind(e.target.value as 'breakdown' | 'series')}>
                <option value="breakdown">Categories</option>
                <option value="series">Over time</option>
              </Select>
            </Field>
          )}
          {(w.type === 'area' || (w.type === 'bar' && (q.kind === 'series' || (q.elements as string[] | undefined)?.length))) && (
            <div className="flex items-end pb-1">
              <SwitchField label="Stacked" checked={!!w.options?.stacked} onChange={(v: boolean) => setO({ stacked: v })} />
            </div>
          )}
          {q.kind === 'series' && (
            <>
              <Field label="Values" className="sm:col-span-3">
                <div className="flex flex-wrap gap-2">
                  {elements.data?.map((e) => {
                    const on = ((q.elements as string[]) ?? []).includes(e.key);
                    return (
                      <label key={e.key} className={cx('flex cursor-pointer items-center gap-2 border px-2.5 py-1.5 text-sm', on ? 'border-accent-600 bg-accent-50' : 'border-zinc-300')}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setQ({ elements: on ? (q.elements as string[]).filter((k) => k !== e.key) : [...((q.elements as string[]) ?? []), e.key] })}
                          className="size-4 accent-[var(--brand-600)]"
                        />
                        {e.name}
                      </label>
                    );
                  })}
                </div>
              </Field>
              <Agg />
              <Field label="Interval">
                <Select value={(q.interval as string) ?? 'day'} onChange={(e) => setQ({ interval: e.target.value })}>
                  {['minute', 'hour', 'day', 'week', 'month'].map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </Select>
              </Field>
              <Range />
              <TypeSel />
            </>
          )}
          {q.kind === 'breakdown' && (
            <>
              <Field label="Values">
                <Select
                  value={q.elements ? 'many' : 'one'}
                  onChange={(e) => setQ(e.target.value === 'many' ? { elements: q.element ? [q.element as string] : elements.data?.slice(0, 2).map((x) => x.key), element: undefined } : { elements: undefined })}
                >
                  <option value="one">One value</option>
                  <option value="many">Several values side by side</option>
                </Select>
              </Field>
              {q.elements ? (
                <Field label="Values to compare" className="sm:col-span-3">
                  <Multi value={q.elements as string[]} onChange={(v) => setQ({ elements: v.length ? v : undefined })} />
                </Field>
              ) : (
                <El label="Value" value={q.element as string} onChange={(v) => setQ({ element: v })} optional="Count of entities" />
              )}
              <Field label="Group by">
                <Select value={(q.by as string) ?? 'parent'} onChange={(e) => setQ({ by: e.target.value })}>
                  <option value="parent">Parent</option>
                  <option value="attribute">Attribute</option>
                  <option value="entity">Entity</option>
                  <option value="type">Entity type</option>
                </Select>
              </Field>
              {q.by === 'attribute' && (
                <Field label="Attribute">
                  <Select value={(q.attribute as string) ?? ''} onChange={(e) => setQ({ attribute: e.target.value || undefined })}>
                    <option value="">Choose…</option>
                    {types.data
                      ?.filter((t) => !q.entityType || t.key === q.entityType)
                      .flatMap((t) => t.attributes)
                      .map((a) => (
                        <option key={a.key} value={a.key}>
                          {a.label}
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
              <TypeSel />
              {q.element || q.elements ? <Agg /> : null}
              {q.element || q.elements ? <Range /> : null}
              {w.type === 'matrix' && <Thresholds />}
              <Field label="Show top">
                <Input type="number" min={1} max={100} value={(q.limit as number) ?? 12} onChange={(e) => setQ({ limit: Number(e.target.value) })} />
              </Field>
              {w.type === 'bar' && <SwitchField label="Horizontal bars" checked={!!w.options?.horizontal} onChange={(v: boolean) => setO({ horizontal: v })} />}
            </>
          )}
          {q.kind === 'geo' && (
            <>
              <TypeSel geoOnly />
              <El label="Colour by latest value" value={q.element as string} onChange={(v) => setQ({ element: v })} optional="Type colour" />
              <Field label="Only updated within (minutes)" hint="For live layers">
                <Input type="number" min={1} value={(q.withinMinutes as number) ?? ''} onChange={(e) => setQ({ withinMinutes: e.target.value ? Number(e.target.value) : undefined })} />
              </Field>
              <Field label="Warning at ≥">
                <Input type="number" step="any" value={w.options?.warn ?? ''} onChange={(e) => setO({ warn: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </Field>
              <Field label="Alert at ≥">
                <Input type="number" step="any" value={w.options?.alert ?? ''} onChange={(e) => setO({ alert: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </Field>
              <Field label="Refresh every (seconds)">
                <Input type="number" min={10} value={w.options?.refreshSeconds ?? ''} onChange={(e) => setO({ refreshSeconds: e.target.value ? Number(e.target.value) : undefined })} />
              </Field>
            </>
          )}
          {q.kind === 'table' && (
            <>
              <Field label="Rows from">
                <Select value={(q.source as string) ?? 'entities'} onChange={(e) => setQ({ source: e.target.value })}>
                  <option value="entities">Entities</option>
                  <option value="dataset">Dataset</option>
                  <option value="observations">Latest observations</option>
                </Select>
              </Field>
              {q.source === 'dataset' ? (
                <Field label="Dataset">
                  <Select value={(q.dataset as string) ?? ''} onChange={(e) => setQ({ dataset: e.target.value || undefined })}>
                    <option value="">Choose…</option>
                    {datasets.data?.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <TypeSel />
              )}
              <Field label="Columns" hint="Comma-separated: name, code, parent, attribute keys">
                <Input value={((q.columns as string[]) ?? []).join(', ')} onChange={(e) => setQ({ columns: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
              </Field>
              <Field label="Sort by">
                <Input value={(q.sort as string) ?? ''} onChange={(e) => setQ({ sort: e.target.value || undefined })} />
              </Field>
              <Field label="Rows">
                <Input type="number" min={1} max={500} value={(q.limit as number) ?? 50} onChange={(e) => setQ({ limit: Number(e.target.value) })} />
              </Field>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
