import { sql, type Kysely } from 'kysely';

// Personal preferences (colour mode, interface language) follow a person across organisations.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('user_identity')
    .addColumn('preferences', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('user_identity').dropColumn('preferences').execute();
}
