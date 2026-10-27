import { createServer, type Server } from 'node:http';
import { sql } from 'kysely';
import { uuidv7 } from '@grids/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';
import { tenantMigrations } from '@grids/db';

// SQL datasets: on a database connection, and over forms, APIs and other datasets.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let member: string;
let upstream: Server;
let facility: { id: string };
const key = 'health';

beforeAll(async () => {
  upstream = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: { items: [{ district: 'North', target: 10 }, { district: 'South', target: 20 }] } }));
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  h = await startHarness();
  tenantId = await h.activeTenant('SQL Org', 'business');
  admin = await h.join(tenantId, 'admin@sql.org', { role: 'org_admin' });
  member = await h.join(tenantId, 'member@sql.org');
  const made = await h.call(admin, 'POST', `/tenants/${tenantId}/projects`, { name: 'Health', template: 'health-surveillance' });
  expect(made.status).toBe(201);
  facility = (await h.call(admin, 'GET', url('/entities?type=facility&pageSize=5'))).body.items[0];

  // An external database to connect to: a table in the platform database.
  await sql`create table demo_sales (region text, amount numeric, sold_on date)`.execute(h.dbs.platform);
  await sql`insert into demo_sales values ('north', 10.5, '2024-01-01'), ('north', 4.5, '2024-01-02'), ('south', 7, '2024-01-03')`.execute(h.dbs.platform);
}, 240_000);
afterAll(async () => {
  await h?.stop();
  upstream?.close();
});

const url = (sub: string) => `/tenants/${tenantId}/projects/${key}${sub}`;
const post = (sub: string, body?: unknown, who = admin) => h.call(who, 'POST', url(sub), body);

/** The cell server's own address, as the owner role, so the "external" database is real. */
const dbUrl = () => {
  const u = new URL(h.dbs.cellAppUrl);
  return `postgres://grids_owner:{{DB_PASSWORD}}@${u.host}/grids_platform`;
};

describe('database connections', () => {
  it('accept every supported database and keep credentials in variables', async () => {
    const bad = (body: object, k = 'c') => post('/connections', { key: k, name: 'C', ...body });
    expect((await bad({ kind: 'mysql', target: 'postgres://u:{{PW}}@h/db' })).status).toBe(400);
    expect((await bad({ kind: 'mysql', target: 'mysql://u:hunter2@h/db' })).status).toBe(400);
    expect((await bad({ kind: 'mssql', target: 'mssql://u:{{PW}}@h/db' }, 'ms')).status).toBe(200);
    expect((await bad({ kind: 'snowflake', target: 'xy12345.eu-west-1', options: { token: 'raw-secret' } })).status).toBe(400);
    expect((await bad({ kind: 'bigquery', target: 'my-project', options: { serviceAccount: '{{BQ_KEY}}', dataset: 'sales' } }, 'bq')).status).toBe(200);
    expect((await bad({ kind: 'oracle', target: 'oracle://u:{{PW}}@h:1521/svc' }, 'ms')).status).toBe(409);
    for (const k of ['ms', 'bq']) expect((await h.call(admin, 'DELETE', url(`/connections/${k}`))).status).toBe(200);
  });

  it('are tested, browsed and queried read-only', async () => {
    await post('/variables', { key: 'DB_PASSWORD', value: 'grids_owner' });
    expect((await post('/connections', { key: 'warehouse', name: 'Warehouse', kind: 'postgres', target: dbUrl() })).status).toBe(200);
    expect((await post('/connections/warehouse/test')).body).toMatchObject({ ok: true });

    const catalog = (await h.call(admin, 'GET', url('/connections/warehouse/catalog'))).body;
    expect(catalog.dialect).toBe('postgres');
    expect(catalog.tables).toContainEqual({
      schema: 'public',
      name: 'demo_sales',
      columns: [{ name: 'region', type: 'text' }, { name: 'amount', type: 'numeric' }, { name: 'sold_on', type: 'date' }],
    });

    const run = (sqlText: string, limit?: number) =>
      post('/sql/run', { source: { type: 'connection', connection: 'warehouse', sql: sqlText }, ...(limit ? { limit } : {}) });
    const ok = await run('select region, sum(amount) as total, count(*) as n from demo_sales group by region order by region;');
    expect(ok.body.rows).toEqual([
      { region: 'north', total: 15, n: 2 },
      { region: 'south', total: 7, n: 1 },
    ]);
    expect(ok.body.columns).toEqual([
      { name: 'region', type: 'text' },
      { name: 'total', type: 'numeric' },
      { name: 'n', type: 'bigint' },
    ]);
    expect((await run('select sold_on from demo_sales order by 1', 2)).body).toMatchObject({ rows: [{ sold_on: '2024-01-01' }, { sold_on: '2024-01-02' }], truncated: true });
    for (const bad of ['delete from demo_sales', 'select 1; drop table demo_sales', 'select * into x from demo_sales'])
      expect((await run(bad)).status).toBe(400);
    const broken = await run('select nope from demo_sales');
    expect(broken.status).toBe(400);
    expect(broken.body.detail).toContain('nope');
    expect(JSON.stringify(broken.body)).not.toContain('grids_owner');
    expect((await run('select count(*) as n from demo_sales')).body.rows).toEqual([{ n: 3 }]);

    expect((await post('/sql/run', { source: { type: 'connection', connection: 'warehouse', sql: 'select 1' } }, member)).status).toBeGreaterThanOrEqual(403);
  });

  it('can look up unqualified tables in a default schema', async () => {
    await sql`create schema if not exists samples`.execute(h.dbs.platform);
    await sql`create table if not exists samples.clinics (id int, name text)`.execute(h.dbs.platform);
    await sql`insert into samples.clinics values (1, 'North Central Clinic')`.execute(h.dbs.platform);
    const run = (conn: string) => post('/sql/run', { source: { type: 'connection', connection: conn, sql: 'select name from clinics' } });
    expect((await post('/connections', { key: 'with_schema', name: 'With schema', kind: 'postgres', target: dbUrl(), options: { schema: 'samples' } })).status).toBe(200);
    expect((await run('with_schema')).body.rows).toEqual([{ name: 'North Central Clinic' }]);
    // Tables in public still resolve, and without the setting the unqualified name is not found.
    expect((await post('/sql/run', { source: { type: 'connection', connection: 'with_schema', sql: 'select count(*) as n from demo_sales' } })).body.rows).toEqual([{ n: 3 }]);
    expect((await run('warehouse')).status).toBe(400);
  });

  it('shows the variables at a breakpoint, and can stop there', async () => {
    const code = 'const rows = [];\nfor (let i = 1; i <= 3; i++) {\n  const double = i * 2;\n  rows.push({ double });\n}\nreturn rows;';
    const run = (debug?: object) => post('/sql/run', { source: { type: 'script', language: 'javascript', code, inputs: [] }, ...(debug && { debug }) });
    const plain = await run();
    expect(plain.status).toBe(200);
    expect(plain.body.rows).toHaveLength(3);
    expect(plain.body.debug).toBeUndefined();
    // Every pass over the marked line is kept, with what the variables were then.
    const marked = (await run({ lines: [4], stop: false })).body;
    expect(marked.rows).toHaveLength(3);
    expect(marked.debug.stopped).toBe(false);
    expect(marked.debug.hits.map((h: { line: number }) => h.line)).toEqual([4, 4, 4]);
    expect(marked.debug.hits[2].vars.find((v: { name: string }) => v.name === 'double')).toMatchObject({ type: 'number', preview: '6' });
    // Stopping ends the run at the first pass.
    const stopped = (await run({ lines: [4], stop: true })).body;
    expect(stopped.debug).toMatchObject({ stopped: true });
    expect(stopped.debug.hits).toHaveLength(1);
    expect(stopped.rows).toEqual([]);
  });

  it('back datasets that are refreshed into rows charts can read', async () => {
    const save = await post('/datasets', {
      key: 'sales_by_region',
      name: 'Sales by region',
      source: { type: 'connection', connection: 'warehouse', sql: 'select region, sum(amount) as total from demo_sales group by region order by region' },
    });
    expect(save.status).toBe(200);
    expect(save.body[0]).toMatchObject({ key: 'sales_by_region', kind: 'virtual', rowCount: 0, lastMaterialisedAt: null });

    const refreshed = (await post('/datasets/sales_by_region/refresh')).body;
    expect(refreshed.find((d: { key: string }) => d.key === 'sales_by_region')).toMatchObject({
      columns: ['region', 'total'],
      columnTypes: { region: 'text', total: 'numeric' },
      rowCount: 2,
      refreshError: null,
    });
    expect((await h.call(admin, 'GET', url('/datasets/sales_by_region/rows'))).body.items).toEqual([
      { region: 'north', total: 15 },
      { region: 'south', total: 7 },
    ]);

    // Physical: a table as it is.
    await post('/datasets', { key: 'sales_raw', name: 'Sales', source: { type: 'connection', connection: 'warehouse', table: 'public.demo_sales', sql: 'select * from "public"."demo_sales"' } });
    expect((await post('/datasets/sales_raw/refresh')).body.find((d: { key: string }) => d.key === 'sales_raw')).toMatchObject({ kind: 'physical', rowCount: 3 });

    // A failing refresh is recorded and keeps the old rows.
    await h.call(admin, 'PUT', url('/datasets/sales_by_region'), {
      key: 'sales_by_region',
      name: 'Sales by region',
      source: { type: 'connection', connection: 'warehouse', sql: 'select missing from demo_sales' },
    });
    expect((await post('/datasets/sales_by_region/refresh')).status).toBe(400);
    expect((await h.call(admin, 'GET', url('/datasets'))).body.find((d: { key: string }) => d.key === 'sales_by_region')).toMatchObject({ rowCount: 2, refreshError: expect.stringContaining('missing') });

    // Only database connections can back a dataset.
    await post('/connections', { key: 'api', name: 'API', kind: 'http', target: `http://127.0.0.1:${(upstream.address() as { port: number }).port}` });
    expect((await post('/datasets', { key: 'bad', name: 'Bad', source: { type: 'connection', connection: 'api', sql: 'select 1' } })).status).toBe(400);
    expect((await post('/datasets', { key: 'bad', name: 'Bad', source: { type: 'connection', connection: 'nope', sql: 'select 1' } })).status).toBe(400);
  });
});

describe('local datasets', () => {
  it('lists what they can read', async () => {
    const sources = (await h.call(admin, 'GET', url('/sql/sources'))).body;
    expect(sources.forms.find((f: { key: string }) => f.key === 'weekly_report')).toBeTruthy();
    expect(sources.forms[0].columns.slice(0, 2)).toEqual(['_id', '_status']);
    expect(sources.connections).toContainEqual({ key: 'api', name: 'API', kind: 'http' });
  });

  it('aggregate form submissions, and join them with an API and other datasets', async () => {
    const submit = (collectedAt: string, answers: object) =>
      post('/forms/weekly_report/submissions', { id: uuidv7(), version: 1, entityId: facility.id, collectedAt, answers: { diarrhoea: 0, measles: 0, deaths: 0, outbreak: false, stockout: 0, ...answers } });
    expect((await submit('2026-09-30T10:00:00Z', { malaria: 3, ili: 10 })).status).toBe(201);
    expect((await submit('2026-10-07T10:00:00Z', { malaria: 4, ili: 5 })).status).toBe(201);

    const run = (source: object) => post('/sql/run', { source });
    const form = await run({ type: 'local', inputs: [{ kind: 'form', ref: 'weekly_report', as: 'reports' }], sql: 'select count(*) as n, sum(malaria) as malaria, max(_submitted_at) is not null as has_time from reports' });
    expect(form.body.rows).toEqual([{ n: 2, malaria: 7, has_time: true }]);

    const joined = await run({
      type: 'local',
      inputs: [
        { kind: 'connection', ref: 'api', as: 'targets', path: 'data.items' },
        { kind: 'connection', ref: 'warehouse', as: 'sales', sql: 'select region, sum(amount) as total from demo_sales group by region' },
        { kind: 'dataset', ref: 'sales_raw', as: 'raw' },
      ],
      sql: "select t.district, t.target, s.total, (select count(*) from raw) as raw_rows from targets t left join sales s on lower(t.district) = s.region order by t.district",
    });
    expect(joined.status).toBe(200);
    expect(joined.body.rows).toEqual([
      { district: 'North', target: 10, total: 15, raw_rows: 3 },
      { district: 'South', target: 20, total: 7, raw_rows: 3 },
    ]);
  });

  it('are saved, refreshed and charted like any dataset', async () => {
    await post('/datasets', {
      key: 'malaria_total',
      name: 'Malaria total',
      source: { type: 'local', inputs: [{ kind: 'form', ref: 'weekly_report', as: 'reports' }], sql: "select date_trunc('week', _collected_at) as week, sum(malaria) as malaria from reports group by 1 order by 1" },
    });
    const done = (await post('/datasets/malaria_total/refresh')).body.find((d: { key: string }) => d.key === 'malaria_total');
    expect(done).toMatchObject({ kind: 'virtual', rowCount: 2, columns: ['week', 'malaria'] });
    expect(done.columnTypes.malaria).toMatch(/^(hugeint|bigint|double|decimal)/);

    const kpi = await post('/query', { kind: 'dataset', dataset: 'malaria_total', value: 'malaria', aggregation: 'sum' });
    expect(kpi.status).toBe(200);
    expect(kpi.body.rows[0].value).toBe(7);
  });

  it('can be written as code in JavaScript, Python or R, and run over the same sources', async () => {
    const inputs = [{ kind: 'form', ref: 'weekly_report', as: 'reports' }];
    const run = (language: string, code: string) => post('/sql/run', { source: { type: 'script', language, code, inputs } });
    const js = await run('javascript', 'return [{ reports: tables.reports.length, malaria: tables.reports.reduce((n, r) => n + r.malaria, 0) }]');
    expect(js.status).toBe(200);
    expect(js.body.rows).toEqual([{ reports: 2, malaria: 7 }]);
    expect(js.body.columns.map((c: { name: string }) => c.name)).toEqual(['reports', 'malaria']);
    const py = await run('python', 'result = reports.groupby(lambda i: 0).agg(reports=("malaria", "size"), malaria=("malaria", "sum")).reset_index(drop=True)');
    expect(py.status, JSON.stringify(py.body)).toBe(200);
    expect(py.body.rows).toEqual([{ reports: 2, malaria: 7 }]);
    const r = await run('r', 'result <- data.frame(reports = nrow(reports), malaria = sum(reports$malaria))');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.rows).toEqual([{ reports: 2, malaria: 7 }]);
    // Mistakes read as mistakes, with the line.
    const bad = await run('python', 'x = 1\ny = 1 / 0\nresult = x');
    expect(bad.status).toBe(400);
    expect(bad.body.detail).toMatch(/Line 2: ZeroDivisionError/);
    expect((await run('javascript', 'return 5')).status).toBe(400);
    // A saved script dataset refreshes like any other.
    await post('/datasets', { key: 'malaria_js', name: 'Malaria (code)', source: { type: 'script', language: 'javascript', code: 'return tables.reports.map((r) => ({ at: r._collected_at, malaria: r.malaria }))', inputs } });
    const done = (await post('/datasets/malaria_js/refresh')).body.find((d: { key: string }) => d.key === 'malaria_js');
    expect(done).toMatchObject({ kind: 'virtual', rowCount: 2, columns: ['at', 'malaria'] });
    expect((await post('/datasets', { key: 'self', name: 'Self', source: { type: 'script', language: 'python', code: 'result = []', inputs: [{ kind: 'dataset', ref: 'self', as: 'x' }] } })).status).toBe(400);
  });

  it('cannot read themselves, share a name between sources, or escape the sandbox', async () => {
    const save = (source: object) => post('/datasets', { key: 'loop', name: 'Loop', source });
    expect((await save({ type: 'local', sql: 'select 1', inputs: [{ kind: 'dataset', ref: 'loop', as: 'x' }] })).status).toBe(400);
    expect((await save({ type: 'local', sql: 'select 1', inputs: [{ kind: 'dataset', ref: 'sales_raw', as: 'x' }, { kind: 'dataset', ref: 'sales_raw', as: 'x' }] })).status).toBe(400);
    expect((await post('/sql/run', { source: { type: 'local', inputs: [], sql: "select * from read_csv('/etc/passwd')" } })).status).toBe(400);
    expect((await post('/sql/run', { source: { type: 'local', inputs: [{ kind: 'dataset', ref: 'ghost', as: 'g' }], sql: 'select * from g' } })).status).toBe(400);
    expect((await post('/datasets/sales_raw/refresh', undefined, member)).status).toBeGreaterThanOrEqual(403);
  });

  it('leaves job-written datasets alone', async () => {
    await post('/datasets', { key: 'manual', name: 'Manual' });
    const list = (await h.call(admin, 'GET', url('/datasets'))).body;
    expect(list.find((d: { key: string }) => d.key === 'manual')).toMatchObject({ kind: 'rows', source: { type: 'rows' } });
    expect((await post('/datasets/manual/refresh')).status).toBe(400);
  });
});

describe('dataset settings', () => {
  it('fill parameters in SQL and code, and refuse values that are not of their type', async () => {
    const parameters = [
      { name: 'region', label: 'Region', type: 'text', default: 'north' },
      { name: 'minimum', label: 'Minimum', type: 'number', default: '5' },
    ];
    const source = { type: 'connection', connection: 'warehouse', sql: 'select region, amount from demo_sales where region = {{ region }} and amount >= {{ minimum }} order by amount' };
    const run = (params: object, extra: object = {}) => post('/sql/run', { source, parameters, params, ...extra });
    expect((await run({})).body.rows).toEqual([{ region: 'north', amount: 10.5 }]);
    expect((await run({ region: 'south', minimum: '1' })).body.rows).toEqual([{ region: 'south', amount: 7 }]);
    // A quote in the value cannot end the string.
    expect((await run({ region: "x' or '1'='1" })).body.rows).toEqual([]);
    expect((await run({ minimum: 'many' })).status).toBe(400);
    expect((await post('/sql/run', { source: { ...source, sql: 'select {{ ghost }}' }, parameters, params: {} })).status).toBe(400);

    const js = await post('/sql/run', { source: { type: 'script', language: 'javascript', code: 'return [{ region: params.region, minimum: params.minimum + 1 }]', inputs: [] }, parameters, params: { minimum: '9' } });
    expect(js.body.rows).toEqual([{ region: 'north', minimum: 10 }]);

    // Saved defaults are used when the dataset refreshes.
    await post('/datasets', { key: 'param_sales', name: 'Param sales', source, settings: { parameters } });
    const done = (await post('/datasets/param_sales/refresh')).body.find((d: { key: string }) => d.key === 'param_sales');
    expect(done).toMatchObject({ rowCount: 1, settings: { parameters } });
  });

  it('give widgets named metrics, and a time column the dashboard period applies to', async () => {
    const settings = { timeColumn: 'sold_on', metrics: [{ key: 'total_sales', label: 'Total sales', column: 'amount', aggregation: 'sum' }, { key: 'orders', label: 'Orders', aggregation: 'count' }] };
    await post('/datasets', { key: 'timed_sales', name: 'Timed', source: { type: 'connection', connection: 'warehouse', table: 'public.demo_sales', sql: 'select * from "public"."demo_sales"' }, settings });
    await post('/datasets/timed_sales/refresh');
    const q = (spec: object) => post('/query', { kind: 'dataset', dataset: 'timed_sales', ...spec });
    expect((await q({ metric: 'total_sales' })).body.rows[0].value).toBe(22);
    expect((await q({ metric: 'orders' })).body.rows[0].value).toBe(3);
    expect((await q({ metric: 'total_sales', groupBy: 'region' })).body.rows).toEqual([{ label: 'north', value: 15 }, { label: 'south', value: 7 }]);
    expect((await q({ metric: 'nope' })).status).toBe(400);
    // The period only keeps rows whose time column falls inside it.
    const window = { range: { from: '2024-01-02T00:00:00Z', to: '2024-01-04T00:00:00Z' } };
    expect((await q({ metric: 'total_sales', ...window })).body.rows[0].value).toBe(11.5);
    // Charts over time default to nothing unless asked, and use the dataset's time column when they are.
    expect((await q({ metric: 'orders', timeColumn: 'sold_on', interval: 'day' })).body.rows).toHaveLength(3);
  });

  it('is read from the database with the values a viewer picks, and keeps no copy', async () => {
    const parameters = [{ name: 'region', label: 'Region', type: 'text', default: 'north', column: 'region' }, { name: 'minimum', label: 'Smallest sale', type: 'number', default: '0', column: 'amount' }];
    const source = { type: 'connection', connection: 'warehouse', sql: 'select region, amount from demo_sales where region = {{ region }} and amount >= {{ minimum }}' };
    await post('/datasets', { key: 'per_viewer', name: 'Per viewer', source, settings: { parameters, metrics: [{ key: 'total', label: 'Total', column: 'amount', aggregation: 'sum' }] } });
    await post('/datasets/per_viewer/refresh');
    const widgets = [
      { id: 'total', type: 'kpi', title: 'Total', query: { kind: 'dataset', dataset: 'per_viewer', metric: 'total' } },
      { id: 'rows', type: 'table', title: 'Rows', query: { kind: 'table', source: 'dataset', dataset: 'per_viewer', columns: ['region', 'amount'] } },
    ];
    const filters = { columns: [{ id: 'f_region', label: 'Region', dataset: 'per_viewer', column: 'region', kind: 'select', param: 'region', mode: 'run' }, { id: 'f_min', label: 'Smallest sale', dataset: 'per_viewer', column: 'amount', kind: 'range', param: 'minimum', part: 'min', mode: 'run' }] };
    expect((await post('/dashboards', { key: 'viewer_board', name: 'Per viewer', widgets, filters })).status).toBe(200);
    const get = (widget: string, cf?: object) => h.call(admin, 'GET', url(`/dashboards/viewer_board/widgets/${widget}${cf ? `?cf=${encodeURIComponent(JSON.stringify(cf))}` : ''}`));
    const stored = async () =>
      h.services.projects.cellTx(tenantId, async (tx) =>
        Number((await sql<{ n: string }>`select (select count(*) from dataset_row r join dataset d on d.id = r.dataset_id where d.key = 'per_viewer') + (select count(*) from dataset_variant v join dataset d on d.id = v.dataset_id where d.key = 'per_viewer') as n`.execute(tx)).rows[0]!.n),
      );

    // Nothing is copied: not by refreshing, and not by reading.
    expect(await stored()).toBe(0);
    // Nobody picked anything: the query runs with its defaults (north).
    expect((await get('total')).body.rows[0].value).toBe(15);
    expect((await get('total')).body.freshness).toMatchObject({ live: true, status: 'fresh' });
    // A viewer's value runs the query for that value.
    expect((await get('total', { f_region: 'south' })).body.rows[0].value).toBe(7);
    expect((await get('rows', { f_region: 'south' })).body.rows).toEqual([{ region: 'south', amount: 7 }]);
    expect((await get('total', { f_region: 'north', f_min: { min: 10 } })).body.rows[0].value).toBe(10.5);
    // The same values again, a moment later, share the read, even if the source has moved on.
    await sql`insert into demo_sales values ('south', 100, '2024-02-01')`.execute(h.dbs.platform);
    expect((await get('total', { f_region: 'south' })).body.rows[0].value).toBe(7);
    // Other values are a new read, and see the new row.
    expect((await get('total', { f_region: 'south', f_min: { min: 1 } })).body.rows[0].value).toBe(107);
    // Refreshing by hand forgets what was read.
    await post('/datasets/per_viewer/refresh');
    expect((await get('total', { f_region: 'south' })).body.rows[0].value).toBe(107);
    // A quote in a value cannot end the string (it just matches nothing), and clearing a filter falls back to the defaults.
    expect((await get('total', { f_min: { min: 5 }, f_region: "x' or '1'='1" })).body.rows[0].value).toBeNull();
    expect((await get('total', { f_region: null })).body.rows[0].value).toBe(15);
    expect(await stored()).toBe(0);
    await sql`delete from demo_sales where amount = 100`.execute(h.dbs.platform);
  });
  it('works grouping out on the database, so a big table is not cut short, and values cannot change the query', async () => {
    await sql`drop table if exists big_sales`.execute(h.dbs.platform);
    await sql`create table big_sales as select (i % 3)::int as bucket, case when i % 2 = 0 then 'even' else 'odd' end as parity, (i % 10)::numeric as amount, timestamp '2024-01-01' + (i % 5) * interval '1 day' as sold_at from generate_series(1, 30000) i`.execute(h.dbs.platform);
    await post('/datasets', { key: 'big', name: 'Big', source: { type: 'connection', connection: 'warehouse', sql: 'select * from big_sales' } });
    await post('/datasets/big/refresh');
    const ask = async (q: object) => (await post('/query', { kind: 'dataset', dataset: 'big', ...q })).body;
    // More rows than a read would bring back: the database does the counting.
    expect((await ask({ aggregation: 'count' })).rows[0].value).toBe(30000);
    expect((await ask({ value: 'amount', aggregation: 'sum' })).rows[0].value).toBe(135000);
    expect((await ask({ aggregation: 'count', groupBy: 'parity' })).rows).toEqual([{ label: 'even', value: 15000 }, { label: 'odd', value: 15000 }]);
    const series = (await ask({ aggregation: 'count', timeColumn: 'sold_at', interval: 'day' })).rows;
    expect(series).toHaveLength(5);
    expect(series.every((r: { value: number }) => r.value === 6000)).toBe(true);
    expect((await ask({ aggregation: 'count' })).freshness).toMatchObject({ live: true });
    // Conditions and filters are applied by the database too.
    expect((await ask({ value: 'amount', aggregation: 'sum', conditions: [{ op: 'in', column: 'parity', values: ['odd'] }] })).rows[0].value).toBe(75000);
    expect((await ask({ aggregation: 'count', conditions: [{ op: 'range', column: 'amount', min: 5 }] })).rows[0].value).toBe(15000);
    expect((await ask({ aggregation: 'count', conditions: [{ op: 'contains', column: 'parity', text: 'ev' }] })).rows[0].value).toBe(15000);
    expect((await ask({ aggregation: 'count', filter: { column: 'parity', equals: 'even' } })).rows[0].value).toBe(15000);
    expect((await ask({ aggregation: 'count', conditions: [{ op: 'dates', column: 'sold_at', from: '2024-01-02', to: '2024-01-03' }] })).rows[0].value).toBe(12000);
    // A table widget and a filter's list of values come from the database too.
    const table = (await post('/query', { kind: 'table', source: 'dataset', dataset: 'big', columns: ['parity', 'amount'], sort: 'amount', desc: true, limit: 3, conditions: [{ op: 'in', column: 'parity', values: ['odd'] }] })).body;
    expect(table.rows).toEqual([{ parity: 'odd', amount: 9 }, { parity: 'odd', amount: 9 }, { parity: 'odd', amount: 9 }]);
    expect(table.freshness).toMatchObject({ live: true });
    // A value is only ever a value: a quote or a backslash cannot end the string, and % does not match everything.
    for (const text of ["x' or '1'='1", "\\' or 1=1 --", "'; drop table big_sales; --"]) {
      expect((await ask({ aggregation: 'count', conditions: [{ op: 'in', column: 'parity', values: [text] }] })).rows[0].value).toBe(0);
      expect((await ask({ aggregation: 'count', filter: { column: 'parity', equals: text } })).rows[0].value).toBe(0);
    }
    expect((await ask({ aggregation: 'count', conditions: [{ op: 'contains', column: 'parity', text: '%' }] })).rows[0].value).toBe(0);
    // A column the query does not have never reaches the database's SQL: it is answered from the rows, as "(none)".
    const odd = await ask({ aggregation: 'count', groupBy: 'x"; drop table big_sales; --' });
    expect(odd.rows).toEqual([{ label: '(none)', value: 20000 }]);
    // Two columns to group by: each group is named "first · second".
    const two = (await ask({ aggregation: 'count', groupBy: 'parity', thenBy: 'bucket' })).rows;
    expect(two).toHaveLength(6);
    expect(two.map((r: { label: string }) => r.label).sort()).toEqual(['even · 0', 'even · 1', 'even · 2', 'odd · 0', 'odd · 1', 'odd · 2']);
    expect(two.reduce((n: number, r: { value: number }) => n + r.value, 0)).toBe(30000);
    // When the database cannot do it, the rows are grouped here and read the same way.
    const unknown = (await ask({ aggregation: 'count', groupBy: 'parity', thenBy: 'nope' })).rows;
    expect(unknown.map((r: { label: string }) => r.label).sort()).toEqual(['even · (none)', 'odd · (none)']);
    // A metric can be a SQL expression, worked out by the database.
    const withMetric = (expression: string) => h.call(admin, 'PUT', url('/datasets/big'), { key: 'big', name: 'Big', source: { type: 'connection', connection: 'warehouse', sql: 'select * from big_sales' }, settings: { metrics: [{ key: 'mean_amount', label: 'Mean amount', aggregation: 'count', expression }] } });
    expect((await withMetric('sum(amount) / nullif(count(*), 0)')).status).toBe(200);
    await post('/datasets/big/refresh');
    expect((await ask({ metric: 'mean_amount' })).rows[0].value).toBe(4.5);
    expect((await ask({ metric: 'mean_amount', groupBy: 'parity' })).rows).toEqual([{ label: 'odd', value: 5 }, { label: 'even', value: 4 }]);
    expect((await ask({ metric: 'mean_amount', conditions: [{ op: 'in', column: 'parity', values: ['even'] }] })).rows[0].value).toBe(4);
    // It must be one expression that closes its own brackets: nothing can be added to the query around it.
    for (const bad of ['sum(amount); drop table big_sales', 'sum(amount) -- the rest', 'sum(amount) /* x */', '1) from big_sales union select 1 where (1', 'sum(amount']) expect((await withMetric(bad)).status).toBe(400);
    expect((await withMetric('sum(nope)')).status).toBe(200);
    expect((await post('/query', { kind: 'dataset', dataset: 'big', metric: 'mean_amount' })).status).toBe(400);
    expect((await sql<{ n: string }>`select count(*)::text as n from big_sales`.execute(h.dbs.platform)).rows[0]!.n).toBe('30000');
    await sql`drop table big_sales`.execute(h.dbs.platform);
  });

  it('applies a viewer’s values to a database dataset, and only copies the kinds that need it', async () => {
    const source = { type: 'connection', connection: 'warehouse', sql: 'select region, amount from demo_sales where region = {{ region }}' };
    await post('/datasets', { key: 'fixed', name: 'Fixed', source, settings: { parameters: [{ name: 'region', label: 'Region', type: 'text', default: 'north', column: 'region' }] } });
    await post('/datasets/fixed/refresh');
    // The query is run for the values, whatever the dataset's other settings.
    const r = await post('/query', { kind: 'dataset', dataset: 'fixed', value: 'amount', aggregation: 'sum', params: { region: 'south' } });
    expect(r.body.rows[0].value).toBe(7);
    // A dataset the platform is given rows for keeps them.
    expect((await post('/datasets', { key: 'rows_only', name: 'Rows only', settings: { runPerViewer: true } })).status).toBe(200);
  });

  it('are filtered by viewers through a dashboard\'s column filters, per widget', async () => {
    const widgets = [
      { id: 'total', type: 'kpi', title: 'Total', query: { kind: 'dataset', dataset: 'timed_sales', metric: 'total_sales' } },
      { id: 'orders', type: 'kpi', title: 'Orders', query: { kind: 'dataset', dataset: 'timed_sales', metric: 'orders' } },
      { id: 'rows', type: 'table', title: 'Rows', query: { kind: 'table', source: 'dataset', dataset: 'timed_sales', columns: ['region', 'amount'] } },
    ];
    const filters = {
      columns: [
        { id: 'f_region', label: 'Region', dataset: 'timed_sales', column: 'region', kind: 'multi', scope: ['total', 'rows'] },
        { id: 'f_amount', label: 'Amount', dataset: 'timed_sales', column: 'amount', kind: 'range' },
        { id: 'f_day', label: 'Sold', dataset: 'timed_sales', column: 'sold_on', kind: 'date', scope: ['orders'] },
      ],
    };
    expect((await post('/dashboards', { key: 'sales_board', name: 'Sales', widgets, filters })).status).toBe(200);
    const get = (widget: string, cf?: object, who = admin) => h.call(who, 'GET', url(`/dashboards/sales_board/widgets/${widget}${cf ? `?cf=${encodeURIComponent(JSON.stringify(cf))}` : ''}`));
    // Nobody has picked anything: every row.
    expect((await get('total')).body.rows[0].value).toBe(22);
    // A filter on a column only changes the widgets in its scope.
    expect((await get('total', { f_region: ['south'] })).body.rows[0].value).toBe(7);
    expect((await get('orders', { f_region: ['south'] })).body.rows[0].value).toBe(3);
    expect((await get('rows', { f_region: ['south'] })).body.rows).toEqual([{ region: 'south', amount: 7 }]);
    // Ranges, dates and clearing work; unscoped filters apply to every widget on the dataset.
    expect((await get('orders', { f_amount: { min: 5 } })).body.rows[0].value).toBe(2);
    expect((await get('orders', { f_day: { from: '2024-01-02', to: '2024-01-02' } })).body.rows[0].value).toBe(1);
    expect((await get('total', { f_region: null })).body.rows[0].value).toBe(22);
    // What a filter offers comes from its column, for people who can see the dashboard.
    const values = await h.call(admin, 'GET', url('/dashboards/sales_board/filters/f_region/values'));
    expect(values.body).toEqual(['north', 'south']);
    expect((await h.call(member, 'GET', url('/dashboards/sales_board/filters/f_region/values'))).status).toBe(404);
    // A list narrows by what is picked on the other filters of the dataset (here: amounts of 8 and up are only north's 10.5).
    const cf = encodeURIComponent(JSON.stringify({ f_amount: { min: 8 } }));
    expect((await h.call(admin, 'GET', url(`/dashboards/sales_board/filters/f_region/values?cf=${cf}`))).body).toEqual(['north']);
    expect((await h.call(admin, 'GET', url('/dashboards/sales_board/filters/nope/values'))).status).toBe(404);
  });
});

// Last, because the move clears every dataset's metric list.
describe('metrics moved into widgets', () => {
  it('moves a dataset’s old metrics into the widgets that used them', async () => {
    const source = { type: 'connection', connection: 'warehouse', sql: 'select region, amount from demo_sales' };
    const metrics = [{ key: 'total', label: 'Total', column: 'amount', aggregation: 'sum' }, { key: 'ratio', label: 'Ratio', aggregation: 'count', expression: 'sum(amount) / nullif(count(*), 0)' }];
    expect((await post('/datasets', { key: 'legacy_m', name: 'Legacy', source, settings: { metrics } })).status).toBe(200);
    const widgets = [
      { id: 'a', type: 'kpi', title: 'A', query: { kind: 'dataset', dataset: 'legacy_m', metric: 'total' } },
      { id: 'b', type: 'kpi', title: 'B', query: { kind: 'dataset', dataset: 'legacy_m', metric: 'ratio' } },
      { id: 'c', type: 'kpi', title: 'C', query: { kind: 'dataset', dataset: 'legacy_m', value: 'amount', aggregation: 'max' } },
    ];
    expect((await post('/dashboards', { key: 'legacy_board', name: 'Legacy', widgets })).status).toBe(200);
    const migrations = await tenantMigrations.getMigrations();
    await h.services.projects.cellTx(tenantId, (tx) => migrations['0047_inline_metrics']!.up(tx as never));
    const board = (await h.call(admin, 'GET', url('/dashboards'))).body.find((d: { key: string }) => d.key === 'legacy_board');
    const q = (id: string) => board.widgets.find((w: { id: string }) => w.id === id).query;
    expect(q('a')).toMatchObject({ value: 'amount', aggregation: 'sum' });
    expect(q('a').metric).toBeUndefined();
    expect(q('b')).toMatchObject({ expression: 'sum(amount) / nullif(count(*), 0)' });
    expect(q('b').metric).toBeUndefined();
    expect(q('c')).toMatchObject({ value: 'amount', aggregation: 'max' });
    const ds = (await h.call(admin, 'GET', url('/datasets'))).body.find((d: { key: string }) => d.key === 'legacy_m');
    expect(ds.settings.metrics).toEqual([]);
    // The widgets still work.
    await post('/datasets/legacy_m/refresh');
    expect((await h.call(admin, 'GET', url('/dashboards/legacy_board/widgets/a'))).body.rows[0].value).toBeGreaterThan(0);
  });

  it('say what the database said when a query fails, and where', async () => {
    const run = (sql: string) => post('/sql/run', { source: { type: 'connection', connection: 'warehouse', sql } });
    const sql = "  select region, amount\nfrom demo_sales\nwhere amount = ''";
    const r = await run(sql);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ title: 'The query failed', detail: 'invalid input syntax for type numeric: ""', sql: { code: '22P02', text: sql.trim() } });
    // The position points at the offending text in the query as sent.
    expect(r.body.sql.text.slice(r.body.sql.position - 1, r.body.sql.position + 1)).toBe("''");
    const bad = await run('select * from nowhere_at_all');
    expect(bad.body.sql).toMatchObject({ code: '42P01' });
  });
});
