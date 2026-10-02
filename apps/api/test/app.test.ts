import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('api health', () => {
  it('reports liveness', async () => {
    const app = await buildApp({ checks: {} });
    const res = await app.inject('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('reports degraded readiness with 503 when a dependency fails', async () => {
    const app = await buildApp({
      checks: { ok: async () => {}, broken: async () => Promise.reject(new Error('down')) },
    });
    const res = await app.inject('/readyz');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', checks: { ok: 'ok', broken: 'fail' } });
  });

  it('returns RFC 7807 problem details for unknown routes', async () => {
    const app = await buildApp({ checks: {} });
    const res = await app.inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.json()).toMatchObject({ title: 'Not Found', status: 404, instance: '/nope' });
  });

  it('allows browser preflight for every write method from configured origins', async () => {
    const app = await buildApp({ checks: {}, corsOrigins: ['http://console'] });
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/healthz',
      headers: { origin: 'http://console', 'access-control-request-method': 'PATCH' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    expect(res.headers['access-control-allow-origin']).toBe('http://console');
  });
});
