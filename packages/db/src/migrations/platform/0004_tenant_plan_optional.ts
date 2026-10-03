import { sql, type Kysely } from 'kysely';

// A tenant has no plan until it subscribes; the plan then mirrors its subscription.
// Negotiated discounts are kept separately so plan/interval changes can reapply them.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table tenant alter column plan_id drop not null`.execute(db);
  await sql`alter table subscription add column extra_discount_pct numeric(5,2) not null default 0`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table subscription drop column extra_discount_pct`.execute(db);
  await sql`alter table tenant alter column plan_id set not null`.execute(db);
}
