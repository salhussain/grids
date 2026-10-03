/** Relative luminance (WCAG) of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Recolours the page with an organisation's primary colour (other steps derive in CSS). */
export function applyBrand(primary: string | undefined | null) {
  const root = document.documentElement;
  if (!primary || !/^#[0-9a-f]{6}$/i.test(primary)) {
    root.style.removeProperty('--brand-600');
    root.style.removeProperty('--brand-contrast');
    return;
  }
  root.style.setProperty('--brand-600', primary);
  root.style.setProperty('--brand-contrast', luminance(primary) > 0.35 ? '#161616' : '#ffffff');
}
