import { sql, type Kysely } from 'kysely';

// The way a payment was made (card, wallet, bank, instalments), told by GridPay when it ends.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table payment add column method text`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table payment drop column method`.execute(db);
}
