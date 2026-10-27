/**
 * Adds a "Data Lab" project with sample data to try datasets on, without touching anything else:
 *   - a small database of its own (a `samples` schema next to the cell's tables),
 *   - a connection to it,
 *   - datasets of every kind: a table as it is, SQL on the connection, SQL over other datasets, uploaded rows,
 *     and datasets written in Python, R and JavaScript.
 *
 *   pnpm --filter @grids/api build && pnpm --filter @grids/api seed:samples
 *
 * Safe to run again: the sample tables are rebuilt and the project's connection and datasets are updated in place.
 * ORGANISATION_ID and USER_ID pick who owns it (defaults: the first organisation and its first admin).
 * The Python dataset needs the packages downloaded once: pnpm --filter @grids/data warm
 */
import { createDb, TenantRouter, type CellDB, type PlatformDB } from '@grids/db';
import { ConnectionInput, DatasetInput, ProjectInput, VariableInput, type DatasetInput as DatasetIn } from '@grids/schema';
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
const project = 'data-lab';

// ---------------------------------------------------------------- the sample database

// Made-up, deterministic figures (a small pseudo-random generator, so every run gives the same data).
let seed = 20260101;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const int = (lo: number, hi: number) => Math.floor(lo + rand() * (hi - lo + 1));

const DISTRICTS = ['North', 'South', 'East', 'West'] as const;
const CLINICS = DISTRICTS.flatMap((d, i) => ['Central', 'Harbour', 'Hillside'].map((n, j) => ({ id: i * 3 + j + 1, name: `${d} ${n} Clinic`, district: d, beds: int(8, 40) })));
const PRODUCTS = ['Bed nets', 'Test kits', 'Vaccines', 'Oral rehydration'] as const;

await sql`create schema if not exists samples`.execute(owner);
await sql`drop table if exists samples.visits, samples.clinics, samples.supplies`.execute(owner);
await sql`create table samples.clinics (id int primary key, name text not null, district text not null, beds int not null)`.execute(owner);
await sql`create table samples.visits (clinic_id int not null references samples.clinics(id), visit_date date not null, patients int not null, malaria int not null, dengue int not null)`.execute(owner);
await sql`create table samples.supplies (region text not null, product text not null, shipped_on date not null, units int not null, cost numeric(10,2) not null)`.execute(owner);
for (const c of CLINICS) await sql`insert into samples.clinics values (${c.id}, ${c.name}, ${c.district}, ${c.beds})`.execute(owner);
const start = Date.UTC(2026, 0, 5);
for (const c of CLINICS)
  for (let w = 0; w < 26; w++) {
    const patients = int(40, 160);
    await sql`insert into samples.visits values (${c.id}, ${new Date(start + w * 7 * 86_400_000).toISOString().slice(0, 10)}, ${patients}, ${int(0, Math.round(patients / 12))}, ${int(0, Math.round(patients / 18))})`.execute(owner);
  }
for (const d of DISTRICTS)
  for (const p of PRODUCTS)
    for (let m = 0; m < 6; m++) await sql`insert into samples.supplies values (${d.toLowerCase()}, ${p}, ${new Date(Date.UTC(2026, m, int(1, 27))).toISOString().slice(0, 10)}, ${int(50, 900)}, ${(int(200, 9000) / 10).toFixed(2)})`.execute(owner);

// The connection uses the application's own database login, which is given read access to the sample tables.
// (Grids only runs read-only statements on connections.)
await sql.raw('grant usage on schema samples to grids_app; grant select on all tables in schema samples to grids_app').execute(owner);
const url = new URL(process.env.DATABASE_URL_CELL_APP!);
console.log(`sample database: ${CLINICS.length} clinics, ${CLINICS.length * 26} visit rows, ${DISTRICTS.length * PRODUCTS.length * 6} supply rows`);

// ---------------------------------------------------------------- the project

const exists = (await services.projects.list(actor, tenant)).some((p) => p.key === project);
if (!exists) await services.projects.create(actor, tenant, ProjectInput.parse({ key: project, name: 'Data Lab', description: 'Sample data to try datasets, SQL and code on.', visibility: 'organisation', color: '#0e7490', icon: 'flask-conical' }));
await services.connections.setVariable(actor, tenant, project, VariableInput.parse({ key: 'SAMPLES_DB_URL', value: url.toString(), description: 'Address of the sample database' })).catch((e: { statusCode?: number }) => {
  if (e.statusCode !== 409) throw e; // already there from an earlier run
});
await services.connections.saveConnection(
  actor,
  tenant,
  project,
  ConnectionInput.parse({ key: 'samples', name: 'Sample clinics database', description: 'Clinics, weekly visits and supply shipments (schema "samples").', kind: 'postgres', target: '{{SAMPLES_DB_URL}}', test: 'select count(*) from samples.clinics' }),
  undefined,
).catch((e: { statusCode?: number }) => {
  if (e.statusCode !== 409) throw e;
});
const test = await services.connections.testSaved(actor, tenant, project, 'samples');
console.log(`connection samples: ${test.ok ? 'works' : 'FAILED'} · ${test.message}`);
if (!test.ok) process.exit(1);

// ---------------------------------------------------------------- datasets

const have = new Set((await services.jobs.datasets(actor, tenant, project)).map((d) => d.key));
const dataset = async (input: DatasetIn) => {
  const parsed = DatasetInput.parse(input);
  await services.jobs.saveDataset(actor, tenant, project, parsed, have.has(parsed.key) ? parsed.key : undefined);
  have.add(parsed.key);
};
const refresh = async (key: string) => {
  try {
    const d = (await services.datasets.refresh(actor, tenant, project, key)).find((x) => x.key === key)!;
    console.log(`  ${key}: ${d.rowCount} rows · ${d.columns.join(', ')}`);
  } catch (e) {
    console.log(`  ${key}: FAILED · ${e instanceof Error ? [e.message, (e as { detail?: string }).detail].filter(Boolean).join(': ') : String(e)}`);
  }
};

// Rows of its own: what an upload or a job would leave.
await dataset({ key: 'district_targets', name: 'District targets', description: 'Uploaded rows: the visits each district aims for each week.', source: { type: 'rows' } });
await services.jobs.uploadDatasetRows(actor, tenant, project, 'district_targets', { mode: 'replace', rows: DISTRICTS.map((d, i) => ({ district: d, weekly_target: 300 + i * 60, malaria_alert: 6 })) });

const inputs = [{ kind: 'dataset' as const, ref: 'visits', as: 'visits' }];
await dataset({ key: 'clinics', name: 'Clinics', description: 'A table as it is: samples.clinics.', source: { type: 'connection', connection: 'samples', table: 'samples.clinics', sql: 'select * from "samples"."clinics"' } });
await dataset({ key: 'visits', name: 'Weekly visits', description: 'A table as it is: samples.visits, one row per clinic and week.', source: { type: 'connection', connection: 'samples', table: 'samples.visits', sql: 'select * from "samples"."visits"' }, settings: { timeColumn: 'visit_date', metrics: [{ key: 'patients', label: 'Patients seen', column: 'patients', aggregation: 'sum' }, { key: 'malaria_cases', label: 'Malaria cases', column: 'malaria', aggregation: 'sum' }, { key: 'dengue_cases', label: 'Dengue cases', column: 'dengue', aggregation: 'sum' }, { key: 'reports', label: 'Weekly reports', aggregation: 'count' }] } });
await dataset({
  key: 'visits_by_district',
  name: 'Visits by district',
  description: 'SQL on the connection: patients and cases per district.',
  source: {
    type: 'connection',
    connection: 'samples',
    sql: 'select c.district, count(distinct c.id) as clinics, sum(v.patients) as patients, sum(v.malaria) as malaria, sum(v.dengue) as dengue from samples.visits v join samples.clinics c on c.id = v.clinic_id group by c.district order by patients desc',
  },
});
await dataset({
  key: 'supplies_by_product',
  name: 'Supplies by product',
  description: 'SQL on the connection: units shipped and spend per product and region.',
  source: { type: 'connection', connection: 'samples', sql: 'select product, region, sum(units) as units, round(sum(cost), 2) as spend from samples.supplies group by product, region order by spend desc' },
});
await dataset({
  key: 'against_targets',
  name: 'Districts against target',
  description: 'SQL over other datasets (DuckDB): this dataset joins the weekly visits with the uploaded targets.',
  source: {
    type: 'local',
    inputs: [
      { kind: 'dataset', ref: 'visits', as: 'visits' },
      { kind: 'dataset', ref: 'clinics', as: 'clinics' },
      { kind: 'dataset', ref: 'district_targets', as: 'targets' },
    ],
    sql: 'select c.district, v.visit_date, sum(v.patients) as patients, any_value(t.weekly_target) as target, sum(v.patients) >= any_value(t.weekly_target) as on_target from visits v join clinics c on c.id = v.clinic_id join targets t on t.district = c.district group by c.district, v.visit_date order by v.visit_date, c.district',
  },
});
await dataset({
  key: 'trend_python',
  name: 'Weekly trend (Python)',
  description: 'Python with pandas: weekly patients with a four-week rolling average.',
  source: {
    type: 'script',
    language: 'python',
    inputs,
    code: `# Each source is a pandas DataFrame named like its alias: visits.
weekly = visits.groupby("visit_date", as_index=False).agg(patients=("patients", "sum"), malaria=("malaria", "sum"))
weekly["rolling_4_weeks"] = weekly["patients"].rolling(4, min_periods=1).mean().round(1)
result = weekly
`,
  },
});
await dataset({
  key: 'rates_r',
  name: 'Case rates by clinic (R)',
  description: 'R: malaria and dengue cases per 1,000 patients at each clinic, ranked.',
  source: {
    type: 'script',
    language: 'r',
    inputs: [
      { kind: 'dataset', ref: 'visits', as: 'visits' },
      { kind: 'dataset', ref: 'clinics', as: 'clinics' },
    ],
    code: `# Each source is a data.frame named like its alias: visits, clinics.
totals <- aggregate(cbind(patients, malaria, dengue) ~ clinic_id, data = visits, FUN = sum)
joined <- merge(totals, clinics, by.x = "clinic_id", by.y = "id")
joined$malaria_per_1000 <- round(joined$malaria / joined$patients * 1000, 1)
joined$dengue_per_1000 <- round(joined$dengue / joined$patients * 1000, 1)
result <- joined[order(-joined$malaria_per_1000), c("name", "district", "patients", "malaria_per_1000", "dengue_per_1000")]
`,
  },
});
await dataset({
  key: 'busiest_js',
  name: 'Busiest weeks (JavaScript)',
  description: 'JavaScript: the five weeks with the most patients, and how each compares with the average.',
  source: {
    type: 'script',
    language: 'javascript',
    inputs,
    code: `// Each source is a list of rows in tables.<alias>.
const byWeek = {};
for (const r of tables.visits) byWeek[r.visit_date] = (byWeek[r.visit_date] ?? 0) + r.patients;
const weeks = Object.entries(byWeek).map(([week, patients]) => ({ week, patients }));
const average = weeks.reduce((n, w) => n + w.patients, 0) / weeks.length;
return weeks
  .sort((a, b) => b.patients - a.patients)
  .slice(0, 5)
  .map((w) => ({ ...w, above_average_pct: Math.round((w.patients / average - 1) * 1000) / 10 }));
`,
  },
});

console.log('datasets');
// Tables first, then what is built on them.
for (const k of ['clinics', 'visits', 'visits_by_district', 'supplies_by_product', 'against_targets', 'trend_python', 'rates_r', 'busiest_js']) await refresh(k);
console.log(`\nOpen the Data Lab project: /o/${tenant}/p/${project}/datasets`);
await owner.destroy();
await platformDb.destroy();
