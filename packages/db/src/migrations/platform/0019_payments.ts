import { sql, type Kysely } from 'kysely';

// Organisations take payments from their own users (a fee on a form) through a provider they connect; Grids records each
// payment and the fee its plan charges, and adds the fees to the organisation's invoice.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table plan add column payment_fee jsonb`.execute(db);
  await sql`
    create table tenant_payment_provider (
      tenant_id uuid primary key references tenant(id) on delete cascade,
      provider text not null,
      mode text not null default 'sandbox' check (mode in ('sandbox', 'live')),
      credentials_enc text,
      enabled boolean not null default false,
      updated_at timestamptz not null default now()
    )`.execute(db);
  await sql`
    create table payment (
      id uuid primary key,
      tenant_id uuid not null references tenant(id) on delete cascade,
      provider text not null,
      provider_ref text,
      project_key text not null,
      form_key text not null,
      amount bigint not null check (amount >= 0),
      currency char(3) not null,
      description text not null default '',
      payer_email text,
      status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
      meta jsonb not null default '{}'::jsonb,
      fee_amount bigint not null default 0,
      fee_invoice_id uuid references invoice(id) on delete set null,
      submission_id uuid,
      created_at timestamptz not null default now(),
      paid_at timestamptz
    )`.execute(db);
  await sql`create index payment_tenant_idx on payment (tenant_id, created_at desc)`.execute(db);
  await sql`create index payment_unbilled_idx on payment (tenant_id) where status = 'succeeded' and fee_amount > 0 and fee_invoice_id is null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table payment`.execute(db);
  await sql`drop table tenant_payment_provider`.execute(db);
  await sql`alter table plan drop column payment_fee`.execute(db);
}
