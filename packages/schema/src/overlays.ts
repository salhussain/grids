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

export const MapOverlayInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(120),
  /** Overlays are listed under their group in the overlay picker. */
  group: z.string().trim().min(1).max(60).default('General'),
  description: z.string().trim().max(500).default(''),
  element: Key,
  aggregation: z.enum(AGGREGATIONS).default('sum'),
  /** Window of observations; null = each entity's latest value. */
  hours: z.number().int().min(1).max(24 * 3660).nullable().default(24 * 30),
  /** Entity type to show; null = the children of the selected place. */
  level: Key.nullable().default(null),
  palette: OverlayPalette.default('heat'),
  /** Class breaks (ascending); none = a continuous scale from the data's min to max. */
  thresholds: z.array(z.number()).max(8).default([]),
  /** Higher is better (flips the performance palette). */
  higherIsBetter: z.boolean().default(false),
  unit: z.string().trim().max(20).default(''),
  decimals: z.number().int().min(0).max(6).default(0),
  isPublic: z.boolean().default(false),
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
