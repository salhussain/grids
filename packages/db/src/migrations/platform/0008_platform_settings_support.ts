import { sql, type Kysely } from 'kysely';

// Platform-wide settings (console branding, languages and organisation defaults)
// and organisation-internal support tickets that can be escalated to the platform.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('platform_setting')
    .addColumn('key', 'text', (c) => c.primaryKey())
    .addColumn('value', 'jsonb', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .alterTable('support_ticket')
    // organisation: handled by the organisation's own admins · platform: the Grids team
    .addColumn('audience', 'text', (c) => c.notNull().defaultTo('platform'))
    .addColumn('escalated_at', 'timestamptz')
    .execute();
  await sql`alter table support_ticket add constraint support_ticket_audience_ck check (audience in ('organisation','platform'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table support_ticket drop constraint support_ticket_audience_ck`.execute(db);
  await db.schema.alterTable('support_ticket').dropColumn('escalated_at').dropColumn('audience').execute();
  await db.schema.dropTable('platform_setting').execute();
}
