import type { Kysely } from 'kysely';

// An invite can have dates of its own (wall-clock in the form's time zone), to let someone in outside the form's dates.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('form_link').addColumn('opens_at', 'text').addColumn('closes_at', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('form_link').dropColumn('closes_at').dropColumn('opens_at').execute();
}
