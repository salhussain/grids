import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  type DatasetDto,
  AGGREGATIONS,
  metricExpressionProblem,
  WIDGET_TYPES,
  applyParams,
  filterFromParam,
  type ColumnFilter,
  type DashboardParams,
  type DashboardDto,
  type QuerySpecInput,
  type Widget,
  type WidgetInput,
} from '@grids/schema';
import {
  confirmDialog,
  Button,
  CopyField,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Listbox,
  Loading,
  Select,
  SectionHead,
  Switch,
  Table,
  Td,
  Textarea,
  cx,
  relTime,
  useToast,
  Empty,
} from '@grids/ui';
import {
  ChevronDown,
  SlidersHorizontal,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AreaChart,
  BarChart3,
  Activity,
  CalendarRange,
  Link2,
  ShieldCheck,
  ClipboardList,
  Database,
  Eye,
  Palette,
  Filter,
  Copy,
  Globe,
  MapPin,
  Gauge,
  Grid3x3,
  Hash,
  Lock,
  Map as MapIcon,
  PieChart,
  Search,
  Settings,
  Table2,
  TrendingUp,
  Type,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { aggregationOptions } from './aggregations';
import { aggregationsFor, columnKind, columnOptions, KIND_LABEL } from './columnTypes';
import { useWorkspace } from '../../session';
import { columnValue, DashboardFilterBar, withColumnValue } from '@grids/viz';
import { GroupSelect, LockBadge, usePermissionGroups } from './permissions';
import { RichTextEditor } from './RichTextEditor';
import { ChoiceCards, IconPicker } from './fields';
import { WidgetView } from '@grids/viz';
import { useElementNames, useProject } from './context';

export function DashboardsTab() {
  const { tenantId, project, can, base } = useProject();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const names = useElementNames();
  const list = useQuery({
    queryKey: ['dashboards', tenantId, project.key],
    queryFn: () => api.dashboards(tenantId, project.key),
  });
  const [selected, setSelected] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('dashboard'),
  );
  // The dashboard's settings being changed in their window; saved with its Save button.
  const [settings, setSettings] = useState<DashboardDto | null>(null);
  const [widgetDialog, setWidgetDialog] = useState<{ index: number | null } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [q, setQ] = useState('');

  const current = list.data?.find((d) => d.key === selected) ?? null;
  // The address names the open dashboard, so a copied link opens it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set('dashboard', selected);
    else url.searchParams.delete('dashboard');
    window.history.replaceState(window.history.state, '', url);
  }, [selected]);
  const [params, setParams] = useState<DashboardParams>({});
  useEffect(() => setParams({}), [current?.key]);
  const datasets = useQuery({
    queryKey: ['datasets', tenantId, project.key],
    queryFn: () => api.datasets(tenantId, project.key),
    enabled: !!settings,
  });
  const areaType = current?.filters.areaType ?? null;
  const types = useQuery({
    queryKey: ['types', tenantId, project.key],
    queryFn: () => api.types(tenantId, project.key),
    enabled: !!areaType || !!settings,
  });
  // Viewers can pick an area at the dashboard's area type and at any more levels it offers.
  const levels = areaType ? [areaType, ...(current?.filters.areaTypes ?? [])] : [];
  const areas = useQuery({
    queryKey: ['areas', tenantId, project.key, levels],
    queryFn: async () =>
      (
        await Promise.all(
          levels.map((t) => api.entities(tenantId, project.key, { type: t, pageSize: 200 })),
        )
      ).flatMap((r) => r.items.map((e) => ({ id: e.id, name: e.name, type: e.type }))),
    enabled: levels.length > 0,
  });

  // Every change is saved as it is made: there is no separate editing mode.
  const save = useMutation({
    mutationFn: (d: DashboardDto) =>
      api.saveDashboard(
        tenantId,
        project.key,
        {
          key: d.key,
          name: d.name,
          description: d.description,
          icon: d.icon,
          widgets: d.widgets,
          isPublic: d.isPublic,
          filters: d.filters,
          permissionGroup: d.permissionGroup,
        },
        d.key,
      ),
    onSuccess: (data) => {
      qc.setQueryData(['dashboards', tenantId, project.key], data);
      void qc.invalidateQueries({ queryKey: ['widget', tenantId, project.key] });
    },
  });
  const remove = useMutation({
    mutationFn: (key: string) => api.deleteDashboard(tenantId, project.key, key),
    onSuccess: (data) => {
      qc.setQueryData(['dashboards', tenantId, project.key], data);
      setSelected(null);
    },
  });

  /** Asks first, saying what goes with the dashboard. */
  const askDelete = async (d: { key: string; name: string; widgets: unknown[] }) => {
    const n = d.widgets.length;
    if (
      await confirmDialog(
        `Delete the dashboard “${d.name}”?${n ? ` Its ${n} widget${n === 1 ? '' : 's'} are deleted with it.` : ''} The datasets and data elements they show are not affected. This cannot be undone.`,
        { confirmLabel: 'Delete dashboard', danger: true },
      )
    )
      remove.mutate(d.key);
  };

  if (list.isPending)
    return (
      <div>
        <SectionHead
          title="Dashboards"
          description="Dashboards combine KPIs, charts, maps and tables over this project’s data."
        />
        <Loading />
      </div>
    );
  if (list.isError) return <ErrorNotice error={list.error} />;
  if (!current)
    return (
      <div>
        <SectionHead
          title="Dashboards"
          description="Dashboards combine KPIs, charts, maps and tables over this project’s data."
          actions={
            can('manager') ? (
              <Button size="sm" icon={Plus} onClick={() => setNewOpen(true)}>
                New dashboard
              </Button>
            ) : undefined
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-zinc-400" />
            <Input
              aria-label="Search dashboards"
              placeholder="Search dashboards"
              className="ps-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="border border-zinc-200 bg-snow">
          <Table
            head={['Dashboard', 'Widgets', 'Shared', 'Updated', '']}
            empty={
              <Empty icon={BarChart3} title="No dashboards yet">
                A dashboard puts KPIs, charts, maps and tables over this project’s data on one page.
                Pick a layout, then add widgets.
              </Empty>
            }
          >
            {list.data
              .filter((d) =>
                `${d.name} ${d.description}`.toLowerCase().includes(q.trim().toLowerCase()),
              )
              .map((d) => (
                <tr
                  key={d.key}
                  className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50"
                  onClick={() => setSelected(d.key)}
                >
                  <Td>
                    <button
                      type="button"
                      className="text-start font-medium text-accent-700 hover:underline"
                      onClick={() => setSelected(d.key)}
                    >
                      {d.name}
                    </button>
                    {d.description && (
                      <div className="max-w-md truncate text-xs text-zinc-500">{d.description}</div>
                    )}
                  </Td>
                  <Td className="num">{d.widgets.length}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1.5 text-xs">
                      {d.isPublic ? (
                        <span className="border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-emerald-800">
                          Public
                        </span>
                      ) : (
                        <span className="border border-zinc-300 px-1.5 py-0.5 text-zinc-600">
                          Members
                        </span>
                      )}
                      {d.permissionGroup && <LockBadge group={d.permissionGroup} />}
                    </span>
                  </Td>
                  <Td className="text-xs text-zinc-500">{relTime(d.updatedAt)}</Td>
                  <Td className="text-end">
                    {can('manager') && (
                      <span className="inline-flex items-center">
                        <button
                          type="button"
                          aria-label={`Open ${d.name}`}
                          title="Open"
                          className="p-1.5 text-zinc-500 hover:text-ink"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(d.key);
                          }}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${d.name}`}
                          title="Delete"
                          className="p-1.5 text-zinc-500 hover:text-red-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            void askDelete(d);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
          </Table>
        </div>
        {newOpen && (
          <NewDashboard onClose={() => setNewOpen(false)} onCreated={(k) => setSelected(k)} />
        )}
      </div>
    );

  // A widget set to show at some levels only appears while the picked area is at one of them.
  const pickedType = params.area
    ? (areas.data?.find((a) => a.id === params.area)?.type.key ?? null)
    : null;
  const shownAt = (w: Widget) =>
    !w.options?.levels?.length || w.options.levels.includes(pickedType ?? '_none');
  const hidden = current.widgets.filter((w) => !shownAt(w)).length;
  const change = (widgets: Widget[]) => save.mutate({ ...current, widgets });
  const move = (i: number, d: -1 | 1) => {
    const w = [...current.widgets];
    const j = i + d;
    if (j < 0 || j >= w.length) return;
    [w[i], w[j]] = [w[j]!, w[i]!];
    change(w);
  };
  const removeWidget = async (i: number) => {
    const w = current.widgets[i]!;
    if (
      await confirmDialog(`Remove the widget “${w.title || 'Untitled'}”?`, {
        confirmLabel: 'Remove widget',
        danger: true,
      })
    )
      change(current.widgets.filter((_, j) => j !== i));
  };
  const publicUrl = `${window.location.origin}/public/${ws.tenant.slug}/${project.key}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="flex shrink-0 items-center gap-1 text-sm text-accent-700 hover:underline"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" /> All dashboards
          </button>
          <h2 className="truncate text-lg font-semibold">
            {current.name}
            {current.permissionGroup && (
              <Lock className="ms-1.5 inline size-3.5 opacity-60" aria-label="Restricted" />
            )}
          </h2>
        </div>
        {can('manager') && (
          <div className="flex flex-wrap items-center gap-2">
            <SquareBtn
              label="Add widget"
              icon={Plus}
              onClick={() => setWidgetDialog({ index: null })}
            />
            <SquareBtn
              label="Copy link to this dashboard"
              icon={Link2}
              onClick={() => {
                // A public dashboard shares its public page; a private one, the link members sign in to.
                const open = current.isPublic && project.visibility === 'public';
                const url = open
                  ? publicUrl
                  : `${window.location.origin}${base}/dashboards?dashboard=${encodeURIComponent(current.key)}`;
                void navigator.clipboard
                  ?.writeText(url)
                  .then(() =>
                    toast(open ? 'Link copied' : 'Link copied. People need to sign in to open it'),
                  );
              }}
            />
            <SquareBtn
              label="Settings"
              icon={Settings}
              onClick={() => setSettings(structuredClone(current))}
            />
            <SquareBtn
              label="Delete"
              icon={Trash2}
              danger
              onClick={() => void askDelete(current)}
            />
          </div>
        )}
      </div>
      <ErrorNotice error={save.error ?? remove.error} />
      {settings && (
        <DashboardSettings
          draft={settings}
          setDraft={setSettings}
          datasets={datasets.data ?? []}
          types={types.data ?? []}
          publicVisible={project.visibility === 'public'}
          color={project.color}
          publicUrl={publicUrl}
          saving={save.isPending}
          onClose={() => setSettings(null)}
          onSave={() =>
            save.mutate(settings, {
              onSuccess: () => {
                setSettings(null);
                toast('Dashboard saved');
              },
            })
          }
        />
      )}
      {(current.description ||
        current.filters.areaType ||
        current.filters.period ||
        current.filters.columns.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-600">{current.description}</p>
          <DashboardFilterBar
            filters={current.filters}
            params={params}
            onChange={setParams}
            areas={areas.data}
            areaLabel={
              levels.length > 1
                ? 'All areas'
                : `All ${(types.data?.find((t) => t.key === areaType)?.plural ?? 'areas').toLowerCase()}`
            }
            loadOptions={(filter, cf) =>
              api.filterValues(tenantId, project.key, current.key, filter, cf)
            }
            optionsKey={['filter-values', tenantId, project.key, current.key]}
          />
        </div>
      )}
      {hidden > 0 && can('manager') && (
        <p className="text-xs text-zinc-500">
          {hidden} widget{hidden === 1 ? ' is' : 's are'} not shown at this level. Pick another area
          to see {hidden === 1 ? 'it' : 'them'}.
        </p>
      )}
      {current.widgets.length === 0 && (
        <div className="border border-zinc-200 bg-snow">
          <Empty
            icon={BarChart3}
            title="No widgets yet"
            action={
              can('manager') ? (
                <Button icon={Plus} onClick={() => setWidgetDialog({ index: null })}>
                  Add widget
                </Button>
              ) : undefined
            }
          >
            Add numbers, charts, maps and tables. They update as your data does.
          </Empty>
        </div>
      )}
      <div className="grid grid-cols-12 gap-4">
        {current.widgets.map((raw, i) => {
          if (!shownAt(raw)) return null;
          /** Clicking a bar or slice of a chart grouped by a filtered column sets that filter, like picking it in the bar. */
          const crossFilter = (w: Widget) => {
            const q = w.query as
              { kind?: string; dataset?: string; groupBy?: string; thenBy?: string } | undefined;
            if (
              (w.type !== 'bar' && w.type !== 'pie') ||
              q?.kind !== 'dataset' ||
              !q.groupBy ||
              q.thenBy
            )
              return undefined;
            const target = current.filters.columns.find(
              (f) =>
                f.dataset === q.dataset &&
                f.column === q.groupBy &&
                (f.kind === 'select' || f.kind === 'multi'),
            );
            if (!target) return undefined;
            return (label: string) => {
              if (label === '(none)') return;
              setParams((p) => {
                const cur = columnValue(target, p);
                const same =
                  typeof cur === 'string'
                    ? cur === label
                    : Array.isArray(cur) && cur.length === 1 && cur[0] === label;
                return withColumnValue(
                  p,
                  target.id,
                  same ? null : target.kind === 'multi' ? [label] : label,
                );
              });
            };
          };
          const w = raw.query
            ? { ...raw, query: applyParams(raw.query, params, current.filters, raw.id) }
            : raw;
          return (
            <WidgetView
              square
              key={`${current.key}-${w.id}`}
              widget={w}
              names={names}
              queryKey={['widget', tenantId, project.key, current.key]}
              load={(p = {}) =>
                api.widget(tenantId, project.key, current.key, w.id, { ...params, ...p })
              }
              onSelectEntity={(id) => void navigate({ to: `${base}/entities/${id}` })}
              onPick={crossFilter(raw)}
              actions={
                can('manager') ? (
                  <span className="flex items-center gap-0.5">
                    <LockBadge group={w.permissionGroup} />
                    <span className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/w:opacity-100">
                      <IconBtn label="Move earlier" onClick={() => move(i, -1)} icon={ArrowUp} />
                      <IconBtn label="Move later" onClick={() => move(i, 1)} icon={ArrowDown} />
                      <IconBtn
                        label={`Edit ${w.title}`}
                        onClick={() => setWidgetDialog({ index: i })}
                        icon={Pencil}
                      />
                      <IconBtn
                        label={`Duplicate ${w.title}`}
                        onClick={() => {
                          const widgets = [...current.widgets];
                          widgets.splice(i + 1, 0, {
                            ...structuredClone(raw),
                            id: `w${Date.now().toString(36)}`,
                            title: raw.title ? `${raw.title} (copy)` : '',
                          });
                          change(widgets);
                        }}
                        icon={Copy}
                      />
                      <IconBtn
                        label={`Remove ${w.title}`}
                        onClick={() => void removeWidget(i)}
                        icon={Trash2}
                      />
                    </span>
                  </span>
                ) : undefined
              }
            />
          );
        })}
      </div>
      {widgetDialog && (
        <WidgetEditor
          levelOptions={
            current.filters.areaType
              ? [
                  { value: '_none', label: 'No area picked', description: 'The whole dashboard' },
                  ...levels.map((t) => ({
                    value: t,
                    label: types.data?.find((x) => x.key === t)?.name ?? t,
                    description: 'When an area of this type is picked',
                  })),
                ]
              : []
          }
          initial={widgetDialog.index === null ? null : current.widgets[widgetDialog.index]!}
          onClose={() => setWidgetDialog(null)}
          onDelete={
            widgetDialog.index === null
              ? undefined
              : () => {
                  void removeWidget(widgetDialog.index!);
                  setWidgetDialog(null);
                }
          }
          onSave={(w) => {
            const widgets = [...current.widgets];
            if (widgetDialog.index === null) widgets.push(w);
            else widgets[widgetDialog.index] = w;
            change(widgets);
            setWidgetDialog(null);
          }}
        />
      )}
      {newOpen && (
        <NewDashboard onClose={() => setNewOpen(false)} onCreated={(k) => setSelected(k)} />
      )}
    </div>
  );
}

/** An icon-only button in a bordered square, for the dashboard header. */
const SquareBtn = ({
  label,
  onClick,
  icon: Icon,
  danger,
}: {
  label: string;
  onClick(): void;
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={cx(
      'flex size-9 items-center justify-center text-zinc-600 hover:bg-zinc-100',
      danger ? 'hover:text-red-700' : 'hover:text-ink',
    )}
  >
    <Icon className="size-4" />
  </button>
);

const IconBtn = ({
  label,
  onClick,
  icon: Icon,
}: {
  label: string;
  onClick(): void;
  icon: typeof Pencil;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="p-1 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
  >
    <Icon className="size-3.5" />
  </button>
);

/** Widget types that can chart a dataset. */
const TYPE_INFO: Record<
  (typeof WIDGET_TYPES)[number],
  { label: string; hint: string; icon: React.ComponentType<{ className?: string }> }
> = {
  kpi: { label: 'Number', hint: 'One big figure', icon: Hash },
  line: { label: 'Line', hint: 'Trend over time', icon: TrendingUp },
  area: { label: 'Area', hint: 'Filled trend', icon: AreaChart },
  bar: { label: 'Bar', hint: 'Compare categories', icon: BarChart3 },
  pie: { label: 'Pie', hint: 'Share of a whole', icon: PieChart },
  gauge: { label: 'Gauge', hint: 'Progress to a target', icon: Gauge },
  matrix: { label: 'Matrix', hint: 'Two-way grid', icon: Grid3x3 },
  map: { label: 'Map', hint: 'Places on a map', icon: MapIcon },
  table: { label: 'Table', hint: 'Rows and columns', icon: Table2 },
  text: { label: 'Text', hint: 'Notes and headings', icon: Type },
};

/** Widths (of 12 columns) and heights (rows) people pick from; an older value outside them stays listed. */
const WIDTHS: [number, string][] = [
  [3, 'Quarter'],
  [4, 'Third'],
  [6, 'Half'],
  [8, 'Two thirds'],
  [12, 'Full width'],
];
const HEIGHTS: [number, string][] = [
  [1, 'Short'],
  [2, 'Medium'],
  [3, 'Tall'],
  [4, 'Taller'],
  [6, 'Very tall'],
];
const sizeOptions = (
  presets: [number, string][],
  current: number,
  fallback: (n: number) => string,
) => [
  ...(presets.some(([n]) => n === current)
    ? []
    : [{ value: String(current), label: fallback(current) }]),
  ...presets.map(([n, label]) => ({ value: String(n), label })),
];

/** The column a new chart groups by: the first one that is not an id, which reads better than a code. */
const defaultGroupColumn = (ds?: DatasetDto) =>
  ds?.columns.find((c) => !/(^|_)id$/i.test(c)) ?? ds?.columns[0] ?? '';

const DATASET_TYPES: string[] = ['kpi', 'gauge', 'line', 'area', 'bar', 'pie'];

/** Work-item query: what to measure, how to split it, and which items count. */
function WorkFields({
  q,
  setQ,
  type,
}: {
  q: Record<string, unknown>;
  setQ(p: Record<string, unknown>): void;
  type: string;
}) {
  const timed = type === 'line' || type === 'area';
  const grouped = type === 'bar' || type === 'pie';
  const opt = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
  return (
    <>
      <Field row label="Measure">
        <Listbox
          label="Measure"
          value={(q.measure as string) ?? 'count'}
          onChange={(v) => setQ({ measure: v })}
          options={opt([
            ['count', 'Number of items'],
            ['avg_first_response_hours', 'Average first response (hours)'],
            ['avg_resolve_hours', 'Average time to resolve (hours)'],
          ])}
        />
      </Field>
      {grouped && (
        <Field row label="Group by">
          <Listbox
            label="Group by"
            value={(q.by as string) ?? 'state'}
            onChange={(v) => setQ({ by: v })}
            options={opt([
              ['state', 'Status'],
              ['priority', 'Priority'],
              ['assignee', 'Assignee'],
              ['type', 'Type'],
            ])}
          />
        </Field>
      )}
      {timed && (
        <Field row label="Per">
          <Listbox
            label="Per"
            value={(q.by as string) ?? 'day'}
            onChange={(v) => setQ({ by: v })}
            options={opt([
              ['day', 'Day'],
              ['week', 'Week'],
              ['month', 'Month'],
            ])}
          />
        </Field>
      )}
      <Field row label="Items">
        <Listbox
          label="Items"
          value={q.breached ? 'breached' : q.overdue ? 'overdue' : ((q.state as string) ?? 'any')}
          onChange={(v) =>
            setQ({
              state: v === 'open' || v === 'done' ? v : 'any',
              overdue: v === 'overdue' || undefined,
              breached: v === 'breached' || undefined,
            })
          }
          options={opt([
            ['any', 'All'],
            ['open', 'Open'],
            ['done', 'Resolved'],
            ['overdue', 'Overdue'],
            ['breached', 'Past SLA'],
          ])}
        />
      </Field>
    </>
  );
}

/** Dataset query: a value column (or row count), grouped by a column or over time. */
function DatasetFields({
  q,
  setQ,
  type,
  datasets,
}: {
  q: Record<string, unknown>;
  setQ(p: Record<string, unknown>): void;
  type: string;
  datasets: DatasetDto[];
}) {
  const { tenantId, project, can } = useProject();
  const ds = datasets.find((d) => d.key === q.dataset) ?? null;
  const cols = ds?.columns ?? [];
  // Where the database can work a value out, a widget may write it as SQL.
  const conns = useQuery({
    queryKey: ['connections', tenantId, project.key],
    queryFn: () => api.connections(tenantId, project.key),
    enabled: can('manager'),
  });
  const connKind =
    ds?.source.type === 'connection'
      ? conns.data?.find((c) => c.key === (ds.source as { connection: string }).connection)?.kind
      : undefined;
  const sqlOk = connKind === 'postgres' || connKind === 'redshift';
  const sqlMode = q.expression !== undefined;
  const expressionProblem =
    q.expression === undefined ? null : metricExpressionProblem(q.expression as string);
  const [checked, setChecked] = useState<{ ok: boolean; text: string } | 'busy' | null>(null);
  const colOptions = (none?: string) => [
    ...(none ? [{ value: '', label: none }] : []),
    ...cols.map((c) => ({ value: c, label: c })),
  ];
  // A bar chart compares groups of a column, or time periods of a date column.
  const axis = type === 'bar' ? (q.timeColumn !== undefined ? 'time' : 'groups') : null;
  const timed = type === 'line' || type === 'area' || axis === 'time';
  const grouped = type === 'pie' || axis === 'groups';
  return (
    <>
      <Field row label="Dataset">
        <Listbox
          label="Dataset"
          value={(q.dataset as string) || null}
          onChange={(v) =>
            setQ({
              dataset: v,
              metric: undefined,
              expression: undefined,
              value: undefined,
              groupBy: grouped ? defaultGroupColumn(datasets.find((d) => d.key === v)) : undefined,
              thenBy: undefined,
              timeColumn: timed
                ? (datasets.find((d) => d.key === v)?.settings.timeColumn ?? '')
                : undefined,
            })
          }
          options={datasets.map((d) => ({
            value: d.key,
            label: d.name,
            description: `${d.rowCount.toLocaleString()} rows`,
          }))}
        />
      </Field>
      {type === 'bar' && (
        <Field row label="Bars compare" intro="What each bar stands for">
          <Listbox
            label="Bars compare"
            value={axis ?? 'groups'}
            onChange={(v) =>
              setQ(
                v === 'time'
                  ? {
                      timeColumn: ds?.settings.timeColumn ?? '',
                      interval: (q.interval as string) ?? 'week',
                      groupBy: undefined,
                      thenBy: undefined,
                    }
                  : {
                      groupBy: defaultGroupColumn(ds ?? undefined),
                      thenBy: undefined,
                      timeColumn: undefined,
                    },
              )
            }
            options={[
              { value: 'groups', label: 'Groups', description: 'One bar per value of a column' },
              {
                value: 'time',
                label: 'Time periods',
                description: 'One bar per day, week or month',
              },
            ]}
          />
        </Field>
      )}
      {sqlOk && (
        <div
          role="radiogroup"
          aria-label="How the value is worked out"
          className="col-span-full flex border border-zinc-300"
        >
          {(
            [
              ['column', 'Column'],
              ['sql', 'SQL expression'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={(id === 'sql') === sqlMode}
              onClick={() => {
                setChecked(null);
                setQ(
                  id === 'sql'
                    ? {
                        expression: (q.expression as string) ?? '',
                        metric: undefined,
                        value: undefined,
                        aggregation: 'count',
                      }
                    : { expression: undefined },
                );
              }}
              className={cx(
                'flex-1 px-3 py-1.5 text-sm',
                (id === 'sql') === sqlMode
                  ? 'bg-accent-600 font-medium text-on-accent'
                  : 'text-zinc-600 hover:bg-zinc-100',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {sqlMode ? (
        <div className="col-span-full">
          <Field
            label="Expression"
            intro="One aggregate over the dataset's columns, worked out by the database"
          >
            <Textarea
              aria-label="SQL expression"
              rows={3}
              className="font-mono"
              placeholder="sum(visits) / nullif(count(distinct facility_code), 0)"
              value={(q.expression as string) ?? ''}
              onChange={(e) => (setChecked(null), setQ({ expression: e.target.value }))}
            />
          </Field>
          {expressionProblem && (q.expression as string) && (
            <span role="alert" className="mt-1 block text-xs text-red-700">
              {expressionProblem}
            </span>
          )}
          <div className="mt-2 flex items-center gap-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={
                !!metricExpressionProblem((q.expression as string) ?? '') || checked === 'busy'
              }
              loading={checked === 'busy'}
              onClick={async () => {
                if (!ds || ds.source.type !== 'connection') return;
                setChecked('busy');
                try {
                  const inner = ds.source.sql.trim().replace(/[;\s]+$/, '');
                  const r = await api.runSql(tenantId, project.key, {
                    source: {
                      ...ds.source,
                      table: undefined,
                      sql: `select ${q.expression as string} as value from (${inner}) as t`,
                    },
                    limit: 1,
                    parameters: ds.settings.parameters,
                  });
                  const v = r.rows[0]?.value;
                  setChecked({
                    ok: true,
                    text:
                      v === null || v === undefined
                        ? 'It ran and gave no value'
                        : `It ran and gave ${String(v)}`,
                  });
                } catch (e) {
                  setChecked({
                    ok: false,
                    text: e instanceof Error ? e.message : 'It did not run',
                  });
                }
              }}
            >
              Check
            </Button>
            {checked && checked !== 'busy' && (
              <span
                className={cx('min-w-0 text-xs', checked.ok ? 'text-zinc-600' : 'text-red-700')}
              >
                {checked.text}
              </span>
            )}
          </div>
        </div>
      ) : (
        <>
          <Field
            row
            label="Value"
            intro={
              q.metric
                ? `Replaces the dataset metric “${q.metric as string}”`
                : 'A column to calculate from, or count rows'
            }
          >
            <Listbox
              label="Column"
              searchable
              placeholder="Number of rows"
              value={(q.value as string) ?? ''}
              onChange={(v) => {
                const fits = v ? aggregationsFor(columnKind(v, ds?.columnTypes[v])) : [];
                const cur = (q.aggregation as string) ?? 'sum';
                setQ({
                  metric: undefined,
                  value: v || undefined,
                  aggregation: v
                    ? (fits as readonly string[]).includes(cur)
                      ? cur
                      : fits[0]!
                    : 'count',
                });
              }}
              options={columnOptions(cols, ds?.columnTypes ?? {}, undefined, 'Number of rows').map(
                (o) =>
                  o.value
                    ? {
                        ...o,
                        description: KIND_LABEL[columnKind(o.value, ds?.columnTypes[o.value])],
                      }
                    : o,
              )}
            />
          </Field>
          {q.value ? (
            <Field row label="Aggregation" intro="How the values combine">
              <Listbox
                label="Aggregation"
                value={(q.aggregation as string) ?? 'sum'}
                onChange={(v) => setQ({ aggregation: v })}
                options={aggregationOptions(
                  aggregationsFor(
                    columnKind(q.value as string, ds?.columnTypes[q.value as string]),
                  ),
                )}
              />
            </Field>
          ) : null}
        </>
      )}
      {grouped && (
        <Field row label="Group by" intro="Several read “first · second · third”">
          <Listbox
            label="Group by"
            value={null}
            values={[q.groupBy, ...[q.thenBy ?? []].flat()].filter(Boolean) as string[]}
            onChangeMany={(v) => {
              setQ({ groupBy: v[0] ?? '', thenBy: v.length > 2 ? v.slice(1) : v[1] });
            }}
            options={colOptions()}
            placeholder="Choose columns"
          />
        </Field>
      )}
      {timed && (
        <>
          <Field row label="Date column">
            <Listbox
              label="Date column"
              value={(q.timeColumn as string) ?? ''}
              onChange={(v) => setQ({ timeColumn: v || undefined })}
              options={colOptions()}
              placeholder="Choose a column"
            />
          </Field>
          <Field row label="Interval">
            <Listbox
              label="Interval"
              value={(q.interval as string) ?? 'day'}
              onChange={(v) => setQ({ interval: v })}
              options={['hour', 'day', 'week', 'month', 'year'].map((i) => ({
                value: i,
                label: i,
              }))}
            />
          </Field>
        </>
      )}
      {(grouped || timed) && (
        <Field row label="Show at most">
          <Input
            type="number"
            min={1}
            max={500}
            value={(q.limit as number) ?? 20}
            onChange={(e) => setQ({ limit: Number(e.target.value) })}
          />
        </Field>
      )}
      <Field row label="Only rows where" hint="Optional filter: column = value">
        <div className="flex gap-2">
          <Listbox
            label="Filter column"
            value={((q.filter as { column?: string } | undefined)?.column as string) ?? ''}
            onChange={(v) =>
              setQ({
                filter: v
                  ? {
                      column: v,
                      equals: (q.filter as { equals?: string } | undefined)?.equals ?? '',
                    }
                  : undefined,
              })
            }
            options={colOptions('No filter')}
            className="flex-1"
          />
          {!!(q.filter as { column?: string } | undefined)?.column && (
            <Input
              aria-label="Filter value"
              value={String((q.filter as { equals?: string }).equals ?? '')}
              onChange={(e) =>
                setQ({ filter: { ...(q.filter as object), equals: e.target.value } })
              }
              className="w-28"
            />
          )}
        </div>
      </Field>
    </>
  );
}

function NewDashboard({ onClose, onCreated }: { onClose(): void; onCreated(key: string): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('layout-dashboard');
  const [group, setGroup] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const groups = usePermissionGroups();
  const existing = qc.getQueryData<DashboardDto[]>(['dashboards', tenantId, project.key]) ?? [];
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'd_$1')
      .slice(0, 55) || 'dashboard';
  let key = base;
  for (let n = 2; existing.some((d) => d.key === key); n++) key = `${base}_${n}`;
  const create = useMutation({
    mutationFn: () =>
      api.saveDashboard(tenantId, project.key, {
        key,
        name,
        description,
        icon,
        widgets: [],
        permissionGroup: group,
        isPublic,
      }),
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
      <div className="space-y-5">
        <ErrorNotice error={create.error} />
        <Field label="Name" intro="Shown in the list and at the top">
          <Input icon={Type} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Description" intro="One line under the name">
          <Textarea
            value={description}
            className="min-h-16"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <IconPicker
          label="Icon"
          intro="Beside the name in menus"
          value={icon}
          color={project.color}
          onChange={setIcon}
        />
        <Field label="Who can see it" intro="Members at this level of the hierarchy or above">
          <Select
            icon={Lock}
            value={group ?? ''}
            onChange={(e) => setGroup(e.target.value || null)}
          >
            <option value="">Everyone in the project</option>
            {groups.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {'  '.repeat(g.depth)}
                {g.name} and above
              </option>
            ))}
          </Select>
        </Field>
        <SettingRow
          icon={Globe}
          label="Public link"
          hint={
            project.visibility === 'public'
              ? 'Visible without signing in'
              : 'Needs a public project'
          }
        >
          <Switch label="Public link" checked={isPublic} onChange={setIsPublic} />
        </SettingRow>
      </div>
    </Dialog>
  );
}

/** An on/off setting: name and a line of help on the left, the switch on the right. */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange(v: boolean): void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border border-zinc-200 px-3 py-2.5">
      <div className="min-w-0 text-sm leading-tight">
        <div className="font-medium text-ink">{label}</div>
        {description && <div className="mt-0.5 text-xs text-zinc-500">{description}</div>}
      </div>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

/** One setting: icon, name and a line of help on the left, its control on the right. */
function SettingRow({
  icon: Icon,
  label,
  hint,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 ">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
        <div className="text-sm leading-tight">
          <div className="font-medium text-ink">{label}</div>
          <div className="mt-0.5 text-xs text-zinc-500">{hint}</div>
        </div>
      </div>
      <div className="flex shrink-0 justify-end">{children}</div>
    </div>
  );
}

/** Dashboard settings in one window: general, filters, access and delete. */
function DashboardSettings({
  draft,
  setDraft,
  datasets,
  types,
  publicVisible,
  color,
  publicUrl,
  saving,
  onClose,
  onSave,
}: {
  draft: DashboardDto;
  setDraft(d: DashboardDto): void;
  datasets: DatasetDto[];
  types: { key: string; name: string }[];
  publicVisible: boolean;
  color: string;
  publicUrl: string;
  saving?: boolean;
  onClose(): void;
  onSave(): void;
}) {
  const groups = usePermissionGroups();
  return (
    <Dialog
      open
      onClose={onClose}
      title="Dashboard settings"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} loading={saving} disabled={!draft.name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Name" intro="Shown in the list and at the top">
          <Input
            icon={Type}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label="Description" intro="One line under the name">
          <Textarea
            value={draft.description}
            className="min-h-16"
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </Field>
        <IconPicker
          label="Icon"
          intro="Beside the name in menus"
          value={draft.icon}
          color={color}
          onChange={(icon) => setDraft({ ...draft, icon })}
        />
        <div className="space-y-5 border-t border-zinc-200 pt-4">
          <SettingRow
            icon={CalendarRange}
            label="Period filter"
            hint="Viewers choose the time window"
          >
            <Switch
              label="Period filter"
              checked={draft.filters.period}
              onChange={(v: boolean) =>
                setDraft({ ...draft, filters: { ...draft.filters, period: v } })
              }
            />
          </SettingRow>
          <Field label="Area filter" intro="Viewers pick one area; widgets show only that area">
            <Select
              icon={MapPin}
              value={draft.filters.areaType ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  filters: { ...draft.filters, areaType: e.target.value || null },
                })
              }
            >
              <option value="">None</option>
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          {draft.filters.areaType && (
            <Field
              label="Also at these levels"
              intro="Viewers can pick an area at these too, and widgets can show at one level only"
            >
              <Listbox
                label="Also at these levels"
                value={null}
                values={draft.filters.areaTypes}
                onChangeMany={(v) =>
                  setDraft({ ...draft, filters: { ...draft.filters, areaTypes: v } })
                }
                options={types
                  .filter((t) => t.key !== draft.filters.areaType)
                  .map((t) => ({ value: t.key, label: t.name }))}
                placeholder="Just the area level"
              />
            </Field>
          )}
          <ColumnFiltersEditor draft={draft} setDraft={setDraft} datasets={datasets} />
        </div>
        <div className="space-y-5 border-t border-zinc-200 pt-4">
          <Field label="Who can see it" intro="Members at this level of the hierarchy or above">
            <Select
              icon={Lock}
              value={draft.permissionGroup ?? ''}
              onChange={(e) => setDraft({ ...draft, permissionGroup: e.target.value || null })}
            >
              <option value="">Everyone in the project</option>
              {groups.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {'  '.repeat(g.depth)}
                  {g.name} and above
                </option>
              ))}
            </Select>
          </Field>
          <SettingRow
            icon={Globe}
            label="Public link"
            hint={publicVisible ? 'Visible without signing in' : 'Needs a public project'}
          >
            <Switch
              label="Public link"
              checked={draft.isPublic}
              onChange={(v: boolean) => setDraft({ ...draft, isPublic: v })}
            />
          </SettingRow>
          {draft.isPublic && publicVisible && <CopyField value={publicUrl} />}
        </div>
      </div>
    </Dialog>
  );
}

/** A titled panel: icon square, title and one line, then the fields. */
function PanelSection({
  icon: Icon,
  title,
  about,
  className,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  about: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cx('border border-zinc-200 bg-snow', className)}>
      <header className="flex items-center gap-3 border-b border-zinc-100 px-5 py-3.5">
        <span className="flex size-8 shrink-0 items-center justify-center bg-accent-50 text-accent-700">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs text-zinc-500">{about}</p>
        </div>
      </header>
      <div className="space-y-5 p-5">{children}</div>
    </section>
  );
}

/** Builds a widget and its query from the project's data model (no SQL). */
function WidgetEditor({
  initial,
  levelOptions,
  onClose,
  onSave,
  onDelete,
}: {
  initial: Widget | null;
  /** The levels of the hierarchy the dashboard's area filter offers (none: no area filter). */
  levelOptions: { value: string; label: string; description?: string }[];
  onClose(): void;
  onSave(w: Widget): void;
  onDelete?(): void;
}) {
  const { tenantId, project } = useProject();
  const names = useElementNames();
  const [picked, setPicked] = useState(false);
  const types = useQuery({
    queryKey: ['types', tenantId, project.key],
    queryFn: () => api.types(tenantId, project.key),
  });
  const elements = useQuery({
    queryKey: ['elements', tenantId, project.key],
    queryFn: () => api.elements(tenantId, project.key),
  });
  const datasets = useQuery({
    queryKey: ['datasets', tenantId, project.key],
    queryFn: () => api.datasets(tenantId, project.key),
  });
  const [w, setW] = useState<WidgetInput>(
    initial ?? {
      id: `w${Date.now().toString(36)}`,
      type: 'kpi',
      title: '',
      w: 4,
      h: 2,
      options: {},
      query: { kind: 'kpi', aggregation: 'sum', range: { lastHours: 24 * 30 } },
    },
  );
  const q = (w.query ?? {}) as Record<string, unknown> & { kind?: string };
  const setQ = (patch: Record<string, unknown>) =>
    setW({ ...w, query: { ...q, ...patch } as QuerySpecInput });
  const setO = (patch: Record<string, unknown>) =>
    setW({ ...w, options: { ...w.options, ...patch } });
  const firstNumber = () =>
    elements.data?.find((e) => e.valueType === 'number') ?? elements.data?.[0];
  const kindFor = (type: string) =>
    ({
      kpi: 'kpi',
      gauge: 'kpi',
      line: 'series',
      area: 'series',
      bar: q.kind === 'series' ? 'series' : 'breakdown',
      pie: 'breakdown',
      matrix: 'breakdown',
      map: 'geo',
      table: 'table',
      text: null,
    })[type] ?? null;
  const changeType = (type: Widget['type'], source?: 'model') => {
    const kind =
      source !== 'model' && q.kind === 'dataset' && DATASET_TYPES.includes(type)
        ? 'dataset'
        : kindFor(type);
    const defaults: Record<string, QuerySpecInput> = {
      kpi: { kind: 'kpi', aggregation: 'sum', range: { lastHours: 24 * 30 } },
      series: {
        kind: 'series',
        elements: firstNumber() ? [firstNumber()!.ref] : [],
        aggregation: 'sum',
        interval: 'day',
        range: { lastHours: 24 * 30 },
      },
      breakdown: {
        kind: 'breakdown',
        by: 'parent',
        aggregation: 'sum',
        range: { lastHours: 24 * 30 },
      },
      geo: { kind: 'geo', entityType: types.data?.find((t) => t.geometry !== 'none')?.key },
      table: { kind: 'table', source: 'entities', limit: 50 },
      dataset: q as QuerySpecInput,
    };
    setW({
      ...w,
      type,
      query: kind
        ? q.kind === kind
          ? ((kind === 'dataset'
              ? {
                  ...q,
                  // A time axis only suits lines, areas and bars; groups only bars and pies.
                  ...(type === 'pie' || type === 'kpi' || type === 'gauge'
                    ? { timeColumn: undefined }
                    : {}),
                  ...(type === 'line' || type === 'area' || type === 'kpi' || type === 'gauge'
                    ? { groupBy: undefined, thenBy: undefined }
                    : {}),
                  ...((type === 'pie' || type === 'bar') &&
                  q.timeColumn === undefined &&
                  q.groupBy === undefined
                    ? { groupBy: '' }
                    : {}),
                  ...((type === 'line' || type === 'area') && q.timeColumn === undefined
                    ? { timeColumn: '' }
                    : {}),
                }
              : q) as QuerySpecInput)
          : defaults[kind]
        : undefined,
      // A new widget takes the usual size for its type; changing the source or editing one keeps its size.
      ...(source || initial
        ? {}
        : {
            w:
              type === 'kpi'
                ? 3
                : type === 'gauge'
                  ? 4
                  : type === 'map' || type === 'table' || type === 'matrix'
                    ? 12
                    : 6,
            h: type === 'kpi' ? 1 : type === 'gauge' ? 2 : 3,
          }),
    });
  };
  const setBarKind = (kind: 'breakdown' | 'series') =>
    setW({
      ...w,
      query:
        kind === 'series'
          ? {
              kind: 'series',
              elements: firstNumber() ? [firstNumber()!.ref] : [],
              aggregation: 'sum',
              interval: 'week',
              range: { lastHours: 24 * 90 },
            }
          : { kind: 'breakdown', by: 'parent', aggregation: 'sum', range: { lastHours: 24 * 30 } },
    });
  const Thresholds = () => (
    <>
      <Field label="Warning at ≥" intro="Turns amber from this value">
        <Input
          type="number"
          step="any"
          value={w.options?.warn ?? ''}
          onChange={(e) =>
            setO({ warn: e.target.value === '' ? undefined : Number(e.target.value) })
          }
        />
      </Field>
      <Field label="Alert at ≥" intro="Turns red from this value">
        <Input
          type="number"
          step="any"
          value={w.options?.alert ?? ''}
          onChange={(e) =>
            setO({ alert: e.target.value === '' ? undefined : Number(e.target.value) })
          }
        />
      </Field>
    </>
  );
  const range = (q.range ?? {}) as { lastHours?: number; lastMinutes?: number };
  const rangeDays = range.lastMinutes ? range.lastMinutes / 1440 : (range.lastHours ?? 720) / 24;

  const El = ({
    label,
    value,
    onChange,
    optional,
    intro = 'What to measure',
  }: {
    label: string;
    intro?: string;
    value?: string;
    onChange(v: string | undefined): void;
    optional?: string;
  }) => (
    <Field row label={label} intro={intro}>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        {optional && <option value="">{optional}</option>}
        {elements.data?.map((e) => (
          <option key={e.ref} value={e.ref}>
            {e.name}
            {e.group === 'general' ? '' : ` (${e.groupName})`}
          </option>
        ))}
      </Select>
    </Field>
  );
  const TypeSel = ({ geoOnly }: { geoOnly?: boolean }) => (
    <Field row label="Entity type" intro="Which kind of thing it counts">
      <Select
        value={(q.entityType as string) ?? ''}
        onChange={(e) => setQ({ entityType: e.target.value || undefined })}
      >
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
    <Field row label="Aggregation" intro="How values are combined">
      <Listbox
        label="Aggregation"
        value={(q.aggregation as string) ?? 'sum'}
        onChange={(v) => setQ({ aggregation: v })}
        options={aggregationOptions(AGGREGATIONS)}
      />
    </Field>
  );
  const Range = () => (
    <Field row label="Period (days)" intro="How far back, ending now">
      <Input
        type="number"
        min={0.01}
        step="any"
        value={rangeDays}
        onChange={(e) =>
          setQ({ range: { lastHours: Math.max(1, Math.round(Number(e.target.value) * 24)) } })
        }
      />
    </Field>
  );

  if (!initial && !picked)
    return (
      <Dialog open wide onClose={onClose} title="Add widget" description="Pick what it shows.">
        <div className="flex flex-wrap justify-center gap-3">
          {WIDGET_TYPES.map((t) => {
            const I = TYPE_INFO[t].icon;
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  changeType(t);
                  setPicked(true);
                }}
                className="flex w-[calc(50%-0.375rem)] flex-col items-start gap-2 border border-zinc-200 bg-snow p-4 text-start hover:border-accent-600 hover:bg-accent-50 sm:w-[calc(25%-0.5625rem)]"
              >
                <I className="size-6 text-accent-700" aria-hidden />
                <span className="text-sm font-medium">{TYPE_INFO[t].label}</span>
                <span className="text-xs text-zinc-500">{TYPE_INFO[t].hint}</span>
              </button>
            );
          })}
        </div>
      </Dialog>
    );

  return (
    <Dialog
      open
      wide="full"
      onClose={onClose}
      title={w.title || (initial ? 'Edit widget' : 'New widget')}
      description={TYPE_INFO[w.type].label}
      footer={
        <>
          {initial && onDelete && (
            <Button variant="danger" icon={Trash2} className="me-auto" onClick={onDelete}>
              Delete widget
            </Button>
          )}
          {!initial && (
            <Button
              variant="ghost"
              icon={ArrowLeft}
              className="me-auto"
              onClick={() => setPicked(false)}
            >
              Types
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(w as Widget)}>Apply</Button>
        </>
      }
    >
      <div className="grid gap-6 lg:h-[min(72vh,720px)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-h-0 min-w-0 flex-col border border-zinc-200 bg-zinc-50 lg:order-2">
          <header className="flex items-center gap-3 border-b border-zinc-100 px-5 py-3.5">
            <span className="flex size-8 shrink-0 items-center justify-center bg-accent-50 text-accent-700">
              <Eye className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">Preview</h3>
              <p className="mt-0.5 text-xs text-zinc-500">How it looks</p>
            </div>
          </header>
          <div
            className={cx(
              'min-h-64 flex-1 p-5',
              !['kpi', 'text'].includes(w.type) && '[&>section]:h-full',
            )}
          >
            <WidgetView
              square
              expandable={false}
              widget={w as Widget}
              names={names}
              queryKey={[
                'widget-preview',
                tenantId,
                project.key,
                w.id,
                w.type,
                JSON.stringify(w.query),
              ]}
              load={() => api.query(tenantId, project.key, w.query as QuerySpecInput)}
            />
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-col gap-6 overflow-y-auto pe-1 lg:order-1">
          <PanelSection className="order-2" icon={Palette} title="Display" about="Name and size">
            <Field label="Title" intro="Shown above the visual">
              <Input value={w.title} onChange={(e) => setW({ ...w, title: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Width" intro="How much of the row">
                <Listbox
                  label="Width"
                  value={String(w.w ?? 4)}
                  onChange={(v) => setW({ ...w, w: Number(v) })}
                  options={sizeOptions(WIDTHS, w.w ?? 4, (n) => `${n} of 12`)}
                />
              </Field>
              <Field label="Height" intro="How tall">
                <Listbox
                  label="Height"
                  value={String(w.h ?? 2)}
                  onChange={(v) => setW({ ...w, h: Number(v) })}
                  options={sizeOptions(HEIGHTS, w.h ?? 2, (n) => `${n} rows`)}
                />
              </Field>
            </div>
            <div className="space-y-5 border-t border-zinc-200 pt-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Unit" intro="Shown after the value, e.g. %">
                  <Input
                    value={w.options?.unit ?? ''}
                    onChange={(e) => setO({ unit: e.target.value || undefined })}
                  />
                </Field>
                <Field label="Decimals" intro="Digits after the point">
                  <Input
                    type="number"
                    min={0}
                    max={6}
                    value={w.options?.decimals ?? ''}
                    onChange={(e) =>
                      setO({
                        decimals: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <div className="space-y-4 border-t border-zinc-200 pt-4">
                <div className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">
                  Look
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ColourChoice
                    label="Title colour"
                    intro="Theme colour if unset"
                    value={w.options?.titleColor}
                    onChange={(c) => setO({ titleColor: c })}
                  />
                  {(w.type === 'kpi' || w.type === 'gauge') && (
                    <ColourChoice
                      label="Value colour"
                      intro="Theme colour if unset"
                      value={w.options?.valueColor}
                      onChange={(c) => setO({ valueColor: c })}
                    />
                  )}
                </div>
                <div>
                  <div className="text-[13px] font-medium text-zinc-700">Alignment</div>
                  <div className="mb-1.5 text-xs text-zinc-500">Of the title and the value</div>
                  <div
                    role="radiogroup"
                    aria-label="Alignment"
                    className="inline-flex gap-0.5 bg-zinc-100 p-1"
                  >
                    {(
                      [
                        ['left', AlignLeft, 'Left'],
                        ['center', AlignCenter, 'Centre'],
                        ['right', AlignRight, 'Right'],
                      ] as const
                    ).map(([v, I, l]) => {
                      const on = (w.options?.align ?? 'left') === v;
                      return (
                        <button
                          key={v}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setO({ align: v === 'left' ? undefined : v })}
                          className={cx(
                            'flex items-center gap-1.5 px-3 py-1.5 text-sm',
                            on ? 'bg-snow font-medium shadow-sm' : 'text-zinc-600 hover:text-ink',
                          )}
                        >
                          <I className="size-4" /> {l}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {(w.type === 'line' ||
                  w.type === 'area' ||
                  w.type === 'bar' ||
                  w.type === 'pie') && (
                  <Field label="Legend" intro="Where the key to the colours sits">
                    <Select
                      value={w.options?.legend ?? (w.type === 'pie' ? 'bottom' : 'top')}
                      onChange={(e) => setO({ legend: e.target.value })}
                    >
                      <option value="bottom">Bottom</option>
                      <option value="top">Top</option>
                      <option value="right">Right</option>
                      <option value="hidden">Hidden</option>
                    </Select>
                  </Field>
                )}
                {q.kind === 'kpi' && q.element ? (
                  <div className="space-y-3 border-t border-zinc-200 pt-4">
                    <ToggleRow
                      label="Compare with previous period"
                      description="Shows the change since the last period of the same length"
                      checked={!!q.compare}
                      onChange={(v: boolean) => setQ({ compare: v })}
                    />
                    {!!q.compare && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Show" intro="What the change shows">
                          <Select
                            value={w.options?.compareShow ?? 'both'}
                            onChange={(e) =>
                              setO({
                                compareShow: e.target.value === 'both' ? undefined : e.target.value,
                              })
                            }
                          >
                            <option value="both">Change and percent</option>
                            <option value="change">Change only</option>
                            <option value="percent">Percent only</option>
                          </Select>
                        </Field>
                        <Field label="Label" intro="Words after the change; empty hides them">
                          <Input
                            value={w.options?.compareLabel ?? 'vs previous'}
                            onChange={(e) => setO({ compareLabel: e.target.value })}
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                ) : null}
                <div>
                  <div className="text-[13px] font-medium text-zinc-700">Info tip</div>
                  <div className="mb-1.5 text-xs text-zinc-500">
                    Shown when people hover the (i) beside the title
                  </div>
                  <RichTextEditor
                    label="Info tip"
                    value={w.options?.info ?? ''}
                    onChange={(html) =>
                      setO({ info: html.replace(/<[^>]*>/g, '').trim() ? html : undefined })
                    }
                    placeholder="Explain how this is counted, with links to definitions…"
                  />
                </div>
              </div>
            </div>
          </PanelSection>
          <PanelSection
            className="order-3"
            icon={ShieldCheck}
            title="Rules and access"
            about="Who sees it and when it changes colour"
          >
            {levelOptions.length > 0 && (
              <Field
                label="Show at"
                intro="Only when the picked area is at these levels; none means always"
              >
                <Listbox
                  label="Show at"
                  value={null}
                  values={w.options?.levels ?? []}
                  onChangeMany={(v) => setO({ levels: v.length ? v : undefined })}
                  options={levelOptions}
                  placeholder="Every level"
                />
              </Field>
            )}
            <GroupSelect
              label="Who can see this widget"
              value={w.permissionGroup}
              onChange={(g) => setW({ ...w, permissionGroup: g ?? undefined })}
            />
            {w.type === 'gauge' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Thresholds />
              </div>
            )}
            {q.kind === 'kpi' && q.element ? (
              <ToggleRow
                label="Lower is better"
                description="A fall is shown as good news"
                checked={!!w.options?.invert}
                onChange={(v: boolean) => setO({ invert: v })}
              />
            ) : null}
          </PanelSection>
          <PanelSection
            className="order-1"
            icon={Database}
            title="Data"
            about="What the widget shows"
          >
            <Field label="Type" intro="What kind of visual it is">
              <Listbox
                label="Type"
                value={w.type}
                onChange={(t) => changeType(t)}
                options={WIDGET_TYPES.map((t) => ({
                  value: t,
                  label: TYPE_INFO[t].label,
                  description: TYPE_INFO[t].hint,
                  icon: TYPE_INFO[t].icon,
                }))}
              />
            </Field>
            {DATASET_TYPES.includes(w.type) && (
              <div className="space-y-2">
                <ChoiceCards
                  label="Data from"
                  intro="Where the numbers come from"
                  value={q.kind === 'dataset' ? 'dataset' : q.kind === 'work' ? 'work' : 'model'}
                  onChange={(v) => {
                    if (v === 'work')
                      setW({
                        ...w,
                        query: {
                          kind: 'work',
                          measure: 'count',
                          state: 'any',
                          ...(w.type === 'line' || w.type === 'area'
                            ? { by: 'day' }
                            : w.type === 'kpi' || w.type === 'gauge'
                              ? {}
                              : { by: 'state' }),
                        } as QuerySpecInput,
                      });
                    else if (v === 'dataset')
                      setW({
                        ...w,
                        query: {
                          kind: 'dataset',
                          dataset: datasets.data?.[0]?.key ?? '',
                          aggregation: 'count',
                          ...(w.type === 'line' || w.type === 'area'
                            ? { timeColumn: datasets.data?.[0]?.settings.timeColumn ?? '' }
                            : w.type === 'kpi' || w.type === 'gauge'
                              ? {}
                              : { groupBy: defaultGroupColumn(datasets.data?.[0]) }),
                        } as QuerySpecInput,
                      });
                    else {
                      changeType(w.type, 'model');
                    }
                  }}
                  options={{
                    model: {
                      label: 'Indicators & entities',
                      text: 'Recorded values and places',
                      icon: Activity,
                    },
                    dataset: { label: 'A dataset', text: 'A saved table or query', icon: Table2 },
                    work: { label: 'Work items', text: 'Tickets and jobs', icon: ClipboardList },
                  }}
                />
                {q.kind === 'dataset' && !datasets.data?.length && (
                  <p className="text-xs text-amber-700">
                    No datasets yet: create one under Data › Datasets.
                  </p>
                )}
              </div>
            )}
            <div className="grid gap-4 border-t border-zinc-200 pt-4">
              {q.kind === 'work' && <WorkFields q={q} setQ={setQ} type={w.type} />}
              {q.kind === 'dataset' && (
                <DatasetFields q={q} setQ={setQ} type={w.type} datasets={datasets.data ?? []} />
              )}
              {w.type === 'text' && (
                <Field label="Text" intro="Shown in the widget">
                  <Textarea
                    value={w.text ?? ''}
                    onChange={(e) => setW({ ...w, text: e.target.value })}
                  />
                </Field>
              )}
              {q.kind === 'kpi' && (
                <>
                  <El
                    label="Value"
                    value={q.element as string}
                    onChange={(v) => setQ({ element: v })}
                    optional="Count of entities"
                  />
                  <TypeSel />
                  {q.element ? <Agg /> : null}
                  {q.element ? <Range /> : null}
                  {q.element ? (
                    <div className="space-y-3">
                      <ToggleRow
                        label="Latest value per entity"
                        description="Ignores older readings"
                        checked={!!q.latest}
                        onChange={(v: boolean) => setQ({ latest: v })}
                      />
                    </div>
                  ) : null}
                  {w.type === 'gauge' && (
                    <>
                      <Field row label="Dial maximum (target)" intro="The value at a full dial">
                        <Input
                          type="number"
                          step="any"
                          value={w.options?.max ?? ''}
                          onChange={(e) =>
                            setO({
                              max: e.target.value === '' ? undefined : Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                    </>
                  )}
                </>
              )}
              {w.type === 'bar' && (
                <Field row label="Bars compare" intro="What each bar stands for">
                  <Select
                    value={q.kind === 'series' ? 'series' : 'breakdown'}
                    onChange={(e) => setBarKind(e.target.value as 'breakdown' | 'series')}
                  >
                    <option value="breakdown">Categories</option>
                    <option value="series">Over time</option>
                  </Select>
                </Field>
              )}
              {(w.type === 'area' ||
                (w.type === 'bar' &&
                  (q.kind === 'series' || (q.elements as string[] | undefined)?.length))) && (
                <div>
                  <ToggleRow
                    label="Stacked"
                    description="Series pile up instead of sitting side by side"
                    checked={!!w.options?.stacked}
                    onChange={(v: boolean) => setO({ stacked: v })}
                  />
                </div>
              )}
              {q.kind === 'series' && (
                <>
                  <Field row label="Values" intro="Pick one or several indicators to plot">
                    <Listbox
                      label="Values"
                      searchable
                      value={null}
                      values={(q.elements as string[]) ?? []}
                      onChangeMany={(v) => setQ({ elements: v })}
                      placeholder="Choose indicators"
                      options={(elements.data ?? []).map((e) => ({
                        value: e.ref,
                        label: e.name,
                        description: e.group === 'general' ? undefined : e.groupName,
                      }))}
                    />
                  </Field>
                  <Agg />
                  <Field row label="Interval" intro="Size of each time step">
                    <Select
                      value={(q.interval as string) ?? 'day'}
                      onChange={(e) => setQ({ interval: e.target.value })}
                    >
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
                  <Field
                    row
                    label="Value"
                    intro="Pick one, or several to compare. None counts entities"
                  >
                    <Listbox
                      label="Value"
                      searchable
                      value={null}
                      values={
                        q.elements
                          ? (q.elements as string[])
                          : q.element
                            ? [q.element as string]
                            : []
                      }
                      onChangeMany={(v) =>
                        setQ(
                          v.length > 1
                            ? { elements: v, element: undefined }
                            : { elements: undefined, element: v[0] },
                        )
                      }
                      placeholder="Count of entities"
                      options={(elements.data ?? []).map((e) => ({
                        value: e.ref,
                        label: e.name,
                        description: e.group === 'general' ? undefined : e.groupName,
                      }))}
                    />
                  </Field>
                  <Field row label="Group by" intro="What splits the values">
                    <Select
                      value={(q.by as string) ?? 'parent'}
                      onChange={(e) => setQ({ by: e.target.value })}
                    >
                      <option value="parent">Parent</option>
                      <option value="attribute">Attribute</option>
                      <option value="entity">Entity</option>
                      <option value="type">Entity type</option>
                    </Select>
                  </Field>
                  {q.by === 'attribute' && (
                    <Field row label="Attribute" intro="Which attribute to use">
                      <Select
                        value={(q.attribute as string) ?? ''}
                        onChange={(e) => setQ({ attribute: e.target.value || undefined })}
                      >
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
                  <Field row label="Show top" intro="How many to show">
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={(q.limit as number) ?? 12}
                      onChange={(e) => setQ({ limit: Number(e.target.value) })}
                    />
                  </Field>
                  {w.type === 'bar' && (
                    <Field row label="Direction" intro="Which way the bars run">
                      <Select
                        value={w.options?.horizontal ? 'horizontal' : 'vertical'}
                        onChange={(e) => setO({ horizontal: e.target.value === 'horizontal' })}
                      >
                        <option value="vertical">Vertical</option>
                        <option value="horizontal">Horizontal</option>
                      </Select>
                    </Field>
                  )}
                </>
              )}
              {q.kind === 'geo' && (
                <>
                  <TypeSel geoOnly />
                  <El
                    label="Colour by latest value"
                    value={q.element as string}
                    onChange={(v) => setQ({ element: v })}
                    optional="Type colour"
                  />
                  <Field row label="Only updated within (minutes)" hint="For live layers">
                    <Input
                      type="number"
                      min={1}
                      value={(q.withinMinutes as number) ?? ''}
                      onChange={(e) =>
                        setQ({
                          withinMinutes: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    />
                  </Field>
                  <Field row label="Warning at ≥" intro="Turns amber from this value">
                    <Input
                      type="number"
                      step="any"
                      value={w.options?.warn ?? ''}
                      onChange={(e) =>
                        setO({ warn: e.target.value === '' ? undefined : Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field row label="Alert at ≥" intro="Turns red from this value">
                    <Input
                      type="number"
                      step="any"
                      value={w.options?.alert ?? ''}
                      onChange={(e) =>
                        setO({
                          alert: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field row label="Refresh every (seconds)" intro="How often it reloads">
                    <Input
                      type="number"
                      min={10}
                      value={w.options?.refreshSeconds ?? ''}
                      onChange={(e) =>
                        setO({
                          refreshSeconds: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    />
                  </Field>
                </>
              )}
              {q.kind === 'table' && (
                <>
                  <Field row label="Rows from">
                    <Select
                      value={(q.source as string) ?? 'entities'}
                      onChange={(e) => setQ({ source: e.target.value })}
                    >
                      <option value="entities">Entities</option>
                      <option value="dataset">Dataset</option>
                      <option value="observations">Latest observations</option>
                    </Select>
                  </Field>
                  {q.source === 'dataset' ? (
                    <Field row label="Dataset" intro="Where the rows come from">
                      <Select
                        value={(q.dataset as string) ?? ''}
                        onChange={(e) => setQ({ dataset: e.target.value || undefined })}
                      >
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
                  <Field
                    row
                    label="Columns"
                    hint="Comma-separated: name, code, parent, attribute keys"
                  >
                    <Input
                      value={((q.columns as string[]) ?? []).join(', ')}
                      onChange={(e) =>
                        setQ({
                          columns: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </Field>
                  <Field row label="Sort by" intro="Column to order by">
                    <Input
                      value={(q.sort as string) ?? ''}
                      onChange={(e) => setQ({ sort: e.target.value || undefined })}
                    />
                  </Field>
                  <Field row label="Rows" intro="How many rows to show">
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={(q.limit as number) ?? 50}
                      onChange={(e) => setQ({ limit: Number(e.target.value) })}
                    />
                  </Field>
                </>
              )}
            </div>
          </PanelSection>
        </div>
      </div>
    </Dialog>
  );
}

const SWATCHES = ['#0f1117', '#6b7280', '#0f62fe', '#2f7a63', '#d9822b', '#b42318', '#6929c4'];

/** A colour for text: the theme's default, a few swatches, or any hex. */
function ColourChoice({
  label,
  intro,
  value,
  onChange,
}: {
  label: string;
  intro?: string;
  value: string | undefined;
  onChange(c: string | undefined): void;
}) {
  return (
    <div>
      <div className="text-[13px] font-medium text-zinc-700">{label}</div>
      {intro && <div className="mb-1.5 text-xs text-zinc-500">{intro}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Default colour"
          aria-pressed={!value}
          onClick={() => onChange(undefined)}
          className={cx(
            'flex h-7 items-center border px-2.5 text-xs',
            !value
              ? 'border-accent-600 bg-accent-50 text-accent-800'
              : 'border-zinc-300 text-zinc-600 hover:border-zinc-500',
          )}
        >
          Default
        </button>
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Use ${c}`}
            aria-pressed={value?.toLowerCase() === c}
            onClick={() => onChange(c)}
            className="size-7 border border-black/10"
            style={{
              background: c,
              boxShadow:
                value?.toLowerCase() === c
                  ? '0 0 0 2px var(--color-snow), 0 0 0 4px var(--brand-600)'
                  : undefined,
            }}
          />
        ))}
        <input
          type="color"
          aria-label={`${label}: custom`}
          value={value ?? '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="size-7 cursor-pointer border border-zinc-300 bg-transparent p-0.5"
        />
      </div>
    </div>
  );
}

const FILTER_KIND_LABEL: Record<ColumnFilter['kind'], string> = {
  select: 'Pick one',
  multi: 'Pick several',
  text: 'Search text',
  range: 'Number range',
  date: 'Date range',
};

/** The filters viewers get on dataset columns, and which widgets each one applies to. */
function ColumnFiltersEditor({
  draft,
  setDraft,
  datasets,
}: {
  draft: DashboardDto;
  setDraft(d: DashboardDto): void;
  datasets: DatasetDto[];
}) {
  const list = draft.filters.columns;
  const set = (columns: ColumnFilter[]) =>
    setDraft({ ...draft, filters: { ...draft.filters, columns } });
  const [form, setForm] = useState<{ i: number | null; f: ColumnFilter } | null>(null);
  const add = () => {
    const ds = datasets[0];
    if (!ds) return;
    setForm({
      i: null,
      f: {
        id: `f${Math.random().toString(36).slice(2, 8)}`,
        label: ds.columns[0] ?? 'Filter',
        dataset: ds.key,
        column: ds.columns[0] ?? '',
        kind: 'select',
        scope: [],
        mode: 'rows',
      },
    });
  };
  // The dataset parameters that stand for a column, and are not filters here yet.
  const offers = datasets.flatMap((d) =>
    d.settings.parameters
      .filter((p) => p.column && !list.some((f) => f.dataset === d.key && f.param === p.name))
      .map((p) => ({
        value: `${d.key}\u0000${p.name}`,
        label: p.label || p.name,
        description: `${d.name} · matches ${p.column}`,
        icon: SlidersHorizontal,
      })),
  );
  const addFromParam = (v: string) => {
    const [dsKey, name] = v.split('\u0000');
    const d = datasets.find((x) => x.key === dsKey);
    const p = d?.settings.parameters.find((x) => x.name === name);
    const f = d && p ? filterFromParam(p, d.key) : null;
    // A dataset that runs for each viewer's values gets filters that do the same.
    if (f)
      set([
        ...list,
        {
          ...f,
          id: `${f.id}_${Math.random().toString(36).slice(2, 5)}`.slice(0, 30),
          mode: d?.settings.runPerViewer ? 'run' : 'rows',
        },
      ]);
  };
  return (
    <div className="space-y-2 sm:col-span-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-zinc-700">Column filters</p>
          <p className="text-xs text-zinc-500">
            Viewers filter the widgets that read a dataset by one of its columns
          </p>
        </div>
        <div className="flex items-center gap-2">
          {offers.length > 0 && (
            <Listbox
              searchable={offers.length > 6}
              label="From a dataset parameter"
              value={null}
              align="end"
              trigger={{
                className:
                  'inline-flex h-8 items-center gap-1.5 border border-zinc-300 bg-snow px-3 text-[13px] font-medium hover:border-zinc-500',
                children: (
                  <>
                    <SlidersHorizontal className="size-4" /> From a parameter{' '}
                    <ChevronDown className="size-3.5 text-zinc-500" />
                  </>
                ),
              }}
              options={offers}
              onChange={addFromParam}
            />
          )}
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={add}
            disabled={!datasets.length}
          >
            Add filter
          </Button>
        </div>
      </div>
      {!datasets.length && (
        <p className="text-xs text-zinc-500">No datasets yet: create one under Data › Datasets.</p>
      )}
      {list.length > 0 && (
        <ul className="divide-y divide-zinc-100 border border-zinc-200">
          {list.map((f, i) => {
            const ds = datasets.find((d) => d.key === f.dataset);
            return (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2.5">
                <Filter className="size-4 shrink-0 text-zinc-500" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{f.label}</div>
                  <div className="truncate text-xs text-zinc-500">
                    {ds?.name ?? f.dataset} · {f.column} · {FILTER_KIND_LABEL[f.kind]} ·{' '}
                    {f.scope.length === 0
                      ? 'All widgets'
                      : `${f.scope.length} widget${f.scope.length === 1 ? '' : 's'}`}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Edit ${f.label}`}
                  title="Edit"
                  className="p-1.5 text-zinc-500 hover:text-ink"
                  onClick={() => setForm({ i, f: structuredClone(f) })}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${f.label}`}
                  title="Remove"
                  className="p-1.5 text-zinc-500 hover:text-red-700"
                  onClick={async () => {
                    if (
                      await confirmDialog(
                        `Remove the filter “${f.label}”? Viewers will no longer see it.`,
                        {
                          confirmLabel: 'Remove filter',
                          danger: true,
                        },
                      )
                    )
                      set(list.filter((_, j) => j !== i));
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {form && (
        <FilterForm
          form={form}
          datasets={datasets}
          widgets={draft.widgets}
          onClose={() => setForm(null)}
          onSave={(f) => {
            set(form.i === null ? [...list, f] : list.map((x, j) => (j === form.i ? f : x)));
            setForm(null);
          }}
        />
      )}
    </div>
  );
}

/** One column filter in a window: what it filters, how viewers pick, and which widgets it reaches. */
function FilterForm({
  form,
  datasets,
  widgets,
  onClose,
  onSave,
}: {
  form: { i: number | null; f: ColumnFilter };
  datasets: DatasetDto[];
  widgets: Widget[];
  onClose(): void;
  onSave(f: ColumnFilter): void;
}) {
  const [f, setF] = useState(form.f);
  const patch = (p: Partial<ColumnFilter>) => setF((x) => ({ ...x, ...p }));
  const ds = datasets.find((d) => d.key === f.dataset);
  const readers = widgets.filter(
    (w) => (w.query as { dataset?: string } | undefined)?.dataset === f.dataset,
  );
  const resetToParam = () => {
    const p = ds?.settings.parameters.find((x) => x.name === f.param);
    const fresh = p ? filterFromParam(p, f.dataset) : null;
    if (fresh)
      patch({ default: fresh.default, column: fresh.column, kind: fresh.kind, part: fresh.part });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={form.i === null ? 'Add filter' : 'Edit filter'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!f.label.trim() || !f.column} onClick={() => onSave(f)}>
            {form.i === null ? 'Add filter' : 'Apply'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Label" hint="What viewers see">
          <Input value={f.label} onChange={(e) => patch({ label: e.target.value })} />
        </Field>
        <Field label="Dataset">
          <Select
            value={f.dataset}
            onChange={(e) => {
              const next = datasets.find((d) => d.key === e.target.value);
              patch({
                dataset: e.target.value,
                column: next?.columns[0] ?? '',
                scope: [],
                default: undefined,
              });
            }}
          >
            {datasets.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Column">
          <Select
            value={f.column}
            onChange={(e) =>
              patch({
                column: e.target.value,
                label: f.label === f.column ? e.target.value : f.label,
                default: undefined,
              })
            }
          >
            {(ds?.columns ?? [f.column]).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kind" hint="How viewers pick a value">
          <Select
            value={f.kind}
            onChange={(e) =>
              patch({ kind: e.target.value as ColumnFilter['kind'], default: undefined })
            }
          >
            {(Object.keys(FILTER_KIND_LABEL) as ColumnFilter['kind'][]).map((k) => (
              <option key={k} value={k}>
                {FILTER_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        {f.param && (
          <div className="space-y-3 border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 font-medium text-accent-800">
                <SlidersHorizontal className="size-3" /> From the parameter “{f.param}”
              </span>
              <button
                type="button"
                onClick={resetToParam}
                className="font-medium text-accent-700 hover:underline"
              >
                Use its default again
              </button>
            </div>
            {ds?.settings.runPerViewer && (
              <Field label="When a viewer changes it">
                <Select
                  value={f.mode}
                  onChange={(e) =>
                    patch({
                      mode: e.target.value as ColumnFilter['mode'],
                      ...(e.target.value === 'run' && f.kind === 'multi'
                        ? { kind: 'select' as const, default: undefined }
                        : {}),
                    })
                  }
                >
                  <option value="rows">Filter the stored rows</option>
                  <option value="run">Run the query again</option>
                </Select>
              </Field>
            )}
          </div>
        )}
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-zinc-700">Applies to</div>
          {readers.length === 0 ? (
            <p className="text-xs text-zinc-500">No widget reads this dataset yet</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--brand-600)]"
                  checked={f.scope.length === 0}
                  onChange={() => patch({ scope: [] })}
                />
                All widgets on this dataset
              </label>
              {readers.map((w) => (
                <label key={w.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--brand-600)]"
                    checked={f.scope.includes(w.id)}
                    onChange={() => {
                      const next = f.scope.includes(w.id)
                        ? f.scope.filter((x) => x !== w.id)
                        : [...f.scope, w.id];
                      patch({ scope: next.length === readers.length ? [] : next });
                    }}
                  />
                  {w.title || w.id}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
