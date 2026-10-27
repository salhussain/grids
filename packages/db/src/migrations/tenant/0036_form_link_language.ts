import type { Kysely } from 'kysely';

// The language a link opens the form in (the person can still change it); empty means their own choice.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('form_link').addColumn('language', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('form_link').dropColumn('language').execute();
}
