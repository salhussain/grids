import type { MapOverlayDto, OverlayPalette } from '@grids/schema';

/** Five-step sequential ramps (ColorBrewer), light → dark. */
const RAMPS: Record<OverlayPalette, string[]> = {
  heat: ['#fee8a8', '#fdbf6f', '#fb8b3c', '#e8512a', '#b5161c'],
  blues: ['#c6dbef', '#8fc1e3', '#5a9fd4', '#2f78bd', '#0d4f94'],
  greens: ['#c7e9c0', '#97d494', '#5cb86a', '#2b9246', '#0b6b2e'],
  purples: ['#dadaeb', '#bcbddc', '#9e9ac8', '#7a6ab4', '#54278f'],
  reds: ['#fcbba1', '#fc9272', '#fb6a4a', '#de2d26', '#a50f15'],
  // Good → bad (flipped when higher is better).
  performance: ['#2fb36a', '#9ccc3d', '#f2c230', '#f08a24', '#e0352b'],
};
export const NO_DATA = '#5b6270';

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Colour at t ∈ [0, 1] along a ramp (linear in RGB between stops). */
function along(ramp: string[], t: number) {
  const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const a = hex(ramp[i]!);
  const b = hex(ramp[i + 1]!);
  return toHex(a.map((v, k) => v + (b[k]! - v) * (x - i)));
}

export function rampOf(o: Pick<MapOverlayDto, 'palette' | 'higherIsBetter'>) {
  const r = RAMPS[o.palette];
  return o.palette === 'performance' && o.higherIsBetter ? [...r].reverse() : r;
}

export interface LegendItem {
  color: string;
  label: string;
}

const fmt = (v: number, decimals: number) => v.toLocaleString(undefined, { maximumFractionDigits: decimals });

/**
 * A colour function and legend for an overlay: class breaks when it defines
 * thresholds, else a continuous scale over the values on screen.
 */
export function scaleFor(o: MapOverlayDto, min: number | null, max: number | null) {
  const ramp = rampOf(o);
  if (o.thresholds.length) {
    const n = o.thresholds.length + 1;
    const colors = Array.from({ length: n }, (_, i) => along(ramp, n === 1 ? 1 : i / (n - 1)));
    const t = o.thresholds;
    const legend: LegendItem[] = colors.map((color, i) => ({
      color,
      label: i === 0 ? `< ${fmt(t[0]!, o.decimals)}` : i === n - 1 ? `≥ ${fmt(t[n - 2]!, o.decimals)}` : `${fmt(t[i - 1]!, o.decimals)} – ${fmt(t[i]!, o.decimals)}`,
    }));
    const color = (v: number | null) => {
      if (v === null) return NO_DATA;
      const i = t.findIndex((b) => v < b);
      return colors[i === -1 ? n - 1 : i]!;
    };
    return { color, legend, gradient: null as null | { from: string; to: string; stops: string[]; min: string; max: string } };
  }
  const lo = min ?? 0;
  const hi = max ?? 0;
  const color = (v: number | null) => (v === null ? NO_DATA : along(ramp, hi === lo ? 1 : (v - lo) / (hi - lo)));
  return {
    color,
    legend: [] as LegendItem[],
    gradient: min === null ? null : { from: ramp[0]!, to: ramp[ramp.length - 1]!, stops: ramp, min: fmt(lo, o.decimals), max: fmt(hi, o.decimals) },
  };
}

export const paletteSwatch = (p: OverlayPalette) => RAMPS[p];
