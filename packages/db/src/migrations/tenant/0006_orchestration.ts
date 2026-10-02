import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

const id = 'uuid';
const now = sql`now()`;

// Orchestration (M4, ADR 0002): configured jobs (a pipeline of typed steps),
// runs with logs, and datasets they materialise. The queue and schedule tables
// hold only ids and timing and are not tenant-scoped, so workers can claim work
// across tenants; everything they then touch runs under the run's tenant (RLS).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('job')
    .addColumn('id', id, (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('project_id', id, (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('steps', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('schedule', 'text') // cron, null = manual only
    .addColumn('timezone', 'text', (c) => c.notNull().defaultTo('UTC'))
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('max_retries', 'integer', (c) => c.notNull().defaultTo(2))
    .addColumn('timeout_seconds', 'integer', (c) => c.notNull().defaultTo(300))
    // Data is "fresh" if a run succeeded within this many minutes.
    .addColumn('freshness_minutes', 'integer')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .execute();
  await sql`create unique index job_key_uq on job (project_id, key)`.execute(db);
  await enableTenantRls(db, 'job');

  await db.schema
    .createTable('run')
    .addColumn('id', id, (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('project_id', id, (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('job_id', id, (c) => c.notNull().references('job.id').onDelete('cascade'))
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('queued'))
    .addColumn('trigger', 'text', (c) => c.notNull())
    .addColumn('triggered_by', id)
    .addColumn('attempt', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('queued_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('started_at', 'timestamptz')
    .addColumn('finished_at', 'timestamptz')
    .addColumn('error', 'text')
    .addColumn('stats', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('worker', 'text')
    .addCheckConstraint('run_status_ck', sql`status in ('queued','running','succeeded','failed','cancelled')`)
    .execute();
  await sql`create index run_job_idx on run (job_id, queued_at desc)`.execute(db);
  await sql`create index run_project_idx on run (project_id, queued_at desc)`.execute(db);
  await enableTenantRls(db, 'run');

  await db.schema
    .createTable('run_log')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('run_id', id, (c) => c.notNull().references('run.id').onDelete('cascade'))
    .addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('level', 'text', (c) => c.notNull())
    .addColumn('step', 'text')
    .addColumn('message', 'text', (c) => c.notNull())
    .execute();
  await sql`create index run_log_run_idx on run_log (run_id, id)`.execute(db);
  await enableTenantRls(db, 'run_log');

  // Cross-tenant work queue (ids only).
  await db.schema
    .createTable('job_queue')
    .addColumn('run_id', id, (c) => c.primaryKey().references('run.id').onDelete('cascade'))
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('available_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('locked_by', 'text')
    .addColumn('locked_until', 'timestamptz')
    .execute();
  await sql`create index job_queue_available_idx on job_queue (available_at)`.execute(db);

  await db.schema
    .createTable('job_schedule')
    .addColumn('job_id', id, (c) => c.primaryKey().references('job.id').onDelete('cascade'))
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('cron', 'text', (c) => c.notNull())
    .addColumn('timezone', 'text', (c) => c.notNull().defaultTo('UTC'))
    .addColumn('next_run_at', 'timestamptz', (c) => c.notNull())
    .execute();
  await sql`create index job_schedule_next_idx on job_schedule (next_run_at)`.execute(db);

  await db.schema
    .createTable('dataset')
    .addColumn('id', id, (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('project_id', id, (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('columns', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('row_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_materialised_at', 'timestamptz')
    .addColumn('last_run_id', id)
    .addColumn('freshness_minutes', 'integer')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .execute();
  await sql`create unique index dataset_key_uq on dataset (project_id, key)`.execute(db);
  await enableTenantRls(db, 'dataset');

  await db.schema
    .createTable('dataset_row')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('dataset_id', id, (c) => c.notNull().references('dataset.id').onDelete('cascade'))
    .addColumn('data', 'jsonb', (c) => c.notNull())
    .execute();
  await sql`create index dataset_row_dataset_idx on dataset_row (dataset_id, id)`.execute(db);
  await enableTenantRls(db, 'dataset_row');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['dataset_row', 'dataset', 'job_schedule', 'job_queue', 'run_log', 'run', 'job'])
    await db.schema.dropTable(t).execute();
}
