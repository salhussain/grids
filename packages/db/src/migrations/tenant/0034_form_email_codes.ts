import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// One-time codes emailed to people who fill a form in through a public link, to confirm their address.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('form_email_code')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('form_id', 'uuid', (c) => c.notNull().references('form.id').onDelete('cascade'))
    .addColumn('email', 'text', (c) => c.notNull())
    // Only a keyed hash of the code is kept.
    .addColumn('code_hash', 'text', (c) => c.notNull())
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    // Set when the code is used, or when a newer one replaces it.
    .addColumn('used_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create index form_email_code_lookup_idx on form_email_code (form_id, email, created_at desc)`.execute(db);
  await enableTenantRls(db, 'form_email_code');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('form_email_code').execute();
}
