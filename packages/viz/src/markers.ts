import type { ExpressionSpecification, Map as MlMap } from 'maplibre-gl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { iconOf } from './icons';

/** How a place is drawn: a dot (circle layer), a pin with its type's icon, or the icon itself. */
export type MarkerStyle = 'dot' | 'pin' | 'icon';

/** Icons drawn pointing somewhere other than up, by how far clockwise they point (so headings line up). */
const ICON_HEADING: Record<string, number> = { plane: 45 };

const PIXEL_RATIO = 2;

/** The map image for a marker, or null for a plain dot. */
export function markerImageId(style: unknown, icon: unknown, color: string): string | null {
  return style === 'pin' || style === 'icon' ? `${style}|${String(icon || 'box')}|${color}` : null;
}

/** Points drawn as images rather than dots. */
export const HAS_MARKER_IMAGE = ['!=', ['get', 'markerImage'], null] as ExpressionSpecification;

/** Symbol layout for marker images: pins stand on their point, icons sit on it (and turn). */
export const MARKER_LAYOUT = {
  'icon-image': ['get', 'markerImage'] as ExpressionSpecification,
  'icon-anchor': ['match', ['get', 'marker'], 'pin', 'bottom', 'center'] as ExpressionSpecification,
  'icon-rotate': [
    'match',
    ['get', 'marker'],
    'icon',
    ['to-number', ['coalesce', ['get', 'rotation'], 0]],
    0,
  ] as ExpressionSpecification,
  'icon-rotation-alignment': 'map' as const,
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
  'icon-size': [
    'interpolate',
    ['linear'],
    ['zoom'],
    3,
    0.75,
    8,
    1,
    13,
    1.2,
  ] as ExpressionSpecification,
};

function iconSvg(
  name: string,
  props: {
    color: string;
    strokeWidth: number;
    size: number;
    x?: number;
    y?: number;
    turn?: number;
  },
) {
  const markup = renderToStaticMarkup(
    createElement(iconOf(name), {
      color: props.color,
      strokeWidth: props.strokeWidth,
      size: props.size,
    }),
  );
  const turned = props.turn
    ? markup.replace(
        /(<svg[^>]*>)([\s\S]*)(<\/svg>)/,
        `$1<g transform="rotate(${props.turn} 12 12)">$2</g>$3`,
      )
    : markup;
  // Position the nested <svg> inside the marker.
  return turned.replace('<svg ', `<svg x="${props.x ?? 0}" y="${props.y ?? 0}" `);
}

/** The marker as an SVG document (drawn at PIXEL_RATIO). */
function markerSvg(id: string): { svg: string; width: number; height: number } {
  const [style, icon = 'box', color = '#0f62fe'] = id.split('|');
  const r = PIXEL_RATIO;
  if (style === 'pin') {
    const w = 30 * r;
    const h = 38 * r;
    const inner = iconSvg(icon, { color, strokeWidth: 2.5, size: 13 * r, x: 8.5 * r, y: 7.5 * r });
    return {
      width: w,
      height: h,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g transform="scale(${r})"><path d="M15 37C15 37 2.5 23.4 2.5 14.5a12.5 12.5 0 0 1 25 0C27.5 23.4 15 37 15 37Z" fill="${color}" stroke="#ffffff" stroke-width="2"/><circle cx="15" cy="14" r="8.5" fill="#ffffff"/></g>${inner}</svg>`,
    };
  }
  // The icon itself, with a white halo so it reads on any basemap; pointed up so headings line up.
  const s = 26 * r;
  const turn = -(ICON_HEADING[icon] ?? 0);
  const halo = iconSvg(icon, { color: '#ffffff', strokeWidth: 5, size: s, turn });
  const body = iconSvg(icon, { color, strokeWidth: 2.25, size: s, turn });
  return {
    width: s,
    height: s,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${halo}${body}</svg>`,
  };
}

const loaded = new Map<string, Promise<HTMLImageElement>>();
function load(id: string): Promise<HTMLImageElement> {
  let p = loaded.get(id);
  if (!p) {
    const { svg, width, height } = markerSvg(id);
    const img = new Image(width, height);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    p = img.decode().then(() => img);
    loaded.set(id, p);
  }
  return p;
}

/**
 * Adds the marker images a map needs (they are drawn once and cached). Resolves
 * true when it added any, so the caller can redraw its features.
 */
export async function ensureMarkerImages(map: MlMap, ids: Iterable<unknown>): Promise<boolean> {
  const has = (id: string) => {
    try {
      return map.hasImage(id);
    } catch {
      return true; // the map is gone
    }
  };
  const missing = [...new Set(ids)].filter(
    (id): id is string => typeof id === 'string' && !has(id),
  );
  if (!missing.length) return false;
  const images = await Promise.all(
    missing.map((id) =>
      load(id)
        .then((img) => [id, img] as const)
        .catch(() => null),
    ),
  );
  let added = false;
  for (const entry of images) {
    if (!entry || has(entry[0])) continue;
    try {
      map.addImage(entry[0], entry[1], { pixelRatio: PIXEL_RATIO });
      added = true;
    } catch {
      /* style is being replaced; the next draw adds it */
    }
  }
  return added;
}
