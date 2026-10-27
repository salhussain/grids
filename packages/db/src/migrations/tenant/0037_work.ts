import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// Work: tickets, tasks, visits and maintenance jobs. A type says what states it moves through and how fast it is
// expected to be answered and finished; an item is one piece of work with an owner, a due date and a conversation.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('work_type')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('project_id', 'uuid', (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('icon', 'text', (c) => c.notNull().defaultTo('ticket'))
    .addColumn('color', 'text', (c) => c.notNull().defaultTo('#0f62fe'))
    // Numbers read PREFIX-12, counted per type.
    .addColumn('prefix', 'text', (c) => c.notNull().defaultTo('W'))
    .addColumn('states', 'jsonb', (c) => c.notNull())
    .addColumn('sla', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('next_number', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index work_type_key_idx on work_type (project_id, key)`.execute(db);
  await enableTenantRls(db, 'work_type');

  await db.schema
    .createTable('work_item')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('project_id', 'uuid', (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('type_id', 'uuid', (c) => c.notNull().references('work_type.id').onDelete('cascade'))
    .addColumn('number', 'integer', (c) => c.notNull())
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('state', 'text', (c) => c.notNull())
    .addColumn('priority', 'text', (c) => c.notNull().defaultTo('normal'))
    .addColumn('assignee_id', 'uuid')
    .addColumn('requester_id', 'uuid')
    // Who asked, when they have no account (a public form).
    .addColumn('requester_name', 'text')
    .addColumn('entity_id', 'uuid', (c) => c.references('entity.id').onDelete('set null'))
    .addColumn('submission_id', 'uuid', (c) => c.references('submission.id').onDelete('set null'))
    .addColumn('due_at', 'timestamptz')
    .addColumn('respond_by', 'timestamptz')
    .addColumn('resolve_by', 'timestamptz')
    .addColumn('first_response_at', 'timestamptz')
    .addColumn('resolved_at', 'timestamptz')
    .addColumn('source', 'text', (c) => c.notNull().defaultTo('manual'))
    .addColumn('created_by', 'uuid')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index work_item_number_idx on work_item (type_id, number)`.execute(db);
  await sql`create index work_item_project_idx on work_item (project_id, updated_at desc)`.execute(db);
  await sql`create index work_item_assignee_idx on work_item (assignee_id, state) where assignee_id is not null`.execute(db);
  await sql`create index work_item_entity_idx on work_item (entity_id) where entity_id is not null`.execute(db);
  await sql`alter table work_item add constraint work_item_priority_ck check (priority in ('low', 'normal', 'high', 'urgent'))`.execute(db);
  await enableTenantRls(db, 'work_item');

  await db.schema
    .createTable('work_event')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('item_id', 'uuid', (c) => c.notNull().references('work_item.id').onDelete('cascade'))
    .addColumn('actor_id', 'uuid')
    // comment | state | assign | priority | due | created | edited
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull().defaultTo(''))
    // An internal comment is not shown to the requester.
    .addColumn('internal', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('data', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create index work_event_item_idx on work_event (item_id, created_at)`.execute(db);
  await enableTenantRls(db, 'work_event');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('work_event').execute();
  await db.schema.dropTable('work_item').execute();
  await db.schema.dropTable('work_type').execute();
}
