import { z } from 'zod';
import { Key } from './common.js';
import { Freshness } from './projects.js';

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
  element: Key.optional(),
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
  element: Key.optional(),
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
  element: Key.optional(),
  /** Only features whose latest `element` value is this recent (live layers). */
  withinMinutes: z.number().int().min(1).max(525_600).optional(),
  limit: z.number().int().min(1).max(20000).default(5000),
});
export const TableQuery = Scope.extend({
  kind: z.literal('table'),
  source: z.enum(['entities', 'dataset', 'observations']).default('entities'),
  dataset: Key.optional(),
  element: Key.optional(),
  columns: z.array(z.string().max(63)).max(20).optional(),
  sort: z.string().max(63).optional(),
  desc: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(50),
});
/**
 * Aggregates a dataset's rows: a single value (KPI), grouped by a column (bar/pie),
 * or bucketed by a date column (line). Rows match the other kinds' shapes.
 */
export const DatasetQuery = z.object({
  kind: z.literal('dataset'),
  dataset: Key,
  /** Column to aggregate; omitted = count rows. */
  value: z.string().max(63).optional(),
  aggregation: Agg.default('sum'),
  groupBy: z.string().max(63).optional(),
  timeColumn: z.string().max(63).optional(),
  interval: z.enum(['minute', 'hour', 'day', 'week', 'month', 'year']).default('day'),
  filter: z.object({ column: z.string().max(63), equals: z.union([z.string(), z.number(), z.boolean()]) }).optional(),
  limit: z.number().int().min(1).max(500).default(20),
});
export const QuerySpec = z.discriminatedUnion('kind', [SeriesQuery, BreakdownQuery, KpiQuery, GeoQuerySpec, TableQuery, DatasetQuery]);
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
  permissionGroup: Key.optional(),
  options: z
    .object({
      unit: z.string().max(20).optional(),
      decimals: z.number().int().min(0).max(6).optional(),
      /** Thresholds for KPI/map colouring: value ≥ warn → amber, ≥ alert → red. */
      warn: z.number().optional(),
      alert: z.number().optional(),
      /** Lower is better (e.g. stock-outs) flips trend colours. */
      invert: z.boolean().optional(),
      stacked: z.boolean().optional(),
      /** Gauge: the value at a full dial (target). */
      max: z.number().optional(),
      horizontal: z.boolean().optional(),
      /** Map: auto-refresh seconds (live layers). */
      refreshSeconds: z.number().int().min(10).max(3600).optional(),
      labelAttribute: z.string().max(63).optional(),
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
export const DashboardFilters = z.object({
  areaType: Key.nullable().default(null),
  period: z.boolean().default(false),
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
    .refine((h) => (PERIOD_HOURS as readonly number[]).includes(h), 'Unsupported period')
    .optional(),
  /** A custom date range (inclusive days, UTC); overrides `hours`. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Time series bucket. */
  interval: z.enum(['minute', 'hour', 'day', 'week', 'month']).optional(),
});
export type DashboardParams = z.infer<typeof DashboardParams>;

/**
 * Binds parameter values into a widget's query. The explorer's selected place
 * (`entity`), or the dashboard's area filter when it offers one, replaces the
 * scope's ancestor. A period (`hours`, or `from`–`to`) replaces the time range of
 * time-based queries (not latest-value ones); `interval` re-buckets a series.
 * Entity type and other settings stay as the widget defines them.
 */
export function applyParams(spec: QuerySpec, params: DashboardParams, filters: DashboardFilters): QuerySpec {
  let out: QuerySpec = spec;
  // Datasets have no entity scope; only entity-based queries take the place filter.
  if (out.kind !== 'dataset') {
    if (params.entity) out = { ...out, ancestorId: params.entity } as QuerySpec;
    if (params.area && filters.areaType) out = { ...out, ancestorId: params.area } as QuerySpec;
  }
  const timed = 'range' in out && !('latest' in out && out.latest);
  if (timed && (params.from || params.to)) {
    const to = params.to ? new Date(`${params.to}T00:00:00Z`) : null;
    if (to) to.setUTCDate(to.getUTCDate() + 1);
    out = { ...out, range: { ...(params.from && { from: `${params.from}T00:00:00Z` }), ...(to && { to: to.toISOString() }), ...(!params.from && { lastHours: 24 * 365 }) } } as QuerySpec;
  } else if (timed && params.hours) out = { ...out, range: { lastHours: params.hours } } as QuerySpec;
  if (params.interval && out.kind === 'series') out = { ...out, interval: params.interval };
  return out;
}

export const DashboardInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  widgets: z.array(Widget).max(40).default([]),
  isPublic: z.boolean().default(false),
  filters: DashboardFilters.default({ areaType: null, period: false }),
  /** Only members of this permission group (or a group above it) see the dashboard. */
  permissionGroup: Key.nullable().default(null),
});
export type DashboardInput = z.input<typeof DashboardInput>;
export const DashboardDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
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
  }),
  project: z.object({ key: z.string(), name: z.string(), description: z.string(), color: z.string() }),
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
