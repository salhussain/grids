import { sql, type Kysely } from 'kysely';

// A person can star tickets to find them again.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table support_favorite (
      user_id uuid not null,
      ticket_id uuid not null references support_ticket(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (user_id, ticket_id)
    )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table support_favorite`.execute(db);
}
