import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { STATUS, useScheme, type Scheme } from './scheme';

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: { type: 'Feature'; id?: string | number; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }[];
}

// CARTO's free vector basemaps (OpenStreetMap data) in both modes; no API key.
const STYLE: Record<Scheme, string> = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};

export interface MapOptions {
  warn?: number;
  alert?: number;
  labelAttribute?: string;
  unit?: string;
  /** Point colour when there are no thresholds (entity type colour otherwise). */
  color?: string;
  onSelect?: (properties: Record<string, unknown>) => void;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Points/areas from a GeoJSON FeatureCollection, coloured by thresholds when given. */
export function MapView({ data, options = {}, height = '100%', label }: { data: FeatureCollection | undefined; options?: MapOptions; height?: number | string; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const fitted = useRef(false);
  const scheme = useScheme();
  const latest = useRef({ data, options, scheme });
  latest.current = { data, options, scheme };

  const paint = () => {
    const m = map.current;
    const { data: d, options: o, scheme: s } = latest.current;
    if (!m || !m.isStyleLoaded()) return;
    const st = STATUS[s];
    const thresholds = o.warn !== undefined || o.alert !== undefined;
    const color: maplibregl.ExpressionSpecification | string = thresholds
      ? [
          'case',
          ['==', ['get', 'value'], null],
          st.none,
          ...(o.alert !== undefined ? [['>=', ['to-number', ['get', 'value']], o.alert], st.bad] : []),
          ...(o.warn !== undefined ? [['>=', ['to-number', ['get', 'value']], o.warn], st.warn] : []),
          st.good,
        ] as maplibregl.ExpressionSpecification
      : (o.color ?? ['coalesce', ['get', 'color'], '#0f62fe']);
    const fc = d ?? { type: 'FeatureCollection', features: [] };
    const src = m.getSource('features') as GeoJSONSource | undefined;
    if (src) src.setData(fc as never);
    else {
      m.addSource('features', { type: 'geojson', data: fc as never });
      m.addLayer({ id: 'areas', type: 'fill', source: 'features', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': color, 'fill-opacity': 0.35 } });
      m.addLayer({
        id: 'points',
        type: 'circle',
        source: 'features',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3.5, 8, 6, 12, 9],
          'circle-color': color,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': s === 'dark' ? '#111214' : '#ffffff',
        },
      });
      const labelField = o.labelAttribute;
      if (labelField)
        m.addLayer({
          id: 'labels',
          type: 'symbol',
          source: 'features',
          minzoom: 7,
          layout: { 'text-field': ['coalesce', ['get', labelField], ['get', 'name']], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
          paint: { 'text-color': s === 'dark' ? '#e2e3e8' : '#393939', 'text-halo-color': s === 'dark' ? '#111214' : '#ffffff', 'text-halo-width': 1.2 },
        });
    }
    if (m.getLayer('points')) {
      m.setPaintProperty('points', 'circle-color', color);
      m.setPaintProperty('areas', 'fill-color', color);
    }
    // Fit to the data once; later refreshes keep the viewer's position.
    if (!fitted.current && fc.features.length) {
      const b = new maplibregl.LngLatBounds();
      const add = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === 'number') b.extend(c as [number, number]);
        else if (Array.isArray(c)) c.forEach(add);
      };
      fc.features.forEach((f) => add(f.geometry.coordinates));
      m.fitBounds(b, { padding: 40, maxZoom: 11, duration: 0 });
      fitted.current = true;
    }
  };

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({ container: el.current, style: STYLE[scheme], center: [0, 20], zoom: 1.5, attributionControl: { compact: true } });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', paint);
    const popup = new maplibregl.Popup({ closeButton: false, offset: 10, maxWidth: '260px' });
    m.on('mouseenter', 'points', (e) => {
      m.getCanvas().style.cursor = 'pointer';
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, unknown>;
      const o = latest.current.options;
      const value = p.value !== undefined && p.value !== null && p.value !== 'null' ? `<div class="mt-1 tabular-nums">${esc(Number(p.value).toLocaleString())} ${esc(o.unit ?? '')}</div>` : '';
      const extra = o.labelAttribute && p[o.labelAttribute] !== undefined ? `<div class="text-xs opacity-70">${esc(p[o.labelAttribute])}</div>` : '';
      popup
        .setLngLat((f.geometry as { coordinates: [number, number] }).coordinates)
        .setHTML(`<div class="font-medium">${esc(p.name)}</div>${extra}${value}`)
        .addTo(m);
    });
    m.on('mouseleave', 'points', () => {
      m.getCanvas().style.cursor = '';
      popup.remove();
    });
    m.on('click', 'points', (e) => {
      const f = e.features?.[0];
      if (f) latest.current.options.onSelect?.(f.properties as Record<string, unknown>);
    });
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      fitted.current = false;
    };
  }, [scheme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(paint, [data, options.warn, options.alert, scheme]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} role="region" aria-label={label} className="grids-map" style={{ height, width: '100%' }} />;
}
