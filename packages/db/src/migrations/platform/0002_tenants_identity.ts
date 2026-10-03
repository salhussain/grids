import { sql, type Kysely } from 'kysely';

// Control plane: plans/entitlements, tenants + placement, global identities,
// memberships, invitations, platform audit log (spec §2, §3, §12).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('plan')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
    // { projects, users, forms, submissions_per_month, storage_gb, ... }; null = unlimited
    .addColumn('limits', 'jsonb', (c) => c.notNull())
    .addColumn('features', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .execute();

  await db.schema
    .createTable('tenant')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('slug', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) =>
      c
        .notNull()
        .defaultTo('active')
        .check(sql`status in ('provisioning', 'active', 'suspended')`),
    )
    .addColumn('plan_id', 'text', (c) => c.notNull().references('plan.id'))
    .addColumn('cell_id', 'text', (c) => c.notNull().references('cell.id'))
    .addColumn('idp_org_id', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('user_identity')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('idp_subject', 'text', (c) => c.notNull().unique())
    .addColumn('email', sql`citext`)
    .addColumn('display_name', 'text')
    .addColumn('is_platform_admin', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_seen_at', 'timestamptz')
    .execute();

  await db.schema
    .createTable('membership')
    .addColumn('tenant_id', 'uuid', (c) => c.notNull().references('tenant.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (c) =>
      c.notNull().references('user_identity.id').onDelete('cascade'),
    )
    // Coarse tenant-level role; fine-grained grants live in the tenant cell (M2).
    .addColumn('role', 'text', (c) => c.notNull().check(sql`role in ('org_admin', 'member')`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('membership_pk', ['tenant_id', 'user_id'])
    .execute();

  await db.schema
    .createTable('invitation')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull().references('tenant.id').onDelete('cascade'))
    .addColumn('email', sql`citext`, (c) => c.notNull())
    .addColumn('role', 'text', (c) => c.notNull().check(sql`role in ('org_admin', 'member')`))
    .addColumn('token_hash', 'text', (c) => c.notNull().unique())
    .addColumn('invited_by', 'uuid', (c) => c.references('user_identity.id'))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('accepted_at', 'timestamptz')
    .addColumn('accepted_by', 'uuid', (c) => c.references('user_identity.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index invitation_pending_uq on invitation (tenant_id, email) where accepted_at is null`.execute(
    db,
  );

  await db.schema
    .createTable('platform_audit_log')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('actor_id', 'uuid')
    .addColumn('tenant_id', 'uuid')
    .addColumn('action', 'text', (c) => c.notNull())
    .addColumn('details', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .execute();
  await sql`create index platform_audit_log_tenant_idx on platform_audit_log (tenant_id, at desc)`.execute(
    db,
  );

  await sql`
    insert into plan (id, name, sort_order, limits, features) values
      ('free', 'Free', 0,
       '{"projects":1,"users":5,"forms":3,"submissions_per_month":500,"storage_gb":1,"api_calls_per_month":10000,"rows_ingested_per_month":50000,"run_minutes_per_month":60}',
       '[]'),
      ('team', 'Team', 1,
       '{"projects":5,"users":50,"forms":50,"submissions_per_month":20000,"storage_gb":25,"api_calls_per_month":500000,"rows_ingested_per_month":5000000,"run_minutes_per_month":1000}',
       '["custom_branding"]'),
      ('business', 'Business', 2,
       '{"projects":25,"users":500,"forms":null,"submissions_per_month":250000,"storage_gb":250,"api_calls_per_month":5000000,"rows_ingested_per_month":50000000,"run_minutes_per_month":10000}',
       '["custom_branding","sso","custom_domain","dhis2"]'),
      ('enterprise', 'Enterprise', 3,
       '{"projects":null,"users":null,"forms":null,"submissions_per_month":null,"storage_gb":null,"api_calls_per_month":null,"rows_ingested_per_month":null,"run_minutes_per_month":null}',
       '["custom_branding","sso","custom_domain","dhis2","dedicated_db","custom_code"]')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of [
    'platform_audit_log',
    'invitation',
    'membership',
    'user_identity',
    'tenant',
    'plan',
  ]) {
    await db.schema.dropTable(t).execute();
  }
}
