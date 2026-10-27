import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// Pictures (and later other files) people attach while filling a form. A submission's answer holds the id.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('form_attachment')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('project_id', 'uuid', (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('form_key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('content_type', 'text', (c) => c.notNull())
    .addColumn('size', 'integer', (c) => c.notNull())
    .addColumn('content', 'bytea', (c) => c.notNull())
    .addColumn('uploaded_by', 'uuid')
    .addColumn('uploaded_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create index form_attachment_project_idx on form_attachment (project_id, form_key)`.execute(db);
  await enableTenantRls(db, 'form_attachment');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('form_attachment').execute();
}
