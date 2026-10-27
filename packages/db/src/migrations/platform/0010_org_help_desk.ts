import { sql, type Kysely } from 'kysely';

// The organisation's help desk: people using any of its public pages or the portal can ask it for help, with or
// without an account. Their requests are the organisation's own support tickets, with the stages it chose, files, and a
// conversation; only the organisation can pass one on to the Grids team.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table support_ticket alter column created_by drop not null`.execute(db);
  // Someone with no account is known by what they typed.
  await sql`alter table support_ticket add column requester_name text`.execute(db);
  await sql`alter table support_ticket add column requester_email text`.execute(db);
  // member: raised by a signed-in member in the workspace · help: asked from a project's page or the portal
  await sql`alter table support_ticket add column channel text not null default 'member'`.execute(db);
  // The project whose page the request came from (a hint for the team, not where it belongs).
  await sql`alter table support_ticket add column source_project text`.execute(db);
  // One of the organisation's own stages; null for tickets that use only the plain status.
  await sql`alter table support_ticket add column stage text`.execute(db);
  // Keys of the organisation's own labels.
  await sql`alter table support_ticket add column labels text[] not null default '{}'`.execute(db);

  await sql`alter table support_message alter column author_id drop not null`.execute(db);
  await sql`alter table support_message add column author_name text`.execute(db);
  // requester | staff (the organisation's team) | platform (the Grids team) | system (a change of stage, and the like)
  await sql`alter table support_message add column author_kind text`.execute(db);
  await sql`alter table support_message add column attachments jsonb not null default '[]'::jsonb`.execute(db);

  await db.schema
    .createTable('support_file')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull().references('tenant.id').onDelete('cascade'))
    // Set when the message it was sent with is stored.
    .addColumn('ticket_id', 'uuid', (c) => c.references('support_ticket.id').onDelete('cascade'))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('content_type', 'text', (c) => c.notNull())
    .addColumn('size', 'integer', (c) => c.notNull())
    .addColumn('content', sql`bytea`, (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create index support_file_ticket_idx on support_file (ticket_id)`.execute(db);

  await db.schema
    .createTable('support_desk')
    .addColumn('tenant_id', 'uuid', (c) => c.primaryKey().references('tenant.id').onDelete('cascade'))
    .addColumn('config', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('support_desk').execute();
  await db.schema.dropTable('support_file').execute();
  await sql`alter table support_message drop column attachments, drop column author_kind, drop column author_name`.execute(db);
  await sql`alter table support_ticket drop column labels, drop column stage, drop column source_project, drop column channel, drop column requester_email, drop column requester_name`.execute(db);
}
