import {
  catalogs,
  interpolate,
  isRtl,
  LOCALES,
  resolveLocale,
  type LocaleCode,
} from '@grids/i18n';
import type { LocalizationDto } from '@grids/schema';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

type Vars = Record<string, string | number>;
export type T = (key: string, vars?: Vars) => string;

interface I18n {
  locale: LocaleCode;
  t: T;
}

function lookup(tree: unknown, key: string): string | undefined {
  const v = key
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      tree,
    );
  return typeof v === 'string' ? v : undefined;
}

const Ctx = createContext<I18n>({
  locale: 'en',
  t: (k, vars) => interpolate(lookup(catalogs.en, k) ?? k, vars),
});
export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;

/**
 * Which language a person sees in a workspace: their own choice if the organisation
 * offers it, else their browser's languages, else the organisation's default.
 */
export function workspaceLocale(
  preferred: string | null | undefined,
  localization?: LocalizationDto | null,
): LocaleCode {
  return resolveLocale(
    [preferred, ...navigator.languages],
    localization?.languages,
    localization?.defaultLanguage ?? 'en',
  );
}

/** Provides `t()` with the organisation's wording overrides layered over the catalogs. */
export function I18nProvider({
  locale,
  overrides,
  children,
}: {
  locale: LocaleCode;
  overrides?: Record<string, string>;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('grids.locale', locale); // the sign-in page starts in it too
    } catch {
      /* not persisted */
    }
  }, [locale]);
  const value = useMemo<I18n>(
    () => ({
      locale,
      t: (key, vars) =>
        interpolate(
          overrides?.[key] ?? lookup(catalogs[locale], key) ?? lookup(catalogs.en, key) ?? key,
          vars,
        ),
    }),
    [locale, overrides],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const localeName = (code: string) => LOCALES.find((l) => l.code === code)?.nativeName ?? code;

/** Every translatable key under a namespace, with its English text (for the wording editor). */
export function catalogEntries(ns: 'web' | 'auth' | 'common'): [string, string][] {
  const out: [string, string][] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'string') out.push([path, node]);
    else if (node && typeof node === 'object')
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
  };
  walk(catalogs.en[ns], ns);
  return out;
}
