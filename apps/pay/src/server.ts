import { createDb, type PayDB } from '@grids/db';
import { buildPayApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const db = createDb<PayDB>(config.DATABASE_URL_PAY_APP, { max: 10 });
const { app, service } = await buildPayApp({ config, db, logger: true });

/** Tells the platform how payments ended (and again, until it has been told: a payment must never be lost). */
async function notify() {
  for (const p of await service.unnotified()) {
    try {
      const res = await fetch(new URL('/internal/payments/settled', config.API_URL), {
        method: 'POST',
        headers: { authorization: `Bearer ${config.PAY_SERVICE_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id: p.id, status: p.status, paidAt: p.paid_at ? p.paid_at.toISOString() : null, method: p.method, surcharge: Number(p.surcharge) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) await service.markNotified(p.id);
      else app.log.warn({ payment: p.id, status: res.status }, 'platform did not accept the payment result');
    } catch (e) {
      app.log.warn({ payment: p.id, err: String(e) }, 'could not reach the platform');
    }
  }
}
const timer = setInterval(() => void notify(), 3_000);

const shutdown = async () => {
  clearInterval(timer);
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: '0.0.0.0', port: config.PAY_PORT });
