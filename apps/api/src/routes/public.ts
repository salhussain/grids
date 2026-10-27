import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ATTACHMENT_MAX_BYTES, AttachmentDto, SUPPORT_ATTACHMENT_MAX_BYTES, SupportAttachmentDto, SupportEmailCodeInput, SupportEmailProof, SupportEmailVerifyInput, SupportInfo, SupportReplyInput, SupportRequestInput, SupportSent, SupportThreadDto, SupportTypingInput,  CaptchaChallenge, EmailCodeRequest, EmailCodeSent, PlatformSettingsDto, InvitationPreview, MeDto, PreferencesInput, PublicBranding, PublicFormDto, PublicPlaceDto, PublicSubmissionInput, ResolvedHost, StartPaymentInput, PaymentStarted, PaymentState } from '@grids/schema';
import { actorOf, authenticate, type AuthDeps } from '../auth/plugin.js';

/** Signed-in user, invitation landing, and edge routing endpoints. */
export const publicRoutes: FastifyPluginAsyncZod<AuthDeps> = async (app, deps) => {
  const { services } = deps;
  const auth = authenticate(deps);

  app.get('/me', { preHandler: auth, schema: { response: { 200: MeDto } } }, (req) =>
    services.identity.me(actorOf(req)),
  );

  app.put(
    '/me/preferences',
    { preHandler: auth, schema: { body: PreferencesInput, response: { 200: MeDto } } },
    (req) => services.identity.setPreferences(actorOf(req), req.body),
  );

  // Sign-in page branding (read by the identity service; safe to cache briefly).
  app.get(
    '/public/branding/:tenantId',
    {
      schema: {
        params: z.object({ tenantId: z.uuid() }),
        response: { 200: PublicBranding },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'public, max-age=60');
      return services.workspace.publicBranding(req.params.tenantId);
    },
  );

  // Platform look and languages: the console before sign-in, the sign-in page and the public portal.
  app.get('/public/platform', { schema: { response: { 200: PlatformSettingsDto } } }, async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    return services.settings.get();
  });

  const TokenParams = z.object({ token: z.string().min(20).max(100) });
  app.get(
    '/invitations/:token',
    { schema: { params: TokenParams, response: { 200: InvitationPreview } } },
    (req) => services.members.preview(req.params.token),
  );
  app.post(
    '/invitations/:token/accept',
    { preHandler: auth, schema: { params: TokenParams, response: { 200: MeDto } } },
    (req) => services.members.accept(actorOf(req), req.params.token),
  );

  // A form opened through a link by someone without an account. Nothing here reads the caller's identity.
  const LinkParams = z.object({ path: z.string().min(40).max(120) });
  app.get('/public/captcha', { schema: { response: { 200: CaptchaChallenge } } }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return services.formLinks.captcha();
  });
  app.get('/public/forms/:path', { schema: { params: LinkParams, response: { 200: PublicFormDto } } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return services.formLinks.preview(req.params.path);
  });
  // Places an entity question offers, and files people attach: both only for the form the link opens.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: ATTACHMENT_MAX_BYTES }, (_req, body, done) => done(null, body));
  app.get(
    '/public/forms/:path/places',
    {
      schema: {
        params: LinkParams,
        querystring: z.object({ question: z.string().regex(/^[a-z][a-z0-9_]*$/).max(63), of: z.uuid().optional() }),
        response: { 200: z.array(PublicPlaceDto) },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return services.formLinks.places(req.params.path, req.query.question, req.query.of ?? null, req.ip);
    },
  );
  app.put(
    '/public/forms/:path/attachments',
    {
      bodyLimit: ATTACHMENT_MAX_BYTES,
      schema: {
        params: LinkParams,
        querystring: z.object({ name: z.string().max(255).default('file'), type: z.string().max(100).default('application/octet-stream') }),
        response: { 201: AttachmentDto },
      },
    },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) throw new Error('Send the file as the request body (application/octet-stream).');
      return reply.status(201).send(await services.formLinks.uploadAttachment(req.params.path, { name: req.query.name, contentType: req.query.type, content: req.body }, req.ip));
    },
  );
  app.get('/public/forms/:path/attachments/:id', { schema: { params: LinkParams.extend({ id: z.uuid() }) } }, async (req, reply) => {
    const f = await services.formLinks.attachment(req.params.path, req.params.id);
    const inline = f.contentType.startsWith('image/');
    return reply
      .header('content-type', f.contentType)
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .header('cache-control', 'private, max-age=3600')
      .header('x-content-type-options', 'nosniff')
      .send(f.content);
  });
  app.post(
    '/public/forms/:path/email-code',
    { schema: { params: LinkParams, body: EmailCodeRequest, response: { 200: EmailCodeSent } } },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return services.formLinks.sendEmailCode(req.params.path, req.body.email, req.ip);
    },
  );
  app.post(
    '/public/forms/:path/submissions',
    { schema: { params: LinkParams, body: PublicSubmissionInput, response: { 200: z.object({ message: z.string() }) } } },
    (req) => services.formLinks.submit(req.params.path, req.body, req.ip),
  );

  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  // A fee a form asks for: where to pay, and whether it went through.
  app.post(
    '/public/forms/:path/payments',
    { schema: { params: LinkParams, body: StartPaymentInput, response: { 200: PaymentStarted } } },
    (req) => services.formLinks.startPayment(req.params.path, req.body, req.ip),
  );
  app.get(
    '/public/forms/:path/payments/:id',
    { schema: { params: LinkParams.extend({ id: z.uuid() }), response: { 200: PaymentState } } },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return services.formLinks.paymentState(req.params.path, req.params.id);
    },
  );
  // The receipt for a payment that went through, for the person who paid.
  app.get('/public/forms/:path/payments/:id/receipt', { schema: { params: LinkParams.extend({ id: z.uuid() }) } }, async (req, reply) => {
    const r = await services.formLinks.paymentReceipt(req.params.path, req.params.id);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${r.name}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(r.pdf);
  });
  // The organisation's help window, on its public pages: people without an account ask the organisation. Nothing here reads the caller's identity.
  const OrgParams = z.object({ slug: z.string().min(1).max(63) });
  const ThreadParams = z.object({ token: z.string().min(40).max(100) });
  const fileQuery = z.object({ name: z.string().max(255).default('file'), type: z.string().max(100).default('application/octet-stream') });
  const sendFile = (reply: import('fastify').FastifyReply, f: { name: string; contentType: string; content: Buffer }) =>
    reply
      .header('content-type', f.contentType)
      .header('content-disposition', `${f.contentType.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(f.content);
  app.get('/public/orgs/:slug/help', { schema: { params: OrgParams, response: { 200: SupportInfo } } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return services.helpDesk.publicInfo(req.params.slug);
  });
  app.post('/public/orgs/:slug/help/email-code', { schema: { params: OrgParams, body: SupportEmailCodeInput } }, (req) => services.helpDesk.sendEmailCode(req.params.slug, req.body.email, req.ip));
  app.post('/public/orgs/:slug/help/email-verify', { schema: { params: OrgParams, body: SupportEmailVerifyInput, response: { 200: SupportEmailProof } } }, (req) =>
    services.helpDesk.verifyEmailCode(req.params.slug, req.body.email, req.body.code, req.ip),
  );
  // ----- the help window on other websites (see the Website embed tab of the help desk settings) -----
  /** A site as the settings list it (`www.example.org`, `*.example.org`) as CSP frame-ancestors sources. */
  const ancestors = (hosts: string[]) =>
    hosts
      .flatMap((h) => {
        const local = /^(localhost|127\.0\.0\.1)$/.test(h);
        return local ? [`http://${h}:*`, `https://${h}:*`] : [`https://${h}`, `http://${h}`];
      })
      .join(' ');
  const self = (req: import('fastify').FastifyRequest) => `${(req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? req.protocol}://${req.headers.host}`;
  app.get('/embed.js', async (req, reply) => {
    const api = self(req);
    return reply
      .header('content-type', 'application/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .send(`(function(){var s=document.currentScript;if(!s)return;var org=s.getAttribute('data-org'),key=s.getAttribute('data-key');if(!org||!key)return console.warn('Help window: data-org and data-key are needed');var origin=${JSON.stringify(api)};var side=s.getAttribute('data-position')==='left'?'left':'right';var q=new URLSearchParams({org:org,key:key,position:side,page:location.href});var project=s.getAttribute('data-project');if(project)q.set('project',project);var st=s.getAttribute('data-token');if(st)q.set('st',st);var f=document.createElement('iframe');f.src=origin+'/embed/help?'+q.toString();f.title='Help';f.setAttribute('allowtransparency','true');var base='position:fixed;bottom:0;'+side+':0;border:0;background:transparent;z-index:2147483000;max-width:100vw;max-height:100vh;color-scheme:normal;';var small='width:84px;height:84px;';f.style.cssText=base+small;window.addEventListener('message',function(e){if(e.origin!==origin||!e.data||e.data.source!=='grids-help')return;if(e.data.type==='open'){f.style.cssText=base+(window.innerWidth<480?'width:100vw;height:100vh;':'width:420px;height:min(680px,100vh);')}else if(e.data.type==='close'){f.style.cssText=base+small}});document.body.appendChild(f)})();`);
  });
  const EmbedQuery = z.object({ org: z.string().min(1).max(63), key: z.string().min(1).max(64), st: z.string().max(1500).optional(), position: z.enum(['left', 'right']).default('right'), project: z.string().max(63).optional(), page: z.string().max(500).optional() });
  app.get('/embed/help', { schema: { querystring: EmbedQuery } }, async (req, reply) => {
    const q = req.query;
    const e = await services.helpDesk.embedFor(q.org, q.key, q.st, { dest: req.headers['sec-fetch-dest'] as string | undefined, referer: req.headers.referer });
    reply.header('cache-control', 'no-store').header('x-content-type-options', 'nosniff').header('referrer-policy', 'no-referrer').header('content-type', 'text/html; charset=utf-8');
    // The browser itself refuses to draw this page inside any site that is not listed.
    if (!e) return reply.status(403).header('content-security-policy', "frame-ancestors 'none'").send('<!doctype html><title>Help</title>');
    const inner = new URL('/embed/help', services.helpDesk.webUrl);
    for (const [k, v] of Object.entries({ org: q.org, token: e.token, position: q.position, project: q.project, page: q.page })) if (v) inner.searchParams.set(k, v);
    return reply
      .header('content-security-policy', `frame-ancestors ${ancestors(e.origins)}`)
      .send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Help</title><style>html,body{margin:0;height:100%;background:transparent}iframe{border:0;width:100%;height:100%;background:transparent;color-scheme:normal}</style></head><body><iframe id="f" title="Help" src="${esc(inner.toString())}" allow="clipboard-write"></iframe><script>addEventListener('message',function(e){var f=document.getElementById('f');if(e.source===f.contentWindow&&e.data&&e.data.source==='grids-help')parent.postMessage(e.data,'*')})</script></body></html>`);
  });
  app.get('/public/orgs/:slug/help/embed-check', { schema: { params: OrgParams, querystring: z.object({ token: z.string().max(700) }) } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return services.helpDesk.embedCheck(req.params.slug, req.query.token);
  });

  app.put(
    '/public/orgs/:slug/help/files',
    { bodyLimit: SUPPORT_ATTACHMENT_MAX_BYTES, schema: { params: OrgParams, querystring: fileQuery, response: { 201: SupportAttachmentDto } } },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) throw new Error('Send the file as the request body (application/octet-stream).');
      return reply.status(201).send(await services.helpDesk.uploadPublic(req.params.slug, { name: req.query.name, contentType: req.query.type, content: req.body }, req.ip));
    },
  );
  app.post('/public/orgs/:slug/help/requests', { schema: { params: OrgParams, body: SupportRequestInput, response: { 201: SupportSent } } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.status(201).send(await services.helpDesk.requestPublic(req.params.slug, req.body, req.ip));
  });
  app.get('/public/help/:token', { schema: { params: ThreadParams, response: { 200: SupportThreadDto } } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return services.helpDesk.threadByToken(req.params.token);
  });
  app.post('/public/help/:token/messages', { schema: { params: ThreadParams, body: SupportReplyInput, response: { 200: SupportThreadDto } } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return services.helpDesk.replyByToken(req.params.token, req.body, req.ip);
  });
  app.put(
    '/public/help/:token/files',
    { bodyLimit: SUPPORT_ATTACHMENT_MAX_BYTES, schema: { params: ThreadParams, querystring: fileQuery, response: { 201: SupportAttachmentDto } } },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) throw new Error('Send the file as the request body (application/octet-stream).');
      return reply.status(201).send(await services.helpDesk.uploadByToken(req.params.token, { name: req.query.name, contentType: req.query.type, content: req.body }, req.ip));
    },
  );
  app.post('/public/help/:token/typing', { schema: { params: ThreadParams, body: SupportTypingInput } }, async (req, reply) => {
    await services.helpDesk.typingByToken(req.params.token, req.body.text, req.ip);
    return reply.status(204).send();
  });
  app.get('/public/help/:token/files/:id', { schema: { params: ThreadParams.extend({ id: z.uuid() }) } }, async (req, reply) => sendFile(reply, await services.helpDesk.fileByToken(req.params.token, req.params.id)));

  // Called by the edge proxy: Host → tenant (+ redirect to the primary domain).
  app.get(
    '/edge/resolve',
    {
      schema: {
        querystring: z.object({ host: z.string().min(1).max(253) }),
        response: { 200: ResolvedHost },
      },
    },
    (req) => services.domains.resolve(req.query.host),
  );
  // Caddy on-demand TLS `ask` endpoint: 200 = issue a certificate for this domain.
  app.get(
    '/edge/tls-allowed',
    { schema: { querystring: z.object({ domain: z.string().min(1).max(253) }) } },
    async (req, reply) =>
      reply.status((await services.domains.tlsAllowed(req.query.domain)) ? 200 : 404).send(),
  );
};
