import { sql, type Kysely } from 'kysely';

// Merchants now live in GridPay (its own service and database); the platform keeps only its record of each payment and the fee.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table payment drop column merchant_id`.execute(db);
  await sql`drop table payment_merchant`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table payment_merchant (
      id uuid primary key,
      tenant_id uuid not null references tenant(id) on delete cascade,
      name text not null,
      merchant_ref text not null default '',
      credentials_enc text,
      mode text not null default 'test' check (mode in ('test', 'live')),
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      logo text
    )`.execute(db);
  await sql`alter table payment add column merchant_id uuid references payment_merchant(id) on delete set null`.execute(db);
}
