import { catalogs, interpolate, isRtl, resolveLocale, type LocaleCode } from '@grids/i18n';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api } from './api';

type T = (key: string, vars?: Record<string, string | number>) => string;
const lookup = (tree: unknown, key: string) => {
  const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), tree);
  return typeof v === 'string' ? v : undefined;
};
const Ctx = createContext<{ locale: LocaleCode; t: T }>({ locale: 'en', t: (k, v) => interpolate(lookup(catalogs.en, k) ?? k, v) });
export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;

/** Platform look and languages (public: also used before sign-in). */
export function usePlatform() {
  return useQuery({ queryKey: ['platform'], queryFn: api.platform, staleTime: 60_000 });
}

/** The console in the person's language, limited to the languages the platform offers staff. */
export function I18nProvider({ preferred, children }: { preferred: string | null | undefined; children: ReactNode }) {
  const platform = usePlatform();
  const l = platform.data?.localization;
  const locale = resolveLocale([preferred, ...navigator.languages], l?.consoleLanguages ?? ['en'], l?.consoleDefault ?? 'en');
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
  }, [locale]);
  const value = useMemo(() => ({ locale, t: ((k, v) => interpolate(lookup(catalogs[locale], k) ?? lookup(catalogs.en, k) ?? k, v)) as T }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/** Applies the platform's primary colour and product name to the console. */
export function usePlatformBranding() {
  const platform = usePlatform();
  const b = platform.data?.branding;
  useEffect(() => {
    if (!b) return;
    const root = document.documentElement;
    root.style.setProperty('--brand-600', b.primaryColor);
    root.style.setProperty('--brand-contrast', luminance(b.primaryColor) > 0.35 ? '#161616' : '#ffffff');
    document.title = `${b.appName} Console`;
  }, [b]);
  return b;
}
