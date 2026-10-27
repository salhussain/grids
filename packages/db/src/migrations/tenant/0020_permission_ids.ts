import { sql, type Kysely } from 'kysely';

// Permissions are referenced by id, not by a typed-in key. Everything that stored a key
// (members, dashboards and their widgets, map overlays, form settings and approvers) now
// stores the permission's id; the built-in ones are told apart by `kind`.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table permission_group add column kind text, add column parent_id uuid`.execute(db);
  await sql`update permission_group set kind = 'admin' where key = 'project_admin'`.execute(db);
  await sql`update permission_group set kind = 'public' where key = 'public' and system`.execute(db);
  await sql`
    update permission_group c set parent_id = p.id
    from permission_group p where p.project_id = c.project_id and p.key = c.parent_key
  `.execute(db);

  await sql`
    update project_member m set permission_group = g.id::text
    from permission_group g where g.project_id = m.project_id and g.key = m.permission_group
  `.execute(db);
  await sql`
    update dashboard d set permission_group = g.id::text
    from permission_group g where g.project_id = d.project_id and g.key = d.permission_group
  `.execute(db);
  // A reference to a permission that no longer exists is dropped.
  await sql`
    update dashboard d set widgets = coalesce((
      select jsonb_agg(
        case when w ->> 'permissionGroup' is null then w
        else coalesce(
          jsonb_set(w, '{permissionGroup}', to_jsonb((select g.id::text from permission_group g where g.project_id = d.project_id and g.key = w ->> 'permissionGroup'))),
          w - 'permissionGroup'
        ) end order by ord)
      from jsonb_array_elements(d.widgets) with ordinality as t(w, ord)
    ), '[]'::jsonb)
    where jsonb_typeof(d.widgets) = 'array' and d.widgets::text like '%"permissionGroup"%'
  `.execute(db);
  await sql`
    update map_overlay o set config = coalesce(
      jsonb_set(o.config, '{permissionGroup}', to_jsonb((select g.id::text from permission_group g where g.project_id = o.project_id and g.key = o.config ->> 'permissionGroup'))),
      o.config - 'permissionGroup'
    )
    where o.config ->> 'permissionGroup' is not null
  `.execute(db);

  // Form settings nest the key in `fillGroup` and in every approver rule.
  const groups = (await sql<{ id: string; project_id: string; key: string }>`select id, project_id, key from permission_group`.execute(db)).rows;
  const ids = new Map(groups.map((g) => [`${g.project_id}:${g.key}`, g.id]));
  const forms = (await sql<{ id: string; project_id: string; settings: unknown }>`
    select id, project_id, settings from form where settings::text ~ '"(fillGroup|group)"'
  `.execute(db)).rows;
  for (const f of forms) {
    const swap = (v: unknown) => (typeof v === 'string' ? (ids.get(`${f.project_id}:${v}`) ?? null) : v);
    const walk = (n: unknown, parent?: string): void => {
      if (Array.isArray(n)) return n.forEach((x) => walk(x, parent));
      if (!n || typeof n !== 'object') return;
      const o = n as Record<string, unknown>;
      for (const k of Object.keys(o)) {
        if (k === 'fillGroup' || (k === 'group' && parent === 'approvers')) o[k] = swap(o[k]);
        else walk(o[k], k);
      }
    };
    walk(f.settings);
    await sql`update form set settings = ${JSON.stringify(f.settings)}::jsonb where id = ${f.id}`.execute(db);
  }

  await sql`drop index if exists permission_group_key_uq`.execute(db);
  await sql`alter table permission_group drop column key, drop column parent_key`.execute(db);
  await sql`alter table permission_group add constraint permission_group_parent_fk foreign key (parent_id) references permission_group (id)`.execute(db);
  await sql`create unique index permission_group_kind_uq on permission_group (project_id, kind) where kind is not null`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error('0020_permission_ids cannot be reversed: the old keys are gone.');
}
