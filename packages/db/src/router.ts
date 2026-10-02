import type { Kysely } from 'kysely';
import { createDb } from './connect.js';

/** Where a tenant's data lives: a shared cell or a dedicated database (ADR 0001). */
export interface TenantPlacement {
  cellId: string;
  connectionString: string;
}

export type PlacementResolver = (tenantId: string) => Promise<TenantPlacement>;

/**
 * Resolves tenant → database handle. Pools are shared per cell, so N tenants on
 * one shared cell use one pool. Placement lookups are cached; call `invalidate`
 * after moving a tenant.
 */
export class TenantRouter<DB = unknown> {
  private readonly pools = new Map<string, Kysely<DB>>();
  private readonly placements = new Map<string, TenantPlacement>();

  constructor(
    private readonly resolve: PlacementResolver,
    private readonly connect: (url: string) => Kysely<DB> = (url) => createDb<DB>(url),
  ) {}

  /** Where a tenant's data lives (cached). */
  async placement(tenantId: string): Promise<TenantPlacement> {
    let placement = this.placements.get(tenantId);
    if (!placement) {
      placement = await this.resolve(tenantId);
      this.placements.set(tenantId, placement);
    }
    return placement;
  }

  async forTenant(tenantId: string): Promise<Kysely<DB>> {
    const placement = await this.placement(tenantId);
    let db = this.pools.get(placement.cellId);
    if (!db) {
      db = this.connect(placement.connectionString);
      this.pools.set(placement.cellId, db);
    }
    return db;
  }

  invalidate(tenantId: string): void {
    this.placements.delete(tenantId);
  }

  async destroy(): Promise<void> {
    await Promise.all([...this.pools.values()].map((db) => db.destroy()));
    this.pools.clear();
  }
}
