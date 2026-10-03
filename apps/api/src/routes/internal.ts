import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { unauthorized } from '../errors.js';
import type { EmailService } from '../services/email.js';

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Service-to-service API (bearer service token). The platform is the single
 * outbound mail path: the identity service sends its verification, reset and
 * set-up emails through here, so every message lands in the email log.
 */
export const internalRoutes: FastifyPluginAsyncZod<{ email: EmailService; serviceToken: string; devMailbox: boolean }> = async (app, deps) => {
  app.addHook('onRequest', async (req) => {
    if (!same(req.headers.authorization ?? '', `Bearer ${deps.serviceToken}`)) throw unauthorized();
  });

  app.post(
    '/internal/mail',
    {
      schema: {
        body: z.object({
          template: z.string().min(1).max(60),
          to: z.email(),
          subject: z.string().min(1).max(300),
          text: z.string().min(1).max(50_000),
          tenantId: z.uuid().nullable().default(null),
        }),
        response: { 200: z.object({ sent: z.boolean() }) },
      },
    },
    async (req) => ({ sent: await deps.email.send(req.body.template, req.body.tenantId, { to: req.body.to, subject: req.body.subject, text: req.body.text }) }),
  );

  // Development mailbox (replaces an external mail catcher for tests and demos).
  if (deps.devMailbox)
    app.get(
      '/internal/mail',
      { schema: { querystring: z.object({ to: z.email(), since: z.iso.datetime({ offset: true }).optional() }) } },
      async (req) =>
        (await deps.email.recent(req.query.to, req.query.since ? new Date(req.query.since) : new Date(0))).map((m) => ({
          id: m.id,
          template: m.template,
          to: m.to_address,
          subject: m.subject,
          text: m.body_text,
          status: m.status,
          createdAt: m.created_at.toISOString(),
        })),
    );
};
