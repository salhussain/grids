import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// The front-end help desk: people using a project's public page or portal ask its organisation for help. Each request is a
// piece of work, so what it needs on top of that is who asked (with or without an account), a secret to open it again,
// who wrote each message, and the files that came with it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table work_item add column requester_email text`.execute(db);
  // form | help (the help window) | manual
  await sql`alter table work_item add column channel text`.execute(db);
  // Set when the organisation passed it on to the Grids team: { ticketId, number, at, by }
  await sql`alter table work_item add column escalated jsonb`.execute(db);
  await sql`create index work_item_requester_idx on work_item (requester_id) where requester_id is not null`.execute(db);

  await sql`alter table work_event add column author_name text`.execute(db);
  // staff | requester | system
  await sql`alter table work_event add column author_kind text`.execute(db);
  await sql`alter table work_event add column attachments jsonb not null default '[]'::jsonb`.execute(db);

  await db.schema
    .createTable('support_attachment')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('project_id', 'uuid', (c) => c.notNull().references('project.id').onDelete('cascade'))
    // Set when the message it was sent with is stored.
    .addColumn('item_id', 'uuid', (c) => c.references('work_item.id').onDelete('cascade'))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('content_type', 'text', (c) => c.notNull())
    .addColumn('size', 'integer', (c) => c.notNull())
    .addColumn('content', sql`bytea`, (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create index support_attachment_item_idx on support_attachment (item_id)`.execute(db);
  await enableTenantRls(db, 'support_attachment');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('support_attachment').execute();
  await sql`alter table work_event drop column attachments, drop column author_kind, drop column author_name`.execute(db);
  await sql`alter table work_item drop column escalated, drop column channel, drop column requester_email`.execute(db);
}
