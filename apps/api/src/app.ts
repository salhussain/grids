import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import cors from '@fastify/cors';
import type { Problem } from '@grids/schema';
import type { AuthDeps } from './auth/plugin.js';
import { HttpError } from './errors.js';
import { adminRoutes } from './routes/admin.js';
import { closeAllStreams } from './routes/sse.js';
import { projectRoutes, publicProjectRoutes } from './routes/projects.js';
import { internalRoutes } from './routes/internal.js';
import { publicRoutes } from './routes/public.js';
import { tenantRoutes } from './routes/tenant.js';

export interface AppDeps {
  /** Readiness probes keyed by dependency name; each throws if unhealthy. */
  checks: Record<string, () => Promise<void>>;
  logger?: boolean;
  /** Control-plane routes; omitted in tests that only exercise infrastructure. */
  platform?: AuthDeps;
  corsOrigins?: string[];
  /** Service-to-service endpoints (mail relay); omitted when not configured. */
  internal?: { serviceToken: string; devMailbox: boolean };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cors, {
    origin: deps.corsOrigins ?? false,
    // @fastify/cors defaults to GET/HEAD/POST only; browsers would block PATCH/PUT/DELETE.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  // Every error leaves the API as RFC 7807 problem details (spec §14).
  app.setErrorHandler((err: FastifyError, req, reply) => {
    let problem: Problem;
    if (hasZodFastifySchemaValidationErrors(err)) {
      problem = {
        type: 'about:blank',
        title: 'Validation failed',
        status: 400,
        instance: req.url,
        errors: err.validation.map((v) => ({ path: v.instancePath, message: v.message ?? '' })),
      };
    } else {
      const status = err.statusCode ?? 500;
      if (status >= 500) req.log.error(err);
      problem = {
        type: 'about:blank',
        title: status >= 500 ? 'Internal Server Error' : err.message,
        status,
        instance: req.url,
        ...(err instanceof HttpError && err.detail && { detail: err.detail }),
        ...(err instanceof HttpError && err.errors && { errors: err.errors }),
      };
    }
    void reply.status(problem.status).type('application/problem+json').send(problem);
  });

  app.setNotFoundHandler((req, reply) => {
    const problem: Problem = {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      instance: req.url,
    };
    void reply.status(404).type('application/problem+json').send(problem);
  });

  app.get(
    '/healthz',
    { schema: { response: { 200: z.object({ status: z.literal('ok') }) } } },
    () => ({
      status: 'ok' as const,
    }),
  );

  const Ready = z.object({
    status: z.enum(['ready', 'degraded']),
    checks: z.record(z.string(), z.enum(['ok', 'fail'])),
  });
  app.get('/readyz', { schema: { response: { 200: Ready, 503: Ready } } }, async (_req, reply) => {
    const entries = await Promise.all(
      Object.entries(deps.checks).map(async ([name, check]) => {
        try {
          await check();
          return [name, 'ok'] as const;
        } catch {
          return [name, 'fail'] as const;
        }
      }),
    );
    const checks = Object.fromEntries(entries);
    const ok = entries.every(([, s]) => s === 'ok');
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ready' : 'degraded', checks });
  });

  if (deps.platform) {
    app.decorateRequest('actor', null);
    const services = deps.platform.services;
    app.addHook('preClose', async () => closeAllStreams());
    app.addHook('onClose', async () => services.events.close());
    await app.register(publicRoutes, deps.platform);
    await app.register(tenantRoutes, deps.platform);
    await app.register(adminRoutes, deps.platform);
    await app.register(projectRoutes, deps.platform);
    await app.register(publicProjectRoutes, deps.platform);
    if (deps.internal) await app.register(internalRoutes, { email: deps.platform.services.email, ...deps.internal });
  }

  return app;
}
