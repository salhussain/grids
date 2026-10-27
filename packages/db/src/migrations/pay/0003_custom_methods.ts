import { sql, type Kysely } from 'kysely';

// An organisation's ways of paying are data, not a fixed list: each has a name, a logo and the kind of screen it uses
// (card, wallet, bank or instalments). The four everyone starts with are added the first time they are looked at, and can
// be renamed or removed like any other.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table pay_method (
      org_id text not null,
      id text not null,
      name text not null,
      kind text not null check (kind in ('card', 'wallet', 'bank', 'instalments')),
      logo text,
      sort integer not null default 0,
      created_at timestamptz not null default now(),
      primary key (org_id, id)
    )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table pay_method`.execute(db);
}
