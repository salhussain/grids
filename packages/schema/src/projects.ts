import { z } from 'zod';
import { Key, Slug } from './common.js';

// ---------------------------------------------------------------- projects (M3)

export const PROJECT_ROLES = ['manager', 'editor', 'viewer'] as const;
export const ProjectRole = z.enum(PROJECT_ROLES);
export type ProjectRole = z.infer<typeof ProjectRole>;
/** What each project role can do (cumulative). */
export const PROJECT_ROLE_INFO: Record<ProjectRole, { label: string; description: string }> = {
  manager: { label: 'Manager', description: 'Configure the project, its data model, jobs, dashboards, forms and members.' },
  editor: { label: 'Editor', description: 'Add and edit entities and data, submit forms and run jobs.' },
  viewer: { label: 'Viewer', description: 'View entities, data and dashboards.' },
};
export const roleAtLeast = (have: ProjectRole | null | undefined, need: ProjectRole) =>
  !!have && PROJECT_ROLES.indexOf(have) <= PROJECT_ROLES.indexOf(need);

export const ProjectVisibility = z.enum(['private', 'organisation', 'public']);
export type ProjectVisibility = z.infer<typeof ProjectVisibility>;

export const TEMPLATE_KEYS = ['blank', 'flight-tracker', 'hr-workforce', 'health-surveillance'] as const;
export const ProjectTemplate = z.enum(TEMPLATE_KEYS);
export type ProjectTemplate = z.infer<typeof ProjectTemplate>;

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const ProjectInput = z.object({
  key: Slug.optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  visibility: ProjectVisibility.default('private'),
  color: Hex.default('#0f62fe'),
  icon: z.string().max(40).default('folder'),
  template: ProjectTemplate.default('blank'),
});
export type ProjectInput = z.input<typeof ProjectInput>;
/** Partial update: omitted fields stay as they are (no defaults). */
export const ProjectUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  visibility: ProjectVisibility.optional(),
  color: Hex.optional(),
  icon: z.string().max(40).optional(),
});

export const Freshness = z.object({
  status: z.enum(['fresh', 'warning', 'stale', 'unknown']),
  lastUpdated: z.string().nullable(),
  expectedMinutes: z.number().nullable(),
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
  rootEntity: z.object({ id: z.string(), name: z.string(), type: z.string() }).nullable(),
  /** Inherited from an organisation role rather than granted on the project. */
  implicit: z.boolean(),
  /** Permission group (key); null = only unrestricted visuals (managers see everything). */
  permissionGroup: z.string().nullable(),
});
export type ProjectMemberDto = z.infer<typeof ProjectMemberDto>;
export const ProjectMemberInput = z.object({
  userId: z.uuid(),
  role: ProjectRole,
  rootEntityId: z.uuid().nullable().default(null),
  permissionGroup: Key.nullable().default(null),
});

// ---------------------------------------------------------------- permission groups
// A tree per project, most privileged at the top (e.g. Admin > Staff > Public).
// A member with a group sees visuals that need that group or any group below it.

export const PermissionGroupInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(''),
  /** The more privileged group above this one; null = a top-level group. */
  parent: Key.nullable().default(null),
});
export type PermissionGroupInput = z.input<typeof PermissionGroupInput>;
export const PermissionGroupDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  parent: z.string().nullable(),
  /** Distance from the top of the tree (for indenting). */
  depth: z.number().int(),
  memberCount: z.number().int(),
});
export type PermissionGroupDto = z.infer<typeof PermissionGroupDto>;

// ---------------------------------------------------------------- entity types

export const ATTRIBUTE_TYPES = ['text', 'number', 'integer', 'boolean', 'date', 'select', 'email', 'url', 'phone'] as const;
export const AttributeDef = z.object({
  key: Key,
  label: z.string().trim().min(1).max(80),
  type: z.enum(ATTRIBUTE_TYPES),
  options: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  unit: z.string().max(20).optional(),
  required: z.boolean().optional(),
  /** Shown in lists and map popups. */
  summary: z.boolean().optional(),
});
export type AttributeDef = z.infer<typeof AttributeDef>;

export const GEOMETRY_KINDS = ['none', 'point', 'polygon', 'line'] as const;
export const EntityTypeInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(60),
  plural: z.string().trim().min(1).max(60),
  icon: z.string().max(40).default('box'),
  color: Hex.default('#0f62fe'),
  geometry: z.enum(GEOMETRY_KINDS).default('none'),
  attributes: z.array(AttributeDef).max(100).default([]),
  parentTypes: z.array(Key).default([]),
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
  attributes: z.array(AttributeDef),
  parentTypes: z.array(z.string()),
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

export const EntityInput = z.object({
  typeKey: Key,
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  parentId: z.uuid().nullable().default(null),
  attributes: z.record(z.string(), z.unknown()).default({}),
  geometry: Geometry.nullable().default(null),
});
export type EntityInput = z.input<typeof EntityInput>;
/** Partial update: omitted fields stay as they are (no defaults here, unlike EntityInput). */
export const EntityUpdate = z.object({
  code: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  parentId: z.uuid().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  geometry: Geometry.nullable().optional(),
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
  updatedAt: z.string(),
});
export type EntitySummary = z.infer<typeof EntitySummary>;

export const EntityDetail = EntitySummary.extend({
  version: z.number().int(),
  geometry: Geometry.nullable(),
  ancestors: z.array(z.object({ id: z.string(), name: z.string(), typeName: z.string() })),
  latest: z.array(
    z.object({
      element: z.string(),
      name: z.string(),
      unit: z.string(),
      value: z.union([z.number(), z.string(), z.null()]),
      at: z.string(),
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
  type: Key.optional(),
  parentId: z.union([z.uuid(), z.literal('root')]).optional(),
  ancestorId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
});
export type EntityQuery = z.infer<typeof EntityQuery>;

export const GeoQuery = z.object({
  type: Key.optional(),
  ancestorId: z.uuid().optional(),
  /** minLon,minLat,maxLon,maxLat */
  bbox: z
    .string()
    .regex(/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/)
    .optional(),
  /** Data element whose latest value is attached to each feature. */
  element: Key.optional(),
  limit: z.coerce.number().int().min(1).max(20000).default(5000),
});

// ---------------------------------------------------------------- data elements & observations

export const DataElementInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(''),
  valueType: z.enum(['number', 'text', 'boolean']).default('number'),
  unit: z.string().trim().max(20).default(''),
  aggregation: z.enum(['sum', 'avg', 'min', 'max', 'last', 'count']).default('sum'),
});
export type DataElementInput = z.input<typeof DataElementInput>;
export const DataElementDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  valueType: z.enum(['number', 'text', 'boolean']),
  unit: z.string(),
  aggregation: z.enum(['sum', 'avg', 'min', 'max', 'last', 'count']),
  observationCount: z.number().int(),
  lastAt: z.string().nullable(),
});
export type DataElementDto = z.infer<typeof DataElementDto>;

export const ObservationInput = z.object({
  entityId: z.uuid(),
  element: Key,
  at: z.iso.datetime({ offset: true }),
  value: z.union([z.number(), z.string(), z.boolean()]),
});
export const ObservationBatch = z.object({ observations: z.array(ObservationInput).min(1).max(5000) });

export const ImportRowsInput = z.object({
  typeKey: Key,
  /** Column → field: code, name, parent_code, lat, lon, or attr:<key>. */
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).min(1).max(10000),
});
