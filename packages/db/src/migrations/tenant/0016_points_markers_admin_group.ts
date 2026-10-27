import { sql, type Kysely } from 'kysely';

// Entities: an optional point (centre) beside the boundary in `geom`.
// Entity types: how their places are drawn on maps (dot, pin or icon).
// Permission groups: a built-in "<Project> Admin" group per project that can't be deleted.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('entity')
    .addColumn('point', sql`geometry(Point, 4326)`)
    .execute();
  await db.schema
    .alterTable('entity_type')
    .addColumn('marker', 'jsonb', (c) =>
      c.notNull().defaultTo(sql`'{"style":"dot","rotateBy":null}'::jsonb`),
    )
    .execute();
  await db.schema
    .alterTable('permission_group')
    .addColumn('system', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();
  await sql`
    insert into permission_group (id, tenant_id, project_id, key, name, description, parent_key, system)
    select gen_random_uuid(), p.tenant_id, p.id, 'project_admin', p.name || ' Admin', 'Administers the project and sees everything in it.', null, true
    from project p
    where not exists (select 1 from permission_group g where g.project_id = p.id and g.key = 'project_admin')
  `.execute(db);
  await sql`update permission_group set system = true where key = 'project_admin'`.execute(db);
  // Managers who had no group join the admin group.
  await sql`update project_member set permission_group = 'project_admin' where role = 'manager' and permission_group is null`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`update project_member set permission_group = null where permission_group = 'project_admin'`.execute(
    db,
  );
  await sql`delete from permission_group where system`.execute(db);
  await db.schema.alterTable('permission_group').dropColumn('system').execute();
  await db.schema.alterTable('entity_type').dropColumn('marker').execute();
  await db.schema.alterTable('entity').dropColumn('point').execute();
}
