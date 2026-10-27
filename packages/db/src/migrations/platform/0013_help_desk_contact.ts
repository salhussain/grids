import { sql, type Kysely } from 'kysely';

// The help window can ask for a phone number, and confirm an email address with a code before a request is sent.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table support_ticket add column requester_phone text`.execute(db);
  await sql`
    create table support_email_code (
      id uuid primary key,
      tenant_id uuid not null,
      email text not null,
      code_hash text not null,
      expires_at timestamptz not null,
      attempts int not null default 0,
      used_at timestamptz,
      created_at timestamptz not null default now()
    )`.execute(db);
  await sql`create index support_email_code_lookup on support_email_code (tenant_id, email) where used_at is null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table support_email_code`.execute(db);
  await sql`alter table support_ticket drop column requester_phone`.execute(db);
}
