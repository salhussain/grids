import { sql, type Kysely } from 'kysely';

// A dataset on a database connection is read from the database when asked, not copied: the rows (and the per-viewer
// runs) kept for such datasets are thrown away. What stays is the dataset's definition and the last-queried time.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`delete from dataset_variant where dataset_id in (select id from dataset where source ->> 'type' = 'connection')`.execute(db);
  await sql`delete from dataset_row where dataset_id in (select id from dataset where source ->> 'type' = 'connection')`.execute(db);
}

export async function down(): Promise<void> {
  // The copies cannot be brought back; refresh the datasets to rebuild them.
}
