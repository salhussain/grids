import { sql, type Kysely } from 'kysely';

// Organisation language settings: enabled interface languages, the default, and wording overrides.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('tenant_profile')
    .addColumn('localization', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('tenant_profile').dropColumn('localization').execute();
}
