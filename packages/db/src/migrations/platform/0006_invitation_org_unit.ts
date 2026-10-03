import { type Kysely } from 'kysely';

// Invite straight into an org unit (cell id; no cross-database FK). Placement is
// created in the tenant cell when the invitation is accepted.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('invitation').addColumn('org_unit_id', 'uuid').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('invitation').dropColumn('org_unit_id').execute();
}
