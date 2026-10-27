import { z } from 'zod';
import { ElementRef, Key } from './common.js';
import { metricExpressionProblem, type DatasetParam } from './orchestration.js';
import { DEFAULT_REPORTING, ExplorerConfig, Freshness, ReportingConfig } from './projects.js';

// ---------------------------------------------------------------- query (M5)
// Declarative queries compiled server-side to SQL with tenant RLS and the
// caller's entity scope always applied; clients never send SQL.

const Range = z.object({
  /** Relative window ending now. */
  lastMinutes: z.number().int().min(1).max(24 * 60).optional(),
  lastHours: z.number().int().min(1).max(24 * 366).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
/** A test a dataset query adds on one column of the stored rows. Built from a dashboard's column filters, never sent by viewers. */
export const Condition = z.discriminatedUnion('op', [
  z.object({ op: z.literal('in'), column: z.string().max(63), values: z.array(z.string().max(200)).min(1).max(100) }),
  z.object({ op: z.literal('range'), column: z.string().max(63), min: z.number().optional(), max: z.number().optional() }),
  z.object({ op: z.literal('contains'), column: z.string().max(63), text: z.string().min(1).max(200) }),
  z.object({ op: z.literal('dates'), column: z.string().max(63), from: z.iso.date().optional(), to: z.iso.date().optional() }),
]);
export type Condition = z.infer<typeof Condition>;

const Scope = z.object({
  entityType: Key.optional(),
  /** Only this entity and its descendants. */
  ancestorId: z.uuid().optional(),
});
/** `distinct` counts distinct entities with a value (e.g. aircraft seen). */
export const AGGREGATIONS = ['sum', 'avg', 'min', 'max', 'count', 'distinct', 'last'] as const;
const Agg = z.enum(AGGREGATIONS);

export const SeriesQuery = Scope.extend({
  kind: z.literal('series'),
  elements: z.array(Key).min(1).max(8),
  aggregation: Agg.default('sum'),
  interval: z.enum(['minute', 'hour', 'day', 'week', 'month']).default('day'),
  range: Range.default({ lastHours: 24 * 30 }),
});
export const BreakdownQuery = Scope.extend({
  kind: z.literal('breakdown'),
  /** Data element to aggregate; omitted = count entities. */
  element: ElementRef.optional(),
  /** Several elements side by side (grouped/stacked bars, matrices); rows gain `key`. */
  elements: z.array(Key).min(1).max(12).optional(),
  aggregation: Agg.default('sum'),
  by: z.enum(['parent', 'attribute', 'entity', 'type']),
  attribute: Key.optional(),
  /** Latest value per entity instead of a time range. */
  latest: z.boolean().default(false),
  range: Range.default({ lastHours: 24 * 30 }),
  limit: z.number().int().min(1).max(100).default(12),
});
export const KpiQuery = Scope.extend({
  kind: z.literal('kpi'),
  element: ElementRef.optional(),
  aggregation: Agg.default('sum'),
  latest: z.boolean().default(false),
  /** Entity count filter on an attribute, e.g. on_ground = false. */
  where: z.object({ attribute: Key, equals: z.union([z.string(), z.number(), z.boolean()]) }).optional(),
  range: Range.default({ lastHours: 24 * 30 }),
  /** Also return the value for the previous window of equal length. */
  compare: z.boolean().default(false),
});
export const GeoQuerySpec = Scope.extend({
  kind: z.literal('geo'),
  /** Latest value attached to each feature (for colour/size). */
  element: ElementRef.optional(),
  /** Only features whose latest `element` value is this recent (live layers). */
  withinMinutes: z.number().int().min(1).max(525_600).optional(),
  limit: z.number().int().min(1).max(20000).default(5000),
});
export const TableQuery = Scope.extend({
  kind: z.literal('table'),
  source: z.enum(['entities', 'dataset', 'observations']).default('entities'),
  dataset: Key.optional(),
  element: ElementRef.optional(),
  columns: z.array(z.string().max(63)).max(20).optional(),
  sort: z.string().max(63).optional(),
  desc: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(50),
  /** Only rows that pass every condition (from the dashboard's column filters). */
  conditions: z.array(Condition).max(20).optional(),
  /** Values for the dataset's parameters, from a viewer's filters: the query is run again for them (the dataset must allow it). */
  params: z.record(z.string(), z.string().max(500)).optional(),
});
/**
 * Aggregates a dataset's rows: a single value (KPI), grouped by a column (bar/pie),
 * or bucketed by a date column (line). Rows match the other kinds' shapes.
 */
export const DatasetQuery = z.object({
  kind: z.literal('dataset'),
  dataset: Key,
  /** A metric saved on the dataset (older dashboards; new ones say what to calculate in the widget). Replaces `value` and `aggregation`. */
  metric: z.string().max(63).optional(),
  /** A database dataset only: this SQL expression is the value (for example `sum(visits) / count(distinct clinic)`), worked out by the database. */
  expression: z
    .string()
    .trim()
    .max(500)
    .superRefine((e, ctx) => {
      const problem = metricExpressionProblem(e);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    })
    .optional(),
  /** Column to aggregate; omitted = count rows. */
  value: z.string().max(63).optional(),
  aggregation: Agg.default('sum'),
  groupBy: z.string().max(63).optional(),
  /** More columns to group by: each group is then named "first · second · third". One name or several. */
  thenBy: z.union([z.string().max(63), z.array(z.string().max(63)).max(4)]).optional(),
  timeColumn: z.string().max(63).optional(),
  /** Only rows whose time column falls in this window (set by the dashboard's period). */
  range: Range.optional(),
  interval: z.enum(['minute', 'hour', 'day', 'week', 'month', 'year']).default('day'),
  filter: z.object({ column: z.string().max(63), equals: z.union([z.string(), z.number(), z.boolean()]) }).optional(),
  /** Tests the widget's author set on columns: only rows that pass every one count. */
  filters: z.array(Condition).max(10).optional(),
  /** Only rows that pass every condition (from the dashboard's column filters). */
  conditions: z.array(Condition).max(20).optional(),
  /** Values for the dataset's parameters, from a viewer's filters: the query is run again for them (the dataset must allow it). */
  params: z.record(z.string(), z.string().max(500)).optional(),
  limit: z.number().int().min(1).max(500).default(20),
});
/**
 * Measures work (tickets, tasks, visits, maintenance): how many, how fast they were answered, how long they took.
 * With `by` a time it is a series (by when the work was opened); with another `by` a breakdown; without, one value.
 */
export const WORK_MEASURES = ['count', 'avg_first_response_hours', 'avg_resolve_hours'] as const;
export const WORK_GROUPS = ['state', 'priority', 'assignee', 'type', 'day', 'week', 'month'] as const;
export const WorkMetricQuery = Scope.extend({
  kind: z.literal('work'),
  measure: z.enum(WORK_MEASURES).default('count'),
  by: z.enum(WORK_GROUPS).optional(),
  type: Key.optional(),
  /** Which work counts: not yet finished, finished, or all. */
  state: z.enum(['any', 'open', 'done']).default('any'),
  /** Only work past its due date, or past a service time, and not finished. */
  overdue: z.boolean().optional(),
  breached: z.boolean().optional(),
  /** Counted by when it was opened. */
  range: Range.default({ lastHours: 24 * 30 }),
  /** Also return the value for the previous window of equal length (a single value only). */
  compare: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(12),
});
export const QuerySpec = z.discriminatedUnion('kind', [SeriesQuery, BreakdownQuery, KpiQuery, GeoQuerySpec, TableQuery, DatasetQuery, WorkMetricQuery]);
export type QuerySpec = z.infer<typeof QuerySpec>;
export type QuerySpecInput = z.input<typeof QuerySpec>;

export const QueryResult = z.object({
  kind: z.string(),
  /** series: [{t, key, value}] · breakdown: [{label, value}] (+ key with `elements`) · table: rows · kpi: [{value, previous}] */
  rows: z.array(z.record(z.string(), z.unknown())),
  /** geo only */
  features: z.any().optional(),
  columns: z.array(z.string()).optional(),
  freshness: Freshness,
});
export type QueryResult = z.infer<typeof QueryResult>;

// ---------------------------------------------------------------- dashboards

export const WIDGET_TYPES = ['kpi', 'line', 'area', 'bar', 'pie', 'gauge', 'matrix', 'map', 'table', 'text'] as const;
export const Widget = z.object({
  id: z.string().max(40),
  type: z.enum(WIDGET_TYPES),
  title: z.string().max(120).default(''),
  /** Grid width in 12ths, height in rows (~120px). */
  w: z.number().int().min(2).max(12).default(4),
  h: z.number().int().min(1).max(6).default(2),
  query: QuerySpec.optional(),
  /** Markdown-ish text for `text` widgets. */
  text: z.string().max(4000).optional(),
  /** Only members of this permission group (or a group above it) see the widget. */
  permissionGroup: z.uuid().optional(),
  options: z
    .object({
      unit: z.string().max(20).optional(),
      decimals: z.number().int().min(0).max(6).optional(),
      /** Thresholds for KPI/map colouring: value ≥ warn → amber, ≥ alert → red. */
      warn: z.number().optional(),
      alert: z.number().optional(),
      /** Lower is better (e.g. stock-outs) flips trend colours. */
      invert: z.boolean().optional(),
      /** KPI comparison chip: what it shows and the words after it (default "vs previous"). */
      compareShow: z.enum(['both', 'change', 'percent']).optional(),
      compareLabel: z.string().max(30).optional(),
      stacked: z.boolean().optional(),
      /** Show only when the picked area is of one of these entity types (`_none`: no area picked). Empty: always. */
      levels: z.array(z.string().max(63)).max(20).optional(),
      /** Where a chart's legend sits (pies default to the bottom, lines and bars to the top). */
      legend: z.enum(['top', 'bottom', 'right', 'hidden']).optional(),
      /** Gauge: the value at a full dial (target). */
      max: z.number().optional(),
      horizontal: z.boolean().optional(),
      /** Map: auto-refresh seconds (live layers). */
      refreshSeconds: z.number().int().min(10).max(3600).optional(),
      labelAttribute: z.string().max(63).optional(),
      /** Title and headline-value colours (#rrggbb); the theme's when unset. */
      titleColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      valueColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      /** Alignment of the title and, for KPIs and text, of the content. */
      align: z.enum(['left', 'center', 'right']).optional(),
      /** Rich text (b, i, u, links, lists) shown when people hover the (i) beside the title. */
      info: z.string().max(2000).optional(),
    })
    .default({}),
});
export type Widget = z.infer<typeof Widget>;
export type WidgetInput = z.input<typeof Widget>;

/**
 * Dashboard parameters shown in its header (spec §9): an area (an entity of
 * `areaType`; every widget is limited to its subtree) and a period (the window
 * of time-based widgets).
 */
/** What a viewer picked for a column filter: one value, several, a number range, or a date range. */
export const ColumnFilterValue = z.union([
  z.string().max(200),
  z.array(z.string().max(200)).max(100),
  z.strictObject({ min: z.number().optional(), max: z.number().optional() }),
  z.strictObject({ from: z.iso.date().optional(), to: z.iso.date().optional() }),
]);
export type ColumnFilterValue = z.infer<typeof ColumnFilterValue>;
export const COLUMN_FILTER_KINDS = ['select', 'multi', 'text', 'range', 'date'] as const;
export type ColumnFilterKind = (typeof COLUMN_FILTER_KINDS)[number];
/** A filter viewers use on one column of a dataset: it applies to the widgets reading that dataset. */
export const ColumnFilter = z.object({
  id: Key.max(30),
  label: z.string().trim().min(1).max(60),
  dataset: Key,
  column: z.string().min(1).max(63),
  kind: z.enum(COLUMN_FILTER_KINDS).default('select'),
  /** The widgets it applies to (their ids); none listed = every widget on the dataset. */
  scope: z.array(z.string().max(40)).max(40).default([]),
  /** What it starts as. */
  default: ColumnFilterValue.optional(),
  /** The dataset parameter this filter stands for (its default is where the filter starts). */
  param: z.string().max(63).optional(),
  /** Which part of a range the parameter takes: a date range's start or end, a number range's lowest or highest. */
  part: z.enum(['from', 'to', 'min', 'max']).optional(),
  /**
   * `rows` (the usual): the stored rows are filtered. `run`: the dataset's query is run again with the viewer's value
   * (the dataset must allow it), so the data itself is what is asked for.
   */
  mode: z.enum(['rows', 'run']).default('rows'),
});
export type ColumnFilter = z.infer<typeof ColumnFilter>;

/**
 * The dashboard filter a dataset parameter stands for: the column it matches, the kind of choice that fits its type,
 * and the parameter's default as where the filter starts. Null for a parameter not linked to a column.
 */
export function filterFromParam(p: DatasetParam, dataset: string): ColumnFilter | null {
  if (!p.column) return null;
  const v = p.default.trim();
  const compare = p.type === 'text' ? 'equals' : (p.compare ?? 'at_least');
  const base = { id: `p_${p.name}`.slice(0, 30), label: p.label || p.name, dataset, column: p.column, scope: [] as string[], param: p.name, mode: 'rows' as const };
  if (p.type === 'date') {
    const to = compare === 'at_most';
    return { ...base, kind: 'date', part: to ? 'to' : 'from', ...(v && { default: to ? { to: v } : { from: v } }) };
  }
  if (p.type === 'number') {
    if (compare === 'equals') return { ...base, kind: 'select', ...(v && { default: v }) };
    const n = Number(v);
    const max = compare === 'at_most';
    return { ...base, kind: 'range', part: max ? 'max' : 'min', ...(v && Number.isFinite(n) && { default: max ? { max: n } : { min: n } }) };
  }
  return { ...base, kind: 'select', ...(v && v !== p.any && { default: v }) };
}

export const DashboardFilters = z.object({
  areaType: Key.nullable().default(null),
  /** More levels of the hierarchy viewers can pick an area at, besides `areaType` (a widget can then show only at some levels). */
  areaTypes: z.array(Key).max(8).default([]),
  period: z.boolean().default(false),
  /** Filters on dataset columns, shown in the header. */
  columns: z.array(ColumnFilter).max(20).default([]),
});
export type DashboardFilters = z.infer<typeof DashboardFilters>;
/** Period choices, in hours. */
export const PERIOD_HOURS = [24, 24 * 7, 24 * 30, 24 * 90, 24 * 365] as const;
export const DashboardParams = z.object({
  /** The place selected on the explorer: always scopes every widget. */
  entity: z.uuid().optional(),
  area: z.uuid().optional(),
  hours: z.coerce
    .number()
    .int()
    .refine((h) => h >= 1 && h <= 3650 * 24, 'Unsupported period')
    .optional(),
  /** A custom date range (inclusive days, UTC); overrides `hours`. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Time series bucket. */
  interval: z.enum(['minute', 'hour', 'day', 'week', 'month']).optional(),
  /** The column filters' values as JSON, by filter id (null = cleared); filters left out use their default. */
  cf: z.string().max(4000).optional(),
});
export type DashboardParams = z.infer<typeof DashboardParams>;

/** A reporting period for map overlay values: a recent window, or a custom range of days (UTC). */
export const OverlayPeriod = z.object({
  hours: DashboardParams.shape.hours,
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type OverlayPeriod = z.infer<typeof OverlayPeriod>;

/**
 * Binds parameter values into a widget's query. The explorer's selected place
 * (`entity`), or the dashboard's area filter when it offers one, replaces the
 * scope's ancestor. A period (`hours`, or `from`–`to`) replaces the time range of
 * time-based queries (not latest-value ones); `interval` re-buckets a series.
 * Entity type and other settings stay as the widget defines them.
 */
export function applyParams(spec: QuerySpec, params: DashboardParams, filters: DashboardFilters, widgetId?: string): QuerySpec {
  let out: QuerySpec = spec;
  // Datasets have no entity scope; only entity-based queries take the place filter.
  if (out.kind !== 'dataset') {
    if (params.entity) out = { ...out, ancestorId: params.entity } as QuerySpec;
    if (params.area && filters.areaType) out = { ...out, ancestorId: params.area } as QuerySpec;
  }
  const timed = (('range' in out || out.kind === 'dataset') && !('latest' in out && out.latest));
  if (timed && (params.from || params.to)) {
    const to = params.to ? new Date(`${params.to}T00:00:00Z`) : null;
    if (to) to.setUTCDate(to.getUTCDate() + 1);
    out = { ...out, range: { ...(params.from && { from: `${params.from}T00:00:00Z` }), ...(to && { to: to.toISOString() }), ...(!params.from && { lastHours: 24 * 365 }) } } as QuerySpec;
  } else if (timed && params.hours) out = { ...out, range: { lastHours: params.hours } } as QuerySpec;
  if (params.interval && out.kind === 'series') out = { ...out, interval: params.interval };
  if (out.kind === 'dataset' || (out.kind === 'table' && out.source === 'dataset')) {
    const dataset = out.dataset;
    const conditions = dataset ? columnConditions(filters.columns ?? [], parseColumnValues(params.cf), dataset, widgetId) : [];
    if (conditions.length) out = { ...out, conditions: [...(out.conditions ?? []), ...conditions] };
    const run = dataset ? runValues(filters.columns ?? [], parseColumnValues(params.cf), dataset, widgetId) : {};
    if (Object.keys(run).length) out = { ...out, params: { ...(out.params ?? {}), ...run } };
  }
  return out;
}

/** The picked values of the column filters from the `cf` parameter; anything malformed is ignored. */
export function parseColumnValues(cf: string | undefined): Record<string, ColumnFilterValue | null> {
  if (!cf) return {};
  try {
    const parsed = z.record(z.string(), ColumnFilterValue.nullable()).safeParse(JSON.parse(cf));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Turns what viewers picked into conditions for one dataset (and widget; `'*'` ignores scope): a filter nobody touched uses its default. */
export function columnConditions(filters: ColumnFilter[], values: Record<string, ColumnFilterValue | null>, dataset: string, widgetId?: string): Condition[] {
  const out: Condition[] = [];
  for (const f of filters) {
    if (f.dataset !== dataset || f.mode === 'run') continue;
    if (f.scope.length && widgetId !== '*' && !(widgetId && f.scope.includes(widgetId))) continue;
    const v = f.id in values ? values[f.id] : (f.default ?? null);
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'string') out.push(f.kind === 'text' ? { op: 'contains', column: f.column, text: v } : { op: 'in', column: f.column, values: [v] });
    else if (Array.isArray(v)) {
      if (v.length) out.push({ op: 'in', column: f.column, values: v });
    } else if ('min' in v || 'max' in v) {
      const r = v as { min?: number; max?: number };
      if (r.min !== undefined || r.max !== undefined) out.push({ op: 'range', column: f.column, ...(r.min !== undefined && { min: r.min }), ...(r.max !== undefined && { max: r.max }) });
    } else {
      const r = v as { from?: string; to?: string };
      if (r.from || r.to) out.push({ op: 'dates', column: f.column, ...(r.from && { from: r.from }), ...(r.to && { to: r.to }) });
    }
  }
  return out;
}

/**
 * What a viewer picked on the filters that re-run a dataset, as the values of its parameters (by parameter name):
 * the start or end of a date range, the low or high end of a number range, or the text chosen. A filter left alone
 * gives its default; one the viewer cleared gives nothing, so the dataset's own default is used.
 */
export function runValues(filters: ColumnFilter[], values: Record<string, ColumnFilterValue | null>, dataset: string, widgetId?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of filters) {
    if (f.mode !== 'run' || !f.param || f.dataset !== dataset) continue;
    if (f.scope.length && widgetId !== '*' && !(widgetId && f.scope.includes(widgetId))) continue;
    const v = f.id in values ? values[f.id] : (f.default ?? null);
    if (v === null || v === undefined || v === '') continue;
    let one: string | number | undefined;
    if (typeof v === 'string') one = v;
    else if (Array.isArray(v)) one = v[0];
    else if ('min' in v || 'max' in v) one = f.part === 'max' ? (v as { max?: number }).max : (v as { min?: number }).min;
    else one = f.part === 'to' ? (v as { to?: string }).to : (v as { from?: string }).from;
    if (one !== undefined && one !== '') out[f.param] = String(one);
  }
  return out;
}

export const DashboardInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  /** Icon name, shown in the explorer's dashboard picker. */
  icon: z.string().max(40).default('layout-dashboard'),
  widgets: z.array(Widget).max(40).default([]),
  isPublic: z.boolean().default(false),
  filters: DashboardFilters.default({ areaType: null, areaTypes: [], period: false, columns: [] }),
  /** Only members of this permission group (or a group above it) see the dashboard. */
  permissionGroup: z.uuid().nullable().default(null),
});
export type DashboardInput = z.input<typeof DashboardInput>;
export const DashboardDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  widgets: z.array(Widget),
  isPublic: z.boolean(),
  filters: DashboardFilters,
  permissionGroup: z.string().nullable(),
  updatedAt: z.string(),
});
export type DashboardDto = z.infer<typeof DashboardDto>;

/** Anonymous view of a public project. */
export const PublicProjectDto = z.object({
  tenant: z.object({
    name: z.string(),
    slug: z.string(),
    logo: z.string().nullable(),
    primaryColor: z.string(),
    mapStyles: z.object({ light: z.string().nullable(), dark: z.string().nullable() }).default({ light: null, dark: null }),
    logoDark: z.string().nullable().default(null),
    favicon: z.string().nullable().default(null),
    chartColors: z.object({ mode: z.enum(['standard', 'brand', 'custom']), colors: z.array(z.string()) }).default({ mode: 'standard', colors: [] }),
    poweredBy: z.boolean().default(true),
    helpPosition: z.enum(['left', 'right']).default('left'),
    footer: z.string().default(''),
  }),
  project: z.object({ key: z.string(), name: z.string(), description: z.string(), color: z.string(), explorer: ExplorerConfig.default({ layout: 'both', hideOnLayer: true, panelStart: 'open' }), reporting: ReportingConfig.default(DEFAULT_REPORTING) }),
  dashboards: z.array(DashboardDto),
  /** Data element names, for chart legends. */
  elements: z.array(z.object({ key: z.string(), name: z.string(), unit: z.string() })).default([]),
});
export type PublicProjectDto = z.infer<typeof PublicProjectDto>;

/** A public project in the portal's catalogue. */
export const PublicProjectCard = z.object({
  tenant: z.object({ slug: z.string(), name: z.string(), logo: z.string().nullable(), primaryColor: z.string() }),
  project: z.object({
    key: z.string(),
    name: z.string(),
    description: z.string(),
    color: z.string(),
    icon: z.string(),
    logo: z.string().nullable(),
    coverImage: z.string().nullable(),
  }),
});
export type PublicProjectCard = z.infer<typeof PublicProjectCard>;
