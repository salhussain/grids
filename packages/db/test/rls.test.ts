import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, migrateToLatest, tenantMigrations, withTenant } from '../src/index.js';

// Proves the ADR 0001 isolation contract against real Postgres, using the same
// bootstrap (roles, DBs, extensions) as docker-compose.
interface DB {
  widget: { id: string; tenant_id: string; name: string };
}

const TENANT_A = '01920000-0000-7000-8000-00000000000a';
const TENANT_B = '01920000-0000-7000-8000-00000000000b';

let container: StartedPostgreSqlContainer;
let owner: Kysely<DB>;
let app: Kysely<DB>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('imresamu/postgis:16-3.5')
    .withCopyFilesToContainer([
      {
        source: resolve(import.meta.dirname, '../../../infra/postgres/init.sql'),
        target: '/docker-entrypoint-initdb.d/10-init.sql',
      },
    ])
    .start();
  const url = (user: string) =>
    `postgres://${user}:${user}@${container.getHost()}:${container.getPort()}/grids_cell_1`;
  owner = createDb<DB>(url('grids_owner'));
  app = createDb<DB>(url('grids_app'));

  await migrateToLatest(owner as Kysely<unknown>, tenantMigrations);
  // The table pattern every tenant-scoped table follows.
  await sql`
    create table widget (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, name text not null);
    alter table widget enable row level security;
    create policy tenant_isolation on widget
      using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
  `.execute(owner);

  for (const [tenant, name] of [
    [TENANT_A, 'a1'],
    [TENANT_A, 'a2'],
    [TENANT_B, 'b1'],
  ] as const) {
    await withTenant(app, tenant, (tx) =>
      tx
        .insertInto('widget')
        .values({ tenant_id: tenant, name } as never)
        .execute(),
    );
  }
}, 120_000);

afterAll(async () => {
  await app?.destroy();
  await owner?.destroy();
  await container?.stop();
});

describe('row-level security', () => {
  it('a tenant sees only its own rows', async () => {
    const rows = await withTenant(app, TENANT_A, (tx) =>
      tx.selectFrom('widget').select('name').orderBy('name').execute(),
    );
    expect(rows.map((r) => r.name)).toEqual(['a1', 'a2']);
  });

  it('fails closed outside withTenant (no tenant set → zero rows)', async () => {
    const rows = await app.selectFrom('widget').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('rejects writing a row for another tenant', async () => {
    await expect(
      withTenant(app, TENANT_A, (tx) =>
        tx
          .insertInto('widget')
          .values({ tenant_id: TENANT_B, name: 'sneaky' } as never)
          .execute(),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot update or delete another tenant’s rows', async () => {
    const res = await withTenant(app, TENANT_A, (tx) =>
      tx.deleteFrom('widget').where('name', '=', 'b1').executeTakeFirst(),
    );
    expect(res.numDeletedRows).toBe(0n);
  });

  it('tenant setting does not leak across pooled connections', async () => {
    await withTenant(app, TENANT_B, async () => undefined);
    const rows = await app.selectFrom('widget').selectAll().execute();
    expect(rows).toHaveLength(0);
  });
});
