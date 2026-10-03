/**
 * Supported interface languages. Organisations enable a subset; each person
 * picks their own from those. `draft` catalogs were machine-assisted and need
 * native-speaker review before production use.
 */
export const LOCALES = [
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr', status: 'stable' },
  { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr', status: 'stable' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr', status: 'stable' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl', status: 'stable' },
  { code: 'sm', name: 'Samoan', nativeName: 'Gagana Sāmoa', dir: 'ltr', status: 'draft' },
  { code: 'to', name: 'Tongan', nativeName: 'Lea faka-Tonga', dir: 'ltr', status: 'draft' },
  { code: 'bi', name: 'Bislama', nativeName: 'Bislama', dir: 'ltr', status: 'draft' },
  { code: 'tpi', name: 'Tok Pisin', nativeName: 'Tok Pisin', dir: 'ltr', status: 'draft' },
] as const;

export type LocaleCode = (typeof LOCALES)[number]['code'];
export const LOCALE_CODES = LOCALES.map((l) => l.code) as LocaleCode[];
export const DEFAULT_LOCALE: LocaleCode = 'en';

export const localeInfo = (code: string) => LOCALES.find((l) => l.code === code) ?? LOCALES[0];
export const isRtl = (code: string) => localeInfo(code).dir === 'rtl';

/**
 * Picks the best locale: the first preferred one the organisation enables
 * (exact, then language-only match like fr-CA → fr), else its default.
 */
export function resolveLocale(preferred: readonly (string | null | undefined)[], enabled: readonly string[] = LOCALE_CODES, fallback: string = DEFAULT_LOCALE): LocaleCode {
  const allowed = enabled.filter((c) => (LOCALE_CODES as string[]).includes(c));
  for (const p of preferred) {
    if (!p) continue;
    const lower = p.toLowerCase();
    if (allowed.includes(lower)) return lower as LocaleCode;
    const base = lower.split(/[-_]/)[0]!;
    if (allowed.includes(base)) return base as LocaleCode;
  }
  return ((allowed.includes(fallback) ? fallback : allowed[0]) ?? DEFAULT_LOCALE) as LocaleCode;
}
