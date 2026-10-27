import { sql, type Kysely } from 'kysely';

const OLD = `'http','postgres','file','s3','azure_blob','gcs','gdrive'`;
const NEW = `'http','postgres','redshift','mysql','mariadb','mssql','oracle','clickhouse','snowflake','bigquery','file','s3','azure_blob','gcs','gdrive'`;

// Datasets can be defined by SQL (on a database connection, or over forms, files and other datasets),
// and connections can be any of the supported databases.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table dataset add column source jsonb not null default '{"type":"rows"}'::jsonb`.execute(db);
  await sql`alter table dataset add column column_types jsonb not null default '{}'::jsonb`.execute(db);
  await sql`alter table dataset add column refresh_error text`.execute(db);
  await sql`alter table project_connection drop constraint project_connection_kind_ck`.execute(db);
  await sql.raw(`alter table project_connection add constraint project_connection_kind_ck check (kind in (${NEW}))`).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from project_connection where kind not in ('http','postgres','file','s3','azure_blob','gcs','gdrive')`.execute(db);
  await sql`alter table project_connection drop constraint project_connection_kind_ck`.execute(db);
  await sql.raw(`alter table project_connection add constraint project_connection_kind_ck check (kind in (${OLD}))`).execute(db);
  await sql`delete from dataset where source ->> 'type' <> 'rows'`.execute(db);
  await sql`alter table dataset drop column refresh_error`.execute(db);
  await sql`alter table dataset drop column column_types`.execute(db);
  await sql`alter table dataset drop column source`.execute(db);
}
