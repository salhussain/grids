import type { Theme } from '@grids/schema';
import { setChartColors } from '@grids/viz';

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
/** Six distinguishable shades of the brand colour, for chart series. */
export function brandRange(hex: string): string[] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const steps: [number, number, number][] = [
    [0, 1, 0.45],
    [0, 0.8, 0.65],
    [30, 0.9, 0.3],
    [-30, 0.7, 0.55],
    [180, 0.6, 0.45],
    [60, 0.7, 0.4],
  ];
  return steps.map(
    ([dh, ks, lightness]) =>
      `hsl(${Math.round((h + dh + 360) % 360)} ${Math.round(Math.min(1, sat * ks) * 100)}% ${Math.round(lightness * 100)}%)`,
  );
}

/** The series colours a theme asks for; null = the standard set. */
export function chartPalette(c: Theme['chartColors'] | undefined, brand: string): string[] | null {
  if (!c) return null;
  if (c.mode === 'brand') return brandRange(brand);
  return c.mode === 'custom' && c.colors.length ? c.colors : null;
}

/** Tab title: page name (if any) then the workspace name. */
export const tabTitle = (
  theme: Pick<Theme, 'tabTitle' | 'appName'>,
  fallback: string,
  page?: string,
) => [page, theme.tabTitle || theme.appName || fallback].filter(Boolean).join(' · ');

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  const p = theme.primaryColor;
  const vars: Record<string, string> = { '--brand-600': p, '--brand-contrast': contrastOn(p) };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  if (root === document.documentElement) {
    if (theme.favicon || theme.logo) setIconUrl(theme.favicon ?? theme.logo!);
    else setFavicon(p);
    setDarkIcon(theme.faviconDark);
    setChartColors(chartPalette(theme.chartColors, p));
    setToolbar(theme.toolbarColour ? p : null);
    try {
      localStorage.setItem(BRAND_KEY, p);
    } catch {
      /* storage unavailable: the next load starts in the default colour */
    }
  }
}

const BRAND_KEY = 'grids.brand';

/** The browser-tab icon in the organisation's colour. */
export function setFavicon(color: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='${color}'/><path d='M9 9h6v6H9zM17 9h6v6h-6zM9 17h6v6H9zM17 17h6v6h-6z' fill='${contrastOn(color)}'/></svg>`;
  const link = document.getElementById('favicon') as HTMLLinkElement | null;
  if (link) link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The colour of the browser toolbar on phones (null: the browser's own). */
function setToolbar(color: string | null) {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!color) return meta?.remove();
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}

/** An icon for browsers in dark mode (null: the normal icon is used). */
function setDarkIcon(href: string | null | undefined) {
  let link = document.getElementById('favicon-dark') as HTMLLinkElement | null;
  if (!href) return link?.remove();
  if (!link) {
    link = document.createElement('link');
    link.id = 'favicon-dark';
    link.rel = 'icon';
    link.media = '(prefers-color-scheme: dark)';
    document.head.appendChild(link);
  }
  link.href = href;
}

function setIconUrl(href: string) {
  const link = document.getElementById('favicon') as HTMLLinkElement | null;
  if (link) {
    link.href = href;
    link.removeAttribute('type');
  }
}

export function resetTheme(root: HTMLElement = document.documentElement) {
  for (const k of ['--brand-600', '--brand-contrast']) root.style.removeProperty(k);
  setChartColors(null);
  setToolbar(null);
  setDarkIcon(null);
}
