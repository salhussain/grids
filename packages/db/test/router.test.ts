import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { TenantRouter } from '../src/router.js';

const fakeDb = () => ({ destroy: vi.fn(async () => {}) }) as unknown as Kysely<unknown>;

describe('TenantRouter', () => {
  it('shares one pool per cell and caches placements', async () => {
    const resolve = vi.fn(async (t: string) => ({
      cellId: t === 'dedicated' ? 'cell-dedicated' : 'cell-1',
      connectionString: `postgres://x/${t}`,
    }));
    const connect = vi.fn(fakeDb);
    const router = new TenantRouter(resolve, connect);

    const a = await router.forTenant('a');
    const b = await router.forTenant('b');
    const d = await router.forTenant('dedicated');
    await router.forTenant('a');

    expect(a).toBe(b);
    expect(d).not.toBe(a);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledTimes(3);

    router.invalidate('a');
    await router.forTenant('a');
    expect(resolve).toHaveBeenCalledTimes(4);
  });
});
