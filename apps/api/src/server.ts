import { sql } from 'kysely';
import { createDb, TenantRouter, type CellDB, type PlatformDB } from '@grids/db';
import { buildApp } from './app.js';
import { JwtTokenVerifier } from './auth/tokens.js';
import { loadConfig } from './config.js';
import { GridsIdpClient } from './idp/grids.js';
import { cellResolver } from './services/cells.js';
import { EmailService, SmtpMailer } from './services/email.js';
import { createServices } from './services/index.js';

const config = loadConfig();
const platformDb = createDb<PlatformDB>(config.DATABASE_URL_PLATFORM, { max: 10 });
const cells = new TenantRouter<CellDB>(cellResolver(platformDb));
const idp = new GridsIdpClient(config.IDENTITY_INTERNAL_URL, config.IDENTITY_SERVICE_TOKEN);
const services = createServices(
  {
    db: platformDb,
    cells,
    idp,
    email: new EmailService(platformDb, new SmtpMailer(config.SMTP_URL, config.MAIL_FROM)),
    consoleUrl: config.CONSOLE_URL,
    workspaceUrl: config.WEB_URL,
    baseDomain: config.BASE_DOMAIN,
    supportEmail: config.SUPPORT_EMAIL,
    now: () => new Date(),
  },
  { devAutoVerifyDomains: config.DOMAIN_DEV_AUTOVERIFY },
);

const app = await buildApp({
  logger: true,
  corsOrigins: [config.CONSOLE_URL, config.WEB_URL],
  checks: {
    platform_db: async () => void (await sql`select 1`.execute(platformDb)),
    identity_provider: async () => {
      const res = await fetch(new URL('/readyz', config.IDENTITY_INTERNAL_URL));
      if (!res.ok) throw new Error(String(res.status));
    },
  },
  platform: {
    services,
    idp,
    verifier: new JwtTokenVerifier(config.IDENTITY_ISSUER, config.API_AUDIENCE),
  },
});

const shutdown = async () => {
  await app.close();
  await Promise.all([platformDb.destroy(), cells.destroy()]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: '0.0.0.0', port: config.API_PORT });
