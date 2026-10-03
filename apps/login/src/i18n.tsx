import { catalogs, interpolate, isRtl, localeInfo, LOCALE_CODES, LOCALES, resolveLocale, type LocaleCode } from '@grids/i18n';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const KEY = 'grids.locale';

function lookup(tree: unknown, key: string): string | undefined {
  const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), tree);
  return typeof v === 'string' ? v : undefined;
}

interface I18n {
  locale: LocaleCode;
  /** Languages offered here: the organisation's enabled set, or all. */
  available: (typeof LOCALES)[number][];
  setLocale(code: LocaleCode): void;
  t(key: string, vars?: Record<string, string | number>): string;
}

const Ctx = createContext<I18n | null>(null);

export const useI18n = () => useContext(Ctx)!;
export const useT = () => useI18n().t;

const stored = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/**
 * Picks the language: the person's earlier choice on this device, then the app's
 * ui_locales hint, then the browser, limited to what the organisation enables and
 * falling back to the organisation's default.
 */
export function I18nProvider({
  enabled,
  fallback,
  hint,
  overrides,
  children,
}: {
  enabled?: string[] | null;
  fallback?: string | null;
  hint?: string | null;
  /** The organisation's own wording, per language. */
  overrides?: Record<string, Record<string, string>>;
  children: ReactNode;
}) {
  const allowed = enabled?.length ? enabled : LOCALE_CODES;
  const initial = () => resolveLocale([stored(), ...(hint?.split(' ') ?? []), ...navigator.languages], allowed, fallback ?? 'en');
  const [locale, setState] = useState<LocaleCode>(initial);
  const key = allowed.join(',');
  // Branding arrives after the first render: re-resolve within the organisation's languages.
  useEffect(() => setState(initial()), [key, fallback, hint]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
  }, [locale]);

  const setLocale = useCallback((code: LocaleCode) => {
    try {
      localStorage.setItem(KEY, code);
    } catch {
      /* not persisted */
    }
    setState(code);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      available: LOCALES.filter((l) => allowed.includes(l.code)),
      setLocale,
      t: (k, vars) =>
        interpolate(overrides?.[locale]?.[k] ?? lookup(catalogs[locale], k) ?? lookup(catalogs.en, k) ?? k, vars),
    }),
    [locale, key, setLocale, overrides],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const isDraft = (code: string) => localeInfo(code).status === 'draft';
