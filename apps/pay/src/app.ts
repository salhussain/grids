import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError } from 'fastify';
import type { Kysely } from 'kysely';
import { ZodError, z } from 'zod';
import type { PayDB } from '@grids/db';
import { MerchantInput, MethodInput } from '@grids/schema';
import { renderCheckout } from './checkout.js';
import type { PayConfig } from './config.js';
import { safeEqual, sealer } from './crypto.js';
import { PayError, PayService } from './service.js';

export interface PayDeps {
  config: PayConfig;
  db: Kysely<PayDB>;
  logger?: boolean;
}

const Id = z.object({ id: z.uuid() });
const Method = z.string().min(1).max(60);
const Org = z.object({ orgId: z.string().min(1).max(100) });
const OrgMerchant = Org.extend({ id: z.uuid() });
const NewPayment = z.object({
  id: z.uuid(),
  orgId: z.string().min(1).max(100),
  projectKey: z.string().min(1).max(100),
  formKey: z.string().min(1).max(100),
  amount: z.number().int().min(0),
  currency: z.string().length(3),
  description: z.string().max(200).default(''),
  email: z.string().max(200).nullable().default(null),
  returnUrl: z.url().max(1000),
  merchantId: z.uuid().nullable().default(null),
});

export async function buildPayApp(deps: PayDeps) {
  const { config, db } = deps;
  const service = new PayService(db, sealer(config.PAY_SECRET_KEY));

  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true, bodyLimit: 512 * 1024 });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // The payment page has its own inline script and styles, and shows merchants' logos (data addresses).
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof PayError) return reply.status(err.status).send({ error: err.message, message: err.message });
    if (err instanceof ZodError) return reply.status(400).send({ error: 'invalid_request', message: 'The request was not valid.' });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message, message: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'server_error', message: 'Something went wrong.' });
  });

  app.get('/healthz', async () => ({ ok: true }));

  // ----- for the platform API (private, bearer token) -----
  app.register(async (scope) => {
    scope.addHook('onRequest', async (req, reply) => {
      const header = req.headers.authorization ?? '';
      if (!safeEqual(header, `Bearer ${config.PAY_SERVICE_TOKEN}`)) return reply.status(401).send({ error: 'unauthorised' });
    });
    scope.get('/internal/orgs/:orgId/merchants', async (req) => service.merchants(Org.parse(req.params).orgId));
    scope.post('/internal/orgs/:orgId/merchants', async (req) =>
      service.saveMerchant(Org.parse(req.params).orgId, null, MerchantInput.parse(req.body)),
    );
    scope.put('/internal/orgs/:orgId/merchants/:id', async (req) => {
      const p = OrgMerchant.parse(req.params);
      return service.saveMerchant(p.orgId, p.id, MerchantInput.parse(req.body));
    });
    scope.delete('/internal/orgs/:orgId/merchants/:id', async (req) => {
      const p = OrgMerchant.parse(req.params);
      return service.deleteMerchant(p.orgId, p.id);
    });
    scope.get('/internal/orgs/:orgId/methods', async (req) => service.catalogue(Org.parse(req.params).orgId));
    scope.post('/internal/orgs/:orgId/methods', async (req) => service.addMethod(Org.parse(req.params).orgId, MethodInput.parse(req.body)));
    scope.put('/internal/orgs/:orgId/methods/:id', async (req) => {
      const p = Org.extend({ id: z.string().min(1).max(60) }).parse(req.params);
      return service.changeMethod(p.orgId, p.id, MethodInput.parse(req.body));
    });
    scope.delete('/internal/orgs/:orgId/methods/:id', async (req) => {
      const p = Org.extend({ id: z.string().min(1).max(60) }).parse(req.params);
      return service.deleteMethod(p.orgId, p.id);
    });
    scope.post('/internal/payments', async (req) => {
      const p = await service.createPayment(NewPayment.parse(req.body));
      return { ...p, checkoutUrl: `${config.PAY_PUBLIC_URL}/pay/${p.id}` };
    });
    scope.get('/internal/payments/:id', async (req) => {
      const p = await service.payment(Id.parse(req.params).id);
      return { id: p.id, orgId: p.org_id, status: p.status, amount: p.amount, currency: p.currency, merchantId: p.merchant_id, paidAt: p.paid_at ? p.paid_at.toISOString() : null };
    });
  });

  // ----- the payment page (for the person paying) -----
  const back = (url: string, id: string) => {
    const u = new URL(url);
    u.searchParams.set('payment', id);
    return u.toString();
  };
  app.get('/pay/:id', async (req, reply) => {
    const { id } = Id.parse(req.params);
    const info = await service.checkoutInfo(id);
    return reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').type('text/html').send(renderCheckout(info, id));
  });
  // Each way of paying answers the same: done (and where to go back), or what to fix.
  const answer = (r: { ok: boolean; message: string | null; returnUrl: string | null; ended: boolean }, id: string) => ({
    ok: r.ok,
    message: r.message,
    returnUrl: r.returnUrl ? back(r.returnUrl, id) : null,
    // A payment that has ended sends the person back to the form; a mistake they can fix stays here.
    final: r.ended && !r.ok,
  });
  app.post('/pay/:id/pay', async (req, reply) => {
    const { id } = Id.parse(req.params);
    const { method, ...card } = z.object({ method: Method, name: z.string().max(100), number: z.string().max(30), expiry: z.string().max(10), cvc: z.string().max(5) }).parse(req.body);
    reply.header('cache-control', 'no-store');
    return answer(await service.payByCard(id, method, card), id);
  });
  app.post('/pay/:id/wallet', async (req, reply) => {
    const { id } = Id.parse(req.params);
    const b = z.object({ method: Method, phone: z.string().max(20) }).parse(req.body);
    reply.header('cache-control', 'no-store');
    return answer(await service.payByWallet(id, b.method, b.phone), id);
  });
  app.post('/pay/:id/bank', async (req, reply) => {
    const { id } = Id.parse(req.params);
    const b = z.object({ method: Method, bank: z.string().max(60), approve: z.boolean() }).parse(req.body);
    reply.header('cache-control', 'no-store');
    return answer(await service.payByBank(id, b.method, b.approve), id);
  });
  app.post('/pay/:id/instalments', async (req, reply) => {
    const { id } = Id.parse(req.params);
    const b = z.object({ method: Method, name: z.string().max(100), email: z.string().max(200), agree: z.boolean() }).parse(req.body);
    reply.header('cache-control', 'no-store');
    return answer(await service.payByInstalments(id, b.method, { name: b.name, email: b.email, agree: b.agree }), id);
  });
  app.get('/pay/:id/cancel', async (req, reply) => {
    const { id } = Id.parse(req.params);
    const url = await service.settle(id, 'cancelled');
    return reply.redirect(back(url, id), 303);
  });

  return { app, service };
}
