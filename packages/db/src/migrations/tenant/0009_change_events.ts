import { sql, type Kysely } from 'kysely';

// Change events (spec §9 live updates, §8 freshness): row triggers notify
// `grids_events` with the tenant and project of every data write and run status
// change, whoever made it (API, worker, templates). Notifications are delivered
// on commit, and identical payloads within one transaction are delivered once,
// so a job writing 100k observations raises a single "data" event.
const DATA_TABLES = ['entity', 'observation', 'dataset', 'submission'];

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create function grids_notify_data() returns trigger language plpgsql as $$
    declare r record;
    begin
      if tg_op = 'DELETE' then r := old; else r := new; end if;
      perform pg_notify('grids_events', json_build_object('t', r.tenant_id, 'p', r.project_id, 'k', 'data', 's', tg_table_name)::text);
      return null;
    end $$
  `.execute(db);
  for (const t of DATA_TABLES)
    await sql`create trigger ${sql.raw(`${t}_notify`)} after insert or update or delete on ${sql.table(t)} for each row execute function grids_notify_data()`.execute(db);

  await sql`
    create function grids_notify_run() returns trigger language plpgsql as $$
    begin
      if tg_op = 'INSERT' or new.status is distinct from old.status then
        perform pg_notify('grids_events', json_build_object('t', new.tenant_id, 'p', new.project_id, 'k', 'run', 'r', new.id, 'j', new.job_id, 's', new.status)::text);
      end if;
      return null;
    end $$
  `.execute(db);
  await sql`create trigger run_notify after insert or update on run for each row execute function grids_notify_run()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger run_notify on run`.execute(db);
  for (const t of DATA_TABLES) await sql`drop trigger ${sql.raw(`${t}_notify`)} on ${sql.table(t)}`.execute(db);
  await sql`drop function grids_notify_run()`.execute(db);
  await sql`drop function grids_notify_data()`.execute(db);
}
