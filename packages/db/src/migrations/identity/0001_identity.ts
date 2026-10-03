import { sql, type Kysely } from 'kysely';

// Grids identity provider (ADR 0009): accounts, second factors, organisations
// (login policy), one-time email tokens, OIDC model storage and signing keys.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('account')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('email', sql`citext`, (c) => c.notNull().unique())
    .addColumn('email_verified', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('password_hash', 'text')
    .addColumn('given_name', 'text')
    .addColumn('family_name', 'text')
    .addColumn('locale', 'text')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('active').check(sql`status in ('active', 'disabled')`))
    .addColumn('failed_logins', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('locked_until', 'timestamptz')
    .addColumn('last_login_at', 'timestamptz')
    .addColumn('password_changed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('account_totp')
    .addColumn('account_id', 'uuid', (c) => c.primaryKey().references('account.id').onDelete('cascade'))
    // AES-256-GCM encrypted base32 secret
    .addColumn('secret_enc', 'text', (c) => c.notNull())
    .addColumn('confirmed_at', 'timestamptz')
    .addColumn('last_used_step', 'bigint')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('account_recovery_code')
    .addColumn('account_id', 'uuid', (c) => c.notNull().references('account.id').onDelete('cascade'))
    .addColumn('code_hash', 'text', (c) => c.notNull())
    .addColumn('used_at', 'timestamptz')
    .addPrimaryKeyConstraint('account_recovery_code_pk', ['account_id', 'code_hash'])
    .execute();

  // An organisation = a Grids tenant (id = tenant id) or the platform itself.
  await db.schema
    .createTable('org')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('mfa_required', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('allow_registration', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('account_org')
    .addColumn('account_id', 'uuid', (c) => c.notNull().references('account.id').onDelete('cascade'))
    .addColumn('org_id', 'text', (c) => c.notNull().references('org.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('account_org_pk', ['account_id', 'org_id'])
    .execute();

  await db.schema
    .createTable('email_token')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('account_id', 'uuid', (c) => c.notNull().references('account.id').onDelete('cascade'))
    .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('verify', 'reset', 'setup')`))
    .addColumn('token_hash', 'text', (c) => c.notNull().unique())
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('used_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create index email_token_account_idx on email_token (account_id, kind)`.execute(db);

  // oidc-provider adapter storage (sessions, grants, codes, refresh tokens, interactions…)
  await db.schema
    .createTable('oidc_model')
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('id', 'text', (c) => c.notNull())
    .addColumn('payload', 'jsonb', (c) => c.notNull())
    .addColumn('grant_id', 'text')
    .addColumn('uid', 'text')
    .addColumn('user_code', 'text')
    .addColumn('expires_at', 'timestamptz')
    .addColumn('consumed_at', 'timestamptz')
    .addPrimaryKeyConstraint('oidc_model_pk', ['kind', 'id'])
    .execute();
  await sql`create index oidc_model_grant_idx on oidc_model (grant_id)`.execute(db);
  await sql`create index oidc_model_uid_idx on oidc_model (uid)`.execute(db);
  await sql`create index oidc_model_expires_idx on oidc_model (expires_at)`.execute(db);

  await db.schema
    .createTable('signing_key')
    .addColumn('kid', 'text', (c) => c.primaryKey())
    .addColumn('private_jwk', 'jsonb', (c) => c.notNull())
    .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  // Login in progress between the password step and the second factor / setup.
  await db.schema
    .createTable('pending_login')
    .addColumn('uid', 'text', (c) => c.primaryKey())
    .addColumn('account_id', 'uuid', (c) => c.notNull().references('account.id').onDelete('cascade'))
    .addColumn('stage', 'text', (c) => c.notNull().check(sql`stage in ('verify_email', 'mfa', 'mfa_setup')`))
    .addColumn('remember', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('login_event')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('account_id', 'uuid')
    .addColumn('email', 'text')
    .addColumn('ip', 'text')
    .addColumn('event', 'text', (c) => c.notNull())
    .addColumn('success', 'boolean', (c) => c.notNull())
    .addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create index login_event_account_idx on login_event (account_id, at desc)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['login_event', 'pending_login', 'signing_key', 'oidc_model', 'email_token', 'account_org', 'org', 'account_recovery_code', 'account_totp', 'account']) {
    await db.schema.dropTable(t).execute();
  }
}
