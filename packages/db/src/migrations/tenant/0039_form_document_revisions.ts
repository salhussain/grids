import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// The history of a form's documents: each saved or published state, who made it and when.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('form_document_revision')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('form_id', 'uuid', (c) => c.notNull().references('form.id').onDelete('cascade'))
    .addColumn('document_id', 'text', (c) => c.notNull())
    // saved | published | restored
    .addColumn('action', 'text', (c) => c.notNull())
    .addColumn('snapshot', 'jsonb', (c) => c.notNull())
    .addColumn('actor_id', 'uuid')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create index form_document_revision_idx on form_document_revision (form_id, document_id, id desc)`.execute(db);
  await enableTenantRls(db, 'form_document_revision');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('form_document_revision').execute();
}
