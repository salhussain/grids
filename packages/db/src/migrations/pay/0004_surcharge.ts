import { sql, type Kysely } from 'kysely';

// A way of paying may add a surcharge (a percentage and/or a fixed amount) and, for instalments, say how many there are.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table pay_method add column surcharge_percent numeric(6,3) not null default 0`.execute(db);
  await sql`alter table pay_method add column surcharge_fixed bigint not null default 0`.execute(db);
  await sql`alter table pay_method add column instalments integer not null default 4`.execute(db);
  await sql`alter table payment add column surcharge bigint not null default 0`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table payment drop column surcharge`.execute(db);
  await sql`alter table pay_method drop column instalments`.execute(db);
  await sql`alter table pay_method drop column surcharge_fixed`.execute(db);
  await sql`alter table pay_method drop column surcharge_percent`.execute(db);
}
