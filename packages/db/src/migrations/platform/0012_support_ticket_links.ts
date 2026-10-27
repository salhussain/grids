import { sql, type Kysely } from 'kysely';

// Tickets can point at each other, as in Linear: one is the parent of another (a sub-issue), blocks it, or is related to it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table support_ticket_link (
      id uuid primary key,
      tenant_id uuid not null,
      -- parent: source is the parent of target · blocks: source blocks target · related: the two are related (either way round)
      kind text not null check (kind in ('parent', 'blocks', 'related')),
      source_id uuid not null references support_ticket(id) on delete cascade,
      target_id uuid not null references support_ticket(id) on delete cascade,
      created_by uuid,
      created_at timestamptz not null default now(),
      check (source_id <> target_id),
      unique (kind, source_id, target_id)
    )`.execute(db);
  await sql`create index support_ticket_link_source_idx on support_ticket_link (source_id)`.execute(db);
  await sql`create index support_ticket_link_target_idx on support_ticket_link (target_id)`.execute(db);
  // A ticket has at most one parent.
  await sql`create unique index support_ticket_link_one_parent on support_ticket_link (target_id) where kind = 'parent'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table support_ticket_link`.execute(db);
}
