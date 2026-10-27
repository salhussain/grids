import { sql, type Kysely } from 'kysely';

// GridPay is the one payment service. An organisation adds one or more merchants to it (the accounts payments are paid out to).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`drop table tenant_payment_provider`.execute(db);
  await sql`
    create table payment_merchant (
      id uuid primary key,
      tenant_id uuid not null references tenant(id) on delete cascade,
      name text not null,
      merchant_ref text not null default '',
      credentials_enc text,
      mode text not null default 'test' check (mode in ('test', 'live')),
      enabled boolean not null default true,
      created_at timestamptz not null default now()
    )`.execute(db);
  await sql`create index payment_merchant_tenant_idx on payment_merchant (tenant_id)`.execute(db);
  await sql`alter table payment add column merchant_id uuid references payment_merchant(id) on delete set null`.execute(db);
  await sql`update payment set provider = 'gridpay'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table payment drop column merchant_id`.execute(db);
  await sql`drop table payment_merchant`.execute(db);
}
