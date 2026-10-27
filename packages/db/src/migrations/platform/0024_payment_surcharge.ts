import { sql, type Kysely } from 'kysely';

// What the person paid on top of the amount for the way they chose (told by GridPay when the payment ends).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table payment add column surcharge bigint not null default 0`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table payment drop column surcharge`.execute(db);
}
