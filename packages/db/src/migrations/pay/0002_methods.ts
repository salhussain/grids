import { sql, type Kysely } from 'kysely';

// Payment methods: which ways a merchant takes payments (card, wallet, bank, instalments), and which one a payment used.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table merchant add column methods jsonb not null default '["card"]'::jsonb`.execute(db);
  await sql`alter table payment add column method text`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table payment drop column method`.execute(db);
  await sql`alter table merchant drop column methods`.execute(db);
}
