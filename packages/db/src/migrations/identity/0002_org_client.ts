import { sql, type Kysely } from 'kysely';

// Applications an organisation registers to sign its people in through Grids (OIDC clients).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('org_client')
    .addColumn('client_id', 'text', (c) => c.primaryKey())
    .addColumn('org_id', 'text', (c) => c.notNull().references('org.id').onDelete('cascade'))
    .addColumn('name', 'text', (c) => c.notNull())
    // AES-256-GCM sealed secret; null = public client (PKCE only)
    .addColumn('secret_enc', 'text')
    .addColumn('redirect_uris', 'jsonb', (c) => c.notNull())
    .addColumn('post_logout_redirect_uris', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('disabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create index org_client_org_idx on org_client (org_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('org_client').execute();
}
