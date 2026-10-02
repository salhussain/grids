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
export const QuerySpec = z.discriminatedUnion('kind', [SeriesQuery, BreakdownQuery, KpiQuery, GeoQuerySpec, TableQuery]);
export type QuerySpec = z.infer<typeof QuerySpec>;
export type QuerySpecInput = z.input<typeof QuerySpec>;

export const QueryResult = z.object({
  kind: z.string(),
  /** series: [{t, key, value}] · breakdown: [{label, value}] · table: rows · kpi: [{value, previous}] */
  rows: z.array(z.record(z.string(), z.unknown())),
  /** geo only */
  features: z.any().optional(),
  columns: z.array(z.string()).optional(),
  freshness: Freshness,
});
export type QueryResult = z.infer<typeof QueryResult>;

// ---------------------------------------------------------------- dashboards

export const WIDGET_TYPES = ['kpi', 'line', 'bar', 'pie', 'map', 'table', 'text'] as const;
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
      horizontal: z.boolean().optional(),
      /** Map: auto-refresh seconds (live layers). */
      refreshSeconds: z.number().int().min(10).max(3600).optional(),
      labelAttribute: z.string().max(63).optional(),
    })
    .default({}),
});
export type Widget = z.infer<typeof Widget>;
export type WidgetInput = z.input<typeof Widget>;

export const DashboardInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  widgets: z.array(Widget).max(40).default([]),
  isPublic: z.boolean().default(false),
});
export type DashboardInput = z.input<typeof DashboardInput>;
export const DashboardDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  widgets: z.array(Widget),
  isPublic: z.boolean(),
  updatedAt: z.string(),
});
export type DashboardDto = z.infer<typeof DashboardDto>;

/** Anonymous view of a public project. */
export const PublicProjectDto = z.object({
  tenant: z.object({ name: z.string(), slug: z.string(), logo: z.string().nullable(), primaryColor: z.string() }),
  project: z.object({ key: z.string(), name: z.string(), description: z.string(), color: z.string() }),
  dashboards: z.array(DashboardDto),
});
export type PublicProjectDto = z.infer<typeof PublicProjectDto>;
