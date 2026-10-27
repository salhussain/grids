import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { unauthorized } from '../errors.js';
import type { PaymentService } from '../services/payments.js';

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** What GridPay (the payment service) tells the platform: how a payment ended (bearer service token). */
export const payInternalRoutes: FastifyPluginAsyncZod<{ payments: PaymentService; serviceToken: string }> = async (app, deps) => {
  app.addHook('onRequest', async (req) => {
    if (!same(req.headers.authorization ?? '', `Bearer ${deps.serviceToken}`)) throw unauthorized();
  });
  app.post(
    '/internal/payments/settled',
    { schema: { body: z.object({ id: z.uuid(), status: z.enum(['succeeded', 'failed', 'cancelled']), paidAt: z.string().nullable(), method: z.string().nullable().default(null), surcharge: z.number().int().default(0) }) } },
    async (req) => {
      await deps.payments.settle(req.body.id, req.body.status, req.body.paidAt, req.body.method, req.body.surcharge);
      return { ok: true };
    },
  );
};
