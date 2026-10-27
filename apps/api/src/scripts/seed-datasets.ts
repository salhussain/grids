/**
 * Adds two sample datasets to the Caribbean Health Network project, to review metrics and parameters with:
 *
 *  - "Clinic reports (weekly)": rows, one per facility per week, with saved metrics and a time column.
 *  - "Clinic reports (filtered)": a SQL dataset that reads the first one through three parameters
 *    (country, since, minimum visits), each linked to a column, with its own metrics.
 *  - A dashboard, "Clinic reports", whose filters come from those parameters.
 *
 *   pnpm --filter @grids/api build && node --env-file=../../.env dist/scripts/seed-datasets.js
 *
 * Safe to run again: the datasets are updated in place and the rows replaced.
 */
import { createDb, TenantRouter, type CellDB, type PlatformDB } from '@grids/db';
import { DashboardInput, DatasetInput, filterFromParam } from '@grids/schema';
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

const project = 'caribbean-health';
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = rng(20261013);
const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));

// ---------------------------------------------------------------- the rows
const facilities = await services.projects.cellTx(tenant, (tx) =>
  sql<{ code: string; name: string; country: string }>`
    select f.code, f.name, c.name as country
    from entity f
    join entity_type ft on ft.id = f.type_id and ft.key = 'facility'
    join project p on p.id = f.project_id and p.key = ${project}
    join entity c on c.path @> f.path and c.project_id = f.project_id
    join entity_type ct on ct.id = c.type_id and ct.key = 'country'
    order by c.name, f.code`.execute(tx).then((r) => r.rows),
);
if (!facilities.length) throw new Error('The Caribbean Health Network has no facilities to report on.');
const WEEKS = 10;
const monday = new Date();
monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
const rows: Record<string, string | number>[] = [];
for (const f of facilities) {
  const size = 0.6 + rand() * 1.4;
  for (let w = WEEKS - 1; w >= 0; w--) {
    const day = new Date(monday.getTime() - w * 7 * 86_400_000).toISOString().slice(0, 10);
    const visits = Math.round(between(40, 220) * size);
    rows.push({ facility_code: f.code, facility: f.name, country: f.country, week_start: day, visits, fever_cases: Math.round(visits * (0.04 + rand() * 0.16)), stockout_days: rand() < 0.3 ? between(1, 7) : 0 });
  }
}
const columns = Object.keys(rows[0]!);

const metrics = [
  { key: 'total_visits', label: 'Total visits', column: 'visits', aggregation: 'sum' as const },
  { key: 'avg_visits', label: 'Average visits per report', column: 'visits', aggregation: 'avg' as const },
  { key: 'fever_cases', label: 'Fever cases', column: 'fever_cases', aggregation: 'sum' as const },
  { key: 'reports', label: 'Reports received', aggregation: 'count' as const },
  { key: 'facilities_reporting', label: 'Facilities reporting', column: 'facility_code', aggregation: 'distinct' as const },
  { key: 'worst_stockout', label: 'Longest stock-out (days)', column: 'stockout_days', aggregation: 'max' as const },
];

const upsert = async (input: ReturnType<typeof DatasetInput.parse>) => {
  const exists = (await services.jobs.datasets(actor, tenant, project)).some((d) => d.key === input.key);
  await services.jobs.saveDataset(actor, tenant, project, input, exists ? input.key : undefined);
};

await upsert(
  DatasetInput.parse({
    key: 'clinic_reports',
    name: 'Clinic reports (weekly)',
    description: 'One row per facility per week: visits, fever cases and stock-out days. Sample data.',
    columns,
    source: { type: 'rows' },
    settings: { timeColumn: 'week_start', metrics, parameters: [] },
  }),
);
await services.projects.cellTx(tenant, async (tx) => {
  const ds = await tx.selectFrom('dataset as d').innerJoin('project as p', 'p.id', 'd.project_id').select('d.id').where('p.key', '=', project).where('d.key', '=', 'clinic_reports').executeTakeFirstOrThrow();
  await tx.deleteFrom('dataset_row').where('dataset_id', '=', ds.id).execute();
  for (let i = 0; i < rows.length; i += 500) await tx.insertInto('dataset_row').values(rows.slice(i, i + 500).map((data) => ({ tenant_id: tenant, dataset_id: ds.id, data: JSON.stringify(data) }))).execute();
  await tx.updateTable('dataset').set({ row_count: rows.length, last_materialised_at: new Date(), refresh_error: null }).where('id', '=', ds.id).execute();
});
console.log(`Clinic reports (weekly): ${rows.length} rows, ${metrics.length} metrics`);

// ---------------------------------------------------------------- the filtered one
// The stored rows start wide (every country, every week), so the dashboard's filters can narrow them.
const since = new Date(monday.getTime() - (WEEKS - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
await upsert(
  DatasetInput.parse({
    key: 'clinic_reports_filtered',
    name: 'Clinic reports (filtered)',
    description: 'The weekly reports for one country (or all), from a date, for clinics with enough visits. Each parameter is also a dashboard filter.',
    freshnessMinutes: 1440,
    source: {
      type: 'local',
      inputs: [{ kind: 'dataset', ref: 'clinic_reports', as: 'reports' }],
      sql: `select facility_code, facility, country, week_start, visits, fever_cases, stockout_days,
       round(100.0 * fever_cases / nullif(visits, 0), 1) as fever_pct
from reports
where ({{ country }} = 'All' or country = {{ country }})
  and week_start >= {{ since }}
  and visits >= {{ min_visits }}
order by week_start desc, facility`,
    },
    settings: {
      timeColumn: 'week_start',
      parameters: [
        { name: 'country', label: 'Country', type: 'text', default: 'All', column: 'country', any: 'All' },
        { name: 'since', label: 'Reports since', type: 'date', default: since, column: 'week_start', compare: 'at_least' },
        { name: 'min_visits', label: 'Smallest number of visits', type: 'number', default: '0', column: 'visits', compare: 'at_least' },
      ],
    },
  }),
);
await services.datasets.refresh(actor, tenant, project, 'clinic_reports_filtered');
const made = (await services.jobs.datasets(actor, tenant, project)).find((d) => d.key === 'clinic_reports_filtered')!;
console.log(`Clinic reports (filtered): ${made.rowCount} rows with country=All, since ${since}, min visits 0; columns: ${made.columns.join(', ')}`);

// ---------------------------------------------------------------- a dashboard whose filters are the parameters
const dsKey = 'clinic_reports_filtered';
const filters = made.settings.parameters.flatMap((p) => filterFromParam(p, dsKey) ?? []);
const read = { kind: 'dataset', dataset: dsKey } as const;
const dash = DashboardInput.parse({
  key: 'clinic_reports',
  name: 'Clinic reports',
  description: 'Filters here come from the dataset’s parameters: country, reports since, and the smallest number of visits.',
  icon: 'activity',
  filters: { areaType: null, period: false, columns: filters },
  widgets: [
    { id: 'visits', type: 'kpi', title: 'Total visits', w: 3, h: 1, query: { ...read, value: 'visits', aggregation: 'sum' } },
    { id: 'fever', type: 'kpi', title: 'Average fever share (%)', w: 3, h: 1, options: { invert: true, warn: 12, alert: 16, decimals: 1 }, query: { ...read, value: 'fever_pct', aggregation: 'avg' } },
    { id: 'clinics', type: 'kpi', title: 'Clinics in the filter', w: 3, h: 1, query: { ...read, value: 'facility_code', aggregation: 'distinct' } },
    { id: 'reports', type: 'kpi', title: 'Reports', w: 3, h: 1, query: { ...read, aggregation: 'count' } },
    { id: 'weekly', type: 'line', title: 'Visits each week', w: 8, h: 3, query: { ...read, value: 'visits', aggregation: 'sum', timeColumn: 'week_start', interval: 'week' } },
    { id: 'by_country', type: 'bar', title: 'Visits by country', w: 4, h: 3, query: { ...read, value: 'visits', aggregation: 'sum', groupBy: 'country', limit: 10 } },
    { id: 'table', type: 'table', title: 'Reports', w: 12, h: 4, query: { kind: 'table', source: 'dataset', dataset: dsKey, columns: ['week_start', 'facility', 'country', 'visits', 'fever_cases', 'fever_pct', 'stockout_days'], sort: 'week_start', desc: true, limit: 50 } },
  ],
});
const haveDash = (await services.query.dashboards(actor, tenant, project)).some((d) => d.key === dash.key);
await services.query.saveDashboard(actor, tenant, project, dash, haveDash ? dash.key : undefined);
console.log(`Dashboard "${dash.name}": ${filters.length} filters from parameters (${filters.map((f) => f.label).join(', ')})`);
process.exit(0);
