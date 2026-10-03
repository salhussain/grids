import type { Theme } from '@grids/schema';

/** Relative luminance (WCAG) of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Text colour with the better contrast on `hex`. */
export const contrastOn = (hex: string) => (luminance(hex) > 0.35 ? '#161616' : '#ffffff');

/**
 * Applies a tenant theme by setting the --brand-* tokens the shared design system
 * reads at runtime (`@theme inline`). The lighter/darker steps are mixed from the
 * primary colour in CSS (differently per light/dark mode), so one input recolours the workspace.
 */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  const p = theme.primaryColor;
  const vars: Record<string, string> = { '--brand-600': p, '--brand-contrast': contrastOn(p) };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

export function resetTheme(root: HTMLElement = document.documentElement) {
  for (const k of ['--brand-600', '--brand-contrast'])
    root.style.removeProperty(k);
}
