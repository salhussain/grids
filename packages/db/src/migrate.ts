import { pathToFileURL } from 'node:url';
import type { Kysely } from 'kysely';
import { Migrator, type MigrationProvider } from 'kysely/migration';
import { createDb } from './connect.js';
import { identityMigrations, platformMigrations, tenantMigrations } from './migrations/index.js';
import type { PlatformDB } from './types.js';

export async function migrateToLatest(
  db: Kysely<unknown>,
  provider: MigrationProvider,
  opts: { quiet?: boolean } = {},
) {
  const { error, results } = await new Migrator({ db, provider }).migrateToLatest();
  for (const r of opts.quiet ? [] : (results ?? [])) {
    console.log(`  ${r.status === 'Success' ? '✓' : '✗'} ${r.migrationName}`);
  }
  if (error) throw error;
}

export { identityMigrations, platformMigrations, tenantMigrations };

/**
 * Migrates the control plane, then every tenant data database. In M1 the cell list
 * comes from the platform `cell` table; until then, from env.
 */
async function main() {
  const platformUrl = required('DATABASE_URL_PLATFORM');
  const cellUrls = [required('DATABASE_URL_CELL_MIGRATOR')];

  const platform = createDb<PlatformDB>(platformUrl);
  try {
    console.log('platform:');
    await migrateToLatest(platform as Kysely<unknown>, platformMigrations);
    // Register the default shared cell. The connection string is referenced, never stored.
    await platform
      .insertInto('cell')
      .values({ id: 'cell-1', kind: 'shared', connection_secret_ref: 'env:DATABASE_URL_CELL_APP' })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  } finally {
    await platform.destroy();
  }

  const identityUrl = process.env.DATABASE_URL_IDENTITY;
  if (identityUrl) {
    const identity = createDb(identityUrl);
    try {
      console.log('identity:');
      await migrateToLatest(identity, identityMigrations);
    } finally {
      await identity.destroy();
    }
  }

  for (const [i, url] of cellUrls.entries()) {
    const cell = createDb(url);
    try {
      console.log(`cell ${i + 1}:`);
      await migrateToLatest(cell, tenantMigrations);
    } finally {
      await cell.destroy();
    }
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
