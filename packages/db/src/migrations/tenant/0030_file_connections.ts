import { sql, type Kysely } from 'kysely';

// Connections can read a CSV or Excel file from a URL, S3, Azure Blob, Google Cloud Storage or Google Drive.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table project_connection add column options jsonb not null default '{}'::jsonb`.execute(db);
  await sql`alter table project_connection drop constraint project_connection_kind_ck`.execute(db);
  await sql`alter table project_connection add constraint project_connection_kind_ck check (kind in ('http','postgres','file','s3','azure_blob','gcs','gdrive'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from project_connection where kind not in ('http','postgres')`.execute(db);
  await sql`alter table project_connection drop constraint project_connection_kind_ck`.execute(db);
  await sql`alter table project_connection add constraint project_connection_kind_ck check (kind in ('http','postgres'))`.execute(db);
  await sql`alter table project_connection drop column options`.execute(db);
}
