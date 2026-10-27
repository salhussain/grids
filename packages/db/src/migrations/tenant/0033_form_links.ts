import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// Links that let people without an account fill a form in: one shared link, and single-use invites.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('form_link')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('project_id', 'uuid', (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('form_id', 'uuid', (c) => c.notNull().references('form.id').onDelete('cascade'))
    .addColumn('kind', 'text', (c) => c.notNull())
    // The secret part of the link. Whoever holds it can send this form, nothing more.
    .addColumn('token', 'text', (c) => c.notNull().unique())
    // Who an invite is for (a name or an email); informational.
    .addColumn('label', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('email', 'text')
    // The entity the answers are about, for a form that is about one.
    .addColumn('entity_id', 'uuid', (c) => c.references('entity.id').onDelete('set null'))
    .addColumn('max_uses', 'integer')
    .addColumn('uses', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_by', 'uuid')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_used_at', 'timestamptz')
    .execute();
  await sql`alter table form_link add constraint form_link_kind_ck check (kind in ('shared', 'invite'))`.execute(db);
  await sql`create index form_link_form_idx on form_link (form_id, created_at desc)`.execute(db);
  await enableTenantRls(db, 'form_link');
  await db.schema
    .alterTable('submission')
    .addColumn('link_id', 'uuid', (c) => c.references('form_link.id').onDelete('set null'))
    // What the person typed as their name or email, when they came in through a link.
    .addColumn('submitter', 'text')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('submission').dropColumn('submitter').dropColumn('link_id').execute();
  await db.schema.dropTable('form_link').execute();
}
