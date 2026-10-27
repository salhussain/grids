import { sql, type Kysely } from 'kysely';

// What an organisation has used this month of the allowances that are counted as they happen (API calls).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table usage_counter (
      tenant_id uuid not null references tenant(id) on delete cascade,
      month date not null,
      key text not null,
      n bigint not null default 0,
      primary key (tenant_id, month, key)
    )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table usage_counter`.execute(db);
}
