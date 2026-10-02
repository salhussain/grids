import ar from './locales/ar.js';
import bi from './locales/bi.js';
import en, { type Catalog } from './locales/en.js';
import es from './locales/es.js';
import fr from './locales/fr.js';
import sm from './locales/sm.js';
import tpi from './locales/tpi.js';
import to from './locales/to.js';
import type { LocaleCode } from './locales.js';

export * from './locales.js';
export type { Catalog };

/** All catalogs, by locale. Namespaces: common, auth, web, email. */
export const catalogs: Record<LocaleCode, Catalog> = { en, fr, es, ar, sm, to, bi, tpi };

/** i18next-style resources: { [lng]: { [ns]: tree } }. */
export const resources = Object.fromEntries(Object.entries(catalogs).map(([lng, c]) => [lng, c])) as Record<LocaleCode, Catalog>;

export const NAMESPACES = Object.keys(en) as (keyof Catalog)[];

/** Look up "ns.a.b" in a catalog. */
function lookup(catalog: unknown, key: string): string | undefined {
  const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), catalog);
  return typeof v === 'string' ? v : undefined;
}

export const interpolate = (template: string, vars: Record<string, string | number> = {}) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{{${k}}}`));

/** Server-side translator with English fallback (used for emails). */
export function translator(locale: string) {
  const c = catalogs[locale as LocaleCode] ?? en;
  return (key: string, vars?: Record<string, string | number>) => interpolate(lookup(c, key) ?? lookup(en, key) ?? key, vars);
}
