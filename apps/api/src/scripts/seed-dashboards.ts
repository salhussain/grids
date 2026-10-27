/**
 * Adds dummy figures and three dashboards to the Caribbean Health Network project, to try dashboards with:
 * fourteen weeks of made-up indicators for every facility (cases, visits, vaccinations, beds, stock-outs),
 * and dashboards that use every kind of widget.
 *
 *   pnpm --filter @grids/api build && node --env-file=../../.env dist/scripts/seed-dashboards.js
 *
 * Safe to run again: the indicators and dashboards are updated in place, and the figures are written over.
 * ORGANISATION_ID and USER_ID pick who owns it (defaults: the first organisation and its first admin).
 */
import { createDb, TenantRouter, type CellDB, type PlatformDB } from '@grids/db';
import { DashboardInput, DataElementInput, EntityQuery, ObservationBatch } from '@grids/schema';
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
const project = 'caribbean-health';

// ---------------------------------------------------------------- indicators

const elements = [
  { key: 'outpatient_visits', name: 'Outpatient visits', unit: 'visits', aggregation: 'sum', description: 'People seen as outpatients in the week.' },
  { key: 'malaria_cases', name: 'Malaria cases', unit: 'cases', aggregation: 'sum', description: 'Confirmed malaria cases in the week.' },
  { key: 'dengue_cases', name: 'Dengue cases', unit: 'cases', aggregation: 'sum', description: 'Confirmed dengue cases in the week.' },
  { key: 'vaccinations_given', name: 'Vaccinations given', unit: 'doses', aggregation: 'sum', description: 'Doses given in the week.' },
  { key: 'stockout_days', name: 'Stock-out days', unit: 'days', aggregation: 'sum', description: 'Days in the week an essential medicine was out of stock.' },
  { key: 'occupied_beds', name: 'Occupied beds', unit: 'beds', aggregation: 'max', description: 'Most beds occupied at once in the week.' },
] as const;
for (const e of elements) {
  const input = DataElementInput.parse({ ...e, valueType: 'number' });
  try {
    await services.projects.saveElement(actor, tenant, project, input);
  } catch {
    await services.projects.saveElement(actor, tenant, project, input, e.key); // it is there already
  }
}

// ---------------------------------------------------------------- figures

/** A small deterministic random source, so the same figures come back each time. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = rng(20261010);
const WEEKS = 14;
const monday = (weeksAgo: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - weeksAgo * 7);
  return d.toISOString();
};

const facilities = (await services.projects.entities(actor, tenant, project, EntityQuery.parse({ type: 'facility', pageSize: 200 }))).items;
if (!facilities.length) throw new Error('The project has no facilities. Run seed-hierarchy first.');

const observations: { entityId: string; element: string; at: string; value: number }[] = [];
for (const f of facilities) {
  const beds = Number((f as { attributes?: Record<string, unknown> }).attributes?.beds) || 20 + Math.round(rand() * 80);
  const size = beds / 50;
  for (let w = WEEKS - 1; w >= 0; w--) {
    const age = WEEKS - 1 - w; // 0 = oldest week
    const at = monday(w);
    const put = (element: string, value: number) => observations.push({ entityId: f.id, element, at, value: Math.max(0, Math.round(value)) });
    put('outpatient_visits', 140 * size * (0.8 + rand() * 0.4));
    put('malaria_cases', 9 * size * (1.25 - age * 0.04) * (0.6 + rand() * 0.8)); // easing off
    put('dengue_cases', 4 * size * (0.5 + age * 0.12) * (0.7 + rand() * 0.6)); // building up
    put('vaccinations_given', 45 * size * (0.7 + rand() * 0.6) * (age === 6 || age === 7 ? 2.6 : 1)); // a campaign
    put('stockout_days', rand() < 0.3 ? 1 + Math.floor(rand() * 5) : 0);
    put('occupied_beds', Math.min(beds, beds * (0.5 + rand() * 0.4)));
  }
}
for (let i = 0; i < observations.length; i += 1000) {
  const batch = observations.slice(i, i + 1000).map((o) => ({ ...o, value: o.value }));
  await services.projects.writeObservations(actor, tenant, project, ObservationBatch.parse({ observations: batch }));
}

// ---------------------------------------------------------------- dashboards

const month = { lastHours: 24 * 28 } as const;
const quarter = { lastHours: 24 * 98 } as const;
const dashboards = [
  {
    key: 'overview',
    name: 'Health overview',
    description: 'Cases, visits and vaccinations across every facility. Pick a country or a period at the top.',
    icon: 'activity',
    filters: { areaType: 'country', period: true },
    widgets: [
      { id: 'visits', type: 'kpi', title: 'Outpatient visits', w: 3, h: 1, query: { kind: 'kpi', element: 'outpatient_visits', entityType: 'facility', range: month, compare: true } },
      { id: 'malaria', type: 'kpi', title: 'Malaria cases', w: 3, h: 1, options: { invert: true, warn: 1500, alert: 2500 }, query: { kind: 'kpi', element: 'malaria_cases', entityType: 'facility', range: month, compare: true } },
      { id: 'dengue', type: 'kpi', title: 'Dengue cases', w: 3, h: 1, options: { invert: true, warn: 600, alert: 1200 }, query: { kind: 'kpi', element: 'dengue_cases', entityType: 'facility', range: month, compare: true } },
      { id: 'vaccines', type: 'kpi', title: 'Vaccinations given', w: 3, h: 1, query: { kind: 'kpi', element: 'vaccinations_given', entityType: 'facility', range: month, compare: true } },
      { id: 'trend', type: 'line', title: 'Cases each week', w: 8, h: 3, query: { kind: 'series', elements: ['malaria_cases', 'dengue_cases'], aggregation: 'sum', interval: 'week', range: quarter } },
      { id: 'by-type', type: 'pie', title: 'Visits by kind of facility', w: 4, h: 3, query: { kind: 'breakdown', element: 'outpatient_visits', aggregation: 'sum', by: 'attribute', attribute: 'facility_type', entityType: 'facility', range: month } },
      { id: 'busiest', type: 'bar', title: 'Busiest facilities', w: 6, h: 4, options: { horizontal: true }, query: { kind: 'breakdown', element: 'outpatient_visits', aggregation: 'sum', by: 'entity', entityType: 'facility', range: month, limit: 10 } },
      { id: 'vacc-trend', type: 'area', title: 'Vaccinations each week', w: 6, h: 4, query: { kind: 'series', elements: ['vaccinations_given'], aggregation: 'sum', interval: 'week', range: quarter } },
      { id: 'note', type: 'text', title: 'About these figures', w: 12, h: 1, text: 'These are made-up figures, to try dashboards with. Each facility reports weekly. Change the period or pick a country above and every chart follows.' },
    ],
  },
  {
    key: 'disease_watch',
    name: 'Disease watch',
    description: 'Where malaria and dengue are rising or falling, with thresholds that turn red.',
    icon: 'bell',
    filters: { areaType: 'country', period: true },
    widgets: [
      { id: 'm-week', type: 'kpi', title: 'Malaria this week', w: 3, h: 1, options: { invert: true, warn: 400, alert: 700 }, query: { kind: 'kpi', element: 'malaria_cases', entityType: 'facility', range: { lastHours: 24 * 7 }, compare: true } },
      { id: 'd-week', type: 'kpi', title: 'Dengue this week', w: 3, h: 1, options: { invert: true, warn: 200, alert: 400 }, query: { kind: 'kpi', element: 'dengue_cases', entityType: 'facility', range: { lastHours: 24 * 7 }, compare: true } },
      { id: 'out', type: 'kpi', title: 'Stock-out days', w: 3, h: 1, options: { invert: true, warn: 60, alert: 120 }, query: { kind: 'kpi', element: 'stockout_days', entityType: 'facility', range: { lastHours: 24 * 7 }, compare: true } },
      { id: 'dengue-gauge', type: 'gauge', title: 'Dengue against the weekly limit', w: 3, h: 1, options: { max: 600, warn: 300, alert: 450 }, query: { kind: 'kpi', element: 'dengue_cases', entityType: 'facility', range: { lastHours: 24 * 7 } } },
      { id: 'both', type: 'area', title: 'Malaria and dengue, last 14 weeks', w: 12, h: 3, options: { stacked: true }, query: { kind: 'series', elements: ['malaria_cases', 'dengue_cases'], aggregation: 'sum', interval: 'week', range: quarter } },
      { id: 'matrix', type: 'matrix', title: 'Facilities compared', w: 7, h: 4, query: { kind: 'breakdown', elements: ['malaria_cases', 'dengue_cases', 'stockout_days'], aggregation: 'sum', by: 'entity', entityType: 'facility', range: month, limit: 12 } },
      { id: 'dengue-top', type: 'bar', title: 'Most dengue cases', w: 5, h: 4, options: { horizontal: true, invert: true }, query: { kind: 'breakdown', element: 'dengue_cases', aggregation: 'sum', by: 'entity', entityType: 'facility', range: month, limit: 8 } },
    ],
  },
  {
    key: 'capacity',
    name: 'Capacity and supplies',
    description: 'Beds in use and medicines running out, by facility.',
    icon: 'hospital',
    filters: { areaType: 'country', period: false },
    widgets: [
      { id: 'beds-now', type: 'kpi', title: 'Beds occupied (latest)', w: 3, h: 1, query: { kind: 'kpi', element: 'occupied_beds', aggregation: 'sum', entityType: 'facility', latest: true } },
      { id: 'beds-gauge', type: 'gauge', title: 'Bed occupancy', w: 3, h: 1, options: { max: 1500, warn: 1000, alert: 1250, unit: ' beds' }, query: { kind: 'kpi', element: 'occupied_beds', aggregation: 'sum', entityType: 'facility', latest: true } },
      { id: 'facilities', type: 'kpi', title: 'Facilities reporting', w: 3, h: 1, query: { kind: 'kpi', aggregation: 'count', entityType: 'facility' } },
      { id: 'out-days', type: 'kpi', title: 'Stock-out days (28 days)', w: 3, h: 1, options: { invert: true, warn: 100, alert: 200 }, query: { kind: 'kpi', element: 'stockout_days', entityType: 'facility', range: month, compare: true } },
      { id: 'beds-trend', type: 'line', title: 'Beds occupied each week', w: 8, h: 3, query: { kind: 'series', elements: ['occupied_beds'], aggregation: 'sum', interval: 'week', range: quarter } },
      { id: 'beds-type', type: 'pie', title: 'Beds in use by kind of facility', w: 4, h: 3, query: { kind: 'breakdown', element: 'occupied_beds', aggregation: 'sum', by: 'attribute', attribute: 'facility_type', entityType: 'facility', latest: true } },
      { id: 'out-top', type: 'bar', title: 'Longest without stock', w: 6, h: 4, options: { horizontal: true, invert: true }, query: { kind: 'breakdown', element: 'stockout_days', aggregation: 'sum', by: 'entity', entityType: 'facility', range: month, limit: 10 } },
      { id: 'table', type: 'table', title: 'Facilities', w: 6, h: 4, query: { kind: 'table', entityType: 'facility', columns: ['name', 'parent', 'facility_type', 'beds'], sort: 'beds', desc: true, limit: 50 } },
    ],
  },
] as const;

for (const d of dashboards) {
  const input = DashboardInput.parse(d);
  try {
    await services.query.saveDashboard(actor, tenant, project, input);
  } catch {
    await services.query.saveDashboard(actor, tenant, project, input, d.key); // it is there already
  }
}

console.log(`project "${project}": ${elements.length} indicators, ${observations.length} figures for ${facilities.length} facilities, ${dashboards.length} dashboards`);
await Promise.all([platformDb.destroy(), cells.destroy()]);
