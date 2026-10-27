import type { Geometry, PointGeometry } from '@grids/schema';

type Ring = [number, number][];

/** Signed area and centroid of a ring (shoelace formula). */
function ringCentroid(ring: Ring): { a: number; x: number; y: number } {
  let a = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[i + 1]!;
    const f = x0 * y1 - x1 * y0;
    a += f;
    x += (x0 + x1) * f;
    y += (y0 + y1) * f;
  }
  a /= 2;
  return a
    ? { a, x: x / (6 * a), y: y / (6 * a) }
    : { a: 0, x: ring[0]?.[0] ?? 0, y: ring[0]?.[1] ?? 0 };
}

/** The centre of a boundary: area-weighted for polygons, the mean vertex for lines. */
export function centroidOf(g: Geometry): PointGeometry | null {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const polys = (
    g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  ) as Ring[][];
  if (polys.length) {
    let area = 0;
    let x = 0;
    let y = 0;
    for (const p of polys) {
      const c = ringCentroid(p[0] ?? []);
      area += Math.abs(c.a);
      x += c.x * Math.abs(c.a);
      y += c.y * Math.abs(c.a);
    }
    if (!area) return null;
    return { type: 'Point', coordinates: [round(x / area), round(y / area)] };
  }
  const pts: [number, number][] = [];
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') pts.push(c as [number, number]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  walk(g.coordinates);
  if (!pts.length) return null;
  return {
    type: 'Point',
    coordinates: [
      round(pts.reduce((s, p) => s + p[0], 0) / pts.length),
      round(pts.reduce((s, p) => s + p[1], 0) / pts.length),
    ],
  };
}

const SHAPES = ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'];

/**
 * A boundary from pasted or uploaded GeoJSON: a geometry, a Feature, or a
 * FeatureCollection (its polygons are merged into one MultiPolygon).
 */
export function parseBoundary(text: string): Geometry {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error('That isn’t valid GeoJSON.');
  }
  const geometries: Geometry[] = [];
  const collect = (o: unknown) => {
    const x = o as {
      type?: string;
      geometry?: unknown;
      features?: unknown[];
      coordinates?: unknown[];
    };
    if (x?.type === 'FeatureCollection') x.features?.forEach(collect);
    else if (x?.type === 'Feature') collect(x.geometry);
    else if (x?.type && SHAPES.includes(x.type) && Array.isArray(x.coordinates))
      geometries.push(x as Geometry);
  };
  collect(v);
  if (!geometries.length) throw new Error('No polygon or line found in that GeoJSON.');
  if (geometries.length === 1) return geometries[0]!;
  const polygons = geometries.flatMap((g) =>
    g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [],
  );
  if (!polygons.length) throw new Error('Use a single line, or polygons only.');
  return { type: 'MultiPolygon', coordinates: polygons };
}
