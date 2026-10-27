import * as SQLite from 'expo-sqlite';

let opened: Promise<SQLite.SQLiteDatabase> | null = null;

const MIGRATIONS = [
  `
  create table outbox (
    id text primary key,
    target text not null,
    form_name text not null,
    version integer not null,
    entity_id text,
    answers text not null,
    collected_at text not null,
    location text,
    submitter text,
    status text not null,
    attempts integer not null default 0,
    next_attempt_at integer,
    last_error text,
    created_at integer not null,
    sent_at integer,
    owner text not null
  );
  create index outbox_status on outbox (status, created_at);
  create table blobs (
    id text primary key,
    item_id text not null references outbox (id) on delete cascade,
    name text not null,
    content_type text not null,
    uri text not null,
    size integer not null,
    remote_id text
  );
  create index blobs_item on blobs (item_id);
  create table places (
    scope text not null,
    id text not null,
    code text not null,
    name text not null,
    type text not null,
    parent_id text,
    attributes text not null,
    lat real,
    lon real,
    shared integer not null,
    primary key (scope, id)
  );
  create index places_type on places (scope, type, name);
  create index places_parent on places (scope, parent_id);
  create table cursors (scope text primary key, server_time text not null);
  create table catalog (key text primary key, value text not null, fetched_at integer not null);
  create table links (path text primary key, name text not null, project_name text not null, definition text not null, version integer not null, ask_name integer not null, added_at integer not null);
  create table link_places (path text not null, question text not null, rows text not null, primary key (path, question));
  `,
];

/** The device's own database: the queue of submissions, downloaded places and forms. Opened once. */
export function db(): Promise<SQLite.SQLiteDatabase> {
  opened ??= (async () => {
    const d = await SQLite.openDatabaseAsync('grids.db');
    await d.execAsync('pragma journal_mode = wal; pragma foreign_keys = on;');
    const row = await d.getFirstAsync<{ user_version: number }>('pragma user_version');
    for (let v = row?.user_version ?? 0; v < MIGRATIONS.length; v++) {
      await d.withTransactionAsync(async () => {
        await d.execAsync(MIGRATIONS[v]!);
        await d.execAsync(`pragma user_version = ${v + 1}`);
      });
    }
    return d;
  })();
  return opened;
}

/** Signing out: everything on the device belonging to the account goes, except what still has to be sent. */
export async function wipeAccountData(keepUnsent: boolean) {
  const d = await db();
  await d.execAsync('delete from places; delete from cursors; delete from catalog;');
  if (!keepUnsent) await d.execAsync('delete from outbox;');
}
