import { z } from 'zod';
import { Key } from './common.js';
import { Freshness } from './projects.js';
import { AGGREGATIONS } from './viz.js';

// ---------------------------------------------------------------- map overlays (spec §9)
// A map overlay colours the places shown on the explorer map by one indicator.
// Places are the selected entity's children (or its descendants of `level`), and
// each place's value rolls up the observations of its whole subtree.

export const OVERLAY_PALETTES = ['performance', 'heat', 'blues', 'greens', 'purples', 'reds'] as const;
export const OverlayPalette = z.enum(OVERLAY_PALETTES);
export type OverlayPalette = z.infer<typeof OverlayPalette>;

/** How an overlay's values are drawn: shaded areas, 3D columns, sized bubbles or a heatmap. */
export const OVERLAY_DISPLAYS = ['shade', 'extrude', 'bubbles', 'heatmap'] as const;
export const OverlayDisplay = z.enum(OVERLAY_DISPLAYS);
export type OverlayDisplay = z.infer<typeof OverlayDisplay>;

export const MapOverlayInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(120),
  /** Overlays are listed under their group in the overlay picker. */
  group: z.string().trim().min(1).max(200).default('General'),
  /** A configured overlay group (levels nest); when set, `group` shows its path. */
  groupId: z.uuid().nullable().default(null),
  description: z.string().trim().max(500).default(''),
  element: Key,
  aggregation: z.enum(AGGREGATIONS).default('sum'),
  /** Window of observations; null = each entity's latest value. */
  hours: z.number().int().min(1).max(24 * 3660).nullable().default(24 * 30),
  /** Entity type to show; null = the children of the selected place. */
  level: Key.nullable().default(null),
  palette: OverlayPalette.default('heat'),
  display: OverlayDisplay.default('shade'),
  /** Class breaks (ascending); none = a continuous scale from the data's min to max. */
  thresholds: z.array(z.number()).max(8).default([]),
  /** Higher is better (flips the performance palette). */
  higherIsBetter: z.boolean().default(false),
  unit: z.string().trim().max(20).default(''),
  decimals: z.number().int().min(0).max(6).default(0),
  isPublic: z.boolean().default(false),
  /** Only members of this permission group (or a group above it) see the overlay. */
  permissionGroup: Key.nullable().default(null),
});
export type MapOverlayInput = z.input<typeof MapOverlayInput>;
export type MapOverlay = z.output<typeof MapOverlayInput>;

export const MapOverlayDto = MapOverlayInput.extend({
  id: z.string(),
  elementName: z.string(),
  updatedAt: z.string(),
});
export type MapOverlayDto = z.infer<typeof MapOverlayDto>;

export const ExplorePlace = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  type: z.object({ key: z.string(), name: z.string(), plural: z.string(), color: z.string() }),
});
export type ExplorePlace = z.infer<typeof ExplorePlace>;

/** A place on the explorer: its breadcrumb, map extent and the places inside it. */
export const ExploreDto = z.object({
  /** null = the whole project (or the caller's own subtree). */
  entity: ExplorePlace.nullable(),
  ancestors: z.array(ExplorePlace),
  /** [minLon, minLat, maxLon, maxLat] of the place and everything in it. */
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  /** Children with a location, as GeoJSON (properties: id, name, code, type, hasChildren). */
  children: z.object({ type: z.literal('FeatureCollection'), features: z.array(z.any()) }),
  /** Plural name of the children's level, e.g. "Districts". */
  childLevel: z.string().nullable(),
  /** The selected place's own outline or point, if it has one. */
  self: z.any().nullable(),
});
export type ExploreDto = z.infer<typeof ExploreDto>;

export const OverlayResult = z.object({
  features: z.object({ type: z.literal('FeatureCollection'), features: z.array(z.any()) }),
  min: z.number().nullable(),
  max: z.number().nullable(),
  freshness: Freshness,
});
export type OverlayResult = z.infer<typeof OverlayResult>;

export const SearchHit = ExplorePlace.extend({ path: z.string() });
export type SearchHit = z.infer<typeof SearchHit>;

/** A node in the place hierarchy browser. */
export const PlaceNode = ExplorePlace.extend({ hasChildren: z.boolean(), childCount: z.number().int() });
export type PlaceNode = z.infer<typeof PlaceNode>;

/** Overlay groups: nested levels in the explorer's overlay picker (e.g. Health › Malaria). */
export const OverlayGroupInput = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.uuid().nullable().default(null),
  sort: z.number().int().default(0),
});
export type OverlayGroupInput = z.input<typeof OverlayGroupInput>;
export const OverlayGroupDto = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  /** "Health › Malaria" */
  path: z.string(),
  sort: z.number().int(),
  overlayCount: z.number().int(),
});
export type OverlayGroupDto = z.infer<typeof OverlayGroupDto>;
