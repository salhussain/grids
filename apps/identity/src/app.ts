import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import helmet from '@fastify/helmet';
import middie from '@fastify/middie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError } from 'fastify';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ZodError } from 'zod';
import type { IdentityDB } from '@grids/db';
import { AuthError, Accounts } from './accounts.js';
import { sweepExpired } from './adapter.js';
import { brandingLoader, type Branding } from './branding.js';
import { originOf, type IdentityConfig } from './config.js';
import { sealer } from './crypto.js';
import { loadSigningKeys } from './keys.js';
import type { Mailer } from './mailer.js';
import { createProvider } from './provider.js';
import { sameOrigin } from './routes/common.js';
import { interactionRoutes } from './routes/interactions.js';
import { internalRoutes } from './routes/internal.js';
import { selfServiceRoutes } from './routes/self-service.js';

export interface IdentityDeps {
  config: IdentityConfig;
  db: Kysely<IdentityDB>;
  mailer: Mailer;
  branding?: (tenantId: string | null | undefined) => Promise<Branding | null>;
  logger?: boolean;
}

export async function buildIdentityApp(deps: IdentityDeps) {
  const { config, db } = deps;
  const accounts = new Accounts(db, sealer(config.IDENTITY_SECRET_KEY), deps.mailer);
  const provider = createProvider(config, db, accounts, await loadSigningKeys(db));
  const origin = originOf(config.IDENTITY_ISSUER);

  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true, bodyLimit: 64 * 1024 });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // inline auto-submit on the logout page only
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        formAction: ["'self'", config.CONSOLE_URL, config.WEB_URL],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AuthError) return reply.status(err.status).send({ error: err.code, vars: err.vars });
    if (err instanceof ZodError) return reply.status(400).send({ error: 'generic', issues: err.issues.map((i) => i.path.join('.')) });
    if (err.statusCode === 429) return reply.status(429).send({ error: 'rate_limited' });
    req.log.error(err);
    return reply.status(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).send({ error: 'generic' });
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await sql`select 1`.execute(db);
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'degraded' });
    }
  });

  // Login app API (same-origin only).
  await app.register(async (ui) => {
    ui.addHook('preHandler', sameOrigin(origin));
    interactionRoutes(ui, { provider, accounts, config, branding: deps.branding ?? brandingLoader(config.API_URL) });
    selfServiceRoutes(ui, { provider, accounts, config });
  });
  internalRoutes(app, { accounts, config });

  // The built login app at /ui (SPA: unknown /ui paths serve index.html).
  if (existsSync(join(config.LOGIN_DIST, 'index.html'))) {
    // Re-read when the build changes (rebuilds replace the hashed asset names).
    const indexPath = join(config.LOGIN_DIST, 'index.html');
    let cached = { mtime: 0, html: '' };
    const indexHtml = () => {
      const mtime = statSync(indexPath).mtimeMs;
      if (mtime !== cached.mtime) cached = { mtime, html: readFileSync(indexPath, 'utf8') };
      return cached.html;
    };
    await app.register(fastifyStatic, { root: config.LOGIN_DIST, prefix: '/ui/', wildcard: false, index: false });
    app.get('/ui/*', (req, reply) => {
      const asset = (req.params as { '*': string })['*'];
      if (/\.[a-z0-9]+$/i.test(asset) && existsSync(join(config.LOGIN_DIST, asset))) return reply.sendFile(asset);
      return reply.type('text/html').header('cache-control', 'no-store').send(indexHtml());
    });
  }

  // OpenID Connect endpoints (discovery, auth, token, userinfo, jwks, end session…).
  await app.register(middie);
  app.use('/oidc', provider.callback());

  const sweep = setInterval(() => void sweepExpired(db).catch(() => undefined), 10 * 60_000);
  app.addHook('onClose', async () => clearInterval(sweep));

  return { app, provider, accounts };
}
