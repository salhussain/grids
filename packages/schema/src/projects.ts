import { z } from 'zod';
import { DEFAULT_DATA_GROUP, ElementRef, Key, Slug } from './common.js';

// ---------------------------------------------------------------- projects (M3)

export const PROJECT_ROLES = ['manager', 'viewer'] as const;
export const ProjectRole = z.enum(PROJECT_ROLES);
export type ProjectRole = z.infer<typeof ProjectRole>;
/** What each project role can do (cumulative). */
export const PROJECT_ROLE_INFO: Record<ProjectRole, { label: string; description: string }> = {
  manager: { label: 'Manager', description: 'Configure the project, edit its data, run jobs and manage members. Comes from the Admin permission.' },
  viewer: { label: 'Member', description: 'Sees what their permission allows and fills in the forms it gives them.' },
};
export const roleAtLeast = (have: ProjectRole | null | undefined, need: ProjectRole) =>
  !!have && PROJECT_ROLES.indexOf(have) <= PROJECT_ROLES.indexOf(need);

export const ProjectVisibility = z.enum(['private', 'organisation', 'public']);
export type ProjectVisibility = z.infer<typeof ProjectVisibility>;

export const TEMPLATE_KEYS = ['blank', 'flight-tracker', 'hr-workforce', 'health-surveillance', 'helpdesk', 'fleet'] as const;
export const ProjectTemplate = z.enum(TEMPLATE_KEYS);
export type ProjectTemplate = z.infer<typeof ProjectTemplate>;

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const PROJECT_STATUSES = ['draft', 'live'] as const;
export const ProjectStatus = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof ProjectStatus>;
/** A data URL (PNG/JPEG/WebP/SVG) or an https URL. */
export const ProjectImage = z
  .string()
  .max(2_000_000)
  .regex(/^(data:image\/(png|jpeg|webp|svg\+xml);base64,|https:\/\/)/, 'PNG, JPEG, WebP or SVG image');

/** What people see when they open a project: the map, the dashboards, or both. */
export const EXPLORER_LAYOUTS = ['map', 'both', 'dashboard'] as const;
export const ExplorerConfig = z.object({
  layout: z.enum(EXPLORER_LAYOUTS).default('both'),
  /** With the map and dashboards together: turning a map layer on gives the map the whole view. */
  hideOnLayer: z.boolean().default(true),
  /** Whether the dashboard panel starts open or collapsed. */
  panelStart: z.enum(['open', 'collapsed']).default('open'),
});
export type ExplorerConfig = z.infer<typeof ExplorerConfig>;

/**
 * A reporting period a project offers in its dashboards and map layers: a window of hours, days, weeks,
 * months or years from now. A negative `n` looks back (-30 = the last 30), a positive one forward.
 */
export const REPORTING_UNITS = ['hours', 'days', 'weeks', 'months', 'years'] as const;
export const ReportingPeriod = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(40),
  unit: z.enum(REPORTING_UNITS),
  n: z.number().int().min(-3650).max(3650).refine((n) => n !== 0, 'Use a number other than 0'),
  /** Kept in the list but not offered to people. */
  hidden: z.boolean().optional(),
});
export type ReportingPeriod = z.infer<typeof ReportingPeriod>;
export const DEFAULT_REPORTING_PERIODS: ReportingPeriod[] = [
  { id: 'h24', label: '24 hours', unit: 'hours', n: -24 },
  { id: 'd7', label: '7 days', unit: 'days', n: -7 },
  { id: 'd30', label: '30 days', unit: 'days', n: -30 },
  { id: 'd90', label: '90 days', unit: 'days', n: -90 },
  { id: 'y1', label: '12 months', unit: 'years', n: -1 },
];
/** Seconds between refreshes people can choose from (0 = off). */
export const REFRESH_RATES = [0, 30, 60, 300, 900] as const;
/** How a project's dashboards and map layers refresh themselves: whether people see it, and the default. */
export const RefreshConfig = z.object({
  enabled: z.boolean().default(true),
  /** Seconds between refreshes when someone opens the project (0 = off). */
  every: z.number().int().refine((n) => (REFRESH_RATES as readonly number[]).includes(n), 'Unsupported rate').default(300),
  /** Stop refreshing while the tab is in the background. */
  pauseHidden: z.boolean().default(true),
});
export type RefreshConfig = z.infer<typeof RefreshConfig>;
/** The reporting periods a project offers (and whether the picker shows at all), and its auto-refresh. */
export const ReportingConfig = z.object({
  /** Whether people can pick a reporting period. */
  enabled: z.boolean().default(true),
  periods: z.array(ReportingPeriod).max(12).default(DEFAULT_REPORTING_PERIODS),
  /** Whether people may also pick their own dates. */
  allowCustom: z.boolean().default(true),
  refresh: RefreshConfig.default({ enabled: true, every: 300, pauseHidden: true }),
});
export type ReportingConfig = z.infer<typeof ReportingConfig>;
export const DEFAULT_REPORTING: ReportingConfig = { enabled: true, periods: DEFAULT_REPORTING_PERIODS, allowCustom: true, refresh: { enabled: true, every: 300, pauseHidden: true } };

export const ProjectInput = z.object({
  key: Slug.optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(10000).default(''),
  visibility: ProjectVisibility.default('private'),
  color: Hex.default('#0f62fe'),
  icon: z.string().max(40).default('folder'),
  template: ProjectTemplate.default('blank'),
  /** Draft projects are only visible to their managers until they go live. */
  status: ProjectStatus.default('live'),
  logo: ProjectImage.nullable().default(null),
  coverImage: ProjectImage.nullable().default(null),
  /** Organisation members to make project managers (besides the creator). */
  managerIds: z.array(z.uuid()).max(20).default([]),
  /** What people see when they open the project: the map, the dashboards, or both. */
  explorer: ExplorerConfig.default({ layout: 'both', hideOnLayer: true, panelStart: 'open' }),
  reporting: ReportingConfig.default(DEFAULT_REPORTING),
});
export type ProjectInput = z.input<typeof ProjectInput>;
/** Partial update: omitted fields stay as they are (no defaults). */
export const ProjectUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(10000).optional(),
  visibility: ProjectVisibility.optional(),
  color: Hex.optional(),
  icon: z.string().max(40).optional(),
  status: ProjectStatus.optional(),
  logo: ProjectImage.nullable().optional(),
  coverImage: ProjectImage.nullable().optional(),
  explorer: ExplorerConfig.partial().optional(),
  reporting: ReportingConfig.optional(),
});

export const Freshness = z.object({
  status: z.enum(['fresh', 'warning', 'stale', 'unknown']),
  lastUpdated: z.string().nullable(),
  expectedMinutes: z.number().nullable(),
  /** Read from the source when asked, so there is no age to measure: lastUpdated is when it was last queried. */
  live: z.boolean().optional(),
});
export type Freshness = z.infer<typeof Freshness>;

export const ProjectDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  visibility: ProjectVisibility,
  color: z.string(),
  icon: z.string(),
  template: z.string().nullable(),
  status: ProjectStatus,
  logo: z.string().nullable(),
  coverImage: z.string().nullable(),
  explorer: ExplorerConfig,
  reporting: ReportingConfig,
  myRole: ProjectRole.nullable(),
  counts: z.object({
    entities: z.number().int(),
    members: z.number().int(),
    jobs: z.number().int(),
    dashboards: z.number().int(),
    forms: z.number().int(),
  }),
  freshness: Freshness,
  createdAt: z.string(),
  updatedAt: z.string(),
  archived: z.boolean(),
});
export type ProjectDto = z.infer<typeof ProjectDto>;

export const ProjectMemberDto = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  role: ProjectRole,
  /** Entities the member is limited to (each with everything under it); empty = the whole project. */
  rootEntities: z.array(z.object({ id: z.string(), name: z.string(), type: z.string() })),
  /** Inherited from an organisation role rather than granted on the project. */
  implicit: z.boolean(),
  /** Permissions (ids) held; none = only unrestricted visuals (managers see everything). */
  permissionGroups: z.array(z.string()),
});
export type ProjectMemberDto = z.infer<typeof ProjectMemberDto>;
/** A member's project role follows their permission: the Admin permission makes a manager. */
export const ProjectMemberInput = z.object({
  userId: z.uuid(),
  rootEntityIds: z.array(z.uuid()).max(100).default([]),
  permissionGroups: z.array(z.uuid()).max(50).default([]),
});

// ---------------------------------------------------------------- permission groups
/** The built-in permissions every project has: admin (sees everything) and public (never has subpermissions). */
export const PERMISSION_KINDS = ['admin', 'public'] as const;
// A tree per project, most privileged at the top (e.g. Admin > Staff > Public).
// A member with a group sees visuals that need that group or any group below it.

export const PermissionGroupInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(''),
  /** The more privileged group above this one; null = a top-level group. */
  parent: z.uuid().nullable().default(null),
});
export type PermissionGroupInput = z.input<typeof PermissionGroupInput>;
export const PermissionGroupDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  parent: z.string().nullable(),
  /** Distance from the top of the tree (for indenting). */
  depth: z.number().int(),
  memberCount: z.number().int(),
  /** A built-in permission: always at the top, can't be deleted. */
  system: z.boolean(),
  /** Which built-in one: the project admin (sees everything) or the public permission. */
  kind: z.enum(PERMISSION_KINDS).nullable(),
});
export type PermissionGroupDto = z.infer<typeof PermissionGroupDto>;

// ---------------------------------------------------------------- entity types

export const ATTRIBUTE_TYPES = ['text', 'number', 'integer', 'boolean', 'date', 'select', 'email', 'url', 'phone'] as const;
/** What is wrong with a value for an attribute of this type, or null when it is fine (empty is always fine). */
export function attributeProblem(def: { type: (typeof ATTRIBUTE_TYPES)[number]; options?: string[] }, v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  switch (def.type) {
    case 'number':
      return Number.isFinite(typeof v === 'number' ? v : Number(s.replace(/,/g, ''))) ? null : 'Enter a number, like 12.5';
    case 'integer':
      return Number.isInteger(typeof v === 'number' ? v : Number(s.replace(/,/g, ''))) ? null : 'Enter a whole number, like 24';
    case 'boolean':
      return typeof v === 'boolean' || ['true', 'false'].includes(s.toLowerCase()) ? null : 'Choose yes or no';
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      const d = m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) : null;
      return d && d.getUTCMonth() === +m![2]! - 1 ? null : 'Enter a date, like 2026-10-07';
    }
    case 'select':
      return def.options?.includes(s) ? null : 'Choose one of the options';
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? null : 'Enter an email address, like name@example.com';
    case 'url':
      try {
        return ['http:', 'https:'].includes(new URL(s).protocol) && /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(s) ? null : 'Enter a web address, like https://example.com';
      } catch {
        return 'Enter a web address, like https://example.com';
      }
    case 'phone':
      return /^\+?[0-9 ()\-.]{6,25}$/.test(s) && s.replace(/\D/g, '').length >= 6 ? null : 'Enter a phone number, like +1 767 555 0100';
    default:
      return null;
  }
}

const AttributeBase = z.object({
  key: Key,
  label: z.string().trim().min(1).max(80),
  type: z.enum(ATTRIBUTE_TYPES),
  options: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  /** For numbers only: shown after the value (m, kg, %). */
  unit: z.string().max(20).optional(),
  /** Pre-filled when an entity of this type is created (and used when the field is left out). */
  default: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
  required: z.boolean().optional(),
  /** Shown in lists and map popups. */
  summary: z.boolean().optional(),
  /** Confidential: shown as •••• wherever it is displayed. */
  sensitive: z.boolean().optional(),
});
/** As stored and returned: older definitions may hold defaults that would not pass today's checks. */
export const AttributeDef = AttributeBase;
/** As submitted: the default value must suit the type. */
export const AttributeDefInput = AttributeBase.superRefine((d, ctx) => {
  const problem = attributeProblem(d, d.default);
  if (problem) ctx.addIssue({ code: 'custom', path: ['default'], message: problem });
});
export type AttributeDef = z.infer<typeof AttributeDef>;

export const GEOMETRY_KINDS = ['none', 'point', 'polygon', 'line'] as const;

/** How a type's places are drawn on maps: a dot, a pin with the type's icon, or the icon itself. */
export const MARKER_STYLES = ['dot', 'pin', 'icon'] as const;
export const MarkerStyle = z.enum(MARKER_STYLES);
export type MarkerStyle = z.infer<typeof MarkerStyle>;
export const Marker = z.object({
  style: MarkerStyle.default('dot'),
  /** A number attribute (e.g. heading, in degrees) that turns icon markers. */
  rotateBy: Key.nullable().default(null),
});
export type Marker = z.infer<typeof Marker>;
/** Marks that a type may sit at the project level as well as inside other types. */
export const ROOT_PARENT = '@root';
export const EntityTypeInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(60),
  plural: z.string().trim().min(1).max(60),
  icon: z.string().max(40).default('box'),
  color: Hex.default('#0f62fe'),
  geometry: z.enum(GEOMETRY_KINDS).default('none'),
  marker: Marker.default({ style: 'dot', rotateBy: null }),
  attributes: z.array(AttributeDefInput).max(100).default([]),
  /** Types it can sit inside; ROOT_PARENT also lets it sit directly under the project. No entries = project level only. */
  parentTypes: z.array(z.union([Key, z.literal(ROOT_PARENT)])).default([]),
  /** Most entities one project may hold of this type; null = no limit. */
  maxPerProject: z.number().int().min(1).max(1_000_000).nullable().default(null),
});
export type EntityTypeInput = z.input<typeof EntityTypeInput>;
export const EntityTypeDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  plural: z.string(),
  icon: z.string(),
  color: z.string(),
  geometry: z.enum(GEOMETRY_KINDS),
  marker: Marker,
  attributes: z.array(AttributeDef),
  parentTypes: z.array(z.string()),
  maxPerProject: z.number().int().nullable(),
  /** Set when the organisation defines this type: shown in every project and edited centrally. */
  orgId: z.string().nullable(),
  count: z.number().int(),
});
export type EntityTypeDto = z.infer<typeof EntityTypeDto>;

// ---------------------------------------------------------------- entities

/** GeoJSON geometry (validated loosely; PostGIS validates the rest). */
export const Geometry = z.object({
  type: z.enum(['Point', 'Polygon', 'MultiPolygon', 'LineString', 'MultiLineString']),
  coordinates: z.array(z.any()),
});
export type Geometry = z.infer<typeof Geometry>;
/** A GeoJSON point: [longitude, latitude]. */
export const PointGeometry = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
});
export type PointGeometry = z.infer<typeof PointGeometry>;

export const EntityInput = z.object({
  typeKey: Key,
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  parentId: z.uuid().nullable().default(null),
  attributes: z.record(z.string(), z.unknown()).default({}),
  /** The entity's shape: a boundary (polygon, line) or, for places that are just a spot, a point. */
  geometry: Geometry.nullable().default(null),
  /** Optional centre beside a boundary (e.g. its centroid), used to pin and label it on maps. */
  point: PointGeometry.nullable().default(null),
});
export type EntityInput = z.input<typeof EntityInput>;
/** Partial update: omitted fields stay as they are (no defaults here, unlike EntityInput). */
export const EntityUpdate = z.object({
  code: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  parentId: z.uuid().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  geometry: Geometry.nullable().optional(),
  point: PointGeometry.nullable().optional(),
  /** Optimistic concurrency: the version the edit was based on. */
  version: z.number().int().optional(),
});

export const EntitySummary = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.object({ key: z.string(), name: z.string(), icon: z.string(), color: z.string() }),
  parent: z.object({ id: z.string(), name: z.string() }).nullable(),
  attributes: z.record(z.string(), z.unknown()),
  hasGeometry: z.boolean(),
  childCount: z.number().int(),
  /** Owned by the organisation and shown in every project: change it there. */
  shared: z.boolean(),
  updatedAt: z.string(),
});
export type EntitySummary = z.infer<typeof EntitySummary>;

export const EntityDetail = EntitySummary.extend({
  version: z.number().int(),
  geometry: Geometry.nullable(),
  point: PointGeometry.nullable(),
  ancestors: z.array(z.object({ id: z.string(), name: z.string(), typeName: z.string() })),
  latest: z.array(
    z.object({
      element: z.string(),
      name: z.string(),
      unit: z.string(),
      value: z.union([z.number(), z.string(), z.null()]),
      at: z.string(),
      /** Not recorded for this place itself: combined from the places under it, the way the indicator is combined. */
      rolledUp: z.boolean().default(false),
      /** How many places under it the value is made from. */
      places: z.number().int().nullable().default(null),
      aggregation: z.enum(['sum', 'avg', 'min', 'max', 'last', 'count']).nullable().default(null),
    }),
  ),
  history: z.array(
    z.object({ at: z.string(), source: z.string(), actor: z.string().nullable(), changes: z.record(z.string(), z.unknown()) }),
  ),
  createdAt: z.string(),
});
export type EntityDetail = z.infer<typeof EntityDetail>;

export const EntityQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(25),
  /** One type key, or several separated by commas. */
  type: z.string().max(500).regex(/^[a-z][a-z0-9_]*(,[a-z][a-z0-9_]*)*$/).optional(),
  parentId: z.union([z.uuid(), z.literal('root')]).optional(),
  ancestorId: z.uuid().optional(),
  /** Only the ancestors of this entity (its parent, grandparent…). */
  aboveId: z.uuid().optional(),
  /** Only the direct parent of this entity. */
  parentOfId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
});
export type EntityQuery = z.infer<typeof EntityQuery>;

/**
 * What the mobile app downloads to pick places offline: the entities changed since the last sync,
 * a page at a time. The last page also lists every id still visible, so the device can drop the rest.
 */
export const EntitySyncQuery = z.object({
  /** Only entities changed at or after this time (the `serverTime` of the previous sync). */
  since: z.iso.datetime({ offset: true }).optional(),
  /** Continue after this id (the `next` of the previous page). */
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(1000),
});
export type EntitySyncQuery = z.infer<typeof EntitySyncQuery>;

export const EntitySyncItem = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.string(),
  parentId: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()),
  point: z.object({ lat: z.number(), lon: z.number() }).nullable(),
  shared: z.boolean(),
  updatedAt: z.string(),
});
export type EntitySyncItem = z.infer<typeof EntitySyncItem>;

export const EntitySyncDto = z.object({
  items: z.array(EntitySyncItem),
  /** More to fetch: pass as `after`. */
  next: z.string().nullable(),
  /** Time on the server when this sync started: the next sync's `since`. */
  serverTime: z.string(),
  /** On the last page only: every entity id the caller can still see. */
  ids: z.array(z.string()).nullable(),
});
export type EntitySyncDto = z.infer<typeof EntitySyncDto>;

export const GeoQuery = z.object({
  type: Key.optional(),
  ancestorId: z.uuid().optional(),
  /** minLon,minLat,maxLon,maxLat */
  bbox: z
    .string()
    .regex(/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/)
    .optional(),
  /** Data element whose latest value is attached to each feature. */
  element: ElementRef.optional(),
  limit: z.coerce.number().int().min(1).max(20000).default(5000),
});

// ---------------------------------------------------------------- data elements & observations

export const ELEMENT_VALUE_TYPES = ['number', 'text', 'boolean'] as const;
export const ELEMENT_AGGREGATIONS = ['sum', 'avg', 'min', 'max', 'last', 'count'] as const;
/**
 * How readings of each kind can be combined. Numbers can be added up, averaged and so on; a yes/no is stored as 1 or 0,
 * so it can be counted as yes (total), shared (average) or read as it last was; text has no number to work with, so
 * all it can be is counted.
 */
export const ALLOWED_AGGREGATIONS: Record<(typeof ELEMENT_VALUE_TYPES)[number], readonly (typeof ELEMENT_AGGREGATIONS)[number][]> = {
  number: ['sum', 'avg', 'min', 'max', 'last', 'count'],
  boolean: ['sum', 'avg', 'last', 'count'],
  text: ['count'],
};
export const AGGREGATION_LABEL: Record<(typeof ELEMENT_AGGREGATIONS)[number], string> = { sum: 'Total', avg: 'Average', min: 'Lowest', max: 'Highest', last: 'Latest', count: 'Count of readings' };
/** What an aggregation means for a yes/no, where it reads differently. */
export const BOOLEAN_AGGREGATION_LABEL: Partial<Record<(typeof ELEMENT_AGGREGATIONS)[number], string>> = { sum: 'Number of yes', avg: 'Share of yes', last: 'Latest answer', count: 'Count of readings' };

export const DataGroupInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(''),
});
export type DataGroupInput = z.input<typeof DataGroupInput>;
export const DataGroupDto = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  /** How many indicators are in it. */
  elementCount: z.number().int(),
});
export type DataGroupDto = z.infer<typeof DataGroupDto>;

export const DataElementInput = z
  .object({
    /** The group it is in: its key is unique only within the group. */
    group: Key.default(DEFAULT_DATA_GROUP),
    key: Key,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).default(''),
    valueType: z.enum(ELEMENT_VALUE_TYPES).default('number'),
    unit: z.string().trim().max(20).default(''),
    aggregation: z.enum(ELEMENT_AGGREGATIONS).default('sum'),
  })
  .superRefine((v, ctx) => {
    if (!ALLOWED_AGGREGATIONS[v.valueType].includes(v.aggregation))
      ctx.addIssue({ code: 'custom', path: ['aggregation'], message: `${v.valueType === 'text' ? 'Text' : v.valueType === 'boolean' ? 'Yes/no' : 'Number'} readings can be combined as: ${ALLOWED_AGGREGATIONS[v.valueType].join(', ')}` });
  });
export type DataElementInput = z.input<typeof DataElementInput>;
export const DataElementDto = z.object({
  id: z.string(),
  group: z.string().default(DEFAULT_DATA_GROUP),
  groupName: z.string().default('General'),
  /** How forms, overlays and dashboards refer to it: `key`, or `group.key` outside the default group. */
  ref: z.string().default(''),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  valueType: z.enum(['number', 'text', 'boolean']),
  unit: z.string(),
  aggregation: z.enum(['sum', 'avg', 'min', 'max', 'last', 'count']),
  observationCount: z.number().int(),
  lastAt: z.string().nullable(),
  /** Forms with a question recorded as this indicator: while there are any, its type and key stay as they are. */
  forms: z.array(z.string()).default([]),
});
export type DataElementDto = z.infer<typeof DataElementDto>;

export const ObservationInput = z.object({
  entityId: z.uuid(),
  element: ElementRef,
  at: z.iso.datetime({ offset: true }),
  value: z.union([z.number(), z.string(), z.boolean()]),
});
export const ObservationBatch = z.object({ observations: z.array(ObservationInput).min(1).max(5000) });

export const ImportRowsInput = z.object({
  /** Used for rows with no `type` column value. */
  typeKey: Key.optional(),
  /** Columns: type, code, name, parent_code, parent_type, geometry (GeoJSON or WKT), lat, lon, and attribute keys. */
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).min(1).max(10000),
});
