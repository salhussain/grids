import { formatMoney } from '@grids/schema';

export const money = (minor: number, currency = 'USD') => formatMoney(minor, currency);

/** Compact money for tiles: $12.4k */
export const moneyCompact = (minor: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: minor >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: minor >= 1_000_000 ? 1 : 0,
  }).format(minor / 100);

export const date = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

export const dateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(-Math.round(s), 'second');
  if (abs < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(-Math.round(s / 86400), 'day');
  return date(iso);
}

export const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = (code: string | null | undefined) =>
  code ? (regionNames.of(code) ?? code) : null;

// ISO 3166-1 alpha-2 codes; names come from Intl.DisplayNames.
const CODES =
  'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW';
export const COUNTRIES = CODES.split(' ')
  .map((code) => ({ code, name: regionNames.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const TIMEZONES: string[] = (
  Intl as unknown as { supportedValuesOf(k: string): string[] }
).supportedValuesOf('timeZone');

const FEATURE_LABELS: Record<string, string> = {
  custom_branding: 'Custom branding',
  custom_domain: 'Custom domain',
  sso: 'SSO / identity federation',
  api_access: 'API access',
  dhis2: 'DHIS2 interoperability',
  priority_support: 'Priority support',
  audit_export: 'Audit log export',
  dedicated_db: 'Dedicated database',
  custom_code: 'Custom code steps',
};
export const featureLabel = (f: string) => FEATURE_LABELS[f] ?? humanize(f);
