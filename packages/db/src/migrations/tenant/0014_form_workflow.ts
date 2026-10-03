import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// Form groups (the organisation's Forms menu), per-form settings (who can fill,
// approval workflow), and submission review state with an audit trail.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('form_group')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('parent_id', 'uuid', (c) => c.references('form_group.id').onDelete('restrict'))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('icon', 'text', (c) => c.notNull().defaultTo('folder'))
    .addColumn('sort', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await enableTenantRls(db, 'form_group');

  await db.schema
    .alterTable('form')
    .addColumn('group_id', 'uuid', (c) => c.references('form_group.id').onDelete('set null'))
    .addColumn('settings', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .execute();

  await db.schema
    .alterTable('submission')
    // complete (no workflow) · in_review · approved · rejected · returned (sent back for changes)
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('complete'))
    .addColumn('stage', 'integer')
    .addColumn('decided_at', 'timestamptz')
    .execute();
  await sql`alter table submission add constraint submission_status_ck check (status in ('complete','in_review','approved','rejected','returned'))`.execute(db);
  await sql`create index submission_review_queue_idx on submission (project_id, status) where status = 'in_review'`.execute(db);

  await db.schema
    .createTable('submission_review')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('submission_id', 'uuid', (c) => c.notNull().references('submission.id').onDelete('cascade'))
    .addColumn('stage', 'integer')
    .addColumn('stage_name', 'text')
    // submitted · resubmitted · approved · rejected · returned
    .addColumn('decision', 'text', (c) => c.notNull())
    .addColumn('comment', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('actor_id', 'uuid')
    .addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create index submission_review_sub_idx on submission_review (submission_id, id)`.execute(db);
  await enableTenantRls(db, 'submission_review');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('submission_review').execute();
  await sql`drop index submission_review_queue_idx`.execute(db);
  await db.schema.alterTable('submission').dropConstraint('submission_status_ck').execute();
  await db.schema.alterTable('submission').dropColumn('decided_at').dropColumn('stage').dropColumn('status').execute();
  await db.schema.alterTable('form').dropColumn('settings').dropColumn('group_id').execute();
  await db.schema.dropTable('form_group').execute();
}
