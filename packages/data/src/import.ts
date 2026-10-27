import type { Geometry } from '@grids/schema';
import { DataError, entityType, upsertEntities, type CellTx, type EntityRowInput, type UpsertResult } from './model.js';

const SHAPES = ['Point', 'Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'];

/** Reads a WKT shape (POINT, LINESTRING, POLYGON and their MULTI forms) into GeoJSON. */
function fromWkt(text: string): Geometry | null {
  const m = /^\s*(?:SRID=\d+;)?\s*(MULTI)?(POINT|LINESTRING|POLYGON)\s*(?:Z|M|ZM)?\s*(\(.*\))\s*$/is.exec(text);
  if (!m) return null;
  const multi = !!m[1];
  const kind = m[2]!.toUpperCase();
  // "(1 2, 3 4)" → nested arrays by bracket depth, leaves are coordinate pairs.
  let i = 0;
  const src = m[3]!;
  const parse = (): unknown => {
    if (src[i] === '(') {
      i++;
      const out: unknown[] = [];
      while (i < src.length && src[i] !== ')') {
        if (src[i] === ',' || src[i] === ' ') i++;
        else out.push(parse());
      }
      i++;
      return out;
    }
    const start = i;
    while (i < src.length && src[i] !== ',' && src[i] !== ')') i++;
    const nums = src.slice(start, i).trim().split(/\s+/).map(Number);
    if (nums.length < 2 || nums.some((n) => !Number.isFinite(n))) throw new Error('bad coordinate');
    return [nums[0], nums[1]];
  };
  try {
    const c = parse() as unknown[];
    // A bare MULTIPOINT may omit inner brackets; a POINT has one coordinate pair.
    if (kind === 'POINT') return multi ? (c.length === 1 ? { type: 'Point', coordinates: (c[0] as number[][])[0] ?? [] } : null) : { type: 'Point', coordinates: c[0] as number[] };
    const type = `${multi ? 'Multi' : ''}${kind === 'LINESTRING' ? 'LineString' : 'Polygon'}` as Geometry['type'];
    return { type, coordinates: c };
  } catch {
    return null;
  }
}

/** A geometry cell: GeoJSON (geometry, Feature or a one-feature collection) or WKT. */
export function parseGeometryCell(v: unknown): Geometry | null {
  if (v === undefined || v === null) return null;
  let o: unknown = v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    if (s.startsWith('{')) {
      try {
        o = JSON.parse(s);
      } catch {
        throw new DataError('The geometry isn’t valid GeoJSON');
      }
    } else {
      const g = fromWkt(s);
      if (!g) throw new DataError('The geometry isn’t GeoJSON or WKT');
      return g;
    }
  }
  const x = o as { type?: string; geometry?: unknown; features?: unknown[]; coordinates?: unknown };
  if (x?.type === 'Feature') return parseGeometryCell(x.geometry as never);
  if (x?.type === 'FeatureCollection' && x.features?.length === 1) return parseGeometryCell(x.features[0] as never);
  if (x?.type && SHAPES.includes(x.type) && Array.isArray(x.coordinates)) return x as Geometry;
  throw new DataError('The geometry must be a point, line or polygon');
}

type Cell = string | number | boolean | null | undefined;

/** Lower-cased lookup, so "Code", "CODE" and "code" are the same column. */
const pick = (r: Record<string, Cell>, ...names: string[]): Cell => {
  for (const n of names) for (const k of Object.keys(r)) if (k.trim().toLowerCase() === n) return r[k];
  return undefined;
};

const blank = (v: Cell) => v === undefined || v === null || v === '';

/**
 * Imports rows from one file. Columns: `type` (entity type; else the default), `code`, `name`,
 * `parent_code`, `parent_type`, `geometry` (GeoJSON or WKT) or `lat`/`lon`, and attribute keys.
 * A file can hold several types: parents are written before their children.
 */
export async function importEntityRows(
  tx: CellTx,
  opts: {
    tenantId: string;
    projectId: string | null;
    defaultTypeKey?: string | null;
    rows: Record<string, Cell>[];
    source: string;
    actorId?: string | null;
    scope?: string[] | null;
  },
): Promise<UpsertResult & { byType: Record<string, { created: number; updated: number; unchanged: number; skipped: number }> }> {
  const groups = new Map<string, { type: Awaited<ReturnType<typeof entityType>>; rows: EntityRowInput[] }>();
  const types = new Map<string, Awaited<ReturnType<typeof entityType>>>();
  const typeOf = async (key: string) => {
    let t = types.get(key);
    if (!t) types.set(key, (t = await entityType(tx, opts.projectId, key)));
    return t;
  };

  for (const [i, r] of opts.rows.entries()) {
    const at = `Row ${i + 2}`;
    const key = String(pick(r, 'type', 'entity_type') ?? '').trim() || opts.defaultTypeKey || '';
    if (!key) throw new DataError(`${at}: no entity type. Add a "type" column or pick a type`, 400);
    let type;
    try {
      type = await typeOf(key);
    } catch {
      throw new DataError(`${at}: unknown entity type "${key}"`, 422);
    }
    const code = String(pick(r, 'code') ?? '').trim();
    if (!code) throw new DataError(`${at}: "code" is empty`, 400);
    const lat = pick(r, 'lat', 'latitude');
    const lon = pick(r, 'lon', 'lng', 'longitude');
    let geometry: Geometry | undefined;
    try {
      const g = parseGeometryCell(pick(r, 'geometry', 'geom', 'wkt', 'boundary'));
      if (g) geometry = g;
    } catch (e) {
      throw new DataError(`${at}: ${(e as Error).message}`, 400);
    }
    if (!geometry && !blank(lat) && !blank(lon) && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
      const [x, y] = [Number(lon), Number(lat)];
      if (Math.abs(x) > 180 || Math.abs(y) > 90) throw new DataError(`${at}: latitude/longitude out of range`, 400);
      geometry = { type: 'Point', coordinates: [x, y] };
    }
    const attributes: Record<string, unknown> = {};
    for (const d of type.attributes) {
      const k = Object.keys(r).find((c) => c === d.key) ?? Object.keys(r).find((c) => c.trim().toLowerCase() === d.key.toLowerCase());
      if (k !== undefined) attributes[d.key] = r[k];
    }
    const parentCode = String(pick(r, 'parent_code', 'parent') ?? '').trim();
    const parentType = String(pick(r, 'parent_type') ?? '').trim();
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { type, rows: [] }));
    g.rows.push({
      code,
      name: String(pick(r, 'name') ?? '').trim() || code,
      parentCode: parentCode || null,
      ...(parentType && { parentType }),
      attributes,
      ...(geometry && { geometry }),
    });
  }

  // Parents first: a type goes after any other type in the file it can sit under.
  const order: string[] = [];
  const pending = new Set(groups.keys());
  while (pending.size) {
    const next = [...pending].find((k) => !groups.get(k)!.type.parentTypes.some((p) => p !== k && pending.has(p))) ?? [...pending][0]!;
    pending.delete(next);
    order.push(next);
  }

  const total: UpsertResult = { created: 0, updated: 0, unchanged: 0, skipped: 0, ids: new Map() };
  const byType: Record<string, { created: number; updated: number; unchanged: number; skipped: number }> = {};
  for (const key of order) {
    const res = await upsertEntities(tx, { tenantId: opts.tenantId, projectId: opts.projectId, typeKey: key, rows: groups.get(key)!.rows, source: opts.source, actorId: opts.actorId, scope: opts.scope });
    total.created += res.created;
    total.updated += res.updated;
    total.unchanged += res.unchanged;
    total.skipped += res.skipped;
    byType[key] = { created: res.created, updated: res.updated, unchanged: res.unchanged, skipped: res.skipped };
  }
  return { ...total, byType };
}
