import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

const id = 'uuid';
const now = sql`now()`;

// Dashboards (M5) and forms (M6, ADR 0006: immutable versions, append-only submissions).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('dashboard')
    .addColumn('id', id, (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('project_id', id, (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('widgets', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('is_public', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('sort', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .execute();
  await sql`create unique index dashboard_key_uq on dashboard (project_id, key)`.execute(db);
  await enableTenantRls(db, 'dashboard');

  await db.schema
    .createTable('form')
    .addColumn('id', id, (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('project_id', id, (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('subject_type_id', id, (c) => c.references('entity_type.id').onDelete('set null'))
    .addColumn('draft', 'jsonb', (c) => c.notNull())
    .addColumn('current_version', 'integer')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('archived_at', 'timestamptz')
    .execute();
  await sql`create unique index form_key_uq on form (project_id, key)`.execute(db);
  await enableTenantRls(db, 'form');

  await db.schema
    .createTable('form_version')
    .addColumn('form_id', id, (c) => c.notNull().references('form.id').onDelete('cascade'))
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('version', 'integer', (c) => c.notNull())
    .addColumn('definition', 'jsonb', (c) => c.notNull())
    .addColumn('published_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('published_by', id)
    .addPrimaryKeyConstraint('form_version_pk', ['form_id', 'version'])
    .execute();
  await enableTenantRls(db, 'form_version');

  await db.schema
    .createTable('submission')
    // Client-generated (UUIDv7) so offline devices can retry idempotently.
    .addColumn('id', id, (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('project_id', id, (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('form_id', id, (c) => c.notNull().references('form.id').onDelete('cascade'))
    .addColumn('form_version', 'integer', (c) => c.notNull())
    .addColumn('entity_id', id, (c) => c.references('entity.id').onDelete('set null'))
    .addColumn('answers', 'jsonb', (c) => c.notNull())
    .addColumn('submitted_by', id)
    .addColumn('collected_at', 'timestamptz', (c) => c.notNull())
    .addColumn('submitted_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('location', sql`geometry(Point, 4326)`)
    .execute();
  await sql`create index submission_form_idx on submission (form_id, submitted_at desc)`.execute(db);
  await sql`create index submission_entity_idx on submission (entity_id, submitted_at desc)`.execute(db);
  await enableTenantRls(db, 'submission');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['submission', 'form_version', 'form', 'dashboard']) await db.schema.dropTable(t).execute();
}
