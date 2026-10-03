import { createDb, withTenant, type CellDB } from '@grids/db';
import { startTestDatabases, type TestDatabases } from '@grids/db/testing';
import { JobInput, uuidv7 } from '@grids/schema';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainQueue, enqueueRun, freshness, nextRun, parseCsv, scheduleDue, syncSchedule, upsertEntities } from '../src/index.js';

let dbs: TestDatabases;
let cell: Kysely<CellDB>;
const tenantId = uuidv7();
const projectId = uuidv7();

const tx = <T>(fn: Parameters<typeof withTenant<CellDB, T>>[2]) => withTenant(cell, tenantId, fn);

beforeAll(async () => {
  dbs = await startTestDatabases();
  cell = createDb<CellDB>(dbs.cellAppUrl);
  await tx(async (t) => {
    await t.insertInto('project').values({ id: projectId, tenant_id: tenantId, key: 'flights', name: 'Flights' }).execute();
    await t
      .insertInto('entity_type')
      .values([
        { id: uuidv7(), tenant_id: tenantId, project_id: projectId, key: 'country', name: 'Country', plural: 'Countries' },
        {
          id: uuidv7(),
          tenant_id: tenantId,
          project_id: projectId,
          key: 'aircraft',
          name: 'Aircraft',
          plural: 'Aircraft',
          geometry: 'point',
          parent_types: ['country'],
          attributes: JSON.stringify([
            { key: 'callsign', label: 'Callsign', type: 'text' },
            { key: 'altitude_m', label: 'Altitude', type: 'number' },
            { key: 'on_ground', label: 'On ground', type: 'boolean' },
          ]),
        },
      ])
      .execute();
    await t
      .insertInto('data_element')
      .values([
        { id: uuidv7(), tenant_id: tenantId, project_id: projectId, key: 'altitude_m', name: 'Altitude', aggregation: 'avg' },
        { id: uuidv7(), tenant_id: tenantId, project_id: projectId, key: 'velocity', name: 'Velocity', aggregation: 'avg' },
      ])
      .execute();
  });
}, 180_000);
afterAll(async () => {
  await cell?.destroy();
  await dbs?.stop();
});

const opensky = {
  time: 1790939041,
  states: [
    ['aa9300', 'UAL147  ', 'United States', 1790939041, 1790939041, -0.4456, 51.4741, null, true, 1.29],
    ['4031bc', 'GBSDP   ', 'United Kingdom', 1790939040, 1790939040, -0.5331, 51.582, 99.06, false, 35.92],
    ['4acb59', 'SAS11M  ', 'Sweden', 1790939041, 1790939041, -0.5054, 51.0433, 11590.02, false, 252.55],
  ],
};

async function createJob(input: JobInput) {
  const job = JobInput.parse(input);
  const id = uuidv7();
  await tx(async (t) => {
    await t
      .insertInto('job')
      .values({ id, tenant_id: tenantId, project_id: projectId, key: job.key, name: job.name, steps: JSON.stringify(job.steps), schedule: job.schedule, max_retries: job.maxRetries, timeout_seconds: job.timeoutSeconds })
      .execute();
  });
  return id;
}

const flightsJob: JobInput = {
  key: 'positions',
  name: 'Positions',
  maxRetries: 1,
  steps: [
    { id: 'fetch', type: 'http.extract', url: 'https://opensky.test/api/states/all', rows: 'states.{"icao": $[0], "callsign": $trim($[1]), "country": $[2], "time": $[3], "lon": $[5], "lat": $[6], "alt": $[7], "ground": $[8], "speed": $[9]}' },
    { id: 'countries', type: 'entity.upsert', entityType: 'country', code: 'country', name: 'country' },
    { id: 'aircraft', type: 'entity.upsert', entityType: 'aircraft', code: 'icao', name: '$exists(callsign) and callsign != "" ? callsign : icao', parentType: 'country', parentCode: 'country', lon: 'lon', lat: 'lat', attributes: { callsign: 'callsign', altitude_m: 'alt', on_ground: 'ground' } },
    { id: 'airborne', type: 'filter', condition: 'ground = false' },
    { id: 'obs', type: 'observation.write', entityType: 'aircraft', entityCode: 'icao', at: 'time', values: { altitude_m: 'alt', velocity: 'speed' } },
    { id: 'snapshot', type: 'dataset.write', dataset: 'airborne_now', columns: [{ name: 'icao', value: 'icao' }, { name: 'callsign', value: 'callsign' }, { name: 'altitude', value: 'alt' }] },
  ],
};

const fakeFetch = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;

describe('job engine', () => {
  it('extracts, maps, upserts a hierarchy, writes observations and a dataset', async () => {
    const jobId = await createJob(flightsJob);
    await tx((t) => enqueueRun(t, { tenantId, projectId, jobId, trigger: 'manual' }));
    expect(await drainQueue(cell, { worker: 'test', fetch: fakeFetch(opensky) })).toBe(1);

    const run = await tx((t) => t.selectFrom('run').selectAll().where('job_id', '=', jobId).executeTakeFirstOrThrow());
    expect(run.error).toBeNull();
    expect(run.status).toBe('succeeded');
    expect(run.stats).toMatchObject({ rows_fetched: 3, entities_created: 6, observations_written: 4, dataset_rows: 2 });

    const aircraft = await tx((t) =>
      t
        .selectFrom('entity as e')
        .innerJoin('entity as p', 'p.id', 'e.parent_id')
        .select(['e.code', 'e.name', 'e.attributes', 'p.name as parent', sql<string>`ST_AsText(e.geom)`.as('wkt')])
        .where('e.code', '=', '4acb59')
        .executeTakeFirstOrThrow(),
    );
    expect(aircraft).toMatchObject({ name: 'SAS11M', parent: 'Sweden', attributes: { callsign: 'SAS11M', altitude_m: 11590.02, on_ground: false }, wkt: 'POINT(-0.5054 51.0433)' });

    const logs = await tx((t) => t.selectFrom('run_log').select(['step', 'message']).where('run_id', '=', run.id).orderBy('id').execute());
    expect(logs.map((l) => l.step)).toEqual([null, 'fetch', 'countries', 'aircraft', 'airborne', 'obs', 'snapshot', null]);

    // Second run: same data → unchanged, idempotent observations
    await tx((t) => enqueueRun(t, { tenantId, projectId, jobId, trigger: 'manual' }));
    await drainQueue(cell, { worker: 'test', fetch: fakeFetch(opensky) });
    const second = await tx((t) => t.selectFrom('run').select('stats').where('job_id', '=', jobId).orderBy('queued_at', 'desc').executeTakeFirstOrThrow());
    expect(second.stats).toMatchObject({ entities_created: 0, entities_unchanged: 6 });
    const obs = await tx((t) => t.selectFrom('observation').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow());
    expect(Number(obs.n)).toBe(4);
    const ds = await tx((t) => t.selectFrom('dataset').select(['row_count', 'columns']).where('key', '=', 'airborne_now').executeTakeFirstOrThrow());
    expect(ds).toMatchObject({ row_count: 2, columns: ['icao', 'callsign', 'altitude'] });
  });

  it('fails without partial writes, then retries with backoff', async () => {
    const jobId = await createJob({
      key: 'broken',
      name: 'Broken',
      maxRetries: 1,
      steps: [
        { id: 'fetch', type: 'http.extract', url: 'https://opensky.test/x', rows: 'states.{"icao": $[0], "country": $[2]}' },
        { id: 'countries', type: 'entity.upsert', entityType: 'country', code: '"Atlantis-" & country', name: 'country' },
        { id: 'bad', type: 'entity.upsert', entityType: 'nope', code: 'icao', name: 'icao' },
      ],
    });
    await tx((t) => enqueueRun(t, { tenantId, projectId, jobId, trigger: 'manual' }));
    await drainQueue(cell, { worker: 'test', fetch: fakeFetch(opensky) });
    const runs = await tx((t) => t.selectFrom('run').select(['status', 'error', 'attempt', 'trigger']).where('job_id', '=', jobId).orderBy('attempt').execute());
    expect(runs[0]).toMatchObject({ status: 'failed', error: 'Unknown entity type "nope"', attempt: 1 });
    expect(runs[1]).toMatchObject({ status: 'queued', attempt: 2, trigger: 'retry' });
    const atlantis = await tx((t) => t.selectFrom('entity').select('id').where('code', 'like', 'Atlantis-%').execute());
    expect(atlantis).toHaveLength(0); // rolled back
    const queued = await cell.selectFrom('job_queue').select('available_at').executeTakeFirstOrThrow();
    expect(queued.available_at.getTime()).toBeGreaterThan(Date.now() + 20_000);
  });

  it('reports HTTP errors per step', async () => {
    const jobId = await createJob({ key: 'down', name: 'Down', maxRetries: 0, steps: [{ id: 'fetch', type: 'http.extract', url: 'https://opensky.test/down' }] });
    await tx((t) => enqueueRun(t, { tenantId, projectId, jobId, trigger: 'manual' }));
    await drainQueue(cell, { worker: 'test', fetch: fakeFetch({}, 503) });
    const run = await tx((t) => t.selectFrom('run').select(['status', 'error']).where('job_id', '=', jobId).executeTakeFirstOrThrow());
    expect(run).toEqual({ status: 'failed', error: 'fetch: HTTP 503 from opensky.test' });
  });
});

describe('schedules', () => {
  it('enqueues due jobs once and advances them', async () => {
    const jobId = await createJob({ key: 'every5', name: 'Every 5', schedule: '*/5 * * * *', steps: [{ id: 'fetch', type: 'http.extract', url: 'https://x.test/' }] });
    const t0 = new Date('2026-10-02T10:02:00Z');
    await tx((t) => syncSchedule(t, { id: jobId, tenantId, schedule: '*/5 * * * *', timezone: 'UTC', enabled: true }, t0));
    expect(await scheduleDue(cell, new Date('2026-10-02T10:04:00Z'))).toBe(0);
    expect(await scheduleDue(cell, new Date('2026-10-02T10:05:01Z'))).toBe(1);
    expect(await scheduleDue(cell, new Date('2026-10-02T10:05:02Z'))).toBe(0); // advanced to 10:10
    expect(nextRun('0 6 * * 1', 'Pacific/Auckland', t0).toISOString()).toBe('2026-10-04T17:00:00.000Z');
  });
});

describe('model', () => {
  it('moves subtrees and enforces parent rules', async () => {
    const r = await tx((t) =>
      upsertEntities(t, { tenantId, projectId, typeKey: 'aircraft', rows: [{ code: '4acb59', name: 'SAS11M', parentCode: 'United Kingdom' }], source: 'user' }),
    );
    expect(r.updated).toBe(1);
    const moved = await tx((t) => sql<{ ok: boolean }>`select e.path <@ p.path as ok from entity e join entity p on p.code = 'United Kingdom' where e.code = '4acb59'`.execute(t));
    expect(moved.rows[0]!.ok).toBe(true);
    await expect(
      tx((t) => upsertEntities(t, { tenantId, projectId, typeKey: 'country', rows: [{ code: 'X', name: 'X', parentCode: '4acb59', parentType: 'aircraft' }], source: 'user' })),
    ).rejects.toThrow(/can't be placed under/);
  });

  it('isolates tenants (RLS)', async () => {
    const other = await withTenant(cell, uuidv7(), (t) => t.selectFrom('entity').select('id').execute());
    expect(other).toHaveLength(0);
  });

  it('computes freshness and parses CSV', () => {
    const now = new Date('2026-10-02T10:00:00Z');
    expect(freshness('2026-10-02T09:53:00Z', 5, now).status).toBe('fresh');
    expect(freshness('2026-10-02T09:50:00Z', 5, now).status).toBe('warning');
    expect(freshness('2026-10-02T09:00:00Z', 5, now).status).toBe('stale');
    expect(freshness(null, 5, now).status).toBe('unknown');
    expect(parseCsv('a,b\n1,"x, ""y"""\n\n2,z\n')).toEqual([{ a: '1', b: 'x, "y"' }, { a: '2', b: 'z' }]);
  });
});
