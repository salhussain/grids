import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// A dataset can be run again for the values a viewer picks on a dashboard. Each distinct set of values is a "variant":
// its rows are kept for a while (and thrown away when the dataset is refreshed or the variant is old), apart from the
// dataset's own rows, which stay what they were.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('dataset_variant')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('dataset_id', 'uuid', (c) => c.notNull().references('dataset.id').onDelete('cascade'))
    // A hash of the parameter values.
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('params', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('row_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('refreshed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_used_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index dataset_variant_key_idx on dataset_variant (dataset_id, key)`.execute(db);
  await enableTenantRls(db, 'dataset_variant');

  await db.schema
    .createTable('dataset_variant_row')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('variant_id', 'uuid', (c) => c.notNull().references('dataset_variant.id').onDelete('cascade'))
    .addColumn('data', 'jsonb', (c) => c.notNull())
    .execute();
  await sql`create index dataset_variant_row_idx on dataset_variant_row (variant_id, id)`.execute(db);
  await enableTenantRls(db, 'dataset_variant_row');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('dataset_variant_row').execute();
  await db.schema.dropTable('dataset_variant').execute();
}
