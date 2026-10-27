/**
 * Replaces every project with three new ones, each fed by a free open-source API through a Variable and a
 * Connection (nothing is written into a connection but {{VARIABLE}} references), then tests the connection and
 * loads some places from the API.
 *
 *   pnpm --filter @grids/api build && node --env-file=../../.env dist/scripts/seed-connections.js
 *
 * ORGANISATION_ID and USER_ID pick who owns them (defaults: the first organisation and its first admin).
 */
import { createDb, TenantRouter, type CellDB, type PlatformDB } from '@grids/db';
import { ConnectionInput, EntityInput, EntityTypeInput, ProjectInput, VariableInput } from '@grids/schema';
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

const gone = await sql<{ n: number }>`select count(*)::int as n from project`.execute(owner);
await sql`delete from project`.execute(owner);
console.log(`deleted ${gone.rows[0]!.n} projects`);

type Feature = { code: string; name: string; lon: number; lat: number; attributes: Record<string, unknown> };
interface Spec {
  key: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  variable: { key: string; value: string; description: string };
  connection: { key: string; name: string; description: string; test: string };
  type: { key: string; plural: string } & Record<string, unknown>;
  /** Path on the connection, and how its answer becomes places. */
  fetch: { path: string };
  read(body: any): Feature[];
}

const specs: Spec[] = [
  {
    key: 'earthquake-watch',
    name: 'Earthquake Watch',
    description: 'The latest magnitude 4.5+ earthquakes worldwide, from the USGS Earthquake Catalog (open data, no key).',
    color: '#c2410c',
    icon: 'activity',
    variable: { key: 'USGS_API_URL', value: 'https://earthquake.usgs.gov/fdsnws/event/1', description: 'Base address of the USGS earthquake API' },
    connection: { key: 'usgs', name: 'USGS Earthquake Catalog', description: 'Open earthquake data, updated every minute.', test: '/query?format=geojson&limit=1' },
    type: {
      key: 'earthquake',
      name: 'Earthquake',
      plural: 'Earthquakes',
      icon: 'activity',
      color: '#c2410c',
      geometry: 'point',
      parentTypes: ['@root'],
      attributes: [
        { key: 'magnitude', label: 'Magnitude', type: 'number', summary: true },
        { key: 'depth_km', label: 'Depth', type: 'number', unit: 'km' },
        { key: 'occurred_on', label: 'Date', type: 'date', summary: true },
      ],
    },
    fetch: { path: '/query?format=geojson&minmagnitude=4.5&limit=40&orderby=time' },
    read: (b) =>
      b.features.map((f: any) => ({
        code: f.id,
        name: f.properties.place ?? f.id,
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        attributes: { magnitude: f.properties.mag, depth_km: f.geometry.coordinates[2], occurred_on: new Date(f.properties.time).toISOString().slice(0, 10) },
      })),
  },
  {
    key: 'caribbean-weather',
    name: 'Caribbean Weather',
    description: 'Current conditions in ten Caribbean capitals, from Open-Meteo (open-source weather API, no key).',
    color: '#0f62fe',
    icon: 'cloud',
    variable: { key: 'OPEN_METEO_URL', value: 'https://api.open-meteo.com/v1', description: 'Base address of the Open-Meteo API' },
    connection: { key: 'open_meteo', name: 'Open-Meteo forecast', description: 'Free weather forecasts and current conditions.', test: '/forecast?latitude=15.3&longitude=-61.39&current=temperature_2m' },
    type: {
      key: 'city',
      name: 'City',
      plural: 'Cities',
      icon: 'map-pin',
      color: '#0f62fe',
      geometry: 'point',
      parentTypes: ['@root'],
      attributes: [
        { key: 'temperature_c', label: 'Temperature', type: 'number', unit: '°C', summary: true },
        { key: 'humidity', label: 'Humidity', type: 'integer', unit: '%' },
        { key: 'wind_kmh', label: 'Wind', type: 'number', unit: 'km/h', summary: true },
      ],
    },
    fetch: { path: '' },
    read: () => [],
  },
  {
    key: 'country-atlas',
    name: 'Country Atlas',
    description: 'Every country in Latin America and the Caribbean with its capital and income level, from the World Bank open data API (no key).',
    color: '#6929c4',
    icon: 'globe',
    variable: { key: 'WORLD_BANK_API_URL', value: 'https://api.worldbank.org/v2', description: 'Base address of the World Bank API' },
    connection: { key: 'world_bank', name: 'World Bank open data', description: 'Countries, indicators and more, free and open.', test: '/country/dm?format=json' },
    type: {
      key: 'country',
      name: 'Country',
      plural: 'Countries',
      icon: 'globe',
      color: '#6929c4',
      geometry: 'point',
      parentTypes: ['@root'],
      attributes: [
        { key: 'capital', label: 'Capital', type: 'text', summary: true },
        { key: 'income_level', label: 'Income level', type: 'text', summary: true },
        { key: 'iso2', label: 'ISO code', type: 'text' },
      ],
    },
    fetch: { path: '/country?format=json&region=LCN&per_page=100' },
    read: (b) =>
      (b[1] as any[])
        .filter((c) => c.latitude && c.longitude)
        .map((c) => ({
          code: c.id,
          name: c.name,
          lat: Number(c.latitude),
          lon: Number(c.longitude),
          attributes: { capital: c.capitalCity || null, income_level: c.incomeLevel?.value ?? null, iso2: c.iso2Code },
        })),
  },
];

const CITIES: [string, string, number, number][] = [
  ['DM', 'Roseau', 15.3, -61.39],
  ['LC', 'Castries', 14.01, -60.99],
  ['JM', 'Kingston', 17.97, -76.79],
  ['TT', 'Port of Spain', 10.66, -61.51],
  ['BB', 'Bridgetown', 13.1, -59.61],
  ['BS', 'Nassau', 25.05, -77.35],
  ['CU', 'Havana', 23.13, -82.38],
  ['DO', 'Santo Domingo', 18.49, -69.93],
  ['AG', 'St. John’s', 17.12, -61.85],
  ['KN', 'Basseterre', 17.3, -62.72],
];

const headers = [{ name: 'User-Agent', value: 'Grids/1.0 ({{CONTACT_EMAIL}})' }];

for (const s of specs) {
  console.log(`\n${s.name}`);
  await services.projects.create(actor, tenant, ProjectInput.parse({ key: s.key, name: s.name, description: s.description, visibility: 'organisation', color: s.color, icon: s.icon }));
  // Secrets and addresses live in variables, never in the connection.
  await services.connections.setVariable(actor, tenant, s.key, VariableInput.parse({ key: 'CONTACT_EMAIL', value: admin.email ?? 'admin@grids.local', description: 'Who to contact about our requests (sent in the User-Agent)' }));
  await services.connections.setVariable(actor, tenant, s.key, VariableInput.parse(s.variable));
  await services.connections.saveConnection(
    actor,
    tenant,
    s.key,
    ConnectionInput.parse({ key: s.connection.key, name: s.connection.name, description: s.connection.description, kind: 'http', target: `{{${s.variable.key}}}`, headers, test: s.connection.test }),
  );
  const test = await services.connections.testSaved(actor, tenant, s.key, s.connection.key);
  console.log(`  connection ${s.connection.key}: ${test.ok ? 'works' : 'FAILED'} · ${test.message} · ${test.ms} ms`);
  if (!test.ok) {
    process.exitCode = 1;
    continue;
  }
  await services.projects.saveType(actor, tenant, s.key, EntityTypeInput.parse(s.type));

  // Load places the way a job would: the base address comes from the variable.
  const get = async (path: string) => {
    const res = await fetch(`${s.variable.value.replace(/\/$/, '')}${path}`, { headers: { 'User-Agent': `Grids/1.0 (${admin.email})` } });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  };
  let places: Feature[];
  if (s.key === 'caribbean-weather') {
    const body = await get(`/forecast?latitude=${CITIES.map((c) => c[2]).join(',')}&longitude=${CITIES.map((c) => c[3]).join(',')}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`);
    places = (Array.isArray(body) ? body : [body]).map((r: any, i: number) => ({
      code: CITIES[i]![0],
      name: CITIES[i]![1],
      lat: CITIES[i]![2],
      lon: CITIES[i]![3],
      attributes: { temperature_c: r.current.temperature_2m, humidity: r.current.relative_humidity_2m, wind_kmh: r.current.wind_speed_10m },
    }));
  } else places = s.read(await get(s.fetch.path));
  let made = 0;
  for (const p of places) {
    await services.projects.createEntity(
      actor,
      tenant,
      s.key,
      EntityInput.parse({ typeKey: s.type.key, code: p.code, name: p.name, attributes: p.attributes, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }),
    );
    made++;
  }
  console.log(`  ${made} ${s.type.plural} loaded`);
}
await owner.destroy();
await platformDb.destroy();
