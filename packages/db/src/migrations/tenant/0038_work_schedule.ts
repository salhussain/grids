import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// Recurring work: service every 90 days, or every 10 000 km. A schedule says what to open and how often; a target
// remembers, for one place or thing, when it is next due and which piece of work is currently open for it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('work_schedule')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('project_id', 'uuid', (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('type_id', 'uuid', (c) => c.notNull().references('work_type.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('priority', 'text', (c) => c.notNull().defaultTo('normal'))
    .addColumn('assignee_id', 'uuid')
    // What it applies to: one entity, or every entity of a type.
    .addColumn('entity_id', 'uuid', (c) => c.references('entity.id').onDelete('cascade'))
    .addColumn('entity_type', 'text')
    .addColumn('every_days', 'integer')
    // Or by use: every N of an entity attribute (an odometer reading, hours run).
    .addColumn('meter_attribute', 'text')
    .addColumn('meter_every', 'double precision')
    // Open the work this many days before it falls due.
    .addColumn('lead_days', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index work_schedule_key_idx on work_schedule (project_id, key)`.execute(db);
  await enableTenantRls(db, 'work_schedule');

  await db.schema
    .createTable('work_schedule_target')
    .addColumn('schedule_id', 'uuid', (c) => c.notNull().references('work_schedule.id').onDelete('cascade'))
    .addColumn('entity_id', 'uuid', (c) => c.notNull().references('entity.id').onDelete('cascade'))
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('next_due_at', 'timestamptz')
    .addColumn('last_meter', 'double precision')
    // The piece of work open for this target now; the next cycle starts when it is resolved.
    .addColumn('item_id', 'uuid', (c) => c.references('work_item.id').onDelete('set null'))
    .addPrimaryKeyConstraint('work_schedule_target_pk', ['schedule_id', 'entity_id'])
    .execute();
  await enableTenantRls(db, 'work_schedule_target');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('work_schedule_target').execute();
  await db.schema.dropTable('work_schedule').execute();
}
