import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Kysely } from 'kysely';
import { createDb } from './connect.js';
import { identityMigrations, migrateToLatest, platformMigrations, tenantMigrations } from './migrate.js';
import type { CellDB, PlatformDB } from './types.js';

export interface TestDatabases {
  container: StartedPostgreSqlContainer;
  /** Control plane as the owner role (migrations, fixtures). */
  platform: Kysely<PlatformDB>;
  /** Cell as the non-owner app role, so RLS applies exactly as in production. */
  cellApp: Kysely<CellDB>;
  cellAppUrl: string;
  /** Identity provider database, app role. */
  identityAppUrl: string;
  stop(): Promise<void>;
}

/**
 * Starts a disposable Postgres with the same bootstrap as docker-compose, migrated
 * to latest, with one shared cell registered. For integration tests only.
 */
export async function startTestDatabases(): Promise<TestDatabases> {
  const container = await new PostgreSqlContainer('imresamu/postgis:16-3.5')
    .withCopyFilesToContainer([
      {
        source: resolve(import.meta.dirname, '../../../infra/postgres/init.sql'),
        target: '/docker-entrypoint-initdb.d/10-init.sql',
      },
    ])
    .start();
  const url = (user: string, db: string) =>
    `postgres://${user}:${user}@${container.getHost()}:${container.getPort()}/${db}`;

  const platform = createDb<PlatformDB>(url('grids_owner', 'grids_platform'));
  const cellOwner = createDb(url('grids_owner', 'grids_cell_1'));
  await migrateToLatest(platform as Kysely<unknown>, platformMigrations, { quiet: true });
  await migrateToLatest(cellOwner, tenantMigrations, { quiet: true });
  await cellOwner.destroy();
  const identityOwner = createDb(url('grids_owner', 'grids_identity'));
  await migrateToLatest(identityOwner, identityMigrations, { quiet: true });
  await identityOwner.destroy();

  const cellAppUrl = url('grids_app', 'grids_cell_1');
  await platform
    .insertInto('cell')
    .values({ id: 'cell-1', kind: 'shared', connection_secret_ref: 'test' } as never)
    .execute();
  const cellApp = createDb<CellDB>(cellAppUrl);

  return {
    container,
    platform,
    cellApp,
    cellAppUrl,
    identityAppUrl: url('grids_app', 'grids_identity'),
    async stop() {
      await cellApp.destroy();
      await platform.destroy();
      await container.stop();
    },
  };
}
