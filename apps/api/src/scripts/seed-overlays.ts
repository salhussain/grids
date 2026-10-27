/**
 * Adds map overlays built from datasets to the Caribbean Health Network, Country Atlas and Caribbean Weather
 * projects, to review and design them: each dataset has a column naming the place (by its code) and numbers
 * to map, and each overlay reads one column of one dataset.
 *
 *   pnpm --filter @grids/api build && node --env-file=../../.env dist/scripts/seed-overlays.js
 *
 * Safe to run again: datasets and overlays are updated in place and the rows are replaced.
 * ORGANISATION_ID and USER_ID pick who owns it (defaults: the first organisation and its first admin).
 */
import { createDb, TenantRouter, type CellDB, type PlatformDB } from '@grids/db';
import { DatasetInput, MapOverlayInput } from '@grids/schema';
import { sql } from 'kysely';
import { loadConfig } from '../config.js';
import { GridsIdpClient } from '../idp/grids.js';
import { cellResolver } from '../services/cells.js';
import type { Actor } from '../services/context.js';
import { EmailService, mailerFor } from '../services/email.js';
import { createServices } from '../services/index.js';
import { secretsKeyFrom } from '../services/secrets.js';

const config = loadConfig();
const platformDb = createDb<PlatformDB>(config.DATABASE_URL_PLATFORM, { max: 4 });
const cells = new TenantRouter<CellDB>(cellResolver(platformDb));
const services = createServices({
  db: platformDb,
  cells,
  idp: new GridsIdpClient(config.IDENTITY_INTERNAL_URL, config.IDENTITY_SERVICE_TOKEN),
  email: new EmailService(platformDb, mailerFor(config.SMTP_URL, config.MAIL_FROM)),
  consoleUrl: config.CONSOLE_URL,
  workspaceUrl: config.WEB_URL,
  baseDomain: config.BASE_DOMAIN,
  supportEmail: config.SUPPORT_EMAIL,
  secretsKey: secretsKeyFrom(config.SECRETS_KEY, false),
  allowPrivateConnections: true,
  now: () => new Date(),
});

const tenant = process.env.ORGANISATION_ID ?? (await platformDb.selectFrom('tenant').select('id').orderBy('created_at').executeTakeFirstOrThrow()).id;
const admin = await platformDb
  .selectFrom('membership as m')
  .innerJoin('user_identity as u', 'u.id', 'm.user_id')
  .select(['u.id', 'u.email'])
  .where('m.tenant_id', '=', tenant)
  .where('m.role', '=', 'org_admin')
  .$if(!!process.env.USER_ID, (q) => q.where('u.id', '=', process.env.USER_ID!))
  .orderBy('m.created_at')
  .executeTakeFirstOrThrow();
const actor: Actor = { id: admin.id, email: admin.email, isPlatformAdmin: false, permissions: new Set() };

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = rng(20261011);
const between = (lo: number, hi: number, dp = 0) => Math.round((lo + rand() * (hi - lo)) * 10 ** dp) / 10 ** dp;
const week = 7 * 24;

type Row = Record<string, string | number>;
interface Plan {
  project: string;
  /** The type of place each row is about. */
  type: string;
  dataset: { key: string; name: string; description: string };
  /** One row per place, or several (a figure for each of the last weeks). */
  weeks?: number;
  row(place: { code: string; name: string }, at: string): Row;
  overlays: MapOverlayInput[];
}

const plans: Plan[] = [
  {
    project: 'caribbean-health',
    type: 'parish',
    dataset: { key: 'parish_health_profile', name: 'Parish health profile', description: 'One row per parish: coverage, population and capacity.' },
    row: (p) => ({ parish_code: p.code, parish: p.name, vaccination_pct: between(58, 97, 1), population: between(8_000, 62_000), clinics_per_10k: between(0.4, 3.2, 1), infant_mortality: between(4, 19, 1) }),
    overlays: [
      { key: 'ds_vaccination_coverage', name: 'Vaccination coverage', group: 'Dataset overlays', description: 'Share of the population fully vaccinated, from the parish health profile.', aggregation: 'avg', hours: null, level: 'parish', palette: 'performance', higherIsBetter: true, thresholds: [65, 80, 90], unit: '%', decimals: 1, dataset: { dataset: 'parish_health_profile', entityColumn: 'parish_code', entityKey: 'code', entityType: 'parish', valueColumn: 'vaccination_pct', timeColumn: null } },
      { key: 'ds_population_parish', name: 'Population by parish', group: 'Dataset overlays', description: 'People living in each parish, shown as 3D columns.', aggregation: 'sum', hours: null, level: 'parish', palette: 'blues', display: 'extrude', unit: 'people', compact: true, dataset: { dataset: 'parish_health_profile', entityColumn: 'parish_code', entityKey: 'code', entityType: 'parish', valueColumn: 'population', timeColumn: null } },
    ],
  },
  {
    project: 'caribbean-health',
    type: 'community',
    weeks: 8,
    dataset: { key: 'community_clinic_visits', name: 'Community clinic visits', description: 'Weekly clinic visits for each community over the last eight weeks.' },
    row: (p, at) => ({ community_code: p.code, community: p.name, week_start: at, visits: between(40, 420), fever_cases: between(0, 60) }),
    overlays: [
      { key: 'ds_visits_4w', name: 'Clinic visits (4 weeks)', group: 'Dataset overlays', description: 'Visits summed over the last four weeks; the period applies to the dataset’s date column.', aggregation: 'sum', hours: week * 4, level: 'community', palette: 'heat', display: 'bubbles', unit: 'visits', dataset: { dataset: 'community_clinic_visits', entityColumn: 'community_code', entityKey: 'code', entityType: 'community', valueColumn: 'visits', timeColumn: 'week_start' } },
      { key: 'ds_fever_latest', name: 'Fever cases (latest week)', group: 'Dataset overlays', description: 'Each community’s newest weekly figure.', aggregation: 'sum', hours: null, level: 'community', palette: 'reds', thresholds: [10, 25, 45], unit: 'cases', dataset: { dataset: 'community_clinic_visits', entityColumn: 'community_code', entityKey: 'code', entityType: 'community', valueColumn: 'fever_cases', timeColumn: 'week_start' } },
    ],
  },
  {
    project: 'country-atlas',
    type: 'country',
    dataset: { key: 'country_indicators', name: 'Country indicators', description: 'Development figures per country, matched on the ISO code.' },
    row: (p) => ({ iso: p.code, country: p.name, gdp_per_capita: between(1_800, 52_000), life_expectancy: between(61, 83, 1), area_km2: between(300, 900_000), internet_pct: between(22, 96) }),
    overlays: [
      { key: 'ds_gdp_per_capita', name: 'GDP per capita', group: 'Development', description: 'US dollars per person.', aggregation: 'avg', hours: null, level: 'country', palette: 'greens', display: 'extrude', unit: '$', unitPosition: 'before', compact: true, dataset: { dataset: 'country_indicators', entityColumn: 'iso', entityKey: 'code', valueColumn: 'gdp_per_capita', timeColumn: null } },
      { key: 'ds_life_expectancy', name: 'Life expectancy', group: 'Development', description: 'Years at birth. Higher is better.', aggregation: 'avg', hours: null, level: 'country', palette: 'performance', higherIsBetter: true, thresholds: [66, 72, 78], unit: 'years', decimals: 1, dataset: { dataset: 'country_indicators', entityColumn: 'iso', entityKey: 'code', valueColumn: 'life_expectancy', timeColumn: null } },
    ],
  },
  {
    project: 'caribbean-weather',
    type: 'city',
    dataset: { key: 'city_climate', name: 'City climate', description: 'Average temperature and rainfall for each city, matched on its name.' },
    row: (p) => ({ city: p.name, avg_temp_c: between(25, 31, 1), rainfall_mm: between(40, 320), humidity_pct: between(66, 90) }),
    overlays: [
      { key: 'ds_avg_temperature', name: 'Average temperature', group: 'Climate', description: 'Degrees Celsius, matched to each city by name.', aggregation: 'avg', hours: null, level: 'city', palette: 'heat', display: 'bubbles', unit: '°C', decimals: 1, dataset: { dataset: 'city_climate', entityColumn: 'city', entityKey: 'name', valueColumn: 'avg_temp_c', timeColumn: null } },
      { key: 'ds_rainfall', name: 'Monthly rainfall', group: 'Climate', description: 'Millimetres per month.', aggregation: 'avg', hours: null, level: 'city', palette: 'blues', unit: 'mm', dataset: { dataset: 'city_climate', entityColumn: 'city', entityKey: 'name', valueColumn: 'rainfall_mm', timeColumn: null } },
    ],
  },
];

for (const plan of plans) {
  const places = await services.projects.cellTx(tenant, (tx) =>
    sql<{ code: string; name: string }>`select e.code, e.name from entity e join entity_type t on t.id = e.type_id join project p on p.id = e.project_id where p.key = ${plan.project} and t.key = ${plan.type} order by e.code`.execute(tx).then((r) => r.rows),
  );
  if (!places.length) {
    console.log(`${plan.project}: no ${plan.type} entities, skipped`);
    continue;
  }
  const now = Date.now();
  const rows: Row[] = [];
  for (const p of places)
    for (let w = (plan.weeks ?? 1) - 1; w >= 0; w--) rows.push(plan.row(p, new Date(now - w * week * 3_600_000).toISOString().slice(0, 10)));
  const columns = Object.keys(rows[0]!);
  const input = DatasetInput.parse({ ...plan.dataset, columns, source: { type: 'rows' } });
  const exists = (await services.jobs.datasets(actor, tenant, plan.project)).some((d) => d.key === input.key);
  await services.jobs.saveDataset(actor, tenant, plan.project, input, exists ? input.key : undefined);
  await services.projects.cellTx(tenant, async (tx) => {
    const ds = await tx.selectFrom('dataset as d').innerJoin('project as p', 'p.id', 'd.project_id').select('d.id').where('p.key', '=', plan.project).where('d.key', '=', input.key).executeTakeFirstOrThrow();
    await tx.deleteFrom('dataset_row').where('dataset_id', '=', ds.id).execute();
    for (let i = 0; i < rows.length; i += 500)
      await tx.insertInto('dataset_row').values(rows.slice(i, i + 500).map((data) => ({ tenant_id: tenant, dataset_id: ds.id, data: JSON.stringify(data) }))).execute();
    await tx.updateTable('dataset').set({ row_count: rows.length, last_materialised_at: new Date(), refresh_error: null }).where('id', '=', ds.id).execute();
  });
  const have = new Set((await services.explore.overlays(actor, tenant, plan.project)).map((o) => o.key));
  for (const raw of plan.overlays) {
    const o = MapOverlayInput.parse(raw);
    await services.explore.saveOverlay(actor, tenant, plan.project, o, have.has(o.key) ? o.key : undefined);
  }
  console.log(`${plan.project}: ${input.name} (${rows.length} rows), ${plan.overlays.length} overlays`);
  // Check each overlay reaches the places: how many are coloured, and the range of values.
  for (const raw of plan.overlays) {
    const r = await services.explore.overlay(actor, tenant, plan.project, raw.key, null);
    const shown = r.features.features.filter((f: { properties: { value: number | null } }) => f.properties.value !== null).length;
    console.log(`  ${raw.key}: ${shown}/${r.features.features.length} places coloured, ${r.min ?? '-'} to ${r.max ?? '-'}`);
  }
}
process.exit(0);
