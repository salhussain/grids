import { useEffect, useState } from 'react';

export type Scheme = 'light' | 'dark';

/** The page's effective colour scheme (follows <html data-theme>). */
export function useScheme(): Scheme {
  const read = (): Scheme => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  const [scheme, setScheme] = useState<Scheme>(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setScheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return scheme;
}

/**
 * Categorical hues in a fixed order (IBM Carbon's accessible categorical palette),
 * one sequence per mode. Series keep their hue by position in the query's
 * element list, never by rank.
 */
export const CATEGORICAL: Record<Scheme, string[]> = {
  light: ['#6929c4', '#1192e8', '#005d5d', '#9f1853', '#fa4d56', '#198038', '#002d9c', '#b28600'],
  dark: ['#8a3ffc', '#33b1ff', '#08bdba', '#ff7eb6', '#fa4d56', '#6fdc8c', '#4589ff', '#d2a106'],
};

/** Reserved status colours (thresholds): never reused for series. */
export const STATUS: Record<Scheme, { good: string; warn: string; bad: string; none: string }> = {
  light: { good: '#198038', warn: '#f1c21b', bad: '#da1e28', none: '#8d8d8d' },
  dark: { good: '#42be65', warn: '#f1c21b', bad: '#fa4d56', none: '#6f6f6f' },
};

/** Recessive chart chrome per mode. */
export const INK: Record<Scheme, { text: string; muted: string; grid: string; axis: string; surface: string; tooltip: string }> = {
  light: { text: '#161616', muted: '#6f6f6f', grid: '#e8e8e8', axis: '#c6c6c6', surface: '#ffffff', tooltip: '#ffffff' },
  dark: { text: '#f2f2f3', muted: '#9b9ca4', grid: '#2a2b30', axis: '#43444a', surface: '#1a1b1e', tooltip: '#26272b' },
};

/** The tenant's primary colour (set by the workspace theme). */
export const brandColor = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--brand-600').trim() || '#0f62fe';

export function thresholdColor(value: number | null | undefined, warn: number | undefined, alert: number | undefined, scheme: Scheme) {
  const s = STATUS[scheme];
  if (value === null || value === undefined) return s.none;
  if (alert !== undefined && value >= alert) return s.bad;
  if (warn !== undefined && value >= warn) return s.warn;
  return s.good;
}
