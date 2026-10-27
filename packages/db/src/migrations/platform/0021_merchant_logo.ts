import { sql, type Kysely } from 'kysely';

// A merchant's logo, shown on the payment page (a small picture kept with the merchant).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table payment_merchant add column logo text`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table payment_merchant drop column logo`.execute(db);
}
