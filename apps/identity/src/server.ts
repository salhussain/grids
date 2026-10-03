import { createDb, type IdentityDB } from '@grids/db';
import { buildIdentityApp } from './app.js';
import { loadConfig } from './config.js';
import { SmtpMailer } from './mailer.js';

const config = loadConfig();
const db = createDb<IdentityDB>(config.DATABASE_URL_IDENTITY_APP, { max: 10 });
const { app } = await buildIdentityApp({ config, db, mailer: new SmtpMailer(config.SMTP_URL, config.MAIL_FROM), logger: true });

const shutdown = async () => {
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: '0.0.0.0', port: config.IDENTITY_PORT });
