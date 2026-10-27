import { sql, type Kysely } from 'kysely';

// A member can be limited to several entities (each with everything under it), not just one.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table project_member add column root_entity_ids uuid[] not null default '{}'`.execute(db);
  await sql`update project_member set root_entity_ids = array[root_entity_id] where root_entity_id is not null`.execute(db);
  await sql`alter table project_member drop column root_entity_id`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table project_member add column root_entity_id uuid references entity (id) on delete set null`.execute(db);
  await sql`update project_member set root_entity_id = root_entity_ids[1]`.execute(db);
  await sql`alter table project_member drop column root_entity_ids`.execute(db);
}
