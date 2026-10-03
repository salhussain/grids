import { sql, type Kysely } from 'kysely';

// Dashboard parameters (spec §9): which filters the dashboard header offers.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('dashboard')
    .addColumn('filters', 'jsonb', (c) => c.notNull().defaultTo(sql`'{"areaType":null,"period":false}'::jsonb`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('dashboard').dropColumn('filters').execute();
}
