import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// Graph workflows for forms: the node a submission is parked on, and an outbox of
// side effects (email, webhooks) and timers (approval SLAs, wait nodes).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('submission').addColumn('node_id', 'text').execute();
  await db.schema.alterTable('submission_review').addColumn('node_id', 'text').execute();

  await db.schema
    .createTable('workflow_task')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('project_id', 'uuid', (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('submission_id', 'uuid', (c) => c.notNull().references('submission.id').onDelete('cascade'))
    .addColumn('node_id', 'text', (c) => c.notNull())
    // email · webhook · timer
    .addColumn('kind', 'text', (c) => c.notNull())
    // pending · done · failed · cancelled
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('pending'))
    .addColumn('due_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('locked_until', 'timestamptz')
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_error', 'text')
    .addColumn('payload', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('done_at', 'timestamptz')
    .execute();
  await sql`alter table workflow_task add constraint workflow_task_kind_ck check (kind in ('email','webhook','timer'))`.execute(db);
  await sql`alter table workflow_task add constraint workflow_task_status_ck check (status in ('pending','done','failed','cancelled'))`.execute(db);
  await sql`create index workflow_task_due_idx on workflow_task (due_at) where status = 'pending'`.execute(db);
  await sql`create index workflow_task_submission_idx on workflow_task (submission_id)`.execute(db);
  await enableTenantRls(db, 'workflow_task');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('workflow_task').execute();
  await db.schema.alterTable('submission_review').dropColumn('node_id').execute();
  await db.schema.alterTable('submission').dropColumn('node_id').execute();
}
