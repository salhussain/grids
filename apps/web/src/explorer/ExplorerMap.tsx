import maplibregl, { type GeoJSONSource, type Map as MlMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { OverlayDisplay } from '@grids/schema';
import { useEffect, useRef, useState } from 'react';

export type Basemap = 'map' | 'satellite';
export type MapScheme = 'light' | 'dark';
export interface PlaceFeature {
  type: 'Feature';
  id: string;
  geometry: { type: string; coordinates: unknown };
  properties: { id: string; name: string; hasChildren?: boolean; value?: number | null; [k: string]: unknown };
}
export interface PlaceCollection {
  type: 'FeatureCollection';
  features: PlaceFeature[];
}

export const OCEAN: Record<MapScheme, string> = { light: '#dbe5ee', dark: '#0c1420' };
// Shown when a basemap can't be fetched (offline, blocked): the data still draws.
const blank = (scheme: MapScheme): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': OCEAN[scheme] } }] });
/** Default vector basemaps (CARTO, OpenStreetMap data; no key). An organisation can set its own. */
export const DEFAULT_STYLES: Record<MapScheme, string> = {
  light: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
/** Satellite imagery with boundaries and place names on top. */
const SATELLITE: StyleSpecification = {
  version: 8,
  sources: {
    imagery: { type: 'raster', tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
    places: { type: 'raster', tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': OCEAN.dark } },
    { id: 'imagery', type: 'raster', source: 'imagery' },
    { id: 'reference', type: 'raster', source: 'places', paint: { 'raster-opacity': 0.9 } },
  ],
};
// Terrain for hillshade: AWS open elevation tiles (Terrarium encoding), no key.
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const resolved = new Map<string, Promise<StyleSpecification | string>>();
/** A style URL if reachable within a few seconds, else a plain backdrop. */
function resolveStyle(url: string, scheme: MapScheme) {
  let p = resolved.get(url);
  if (!p) {
    p = fetch(url, { signal: AbortSignal.timeout(3500) })
      .then((r) => (r.ok ? url : blank(scheme)))
      .catch(() => blank(scheme));
    resolved.set(url, p);
  }
  return p;
}

const POLY = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false] as maplibregl.ExpressionSpecification;
const POINT = ['==', ['geometry-type'], 'Point'] as maplibregl.ExpressionSpecification;
const HOVER = ['boolean', ['feature-state', 'hover'], false] as maplibregl.ExpressionSpecification;
const HAS_FILL = ['!=', ['get', 'fill'], null] as maplibregl.ExpressionSpecification;

/** Where to put a place's label: a point, or the centre of its largest ring's box. */
function labelPoint(g: PlaceFeature['geometry']): [number, number] | null {
  if (g.type === 'Point') return g.coordinates as [number, number];
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as [number, number][][][];
  let best: [number, number] | null = null;
  let area = -1;
  for (const p of polys) {
    const ring = p[0] ?? [];
    const xs = ring.map((c) => c[0]);
    const ys = ring.map((c) => c[1]);
    const a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (a > area) {
      area = a;
      best = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2];
    }
  }
  return best;
}

export interface ExplorerMapProps {
  places: PlaceCollection | undefined;
  self: PlaceFeature | null;
  bounds: [number, number, number, number] | null;
  /** Fill colour per place when an overlay is on. */
  colorOf?: (p: PlaceFeature['properties']) => string;
  /** Second line of a place's label (e.g. the overlay value). */
  detailOf?: (p: PlaceFeature['properties']) => string | null;
  /** How the overlay's values are drawn. */
  display?: OverlayDisplay;
  onSelect(p: PlaceFeature['properties']): void;
  basemap: Basemap;
  scheme: MapScheme;
  /** The organisation's own basemap style URLs (else the defaults). */
  styles?: { light?: string | null; dark?: string | null };
  accent: string;
  /** Map padding so places aren't hidden under floating panels. */
  padding: { top: number; right: number; bottom: number; left: number };
}

/**
 * The explorer's map (MapLibre GL): a globe when zoomed out, hillshaded terrain,
 * outlined places with label pills, and the active overlay drawn as shaded
 * areas, 3D columns, bubbles or a heatmap.
 */
export function ExplorerMap({ places, self, bounds, colorOf, detailOf, display = 'shade', onSelect, basemap, scheme, styles, accent, padding }: ExplorerMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const hovered = useRef<string | null>(null);
  // True between setStyle() and its style.load (sources and layers are being replaced).
  const swapping = useRef(false);
  // Camera tilt wanted by the current display (3D columns tilt; others are flat).
  const pitchRef = useRef(0);
  const [ready, setReady] = useState(0);
  const latest = useRef({ places, self, colorOf, detailOf, onSelect, accent, scheme, display, bounds });
  latest.current = { places, self, colorOf, detailOf, onSelect, accent, scheme, display, bounds };
  const styleUrl = (scheme === 'dark' ? styles?.dark : styles?.light) || DEFAULT_STYLES[scheme];

  // Create the map once; swap styles when the basemap or mode changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const style = basemap === 'satellite' ? SATELLITE : await resolveStyle(styleUrl, scheme);
      if (cancelled || !el.current) return;
      if (map.current) {
        swapping.current = true;
        // A full reload (no diff), so style.load fires and our layers are re-added.
        map.current.setStyle(style as StyleSpecification, { diff: false });
        map.current.once('style.load', () => {
          swapping.current = false;
          setReady((n) => n + 1);
        });
        return;
      }
      const m = new maplibregl.Map({ container: el.current, style: style as StyleSpecification, center: [160, -5], zoom: 1.6, attributionControl: { compact: true }, maxPitch: 70 });
      map.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-left');
      m.on('load', () => setReady((n) => n + 1));
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'explorer-popup' });
      const hover = (id: string | null) => {
        if (hovered.current) m.setFeatureState({ source: 'places', id: hovered.current }, { hover: false });
        hovered.current = id;
        if (id) m.setFeatureState({ source: 'places', id }, { hover: true });
      };
      for (const layer of ['places-fill', 'places-point', 'places-extrude', 'places-bubble']) {
        m.on('mousemove', layer, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          m.getCanvas().style.cursor = 'pointer';
          hover(String(f.properties.id ?? f.id));
          const p = f.properties as PlaceFeature['properties'];
          const detail = latest.current.detailOf?.(p);
          popup
            .setLngLat(e.lngLat)
            .setHTML(`<strong>${escapeHtml(p.name)}</strong>${detail ? `<div>${escapeHtml(detail)}</div>` : ''}`)
            .addTo(m);
        });
        m.on('mouseleave', layer, () => {
          m.getCanvas().style.cursor = '';
          hover(null);
          popup.remove();
        });
        m.on('click', layer, (e) => {
          const f = e.features?.[0];
          if (f) latest.current.onSelect(f.properties as PlaceFeature['properties']);
        });
      }
      const ro = new ResizeObserver(() => m.resize());
      ro.observe(el.current);
      m.once('remove', () => ro.disconnect());
    })();
    return () => {
      cancelled = true;
    };
  }, [basemap, scheme, styleUrl]);

  useEffect(
    () => () => {
      markers.current.forEach((mk) => mk.remove());
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  // Scene (globe, sky, hillshade) and data layers, re-added after any style load.
  useEffect(() => {
    // Not isStyleLoaded(): it is briefly false while a GeoJSON source re-parses.
    const m = map.current;
    if (!m || !ready || swapping.current) return;
    const { places: pl, self: sf, colorOf: col, accent: ac, scheme: sc, display: disp, bounds: bb } = latest.current;
    const dark = sc === 'dark' || basemap === 'satellite';
    const edge = dark ? '#ffffff' : '#1f2937';

    if (!m.getSource('dem')) {
      // A globe at low zoom that flattens as you zoom in, with a soft atmosphere.
      m.setProjection({ type: 'globe' });
      m.setSky({
        'sky-color': dark ? '#0b1220' : '#bcd6f2',
        'horizon-color': dark ? '#1c2a44' : '#eef4fb',
        'fog-color': dark ? '#0b1220' : '#eef4fb',
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 8, 0],
      });
      m.addSource('dem', { type: 'raster-dem', tiles: [DEM_TILES], tileSize: 256, encoding: 'terrarium', maxzoom: 13, attribution: 'Terrain: Mapzen, AWS Open Data' });
      // Under the basemap's labels, so names stay crisp.
      const firstLabel = m.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
      if (basemap === 'map')
        m.addLayer(
          {
            id: 'hillshade',
            type: 'hillshade',
            source: 'dem',
            paint: {
              'hillshade-exaggeration': 0.35,
              'hillshade-shadow-color': dark ? '#000000' : '#5a6b7d',
              'hillshade-highlight-color': dark ? '#3a4a60' : '#ffffff',
              'hillshade-accent-color': dark ? '#0b1220' : '#7d8ea0',
            },
          },
          firstLabel,
        );
    }

    // Values scaled 0..1 for heights, bubble sizes and heat weights.
    const vals = (pl?.features ?? []).map((f) => f.properties.value).filter((v): v is number => typeof v === 'number');
    const lo = vals.length ? Math.min(...vals) : 0;
    const hi = vals.length ? Math.max(...vals) : 0;
    const t = (v: unknown) => (typeof v === 'number' ? (hi === lo ? 1 : (v - lo) / (hi - lo)) : 0);
    const features = (pl?.features ?? []).map((f) => ({ ...f, properties: { ...f.properties, fill: col ? col(f.properties) : null, t: t(f.properties.value) } }));
    const data = { type: 'FeatureCollection' as const, features };
    // Bubbles and heat sit at each place's label point (areas become points).
    const centroids = {
      type: 'FeatureCollection' as const,
      features: features.flatMap((f) => {
        const at = labelPoint(f.geometry);
        return at && f.properties.value !== null && f.properties.value !== undefined ? [{ type: 'Feature' as const, id: f.id, geometry: { type: 'Point', coordinates: at }, properties: f.properties }] : [];
      }),
    };
    const selfData = { type: 'FeatureCollection' as const, features: sf ? [sf] : [] };
    // Column height scales with the area on screen: ~15% of its width at the tallest.
    const span = bb ? Math.max(bb[2] - bb[0], bb[3] - bb[1]) : 5;
    const maxHeight = Math.max(4_000, Math.min(600_000, span * 111_000 * 0.3));

    const src = m.getSource('places') as GeoJSONSource | undefined;
    if (src) {
      src.setData(data as never);
      (m.getSource('centroids') as GeoJSONSource).setData(centroids as never);
      (m.getSource('self') as GeoJSONSource).setData(selfData as never);
    } else {
      m.addSource('self', { type: 'geojson', data: selfData as never });
      m.addSource('places', { type: 'geojson', data: data as never, promoteId: 'id' });
      m.addSource('centroids', { type: 'geojson', data: centroids as never, promoteId: 'id' });
      m.addLayer({ id: 'self-line', type: 'line', source: 'self', filter: POLY, paint: { 'line-color': edge, 'line-opacity': 0.5, 'line-width': 1.5, 'line-dasharray': [2, 2] } });
      m.addLayer({ id: 'places-fill', type: 'fill', source: 'places', filter: POLY, paint: { 'fill-color': ac, 'fill-opacity': 0.1 } });
      m.addLayer({ id: 'places-extrude', type: 'fill-extrusion', source: 'places', filter: POLY, layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': ['coalesce', ['get', 'fill'], ac], 'fill-extrusion-opacity': 0.88, 'fill-extrusion-height-transition': { duration: 600, delay: 0 } } });
      m.addLayer({ id: 'places-line', type: 'line', source: 'places', filter: POLY, paint: { 'line-color': ac, 'line-width': 2 } });
      m.addLayer({ id: 'places-heat', type: 'heatmap', source: 'centroids', layout: { visibility: 'none' }, paint: { 'heatmap-opacity': 0.85 } });
      m.addLayer({ id: 'places-bubble', type: 'circle', source: 'centroids', layout: { visibility: 'none' }, paint: { 'circle-opacity': 0.82 } });
      m.addLayer({ id: 'places-point', type: 'circle', source: 'places', filter: POINT, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 8, 8, 12, 11] } });
    }

    // Style per display: shade (fills), extrude (3D columns), bubbles (sized circles), heatmap.
    const shade = disp === 'shade' || !col;
    const vis = (id: string, on: boolean) => m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('places-extrude', !!col && disp === 'extrude');
    vis('places-bubble', !!col && disp === 'bubbles');
    vis('places-heat', !!col && disp === 'heatmap');
    vis('places-point', shade || disp === 'extrude');
    m.setPaintProperty('places-fill', 'fill-color', shade ? ['coalesce', ['get', 'fill'], ac] : ac);
    m.setPaintProperty('places-fill', 'fill-opacity', shade && col ? ['case', HOVER, 0.95, ['case', HAS_FILL, 0.8, 0.1]] : ['case', HOVER, 0.22, disp === 'extrude' && col ? 0 : 0.07]);
    m.setPaintProperty('places-line', 'line-color', shade && col ? ['case', HAS_FILL, edge, ac] : ac);
    m.setPaintProperty('places-line', 'line-opacity', shade && col ? 0.5 : disp === 'heatmap' ? 0.45 : 0.9);
    m.setPaintProperty('places-line', 'line-width', ['case', HOVER, 3.5, 1.75]);
    m.setPaintProperty('places-extrude', 'fill-extrusion-height', ['*', ['max', ['get', 't'], 0.04], maxHeight]);
    m.setPaintProperty('places-bubble', 'circle-color', ['coalesce', ['get', 'fill'], ac]);
    m.setPaintProperty('places-bubble', 'circle-radius', ['+', 6, ['*', 34, ['sqrt', ['get', 't']]]]);
    m.setPaintProperty('places-bubble', 'circle-stroke-width', ['case', HOVER, 3, 1.5]);
    m.setPaintProperty('places-bubble', 'circle-stroke-color', dark ? '#0c1420' : '#ffffff');
    m.setPaintProperty('places-heat', 'heatmap-weight', ['+', 0.1, ['get', 't']]);
    m.setPaintProperty('places-heat', 'heatmap-radius', ['interpolate', ['linear'], ['zoom'], 3, 30, 8, 60, 12, 90]);
    m.setPaintProperty('places-heat', 'heatmap-intensity', ['interpolate', ['linear'], ['zoom'], 3, 1, 10, 2]);
    m.setPaintProperty('places-heat', 'heatmap-color', ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.15, '#fee8a8', 0.4, '#fdbf6f', 0.65, '#fb8b3c', 0.85, '#e8512a', 1, '#b5161c']);
    m.setPaintProperty('places-point', 'circle-color', ['coalesce', ['get', 'fill'], ac]);
    m.setPaintProperty('places-point', 'circle-stroke-width', ['case', HOVER, 3, 1.5]);
    m.setPaintProperty('places-point', 'circle-stroke-color', dark ? '#0c1420' : '#ffffff');
    m.setPaintProperty('self-line', 'line-color', edge);
    // Tilt the camera for columns; flat otherwise.
    const pitch = col && disp === 'extrude' ? 55 : 0;
    pitchRef.current = pitch;
    if (Math.abs(m.getPitch() - pitch) > 1) m.easeTo({ pitch, bearing: pitch ? -12 : 0, duration: 900 });

    // Label pills (HTML, so they look the same on any basemap).
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    const feats = pl?.features ?? [];
    // Areas get label pills; points (often dense) show theirs on hover.
    if (feats.length <= 150 && disp !== 'heatmap')
      for (const f of feats) {
        if (f.geometry.type === 'Point') continue;
        const at = labelPoint(f.geometry);
        if (!at) continue;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'explorer-label';
        const detail = latest.current.detailOf?.(f.properties);
        // A pill: a dot in the place's colour, its name, and the overlay value.
        const dot = (col ? col(f.properties) : null) ?? ac;
        chip.innerHTML = `<i style="background:${dot}"></i><span>${escapeHtml(f.properties.name)}</span>${detail ? `<em>${escapeHtml(detail)}</em>` : ''}`;
        chip.onclick = (e) => {
          e.stopPropagation();
          latest.current.onSelect(f.properties);
        };
        markers.current.push(new maplibregl.Marker({ element: chip, anchor: disp === 'bubbles' && col ? 'top' : 'center', offset: disp === 'bubbles' && col ? [0, 18] : [0, 0] }).setLngLat(at).addTo(m));
      }
  }, [ready, places, self, colorOf, detailOf, accent, scheme, display, basemap]);

  // Fly to the selected place.
  const key = bounds?.join(',');
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !bounds) return;
    const [x1, y1, x2, y2] = bounds;
    const pad = 0.0005;
    m.fitBounds([x1 - pad, y1 - pad, x2 + pad, y2 + pad], { padding, maxZoom: 11, duration: 1200, pitch: pitchRef.current, bearing: pitchRef.current ? -12 : 0 });
  }, [ready, key]);

  // MapLibre makes its container position: relative, so it sits inside the absolute box.
  return (
    <div className="absolute inset-0">
      <div ref={el} className="explorer-map h-full w-full" style={{ background: OCEAN[scheme] }} role="region" aria-label="Map" />
    </div>
  );
}

const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
