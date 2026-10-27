import { sql } from 'kysely';
import { createDb, TenantRouter, type CellDB, type PlatformDB } from '@grids/db';
import { buildApp } from './app.js';
import { JwtTokenVerifier } from './auth/tokens.js';
import { loadConfig } from './config.js';
import { GridsIdpClient } from './idp/grids.js';
import { GridPayClient } from './pay/grids.js';
import { cellResolver } from './services/cells.js';
import { EmailService, mailerFor } from './services/email.js';
import { createServices } from './services/index.js';
import { secretsKeyFrom } from './services/secrets.js';

const config = loadConfig();
const platformDb = createDb<PlatformDB>(config.DATABASE_URL_PLATFORM, { max: 10 });
const cells = new TenantRouter<CellDB>(cellResolver(platformDb));
const idp = new GridsIdpClient(config.IDENTITY_INTERNAL_URL, config.IDENTITY_SERVICE_TOKEN);
const services = createServices(
  {
    db: platformDb,
    cells,
    idp,
    pay: new GridPayClient(config.PAY_URL, config.PAY_SERVICE_TOKEN),
    email: new EmailService(platformDb, mailerFor(config.SMTP_URL, config.MAIL_FROM)),
    consoleUrl: config.CONSOLE_URL,
    workspaceUrl: config.WEB_URL,
    baseDomain: config.BASE_DOMAIN,
    supportEmail: config.SUPPORT_EMAIL,
    secretsKey: secretsKeyFrom(config.SECRETS_KEY, config.NODE_ENV === 'production'),
    allowPrivateConnections: config.CONNECTIONS_ALLOW_PRIVATE ?? config.NODE_ENV !== 'production',
    now: () => new Date(),
  },
  { devAutoVerifyDomains: config.DOMAIN_DEV_AUTOVERIFY },
);

services.workflow.start(Number(process.env.WORKFLOW_TICK_MS ?? 15_000), (msg, extra) => console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...extra })));

// Time alone ends a subscription: look for organisations whose period has run out, now and every few minutes.
const settleAll = () => void Promise.all([services.access.syncAll(), services.usage.pushAllLimits(), services.billing.issueDueFeeInvoices()]).catch(() => undefined);
settleAll();
const accessTimer = setInterval(settleAll, Number(process.env.ACCESS_SYNC_MS ?? 300_000));

const app = await buildApp({
  logger: true,
  corsOrigins: [config.CONSOLE_URL, config.WEB_URL, config.PORTAL_URL],
  checks: {
    platform_db: async () => void (await sql`select 1`.execute(platformDb)),
    identity_provider: async () => {
      const res = await fetch(new URL('/readyz', config.IDENTITY_INTERNAL_URL));
      if (!res.ok) throw new Error(String(res.status));
    },
  },
  internal: { serviceToken: config.IDENTITY_SERVICE_TOKEN, devMailbox: config.NODE_ENV !== 'production' },
  pay: { serviceToken: config.PAY_SERVICE_TOKEN },
  platform: {
    services,
    idp,
    verifier: new JwtTokenVerifier(config.IDENTITY_ISSUER, config.API_AUDIENCE),
  },
});

const shutdown = async () => {
  clearInterval(accessTimer);
  await services.usage.flush().catch(() => undefined);
  services.workflow.stop();
  await app.close();
  await Promise.all([platformDb.destroy(), cells.destroy()]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: '0.0.0.0', port: config.API_PORT });
