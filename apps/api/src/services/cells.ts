import type { Kysely } from 'kysely';
import type { PlacementResolver, PlatformDB } from '@grids/db';

/**
 * Tenant → cell placement from the control plane. A cell's connection string is
 * referenced, never stored: `env:NAME` reads an env var (a secrets manager later).
 */
export function cellResolver(db: Kysely<PlatformDB>): PlacementResolver {
  return async (tenantId) => {
    const row = await db
      .selectFrom('tenant as t')
      .innerJoin('cell as c', 'c.id', 't.cell_id')
      .select(['c.id', 'c.connection_secret_ref'])
      .where('t.id', '=', tenantId)
      .executeTakeFirst();
    if (!row) throw new Error(`No placement for tenant ${tenantId}`);
    return { cellId: row.id, connectionString: resolveSecret(row.connection_secret_ref) };
  };
}

export function resolveSecret(ref: string): string {
  if (ref.startsWith('env:')) {
    const v = process.env[ref.slice(4)];
    if (!v) throw new Error(`Secret ${ref} is not set`);
    return v;
  }
  throw new Error(`Unsupported secret reference: ${ref}`);
}
