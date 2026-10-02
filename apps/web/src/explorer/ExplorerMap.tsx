import maplibregl, { type GeoJSONSource, type Map as MlMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';

export type Basemap = 'dark' | 'satellite';
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

const OCEAN = '#0b1626';
// Shown when the basemap can't be fetched (offline, blocked): the data still draws.
const BLANK: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': OCEAN } }] };
const DARK_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const SATELLITE: StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': OCEAN } },
    { id: 'imagery', type: 'raster', source: 'imagery' },
  ],
};

let darkStyle: Promise<StyleSpecification | string> | null = null;
/** The dark basemap if reachable within a few seconds, else a plain ocean. */
function resolveDark() {
  darkStyle ??= fetch(DARK_URL, { signal: AbortSignal.timeout(3500) })
    .then((r) => (r.ok ? DARK_URL : BLANK))
    .catch(() => BLANK);
  return darkStyle;
}

const POLY = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false] as maplibregl.ExpressionSpecification;
const POINT = ['==', ['geometry-type'], 'Point'] as maplibregl.ExpressionSpecification;

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
  onSelect(p: PlaceFeature['properties']): void;
  basemap: Basemap;
  accent: string;
  /** Map padding so places aren't hidden under floating panels. */
  padding: { top: number; right: number; bottom: number; left: number };
}

/** The explorer's map: outlined places with labels, coloured by the active overlay. */
export function ExplorerMap({ places, self, bounds, colorOf, detailOf, onSelect, basemap, accent, padding }: ExplorerMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const hovered = useRef<string | null>(null);
  const [ready, setReady] = useState(0);
  const latest = useRef({ places, self, colorOf, detailOf, onSelect, accent });
  latest.current = { places, self, colorOf, detailOf, onSelect, accent };

  // Create the map once; swap styles when the basemap changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const style = basemap === 'satellite' ? SATELLITE : await resolveDark();
      if (cancelled || !el.current) return;
      if (map.current) {
        map.current.setStyle(style as StyleSpecification);
        map.current.once('style.load', () => setReady((n) => n + 1));
        return;
      }
      const m = new maplibregl.Map({ container: el.current, style: style as StyleSpecification, center: [160, -5], zoom: 2, attributionControl: { compact: true } });
      map.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      m.on('load', () => setReady((n) => n + 1));
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'explorer-popup' });
      const hover = (id: string | null) => {
        if (hovered.current) m.setFeatureState({ source: 'places', id: hovered.current }, { hover: false });
        hovered.current = id;
        if (id) m.setFeatureState({ source: 'places', id }, { hover: true });
      };
      for (const layer of ['places-fill', 'places-point']) {
        m.on('mousemove', layer, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          m.getCanvas().style.cursor = 'pointer';
          hover(String(f.id ?? f.properties.id));
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
  }, [basemap]);

  useEffect(
    () => () => {
      markers.current.forEach((mk) => mk.remove());
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  // Data: (re)add sources and layers after any style load, then update them.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.isStyleLoaded()) return;
    const { places: pl, self: sf, colorOf: col, accent: ac } = latest.current;
    const data = {
      type: 'FeatureCollection' as const,
      features: (pl?.features ?? []).map((f) => ({ ...f, properties: { ...f.properties, fill: col ? col(f.properties) : null } })),
    };
    const selfData = { type: 'FeatureCollection' as const, features: sf ? [sf] : [] };
    const src = m.getSource('places') as GeoJSONSource | undefined;
    if (src) {
      src.setData(data as never);
      (m.getSource('self') as GeoJSONSource).setData(selfData as never);
    } else {
      m.addSource('self', { type: 'geojson', data: selfData as never });
      m.addSource('places', { type: 'geojson', data: data as never, promoteId: 'id' });
      m.addLayer({ id: 'self-fill', type: 'fill', source: 'self', filter: POLY, paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.03 } });
      m.addLayer({ id: 'self-line', type: 'line', source: 'self', filter: POLY, paint: { 'line-color': '#ffffff', 'line-opacity': 0.55, 'line-width': 1.5, 'line-dasharray': [2, 2] } });
      m.addLayer({
        id: 'places-fill',
        type: 'fill',
        source: 'places',
        filter: POLY,
        paint: {
          'fill-color': ['coalesce', ['get', 'fill'], ac],
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], ['case', ['!=', ['get', 'fill'], null], 0.92, 0.28], ['case', ['!=', ['get', 'fill'], null], 0.78, 0.08]],
        },
      });
      m.addLayer({
        id: 'places-line',
        type: 'line',
        source: 'places',
        filter: POLY,
        paint: {
          'line-color': ['case', ['!=', ['get', 'fill'], null], '#ffffff', ac],
          'line-opacity': ['case', ['!=', ['get', 'fill'], null], 0.7, 1],
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3.5, 2],
        },
      });
      m.addLayer({
        id: 'places-point',
        type: 'circle',
        source: 'places',
        filter: POINT,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 8, 8, 12, 11],
          'circle-color': ['coalesce', ['get', 'fill'], ac],
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 1.5],
          'circle-stroke-color': '#ffffff',
        },
      });
    }
    if (m.getLayer('places-line')) {
      m.setPaintProperty('places-fill', 'fill-color', ['coalesce', ['get', 'fill'], ac]);
      m.setPaintProperty('places-point', 'circle-color', ['coalesce', ['get', 'fill'], ac]);
      m.setPaintProperty('places-line', 'line-color', ['case', ['!=', ['get', 'fill'], null], '#ffffff', ac]);
    }

    // Label chips (HTML, so they look the same on any basemap).
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    const feats = pl?.features ?? [];
    // Areas get label chips; points (often dense) show theirs on hover.
    if (feats.length <= 150)
      for (const f of feats) {
        if (f.geometry.type === 'Point') continue;
        const at = labelPoint(f.geometry);
        if (!at) continue;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'explorer-label';
        const detail = latest.current.detailOf?.(f.properties);
        chip.innerHTML = `<span>${escapeHtml(f.properties.name)}</span>${detail ? `<em>${escapeHtml(detail)}</em>` : ''}`;
        chip.onclick = (e) => {
          e.stopPropagation();
          latest.current.onSelect(f.properties);
        };
        markers.current.push(new maplibregl.Marker({ element: chip, anchor: f.geometry.type === 'Point' ? 'top' : 'center', offset: f.geometry.type === 'Point' ? [0, 10] : [0, 0] }).setLngLat(at).addTo(m));
      }
  }, [ready, places, self, colorOf, detailOf, accent]);

  // Fly to the selected place.
  const key = bounds?.join(',');
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !bounds) return;
    const [x1, y1, x2, y2] = bounds;
    const pad = 0.0005;
    m.fitBounds([x1 - pad, y1 - pad, x2 + pad, y2 + pad], { padding, maxZoom: 11, duration: 900 });
  }, [ready, key]);

  // MapLibre makes its container position: relative, so it sits inside the absolute box.
  return (
    <div className="absolute inset-0">
      <div ref={el} className="explorer-map h-full w-full" style={{ background: OCEAN }} role="region" aria-label="Map" />
    </div>
  );
}

const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
