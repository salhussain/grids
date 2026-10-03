import { createDb, type IdentityDB } from '@grids/db';
import { buildIdentityApp } from './app.js';
import { loadConfig } from './config.js';
import { PlatformMailer, SmtpMailer } from './mailer.js';

const config = loadConfig();
const db = createDb<IdentityDB>(config.DATABASE_URL_IDENTITY_APP, { max: 10 });
const { app } = await buildIdentityApp({ config, db, mailer:
    config.IDENTITY_MAIL === 'platform'
      ? new PlatformMailer(config.API_URL, config.IDENTITY_SERVICE_TOKEN)
      : new SmtpMailer(config.IDENTITY_MAIL, config.MAIL_FROM), logger: true });

const shutdown = async () => {
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: '0.0.0.0', port: config.IDENTITY_PORT });
