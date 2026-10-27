import { catalogs, interpolate, isRtl, LOCALES, resolveLocale, type LocaleCode } from '@grids/i18n';
import {
  applyColorMode,
  LanguageMenu,
  storedColorMode,
  ThemeToggle,
  type ColorMode,
} from '@grids/ui';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const KEY = 'grids.locale';
const lookup = (tree: unknown, key: string) => {
  const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), tree);
  return typeof v === 'string' ? v : undefined;
};
type Ctx = { locale: LocaleCode; setLocale(l: LocaleCode): void; t(k: string, v?: Record<string, string | number>): string };
const I18n = createContext<Ctx | null>(null);
export const useI18n = () => useContext(I18n)!;

/** Language (remembered on this device, shared with the sign-in page) and RTL. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const stored = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const [locale, set] = useState<LocaleCode>(() => resolveLocale([stored(), ...navigator.languages]));
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
  }, [locale]);
  const value = useMemo<Ctx>(
    () => ({
      locale,
      setLocale: (l) => {
        try {
          localStorage.setItem(KEY, l);
        } catch {
          /* not persisted */
        }
        set(l);
      },
      t: (k, v) => interpolate(lookup(catalogs[locale], k) ?? lookup(catalogs.en, k) ?? k, v),
    }),
    [locale],
  );
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

/** Language and appearance: the same controls, top right, on every page (as on the sign-in page). */
export function HeaderControls() {
  const { locale, setLocale, t } = useI18n();
  const [mode, setMode] = useState<ColorMode>(storedColorMode);
  useEffect(() => applyColorMode(mode), [mode]);
  return (
    <div className="flex items-center gap-2">
      <LanguageMenu
        rounded
        value={locale as string}
        onChange={(v) => setLocale(v as LocaleCode)}
        label={t('common.language')}
        draftLabel={t('common.draftTranslation')}
        options={LOCALES.map((l) => ({
          code: l.code as string,
          label: l.nativeName,
          draft: l.status === 'draft',
        }))}
      />
      <ThemeToggle
        mode={mode}
        onChange={setMode}
        labels={{
          toLight: `${t('common.appearance')}: ${t('common.light')}`,
          toDark: `${t('common.appearance')}: ${t('common.dark')}`,
        }}
      />
    </div>
  );
}
