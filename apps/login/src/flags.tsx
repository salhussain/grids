import type { LocaleCode } from '@grids/i18n';

/** Simplified 20×14 flags. Arabic spans many countries, so it gets a script tile instead of one nation's flag. */
const FLAGS: Record<LocaleCode, string> = {
  en: '<rect width="20" height="14" fill="#012169"/><path d="M0 0l20 14M20 0L0 14" stroke="#fff" stroke-width="2.8"/><path d="M0 0l20 14M20 0L0 14" stroke="#C8102E" stroke-width="1"/><path d="M10 0v14M0 7h20" stroke="#fff" stroke-width="4.6"/><path d="M10 0v14M0 7h20" stroke="#C8102E" stroke-width="2.6"/>',
  fr: '<rect width="20" height="14" fill="#fff"/><rect width="6.67" height="14" fill="#002395"/><rect x="13.33" width="6.67" height="14" fill="#ED2939"/>',
  es: '<rect width="20" height="14" fill="#AA151B"/><rect y="3.5" width="20" height="7" fill="#F1BF00"/>',
  ar: '<rect width="20" height="14" fill="#3f3f46"/><text x="10" y="11" text-anchor="middle" font-size="10" font-family="IBM Plex Sans Arabic, sans-serif" fill="#fff">ع</text>',
  sm: '<rect width="20" height="14" fill="#CE1126"/><rect width="10" height="7" fill="#002B7F"/><g fill="#fff"><circle cx="5" cy="1.8" r=".7"/><circle cx="3.2" cy="3.6" r=".7"/><circle cx="6.8" cy="3.4" r=".7"/><circle cx="5" cy="5.4" r=".8"/><circle cx="6" cy="4.4" r=".4"/></g>',
  to: '<rect width="20" height="14" fill="#C10000"/><rect width="9" height="7" fill="#fff"/><path d="M4.5 1.2v4.6M2.2 3.5h4.6" stroke="#C10000" stroke-width="1.6"/>',
  bi: '<rect width="20" height="7" fill="#D21034"/><rect y="7" width="20" height="7" fill="#009543"/><path d="M0 5.6h20v2.8H0z" fill="#FDCE12"/><path d="M0 0L11 7 0 14z" fill="#FDCE12"/><path d="M0 1.2L9.2 7 0 12.8z" fill="#000"/><path d="M0 6.2h20v1.6H0z" fill="#000"/>',
  tpi: '<path d="M0 0h20L0 14z" fill="#000"/><path d="M20 0v14H0z" fill="#CE1126"/><g fill="#fff"><circle cx="3" cy="5.5" r=".6"/><circle cx="5" cy="3.5" r=".6"/><circle cx="5.2" cy="7" r=".6"/><circle cx="7" cy="5" r=".6"/><circle cx="4.2" cy="9" r=".4"/></g><path d="M12.5 5c2-1.4 4.2-1 5 .2-1.6-.2-2.6.4-3.2 1.6.8.4 1.6 1.4 1.4 3-1-1.4-2.6-1.8-3.6-1.2.2-1.2 0-2.4.4-3.6z" fill="#FCD116"/>',
};

export function Flag({ code }: { code: LocaleCode }) {
  return (
    <svg
      viewBox="0 0 20 14"
      className="block h-3.5 w-5 shrink-0 ring-1 ring-black/10"
      aria-hidden
      // Static, trusted markup defined above.
      dangerouslySetInnerHTML={{ __html: FLAGS[code] }}
    />
  );
}
