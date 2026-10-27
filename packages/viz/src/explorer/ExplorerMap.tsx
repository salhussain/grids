import maplibregl, { type GeoJSONSource, type Map as MlMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { OverlayDisplay } from '@grids/schema';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ensureMarkerImages, HAS_MARKER_IMAGE, MARKER_LAYOUT, markerImageId } from '../markers';

/** `map` is the organisation's vector style; the rest are ready-made imagery and cartography. */
export type Basemap = 'map' | 'streets' | 'topo' | 'natgeo' | 'relief' | 'grey' | 'dark' | 'satellite';
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
interface RasterBase {
  label: string;
  /** Esri service path, e.g. `World_Topo_Map`. */
  service: string;
  maxzoom: number;
  /** Boundaries and place names drawn over the imagery. */
  reference?: string;
  /** Dark backdrop: labels and outlines switch to light. */
  dark?: boolean;
}
/** Ready-made base maps from Esri (no key). */
export const RASTER_BASES: Partial<Record<Basemap, RasterBase>> = {
  streets: { label: 'Streets', service: 'World_Street_Map', maxzoom: 19 },
  topo: { label: 'Topographic', service: 'World_Topo_Map', maxzoom: 19 },
  natgeo: { label: 'National Geographic', service: 'NatGeo_World_Map', maxzoom: 16 },
  relief: { label: 'Shaded relief', service: 'World_Shaded_Relief', maxzoom: 13 },
  grey: { label: 'Light grey', service: 'Canvas/World_Light_Gray_Base', maxzoom: 16, reference: 'Canvas/World_Light_Gray_Reference' },
  dark: { label: 'Dark grey', service: 'Canvas/World_Dark_Gray_Base', maxzoom: 16, reference: 'Canvas/World_Dark_Gray_Reference', dark: true },
  satellite: { label: 'Satellite', service: 'World_Imagery', maxzoom: 19, reference: 'Reference/World_Boundaries_and_Places', dark: true },
};
const tiles = (service: string) => `${ESRI}/${service}/MapServer/tile/{z}/{y}/{x}`;
function rasterStyle(b: RasterBase): StyleSpecification {
  const attribution = b.service === 'World_Imagery' ? 'Imagery © Esri, Maxar, Earthstar Geographics' : '© Esri and its data providers';
  return {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: [tiles(b.service)], tileSize: 256, maxzoom: b.maxzoom, attribution },
      ...(b.reference && { reference: { type: 'raster' as const, tiles: [tiles(b.reference)], tileSize: 256, maxzoom: b.maxzoom } }),
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': b.dark ? OCEAN.dark : OCEAN.light } },
      { id: 'base', type: 'raster', source: 'base' },
      ...(b.reference ? [{ id: 'reference', type: 'raster' as const, source: 'reference', paint: { 'raster-opacity': 0.9 } }] : []),
    ],
  };
}
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

/** Where to put a place's label: its point (or centre point), or the centre of its largest ring's box. */
function labelPoint(g: PlaceFeature['geometry'], centre?: unknown): [number, number] | null {
  if (Array.isArray(centre) && typeof centre[0] === 'number') return centre as [number, number];
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

/** One overlay drawn over the map. Layers are given bottom to top, so a later one covers an earlier one. */
export interface Camera {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface MapLayer {
  key: string;
  name: string;
  features: PlaceCollection | undefined;
  /** Fill colour per place. */
  colorOf: (p: PlaceFeature['properties']) => string;
  /** The layer's value for a place, as text (null: no data). */
  detailOf: (p: PlaceFeature['properties']) => string | null;
  /** How the values are drawn. */
  display: OverlayDisplay;
  /** 0 to 1: how much of the map shows through is 1 minus this. */
  opacity: number;
}

export interface ExplorerMapProps {
  places: PlaceCollection | undefined;
  self: PlaceFeature | null;
  bounds: [number, number, number, number] | null;
  /** The overlays on, bottom to top. */
  layers?: MapLayer[];
  /** Which layers hover cards list (default: the ones drawn). */
  hoverLayers?: MapLayer[];
  /** Called as the camera moves, so a second map can follow. */
  onCamera?(c: Camera): void;
  /** Set to a function that moves this map's camera (for the following map). */
  applyRef?: { current: ((c: Camera) => void) | null };
  /** Where the camera starts, instead of the world view. */
  initialCamera?: Camera | null;
  onSelect(p: PlaceFeature['properties']): void;
  basemap: Basemap;
  /** Drawn as a globe when zoomed out (else a flat map). */
  globe?: boolean;
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
function MapCanvas({ places, self, bounds, layers = [], hoverLayers, onCamera, applyRef, initialCamera, onSelect, basemap, globe = true, scheme, styles, accent, padding }: ExplorerMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const hovered = useRef<string | null>(null);
  // True between setStyle() and its style.load (sources and layers are being replaced).
  const swapping = useRef(false);
  // Camera tilt wanted by the current display (3D columns tilt; others are flat).
  const pitchRef = useRef(0);
  const [ready, setReady] = useState(0);
  const latest = useRef({ places, self, layers, hoverLayers, onCamera, initialCamera, onSelect, accent, scheme, bounds, globe });
  latest.current = { places, self, layers, hoverLayers, onCamera, initialCamera, onSelect, accent, scheme, bounds, globe };
  // Overlay layers already given their map layers (and which display they were made for), and ones that already listen for the mouse.
  const built = useRef(new Map<string, string>());
  const wired = useRef(new Set<string>());
  const wiring = useRef<(layer: string) => void>(() => undefined);
  const styleUrl = (scheme === 'dark' ? styles?.dark : styles?.light) || DEFAULT_STYLES[scheme];

  // Create the map once; swap styles when the basemap or mode changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raster = RASTER_BASES[basemap];
      const style = raster ? rasterStyle(raster) : await resolveStyle(styleUrl, scheme);
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
      const start = latest.current.initialCamera;
      const m = new maplibregl.Map({ container: el.current, style: style as StyleSpecification, center: start?.center ?? [160, -5], zoom: start?.zoom ?? 1.6, bearing: start?.bearing ?? 0, pitch: start?.pitch ?? 0, attributionControl: { compact: true }, maxPitch: 70 });
      if (applyRef) applyRef.current = (c) => m.jumpTo(c);
      m.on('move', () => latest.current.onCamera?.({ center: m.getCenter().toArray() as [number, number], zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() }));
      map.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
      // The projection is set the moment each style arrives, before anything is drawn (no flat-then-globe flash).
      m.on('style.load', () => m.setProjection({ type: latest.current.globe ? 'globe' : 'mercator' }));
      m.on('load', () => setReady((n) => n + 1));
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'explorer-popup' });
      const hover = (id: string | null) => {
        if (hovered.current) m.setFeatureState({ source: 'places', id: hovered.current }, { hover: false });
        hovered.current = id;
        if (id) m.setFeatureState({ source: 'places', id }, { hover: true });
      };
      // Hover and click on a place show every overlay's value for it; overlay layers are wired when they are added.
      const wire = (layer: string) => {
        if (wired.current.has(layer)) return;
        wired.current.add(layer);
        m.on('mousemove', layer, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          m.getCanvas().style.cursor = 'pointer';
          const id = String(f.properties.id ?? f.id);
          hover(id);
          const p = f.properties as PlaceFeature['properties'];
          const lines = (latest.current.hoverLayers ?? latest.current.layers).flatMap((l) => {
            const hit = l.features?.features.find((x) => String(x.properties.id ?? x.id) === id);
            return hit ? [`<div><span class="explorer-popup-k">${escapeHtml(l.name)}</span> ${escapeHtml(l.detailOf(hit.properties) ?? 'No data')}</div>`] : [];
          });
          popup.setLngLat(e.lngLat).setHTML(`<strong>${escapeHtml(p.name)}</strong>${lines.join('')}`).addTo(m);
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
      };
      wiring.current = wire;
      for (const layer of ['places-fill', 'places-point', 'places-symbol']) wire(layer);
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

  // Switching between the globe and the flat map without reloading the style.
  useEffect(() => {
    const m = map.current;
    if (m && ready && !swapping.current) m.setProjection({ type: globe ? 'globe' : 'mercator' });
  }, [globe, ready]);

  // The flat map ends at the poles: never zoom out past the point where the world fills the screen
  // (no empty bands above and below). The globe has no edges to protect.
  useEffect(() => {
    const m = map.current;
    const box = el.current;
    if (!m || !box) return;
    const limit = () => m.setMinZoom(globe ? 0 : Math.max(0, Math.log2(box.clientHeight / 512)));
    limit();
    const ro = new ResizeObserver(limit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [globe, ready]);

  // Scene (globe, sky, hillshade) and data layers, re-added after any style load.
  useEffect(() => {
    // Not isStyleLoaded(): it is briefly false while a GeoJSON source re-parses.
    const m = map.current;
    if (!m || !ready || swapping.current) return;
    const { places: pl, self: sf, accent: ac, scheme: sc, bounds: bb } = latest.current;
    const dark = RASTER_BASES[basemap] ? !!RASTER_BASES[basemap]!.dark : sc === 'dark';
    const edge = dark ? '#ffffff' : '#1f2937';

    if (!m.getSource('dem')) {
      // A globe at low zoom that flattens as you zoom in, with a soft atmosphere.
      m.setProjection({ type: latest.current.globe ? 'globe' : 'mercator' });
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

    const feats = pl?.features ?? [];
    const stack = latest.current.layers;
    // Pins and icons of the places themselves take their type's colour; an overlay recolours them on its own layer.
    const features = feats.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        markerImage: f.geometry.type === 'Point' ? markerImageId(f.properties.marker, f.properties.icon, (f.properties.color as string | undefined) ?? ac) : null,
      } as PlaceFeature['properties'],
    }));
    const data = { type: 'FeatureCollection' as const, features };
    const selfData = { type: 'FeatureCollection' as const, features: sf ? [sf] : [] };
    // Column height scales with the area on screen: ~15% of its width at the tallest.
    const span = bb ? Math.max(bb[2] - bb[0], bb[3] - bb[1]) : 5;
    const maxHeight = Math.max(4_000, Math.min(600_000, span * 111_000 * 0.3));
    const vis = (id: string, on: boolean) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    // The overlays on top of a fresh style have to be made again.
    if (!m.getSource('places')) built.current.clear();
    const drawsPins = stack.some((l) => l.display === 'shade' || l.display === 'extrude');

    const src = m.getSource('places') as GeoJSONSource | undefined;
    if (src) {
      src.setData(data as never);
      (m.getSource('self') as GeoJSONSource).setData(selfData as never);
    } else {
      m.addSource('self', { type: 'geojson', data: selfData as never });
      m.addSource('places', { type: 'geojson', data: data as never, promoteId: 'id' });
      m.addLayer({ id: 'self-line', type: 'line', source: 'self', filter: POLY, paint: { 'line-color': edge, 'line-opacity': 0.5, 'line-width': 1.5, 'line-dasharray': [2, 2] } });
      m.addLayer({ id: 'places-fill', type: 'fill', source: 'places', filter: POLY, paint: { 'fill-color': ac, 'fill-opacity': 0.1 } });
      m.addLayer({ id: 'places-line', type: 'line', source: 'places', filter: POLY, paint: { 'line-color': ac, 'line-width': 2 } });
      m.addLayer({
        id: 'places-point',
        type: 'circle',
        source: 'places',
        filter: ['all', POINT, ['!', HAS_MARKER_IMAGE]],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 8, 8, 12, 11] },
      });
      m.addLayer({ id: 'places-symbol', type: 'symbol', source: 'places', filter: ['all', POINT, HAS_MARKER_IMAGE], layout: MARKER_LAYOUT });
    }
    // Pin and icon images are drawn on demand; redraw the places once they're in.
    void ensureMarkerImages(m, features.map((f) => f.properties.markerImage)).then((added) => {
      if (added && map.current === m) (m.getSource('places') as GeoJSONSource | undefined)?.setData(data as never);
    });
    m.setPaintProperty('places-fill', 'fill-opacity', ['case', HOVER, 0.22, stack.length ? 0.04 : 0.1]);
    m.setPaintProperty('places-line', 'line-color', ac);
    m.setPaintProperty('places-line', 'line-opacity', stack.length ? 0.65 : 0.9);
    m.setPaintProperty('places-line', 'line-width', ['case', HOVER, 3.5, 1.75]);
    m.setPaintProperty('places-point', 'circle-color', ['coalesce', ['get', 'color'], ac]);
    m.setPaintProperty('places-point', 'circle-stroke-width', ['case', HOVER, 3, 1.5]);
    m.setPaintProperty('places-point', 'circle-stroke-color', dark ? '#0c1420' : '#ffffff');
    m.setPaintProperty('self-line', 'line-color', edge);
    vis('places-point', !drawsPins);
    vis('places-symbol', !drawsPins);

    // ---- the overlays, bottom to top: each has its own sources and layers, made once and then updated.
    const idsOf = (k: string, display: OverlayDisplay) =>
      display === 'shade' ? [`ov:${k}:fill`, `ov:${k}:pt`, `ov:${k}:sym`] : display === 'extrude' ? [`ov:${k}:ext`] : display === 'bubbles' ? [`ov:${k}:bub`] : [`ov:${k}:heat`];
    const drop = (k: string, display: OverlayDisplay) => {
      for (const id of idsOf(k, display)) if (m.getLayer(id)) m.removeLayer(id);
      for (const id of [`ov:${k}`, `ov:${k}:c`]) if (m.getSource(id)) m.removeSource(id);
      built.current.delete(k);
    };
    for (const [k, display] of [...built.current]) if (!stack.some((l) => l.key === k)) drop(k, display as OverlayDisplay);
    const layerImages: (string | null)[] = [];
    for (const l of stack) {
      const k = l.key;
      const fs = l.features?.features ?? [];
      const vals = fs.map((f) => f.properties.value).filter((v): v is number => typeof v === 'number');
      const lo = vals.length ? Math.min(...vals) : 0;
      const hi = vals.length ? Math.max(...vals) : 0;
      const t = (v: unknown) => (typeof v === 'number' ? (hi === lo ? 1 : (v - lo) / (hi - lo)) : 0);
      const lf = fs.map((f) => {
        const fill = l.colorOf(f.properties);
        return { ...f, properties: { ...f.properties, fill, t: t(f.properties.value), markerImage: f.geometry.type === 'Point' ? markerImageId(f.properties.marker, f.properties.icon, fill) : null } as PlaceFeature['properties'] };
      });
      layerImages.push(...lf.map((f) => f.properties.markerImage as string | null));
      const ldata = { type: 'FeatureCollection' as const, features: lf };
      // Bubbles and heat sit at each place's label point (areas become points).
      const centroids = {
        type: 'FeatureCollection' as const,
        features: lf.flatMap((f) => {
          const at = labelPoint(f.geometry, f.properties.point);
          return at && f.properties.value !== null && f.properties.value !== undefined ? [{ type: 'Feature' as const, id: f.id, geometry: { type: 'Point', coordinates: at }, properties: f.properties }] : [];
        }),
      };
      if (built.current.get(k) && built.current.get(k) !== l.display) drop(k, built.current.get(k) as OverlayDisplay);
      if (!built.current.has(k)) {
        m.addSource(`ov:${k}`, { type: 'geojson', data: ldata as never, promoteId: 'id' });
        m.addSource(`ov:${k}:c`, { type: 'geojson', data: centroids as never, promoteId: 'id' });
        const before = 'places-line';
        if (l.display === 'shade') {
          m.addLayer({ id: `ov:${k}:fill`, type: 'fill', source: `ov:${k}`, filter: POLY, paint: { 'fill-color': ['coalesce', ['get', 'fill'], ac] } }, before);
          m.addLayer({ id: `ov:${k}:pt`, type: 'circle', source: `ov:${k}`, filter: ['all', POINT, ['!', HAS_MARKER_IMAGE]], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 8, 8, 12, 11] } }, before);
          m.addLayer({ id: `ov:${k}:sym`, type: 'symbol', source: `ov:${k}`, filter: ['all', POINT, HAS_MARKER_IMAGE], layout: MARKER_LAYOUT }, before);
        } else if (l.display === 'extrude') m.addLayer({ id: `ov:${k}:ext`, type: 'fill-extrusion', source: `ov:${k}`, filter: POLY, paint: { 'fill-extrusion-height-transition': { duration: 600, delay: 0 } } as never }, before);
        else if (l.display === 'bubbles') m.addLayer({ id: `ov:${k}:bub`, type: 'circle', source: `ov:${k}:c`, paint: {} }, before);
        else m.addLayer({ id: `ov:${k}:heat`, type: 'heatmap', source: `ov:${k}:c`, paint: {} }, before);
        built.current.set(k, l.display);
        for (const id of idsOf(k, l.display)) wiring.current(id);
      } else {
        (m.getSource(`ov:${k}`) as GeoJSONSource).setData(ldata as never);
        (m.getSource(`ov:${k}:c`) as GeoJSONSource).setData(centroids as never);
      }
      const ring = dark ? '#0c1420' : '#ffffff';
      if (l.display === 'shade') {
        m.setPaintProperty(`ov:${k}:fill`, 'fill-opacity', ['case', HOVER, Math.min(1, 0.95 * l.opacity), 0.8 * l.opacity]);
        m.setPaintProperty(`ov:${k}:pt`, 'circle-color', ['coalesce', ['get', 'fill'], ac]);
        m.setPaintProperty(`ov:${k}:pt`, 'circle-opacity', l.opacity);
        m.setPaintProperty(`ov:${k}:pt`, 'circle-stroke-width', 1.5);
        m.setPaintProperty(`ov:${k}:pt`, 'circle-stroke-color', ring);
        m.setPaintProperty(`ov:${k}:pt`, 'circle-stroke-opacity', l.opacity);
        m.setPaintProperty(`ov:${k}:sym`, 'icon-opacity', l.opacity);
      } else if (l.display === 'extrude') {
        m.setPaintProperty(`ov:${k}:ext`, 'fill-extrusion-color', ['coalesce', ['get', 'fill'], ac]);
        m.setPaintProperty(`ov:${k}:ext`, 'fill-extrusion-opacity', 0.88 * l.opacity);
        m.setPaintProperty(`ov:${k}:ext`, 'fill-extrusion-height', ['*', ['max', ['get', 't'], 0.04], maxHeight]);
      } else if (l.display === 'bubbles') {
        m.setPaintProperty(`ov:${k}:bub`, 'circle-color', ['coalesce', ['get', 'fill'], ac]);
        m.setPaintProperty(`ov:${k}:bub`, 'circle-radius', ['+', 6, ['*', 34, ['sqrt', ['get', 't']]]]);
        m.setPaintProperty(`ov:${k}:bub`, 'circle-opacity', 0.82 * l.opacity);
        m.setPaintProperty(`ov:${k}:bub`, 'circle-stroke-width', 1.5);
        m.setPaintProperty(`ov:${k}:bub`, 'circle-stroke-color', ring);
        m.setPaintProperty(`ov:${k}:bub`, 'circle-stroke-opacity', l.opacity);
      } else {
        m.setPaintProperty(`ov:${k}:heat`, 'heatmap-opacity', 0.85 * l.opacity);
        m.setPaintProperty(`ov:${k}:heat`, 'heatmap-weight', ['+', 0.1, ['get', 't']]);
        m.setPaintProperty(`ov:${k}:heat`, 'heatmap-radius', ['interpolate', ['linear'], ['zoom'], 3, 30, 8, 60, 12, 90]);
        m.setPaintProperty(`ov:${k}:heat`, 'heatmap-intensity', ['interpolate', ['linear'], ['zoom'], 3, 1, 10, 2]);
        m.setPaintProperty(`ov:${k}:heat`, 'heatmap-color', ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.15, '#fee8a8', 0.4, '#fdbf6f', 0.65, '#fb8b3c', 0.85, '#e8512a', 1, '#b5161c']);
      }
    }
    // Stacking order: each layer goes just under the places' outlines, in turn, so the last one given ends on top.
    for (const l of stack) for (const id of idsOf(l.key, l.display)) if (m.getLayer(id)) m.moveLayer(id, 'places-line');
    void ensureMarkerImages(m, layerImages).then((added) => {
      if (!added || map.current !== m) return;
      for (const l of stack) (m.getSource(`ov:${l.key}`) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: (l.features?.features ?? []).map((f) => ({ ...f, properties: { ...f.properties, fill: l.colorOf(f.properties), markerImage: f.geometry.type === 'Point' ? markerImageId(f.properties.marker, f.properties.icon, l.colorOf(f.properties)) : null } })) } as never);
    });

    // Tilt the camera for columns; flat otherwise.
    const pitch = stack.some((l) => l.display === 'extrude' && l.opacity > 0) ? 55 : 0;
    pitchRef.current = pitch;
    if (Math.abs(m.getPitch() - pitch) > 1) m.easeTo({ pitch, bearing: pitch ? -12 : 0, duration: 900 });

    // Label pills (HTML, so they look the same on any basemap): the top layer's places with its value, else the places.
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    const top = stack.at(-1);
    const pills = top?.features?.features.length ? top.features.features : feats;
    // Areas get label pills; points (often dense) show theirs on hover.
    if (pills.length <= 150 && !(top && top.display === 'heatmap'))
      for (const f of pills) {
        if (f.geometry.type === 'Point') continue;
        const at = labelPoint(f.geometry, f.properties.point);
        if (!at) continue;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'explorer-label';
        const detail = top?.detailOf(f.properties);
        // A pill: a dot in the place's colour, its name, and the overlay value.
        const dot = top ? top.colorOf(f.properties) : ac;
        chip.innerHTML = `<i style="background:${dot}"></i><span>${escapeHtml(f.properties.name)}</span>${detail ? `<em>${escapeHtml(detail)}</em>` : ''}`;
        chip.onclick = (e) => {
          e.stopPropagation();
          latest.current.onSelect(f.properties);
        };
        const below = top?.display === 'bubbles';
        markers.current.push(new maplibregl.Marker({ element: chip, anchor: below ? 'top' : 'center', offset: below ? [0, 18] : [0, 0] }).setLngLat(at).addTo(m));
      }
  }, [ready, places, self, layers, accent, scheme, basemap]);

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

/** Two layers side by side: the left one shows left of the divider, the right one to its right. */
export interface MapCompare {
  left: MapLayer;
  right: MapLayer;
  /** Where the divider is, 0 to 100 across the map. */
  x: number;
  onX(x: number): void;
}

/**
 * The explorer's map. In compare mode a second map, the same view with only the left layer, lies over the first and is
 * cut off at the divider; it follows the first one's camera, and the first takes the mouse.
 */
export function ExplorerMap({ compare, layers, ...rest }: ExplorerMapProps & { compare?: MapCompare | null }) {
  const follow = useRef<((c: Camera) => void) | null>(null);
  const last = useRef<Camera | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const onCamera = (c: Camera) => {
    last.current = c;
    follow.current?.(c);
  };
  useEffect(() => {
    if (!compare) follow.current = null;
  }, [compare]);
  const rightOnly = useMemo(() => (compare ? [compare.right] : layers), [compare?.right, layers]);
  const leftOnly = useMemo(() => (compare ? [compare.left] : []), [compare?.left]);
  const both = useMemo(() => (compare ? [compare.left, compare.right] : undefined), [compare?.left, compare?.right]);
  const drag = (e: React.PointerEvent) => {
    if (!compare || !box.current) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = box.current!.getBoundingClientRect();
      compare.onX(Math.min(98, Math.max(2, ((ev.clientX - r.left) / r.width) * 100)));
    };
    const stop = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', stop);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', stop);
  };
  return (
    <div ref={box} className="absolute inset-0">
      <MapCanvas {...rest} layers={rightOnly} hoverLayers={both} onCamera={compare ? onCamera : undefined} />
      {compare && (
        <>
          <div className="pointer-events-none absolute inset-0" style={{ clipPath: `inset(0 ${100 - compare.x}% 0 0)` }}>
            <MapCanvas {...rest} bounds={null} layers={leftOnly} applyRef={follow} initialCamera={last.current} />
          </div>
          <div
            role="slider"
            aria-label="Compare layers"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(compare.x)}
            tabIndex={0}
            onPointerDown={drag}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') compare.onX(Math.max(2, compare.x - 2));
              if (e.key === 'ArrowRight') compare.onX(Math.min(98, compare.x + 2));
            }}
            className="absolute top-0 bottom-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize touch-none"
            style={{ left: `${compare.x}%` }}
          >
            <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.25)]" />
            <div className="absolute top-1/2 left-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-zinc-700 shadow-[var(--shadow-raised)]">
              <span className="text-sm leading-none font-bold">⇆</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
