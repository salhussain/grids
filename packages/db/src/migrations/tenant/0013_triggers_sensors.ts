import { sql, type Kysely } from 'kysely';

// Event triggers, webhooks and sensors (spec §7). Event triggers and the webhook
// token live on the job; runs carry their trigger context (event, webhook rows).
// Sensor state sits beside job_schedule: cross-tenant ids and timing for the
// worker's scan, plus the last cursor seen.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('job')
    .addColumn('triggers', 'jsonb', (c) => c.notNull().defaultTo(sql`'{"events":[],"webhook":false}'::jsonb`))
    .addColumn('sensor', 'jsonb')
    .addColumn('webhook_token', 'text')
    .execute();
  await sql`create unique index job_webhook_token_uq on job (webhook_token) where webhook_token is not null`.execute(db);
  await db.schema.alterTable('run').addColumn('context', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`)).execute();
  await db.schema
    .createTable('job_sensor')
    .addColumn('job_id', 'uuid', (c) => c.primaryKey().references('job.id').onDelete('cascade'))
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('every_minutes', 'integer', (c) => c.notNull())
    .addColumn('next_check_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_checked_at', 'timestamptz')
    .addColumn('cursor', 'text')
    .addColumn('last_error', 'text')
    .execute();
  await sql`create index job_sensor_next_idx on job_sensor (next_check_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('job_sensor').execute();
  await db.schema.alterTable('run').dropColumn('context').execute();
  await db.schema.alterTable('job').dropColumn('webhook_token').dropColumn('sensor').dropColumn('triggers').execute();
}
