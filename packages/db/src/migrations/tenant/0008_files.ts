import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

const id = 'uuid';
const now = sql`now()`;

// Uploaded files that jobs parse (M4 `file.parse`). Each upload is a new version
// under a stable key; jobs read the latest. Content lives in Postgres (RLS-scoped,
// size-capped) for now; the object store is the seam for larger files later.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('project_file')
    .addColumn('id', id, (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('project_id', id, (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('content_type', 'text', (c) => c.notNull())
    .addColumn('size', 'integer', (c) => c.notNull())
    .addColumn('sha256', 'text', (c) => c.notNull())
    .addColumn('content', 'bytea', (c) => c.notNull())
    .addColumn('uploaded_by', id)
    .addColumn('uploaded_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .execute();
  await sql`create index project_file_key_idx on project_file (project_id, key, uploaded_at desc)`.execute(db);
  await enableTenantRls(db, 'project_file');

  // Event trigger: queue the job when a file it parses is uploaded.
  await db.schema.alterTable('job').addColumn('run_on_upload', 'boolean', (c) => c.notNull().defaultTo(false)).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('job').dropColumn('run_on_upload').execute();
  await db.schema.dropTable('project_file').execute();
}
