import { sql, type Kysely } from 'kysely';

// GridPay: the merchants organisations add, and the payments taken through them. Organisations are named by the
// platform's tenant id (`org_id`); GridPay knows nothing else about them.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table merchant (
      id uuid primary key,
      org_id text not null,
      name text not null,
      merchant_ref text not null default '',
      credentials_enc text,
      logo text,
      mode text not null default 'test' check (mode in ('test', 'live')),
      enabled boolean not null default true,
      created_at timestamptz not null default now()
    )`.execute(db);
  await sql`create index merchant_org_idx on merchant (org_id)`.execute(db);
  await sql`
    create table payment (
      id uuid primary key,
      org_id text not null,
      merchant_id uuid references merchant(id) on delete set null,
      project_key text not null,
      form_key text not null,
      amount bigint not null check (amount >= 0),
      currency char(3) not null,
      description text not null default '',
      payer_email text,
      status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
      return_url text not null,
      notified_at timestamptz,
      created_at timestamptz not null default now(),
      paid_at timestamptz
    )`.execute(db);
  await sql`create index payment_org_idx on payment (org_id, created_at desc)`.execute(db);
  await sql`create index payment_unnotified_idx on payment (created_at) where status <> 'pending' and notified_at is null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table payment`.execute(db);
  await sql`drop table merchant`.execute(db);
}
