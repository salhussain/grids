/**
 * Replaces every project with one real one, fed by a free public API (disease.sh, no key needed):
 * "Global COVID-19 Watch": continents and countries as entities, their figures as observations, a world
 * history, dashboards and map layers, all refreshed by scheduled jobs. For testing the platform end to end.
 *
 *   pnpm --filter @grids/api build && node --env-file=../../.env dist/scripts/seed-covid.js
 *
 * ORGANISATION_ID and USER_ID pick who owns it (defaults: the first organisation and its first admin).
 */
import { drainQueue } from '@grids/data';
import { createDb, TenantRouter, type CellDB, type PlatformDB } from '@grids/db';
import { DashboardInput, DataElementInput, EntityTypeInput, JobInput, MapOverlayInput, ProjectInput } from '@grids/schema';
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
const owner = createDb(process.env.DATABASE_URL_CELL_MIGRATOR!, { max: 2 });
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
const project = 'covid-watch';

// 1. Clear every project (their data goes with them).
const gone = await sql<{ n: number }>`select count(*)::int as n from project`.execute(owner);
await sql`delete from project`.execute(owner);
console.log(`deleted ${gone.rows[0]!.n} projects`);

// 2. The project.
await services.projects.create(
  actor,
  tenant,
  ProjectInput.parse({
    key: project,
    name: 'Global COVID-19 Watch',
    description: 'Live COVID-19 figures for every country, pulled every 30 minutes from the free disease.sh API. A real feed to test jobs, dashboards and maps with.',
    visibility: 'organisation',
    color: '#c2410c',
    icon: 'activity',
  }),
);

// 3. What it tracks.
const type = (t: unknown) => services.projects.saveType(actor, tenant, project, EntityTypeInput.parse(t));
await type({ key: 'continent', name: 'Continent', plural: 'Continents', icon: 'globe', color: '#6929c4' });
await type({
  key: 'country',
  name: 'Country',
  plural: 'Countries',
  icon: 'map-pin',
  color: '#c2410c',
  geometry: 'point',
  parentTypes: ['continent'],
  attributes: [
    { key: 'iso2', label: 'ISO code', type: 'text', summary: true },
    { key: 'population', label: 'Population', type: 'integer', summary: true },
  ],
});
await type({ key: 'world', name: 'World', plural: 'World', icon: 'globe', color: '#0f62fe' });

const elements: [string, string][] = [
  ['cases', 'Total cases'],
  ['deaths', 'Total deaths'],
  ['recovered', 'Recovered'],
  ['active', 'Active cases'],
  ['critical', 'Critical cases'],
  ['tests', 'Tests'],
  ['today_cases', 'New cases today'],
  ['today_deaths', 'New deaths today'],
  ['cases_per_million', 'Cases per million'],
  ['deaths_per_million', 'Deaths per million'],
  ['world_cases', 'World total cases'],
  ['world_deaths', 'World total deaths'],
  ['world_recovered', 'World recovered'],
];
// All are running totals, so a day's value is its highest reading.
for (const [key, name] of elements) await services.projects.saveElement(actor, tenant, project, DataElementInput.parse({ key, name, aggregation: 'max' }));

// 4. Jobs that pull the data.
const countryCode = 'countryInfo.iso3 ? countryInfo.iso3 : country';
await services.jobs.save(
  actor,
  tenant,
  project,
  JobInput.parse({
    key: 'covid_countries',
    name: 'Countries, latest figures',
    description: 'Every country’s totals from disease.sh.',
    schedule: '*/30 * * * *',
    freshnessMinutes: 90,
    steps: [
      { id: 'fetch', type: 'http.extract', url: 'https://disease.sh/v3/covid-19/countries', timeoutSeconds: 60 },
      { id: 'located', type: 'filter', condition: '$exists(continent) and continent != "" and $exists(countryInfo.lat) and $exists(countryInfo.long)' },
      { id: 'continents', type: 'entity.upsert', entityType: 'continent', code: 'continent', name: 'continent' },
      {
        id: 'countries',
        type: 'entity.upsert',
        entityType: 'country',
        code: countryCode,
        name: 'country',
        parentType: 'continent',
        parentCode: 'continent',
        lat: 'countryInfo.lat',
        lon: 'countryInfo.long',
        attributes: { iso2: 'countryInfo.iso2', population: 'population' },
      },
      {
        id: 'figures',
        type: 'observation.write',
        entityType: 'country',
        entityCode: countryCode,
        at: '$fromMillis(updated)',
        values: {
          cases: 'cases',
          deaths: 'deaths',
          recovered: 'recovered',
          active: 'active',
          critical: 'critical',
          tests: 'tests',
          today_cases: 'todayCases',
          today_deaths: 'todayDeaths',
          cases_per_million: 'casesPerOneMillion',
          deaths_per_million: 'deathsPerOneMillion',
        },
      },
    ],
  }),
);
await services.jobs.save(
  actor,
  tenant,
  project,
  JobInput.parse({
    key: 'covid_world_history',
    name: 'World history, last 90 days',
    description: 'Daily world totals, for the trend chart.',
    schedule: '15 * * * *',
    freshnessMinutes: 180,
    steps: [
      {
        id: 'fetch',
        type: 'http.extract',
        url: 'https://disease.sh/v3/covid-19/historical/all?lastdays=90',
        rows: '$each(cases, function($v, $k) { {"date": $k, "cases": $v, "deaths": $lookup($$.deaths, $k), "recovered": $lookup($$.recovered, $k)} })',
        timeoutSeconds: 60,
      },
      { id: 'world', type: 'entity.upsert', entityType: 'world', code: '"WORLD"', name: '"World"' },
      {
        id: 'totals',
        type: 'observation.write',
        entityType: 'world',
        entityCode: '"WORLD"',
        at: '($p := $split(date, "/"); $string(2000 + $number($p[2])) & "-" & $formatNumber($number($p[0]), "00") & "-" & $formatNumber($number($p[1]), "00") & "T00:00:00Z")',
        values: { world_cases: 'cases', world_deaths: 'deaths', world_recovered: 'recovered' },
      },
    ],
  }),
);

// 5. Run them now, here, so there is data straight away.
const cell = await cells.forTenant(tenant);
for (const key of ['covid_countries', 'covid_world_history']) {
  const run = await services.jobs.trigger(actor, tenant, project, key);
  await drainQueue(cell, { worker: 'seed' });
  const done = await services.jobs.run(actor, tenant, project, run.id);
  console.log(`${key}: ${done.status}`, JSON.stringify(done.stats));
  if (done.status !== 'succeeded') {
    for (const l of done.logs) console.log(`  [${l.level}] ${l.step ?? ''} ${l.message}`);
    process.exitCode = 1;
  }
}

// 6. Map layers and the dashboard.
const overlay = (o: unknown) => services.explore.saveOverlay(actor, tenant, project, MapOverlayInput.parse(o));
await overlay({ key: 'cases_total', name: 'Total cases', group: 'COVID-19', element: 'cases', hours: null, level: 'country', palette: 'heat', display: 'bubbles' });
await overlay({ key: 'deaths_per_million', name: 'Deaths per million people', group: 'COVID-19', element: 'deaths_per_million', hours: null, level: 'country', palette: 'reds', display: 'bubbles' });
await overlay({ key: 'cases_per_million', name: 'Cases per million people', group: 'COVID-19', element: 'cases_per_million', hours: null, level: 'country', palette: 'purples', display: 'heatmap' });

const latest = { latest: true, entityType: 'country' } as const;
await services.query.saveDashboard(
  actor,
  tenant,
  project,
  DashboardInput.parse({
    key: 'overview',
    name: 'Global overview',
    description: 'Figures as of the latest update from disease.sh.',
    icon: 'activity',
    widgets: [
      { id: 'cases', type: 'kpi', title: 'Total cases', w: 3, h: 1, query: { kind: 'kpi', element: 'cases', ...latest } },
      { id: 'deaths', type: 'kpi', title: 'Total deaths', w: 3, h: 1, options: { invert: true }, query: { kind: 'kpi', element: 'deaths', ...latest } },
      { id: 'recovered', type: 'kpi', title: 'Recovered', w: 3, h: 1, query: { kind: 'kpi', element: 'recovered', ...latest } },
      { id: 'today', type: 'kpi', title: 'New cases today', w: 3, h: 1, options: { invert: true }, query: { kind: 'kpi', element: 'today_cases', ...latest } },
      { id: 'trend', type: 'line', title: 'World totals, last 90 days', w: 8, h: 3, query: { kind: 'series', elements: ['world_cases', 'world_deaths', 'world_recovered'], aggregation: 'max', interval: 'day', range: { lastHours: 24 * 90 } } },
      { id: 'continents', type: 'pie', title: 'Cases by continent', w: 4, h: 3, query: { kind: 'breakdown', element: 'cases', by: 'parent', ...latest } },
      { id: 'top', type: 'bar', title: 'Most cases', w: 6, h: 4, options: { horizontal: true }, query: { kind: 'breakdown', element: 'cases', by: 'entity', limit: 10, ...latest } },
      { id: 'deaths_top', type: 'bar', title: 'Most deaths', w: 6, h: 4, options: { horizontal: true }, query: { kind: 'breakdown', element: 'deaths', by: 'entity', limit: 10, ...latest } },
      { id: 'map', type: 'map', title: 'Cases per million', w: 12, h: 4, options: { labelAttribute: 'iso2' }, query: { kind: 'geo', entityType: 'country', element: 'cases_per_million' } },
      { id: 'countries', type: 'table', title: 'Countries', w: 12, h: 4, query: { kind: 'table', entityType: 'country', columns: ['name', 'parent', 'iso2', 'population'], limit: 100 } },
    ],
  }),
);

const n = await sql<{ entities: number; observations: number }>`
  select (select count(*) from entity e join entity_type t on t.id = e.type_id where not t.system and e.project_id = (select id from project where key = ${project}))::int as entities,
         (select count(*) from observation where project_id = (select id from project where key = ${project}))::int as observations
`.execute(owner);
console.log(`project "${project}" ready:`, n.rows[0]);
await Promise.all([platformDb.destroy(), owner.destroy(), cells.destroy()]);
