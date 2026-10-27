import { planHasFeature } from './features.js';
import {
  stageOf,
  statusOfStage,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  uuidv7,
  type SupportAttachmentDto,
  type SupportInfo,
  type SupportMessageDto,
  type SupportMineDto,
  type SupportReplyInput,
  type SupportRequestInput,
  type SupportSent,
  type SupportStage,
  type SupportThreadDto,
} from '@grids/schema';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import { badRequest, forbidden, HttpError, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { Limiter, type FormLinkService } from './form-links.js';
import { requireTenantAccess } from './authz.js';
import { workspacePolicy } from './policy.js';
import type { SupportService } from './support.js';
import { readSupportToken, supportToken } from './support-token.js';
import { agentTyping, setVisitorTyping } from './typing.js';
import { iso } from './util.js';

const THREAD_KINDS = ['requester', 'staff', 'system'];

/**
 * The requester's side of the organisation's help desk: people using its public pages or portal ask for help, follow the
 * conversation, and send files. What the team does with a request (stages, assigning, labels, internal notes, passing
 * it on) lives in the support service; here only what the person who asked may see and do.
 */
const CODE_TTL_MS = 10 * 60_000;

export class HelpDeskService {
  private readonly limiter = new Limiter();

  constructor(
    private readonly ctx: ServiceContext,
    private readonly support: SupportService,
    private readonly formLinks: FormLinkService,
    private readonly colorOf: (tenantId: string) => Promise<string | null> = async () => null,
    private readonly sideOf: (tenantId: string) => Promise<'left' | 'right'> = async () => 'left',
  ) {}

  // ---------------------------------------------------------------- the window

  private async orgBySlug(slug: string) {
    const t = await this.ctx.db.selectFrom('tenant').select(['id', 'name', 'status', 'access_blocked']).where('slug', '=', slug).executeTakeFirst();
    if (!t || t.status !== 'active' || t.access_blocked || !(await planHasFeature(this.ctx.db, t.id, 'help_desk'))) throw notFound('Organisation');
    return t;
  }

  private async infoOf(tenantId: string, orgName: string): Promise<SupportInfo> {
    const d = await this.support.deskOf(tenantId);
    return { enabled: d.enabled, orgName, chat: d.chat, captcha: d.captcha, phone: d.phone, verifyEmail: d.verifyEmail, color: await this.colorOf(tenantId).catch(() => null), helpPosition: await this.sideOf(tenantId).catch(() => 'left' as const), greeting: d.greeting, categories: d.categories, categoryIcons: d.categoryIcons };
  }

  async publicInfo(slug: string): Promise<SupportInfo> {
    const t = await this.orgBySlug(slug);
    return this.infoOf(t.id, t.name);
  }

  async infoFor(actor: Actor, tenantId: string): Promise<SupportInfo> {
    await this.member(actor, tenantId);
    const t = await this.ctx.db.selectFrom('tenant').select('name').where('id', '=', tenantId).executeTakeFirstOrThrow();
    return this.infoOf(tenantId, t.name);
  }

  private async member(actor: Actor, tenantId: string) {
    if (!(await workspacePolicy(this.ctx, actor, tenantId))) throw forbidden('You are not a member of this organisation.');
  }

  private async enabled(tenantId: string) {
    const d = await this.support.deskOf(tenantId);
    if (!d.enabled) throw notFound('Support');
    return d;
  }

  // ---------------------------------------------------------------- files

  async uploadPublic(slug: string, file: { name: string; contentType: string; content: Buffer }, ip: string): Promise<SupportAttachmentDto> {
    if (!this.limiter.allow(`all|${ip}`, 60, 60_000)) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
    const t = await this.orgBySlug(slug);
    await this.enabled(t.id);
    if (!this.limiter.allow(`up|${t.id}|${ip}`, 30, 3_600_000)) throw new HttpError(429, 'You have sent too many files. Try again later.');
    return this.support.storeFile(t.id, file);
  }

  async uploadByToken(token: string, file: { name: string; contentType: string; content: Buffer }, ip: string): Promise<SupportAttachmentDto> {
    const t = readSupportToken(this.ctx.secretsKey, token);
    if (!t) throw notFound('Request');
    if (!this.limiter.allow(`up|${t.tenantId}|${ip}`, 30, 3_600_000)) throw new HttpError(429, 'You have sent too many files. Try again later.');
    return this.support.storeFile(t.tenantId, file);
  }

  async uploadFor(actor: Actor, tenantId: string, file: { name: string; contentType: string; content: Buffer }, ip: string): Promise<SupportAttachmentDto> {
    await this.member(actor, tenantId);
    if (!this.limiter.allow(`up|${tenantId}|${actor.id}`, 60, 3_600_000)) throw new HttpError(429, 'You have sent too many files. Try again later.');
    void ip;
    return this.support.storeFile(tenantId, file);
  }

  private async fileOf(ticketId: string, id: string) {
    const f = await this.ctx.db.selectFrom('support_file').select(['name', 'content_type', 'content']).where('id', '=', id).where('ticket_id', '=', ticketId).executeTakeFirst();
    if (!f) throw notFound('File');
    return { name: f.name, contentType: f.content_type, content: f.content };
  }

  async fileByToken(token: string, id: string) {
    const t = readSupportToken(this.ctx.secretsKey, token);
    if (!t) throw notFound('File');
    return this.fileOf(t.itemId, id);
  }

  async fileFor(actor: Actor, tenantId: string, id: string) {
    await this.member(actor, tenantId);
    const f = await this.ctx.db.selectFrom('support_file as f').innerJoin('support_ticket as t', 't.id', 'f.ticket_id').select(['f.ticket_id', 't.created_by']).where('f.id', '=', id).where('t.tenant_id', '=', tenantId).executeTakeFirst();
    if (!f) throw notFound('File');
    // The person who asked reads their own files; the team reads every request's.
    if (f.created_by !== actor.id) return this.support.file(actor, id);
    return this.fileOf(f.ticket_id!, id);
  }



  // ---------------------------------------------------------------- website embeds

  /** Where the web app lives (the page inside the embed frame). */
  get webUrl() {
    return this.ctx.workspaceUrl;
  }

  // ---- tokens: ours (handed to the page inside the frame) and the website's own (signed by its server)
  private hmac(key: string | Buffer, text: string) {
    return createHmac('sha256', key).update(text).digest('base64url');
  }
  private same(a: string, b: string) {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
  /** `site.exp.identity.signature`; `identity` is who the website says the visitor is (secure sites), or empty. */
  private embedToken(tenantId: string, siteId: string, identity: { name?: string; email?: string } | null) {
    const exp = this.ctx.now().getTime() + 60 * 60_000;
    const id = identity ? Buffer.from(JSON.stringify(identity)).toString('base64url') : '';
    return `${siteId}.${exp}.${id}.${this.hmac(this.ctx.secretsKey, `support-embed:${tenantId}:${siteId}:${exp}:${id}`)}`;
  }
  private readEmbedToken(tenantId: string, token: string | undefined): { siteId: string; identity: { name?: string; email?: string } | null } | null {
    const [siteId, exp, id, sig, extra] = (token ?? '').split('.');
    if (!siteId || !exp || id === undefined || !sig || extra !== undefined || Number(exp) < this.ctx.now().getTime()) return null;
    if (!this.same(this.hmac(this.ctx.secretsKey, `support-embed:${tenantId}:${siteId}:${exp}:${id}`), sig)) return null;
    try {
      return { siteId, identity: id ? (JSON.parse(Buffer.from(id, 'base64url').toString()) as { name?: string; email?: string }) : null };
    } catch {
      return null;
    }
  }
  /** What a secure website signs with: made from the server's key, so nothing is stored (and it can be shown again). */
  siteSecret(tenantId: string, site: { id: string; secretVersion: number }) {
    return createHmac('sha256', this.ctx.secretsKey).update(`support-embed-secret:${tenantId}:${site.id}:${site.secretVersion}`).digest('hex');
  }
  /** The website's own token: `payload.signature`, the payload being base64url JSON `{ exp (seconds), name?, email? }` and the signature an HMAC-SHA256 of it with the site's secret. */
  private readSiteToken(secret: string, token: string | undefined): { name?: string; email?: string } | null {
    const [payload, sig, extra] = (token ?? '').split('.');
    if (!payload || !sig || extra !== undefined || !this.same(this.hmac(secret, payload), sig)) return null;
    try {
      const c = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: number; name?: string; email?: string };
      const now = this.ctx.now().getTime() / 1000;
      if (typeof c.exp !== 'number' || c.exp < now || c.exp > now + 3600) return null;
      return { ...(c.name && { name: String(c.name).slice(0, 100) }), ...(c.email && { email: String(c.email).slice(0, 200) }) };
    } catch {
      return null;
    }
  }
  private hostMatches(host: string, pattern: string) {
    const h = pattern.replace(/:\d+$/, '');
    return h.startsWith('*.') ? host === h.slice(2) || host.endsWith(h.slice(1)) : host === h;
  }

  /**
   * What the embed page needs: the one site allowed to frame it, and a short-lived token for the page inside it. Nothing
   * is given without that site's own key, while the site (or all embeds) is paused, to something that is not a browser
   * loading a frame, from a page on another site, or (for a secure site) without a token signed by the site's own server.
   */
  async embedFor(slug: string, key: string, siteToken: string | undefined, from: { dest?: string; referer?: string }): Promise<{ origins: string[]; token: string } | null> {
    const t = await this.ctx.db.selectFrom('tenant').select(['id', 'status', 'access_blocked']).where('slug', '=', slug).executeTakeFirst();
    if (!t || t.status !== 'active' || t.access_blocked || !(await planHasFeature(this.ctx.db, t.id, 'help_desk'))) return null;
    const d = await this.support.deskOf(t.id);
    if (!d.enabled || d.embedPaused) return null;
    const site = d.embedSites.find((e) => !!e.key && this.same(e.key, key));
    if (!site || site.paused) return null;
    // A browser loading a frame says so, and says which page asked; a script that does not bother is turned away.
    if (from.dest !== 'iframe') return null;
    if (from.referer) {
      try {
        if (!this.hostMatches(new URL(from.referer).hostname.toLowerCase(), site.host)) return null;
      } catch {
        return null;
      }
    }
    let identity: { name?: string; email?: string } | null = null;
    if (site.secure) {
      identity = this.readSiteToken(this.siteSecret(t.id, site), siteToken);
      if (!identity) return null;
    }
    return { origins: [site.host], token: this.embedToken(t.id, site.id, identity && Object.keys(identity).length ? identity : null) };
  }

  /** Whether the page inside the frame may show, on which website it must sit, and who the website says the visitor is. */
  async embedCheck(slug: string, token: string): Promise<{ ok: boolean; host: string | null; identity: { name?: string; email?: string } | null }> {
    const none = { ok: false, host: null, identity: null };
    const t = await this.ctx.db.selectFrom('tenant').select(['id', 'status', 'access_blocked']).where('slug', '=', slug).executeTakeFirst();
    if (!t || t.status !== 'active' || t.access_blocked || !(await planHasFeature(this.ctx.db, t.id, 'help_desk'))) return none;
    const d = await this.support.deskOf(t.id);
    const read = this.readEmbedToken(t.id, token);
    const site = read && d.embedSites.find((e) => e.id === read.siteId);
    return d.enabled && !d.embedPaused && site && !site.paused ? { ok: true, host: site.host, identity: read!.identity } : none;
  }

  /** How much each website has used of its hourly allowance (the team sees this beside the website). */
  async embedUsage(actor: Actor, tenantId: string): Promise<{ siteId: string; used: number; limit: number; refused: number }[]> {
    const d = await this.support.desk(actor, tenantId);
    return d.embedSites.map((e) => ({ siteId: e.id, used: this.limiter.count(`embed|${tenantId}|${e.id}`, 3_600_000), limit: e.hourlyLimit, refused: this.limiter.count(`embed-no|${tenantId}|${e.id}`, 3_600_000) }));
  }

  /** The secret a secure website signs its tokens with (only for the team that manages support). */
  async embedSecret(actor: Actor, tenantId: string, siteId: string): Promise<string> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'support.triage', workspace: 'support.manage' });
    const site = (await this.support.deskOf(tenantId)).embedSites.find((e) => e.id === siteId);
    if (!site) throw notFound('Website');
    await audit(this.ctx, actor.id, tenantId, 'support.embed_secret_viewed', { site: site.host });
    return this.siteSecret(tenantId, site);
  }

  // ---------------------------------------------------------------- confirming an email address

  private hashCode(id: string, code: string) {
    return createHmac('sha256', this.ctx.secretsKey).update(`support-code:${id}:${code}`).digest('hex');
  }
  private proofSig(tenantId: string, email: string, exp: number) {
    return createHmac('sha256', this.ctx.secretsKey).update(`support-proof:${tenantId}:${email}:${exp}`).digest('base64url');
  }
  /** Whether `proof` was handed out for this address of this organisation, and has not run out. */
  private checkProof(tenantId: string, rawEmail: string, proof: string | undefined): boolean {
    const [exp, sig, extra] = (proof ?? '').split('.');
    if (!exp || !sig || extra !== undefined || Number(exp) < this.ctx.now().getTime()) return false;
    const want = Buffer.from(this.proofSig(tenantId, rawEmail.trim().toLowerCase(), Number(exp)));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  /** Emails a six-digit code to the address, so the person can show it is theirs. */
  async sendEmailCode(slug: string, rawEmail: string, ip: string): Promise<{ expiresInMinutes: number }> {
    if (!this.limiter.allow(`all|${ip}`, 60, 60_000)) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
    const t = await this.orgBySlug(slug);
    const desk = await this.enabled(t.id);
    if (!desk.verifyEmail) throw badRequest('This help desk does not check email addresses');
    const email = rawEmail.trim().toLowerCase();
    if (!this.limiter.allow(`code|${t.id}|${ip}`, 10, 3_600_000)) throw new HttpError(429, 'Too many codes asked for. Try again later.');
    if (!this.limiter.allow(`code-to|${t.id}|${email}`, 5, 3_600_000)) throw new HttpError(429, 'Too many codes sent to this address. Try again later.');
    const now = this.ctx.now();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = uuidv7();
    await this.ctx.db.transaction().execute(async (tx) => {
      // A new code replaces any earlier one for this address.
      await tx.updateTable('support_email_code').set({ used_at: now }).where('tenant_id', '=', t.id).where('email', '=', email).where('used_at', 'is', null).execute();
      await tx.insertInto('support_email_code').values({ id, tenant_id: t.id, email, code_hash: this.hashCode(id, code), expires_at: new Date(now.getTime() + CODE_TTL_MS) }).execute();
    });
    const sent = await this.ctx.email.send('support_email_verify', t.id, {
      to: email,
      subject: `Your code for ${t.name}: ${code}`,
      text: `Your code is ${code}\n\nEnter it in the help window to confirm this email address. It works once and expires in ${CODE_TTL_MS / 60_000} minutes.\n\nIf you did not ask for it, you can ignore this message.`,
    });
    if (!sent) throw new HttpError(502, 'The code could not be emailed. Try again in a moment.');
    return { expiresInMinutes: CODE_TTL_MS / 60_000 };
  }

  /** Checks the code; a right one is spent and answered with a proof that goes with the request. */
  async verifyEmailCode(slug: string, rawEmail: string, code: string, ip: string): Promise<{ proof: string }> {
    if (!this.limiter.allow(`all|${ip}`, 60, 60_000)) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
    const t = await this.orgBySlug(slug);
    await this.enabled(t.id);
    const email = rawEmail.trim().toLowerCase();
    const now = this.ctx.now();
    const row = await this.ctx.db.selectFrom('support_email_code').selectAll().where('tenant_id', '=', t.id).where('email', '=', email).where('used_at', 'is', null).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    const wrong = badRequest('That code is not right, or it has run out. Ask for a new one.');
    if (!row || row.expires_at < now || row.attempts >= 5) throw wrong;
    const got = Buffer.from(this.hashCode(row.id, code));
    const want = Buffer.from(row.code_hash);
    if (got.length !== want.length || !timingSafeEqual(got, want)) {
      await this.ctx.db.updateTable('support_email_code').set((eb) => ({ attempts: eb('attempts', '+', 1) })).where('id', '=', row.id).execute();
      throw wrong;
    }
    await this.ctx.db.updateTable('support_email_code').set({ used_at: now }).where('id', '=', row.id).execute();
    const exp = now.getTime() + 30 * 60_000;
    return { proof: `${exp}.${this.proofSig(t.id, email, exp)}` };
  }

  // ---------------------------------------------------------------- asking

  private async open(tenant: { id: string; name: string }, who: { userId: string | null; name: string; email: string | null; phone?: string | null }, input: z.output<typeof SupportRequestInput>): Promise<{ id: string; number: number }> {
    const desk = await this.support.deskOf(tenant.id);
    const category = input.category && desk.categories.includes(input.category) ? input.category : null;
    const body = [input.body, category && `Topic: ${category}`, input.page && `Sent from ${input.page}`].filter(Boolean).join('\n\n');
    const id = uuidv7();
    const number = await this.support.nextTicketNumber();
    await this.ctx.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('support_ticket')
        .values({
          id,
          number,
          tenant_id: tenant.id,
          subject: input.subject,
          category: 'question',
          priority: 'normal',
          status: 'open',
          created_by: who.userId,
          audience: 'organisation',
          requester_name: who.name,
          requester_email: who.email,
          requester_phone: who.phone ?? null,
          channel: 'help',
          source_project: input.project ?? null,
          stage: desk.stages[0]!.key,
        })
        .execute();
      const files = await this.support.attach(tx, tenant.id, id, input.attachments);
      await tx.insertInto('support_message').values({ id: uuidv7(), ticket_id: id, author_id: who.userId, author_name: who.name, author_kind: 'requester', body, attachments: JSON.stringify(files) }).execute();
    });
    await this.support.notifyHandlers(tenant.id, `[#${number}] ${input.subject}`, `${who.name}${who.email ? ` (${who.email})` : ''}${who.phone ? `, ${who.phone}` : ''} asked for help${input.project ? ` from the ${input.project} project` : ''}:\n\n${input.body}\n\nOpen: ${this.ctx.workspaceUrl}/o/${tenant.id}/support/${id}`, who.userId);
    return { id, number };
  }

  /** A request from someone who is not signed in: they give their name and email so the team can write back. */
  async requestPublic(slug: string, input: z.output<typeof SupportRequestInput>, ip: string): Promise<SupportSent> {
    if (!this.limiter.allow(`all|${ip}`, 60, 60_000)) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
    const t = await this.orgBySlug(slug);
    const desk = await this.enabled(t.id);
    // Through a website's embed: its token says which website, and (for a secure site) who the visitor is.
    const emb = input.embed ? this.readEmbedToken(t.id, input.embed) : null;
    const site = emb && desk.embedSites.find((e) => e.id === emb.siteId);
    if (input.embed) {
      if (desk.embedPaused || !site || site.paused) throw new HttpError(403, 'Help from this website is switched off.');
      // A standard website has its own hourly allowance, and each visitor a small share of it. A secure website
      // (whose server vouches for each page view) is not limited this way.
      if (!site.secure) {
        if (!this.limiter.allow(`embed|${t.id}|${site.id}`, site.hourlyLimit, 3_600_000)) {
          // A website that keeps hammering after it is over its allowance is switched off, and the team told.
          this.limiter.allow(`embed-no|${t.id}|${site.id}`, Number.MAX_SAFE_INTEGER, 3_600_000);
          if (this.limiter.count(`embed-no|${t.id}|${site.id}`, 3_600_000) >= Math.max(20, site.hourlyLimit)) await this.support.pauseEmbedSite(t.id, site.id, `${site.host} kept sending requests after reaching its limit of ${site.hourlyLimit} an hour.`);
          throw new HttpError(429, 'This website has sent too many requests this hour. Try again later.');
        }
        if (!this.limiter.allow(`embed-ip|${t.id}|${site.id}|${ip}`, 5, 3_600_000)) throw new HttpError(429, 'You have sent too many requests from here. Try again later.');
        // A first warning when most of the allowance is gone.
        if (this.limiter.count(`embed|${t.id}|${site.id}`, 3_600_000) === Math.ceil(site.hourlyLimit * 0.8)) void this.support.notifyHandlers(t.id, `${site.host} is close to its hourly limit`, `${site.host} has used 80% of its ${site.hourlyLimit} requests this hour.\n\nChange the limit in Settings → Help desk → Website embed.`, null).catch(() => undefined);
      }
    }
    const known = emb?.identity?.email ? emb.identity : null;
    const name = known?.name ?? input.name;
    const email = known?.email ?? input.email;
    if (!name || !email) throw badRequest('Tell us your name and email so we can reply.');
    const phone = input.phone?.trim() || null;
    if (desk.phone === 'required' && !phone) throw badRequest('Add a phone number so we can reach you.');
    if (phone && !/^[+0-9 ()-]{6,25}$/.test(phone)) throw badRequest('That phone number does not look right.');
    if (desk.verifyEmail && !known && !this.checkProof(t.id, email, input.emailProof)) throw badRequest('Confirm your email address first.');
    if (desk.captcha) {
      if (!input.captcha) throw new HttpError(400, 'The check did not pass. Reload the page and try again.');
      this.formLinks.verifyCaptcha(input.captcha);
    }
    if (!this.limiter.allow(`ask|${t.id}|${ip}`, 8, 3_600_000)) throw new HttpError(429, 'You have sent too many requests. Try again later.');
    if (!this.limiter.allow(`ask-by|${t.id}|${email.toLowerCase()}`, 10, 86_400_000)) throw new HttpError(429, 'Too many requests from this address today.');
    const made = await this.open(t, { userId: null, name, email, phone: desk.phone === 'off' ? null : phone }, input);
    return { token: supportToken(this.ctx.secretsKey, t.id, made.id), thread: await this.threadOf(t.id, made.id) };
  }

  /** A request from a signed-in person: their account says who they are. */
  async requestFor(actor: Actor, tenantId: string, input: z.output<typeof SupportRequestInput>, ip: string): Promise<SupportSent> {
    await this.member(actor, tenantId);
    await this.enabled(tenantId);
    void ip;
    if (!this.limiter.allow(`ask-by|${tenantId}|${actor.id}`, 30, 86_400_000)) throw new HttpError(429, 'Too many requests today.');
    const t = await this.ctx.db.selectFrom('tenant').select(['id', 'name']).where('id', '=', tenantId).executeTakeFirstOrThrow();
    const u = await this.ctx.db.selectFrom('user_identity').select(['display_name', 'email']).where('id', '=', actor.id).executeTakeFirst();
    const made = await this.open(t, { userId: actor.id, name: u?.display_name || u?.email || 'Someone', email: u?.email ?? actor.email }, input);
    return { token: null, thread: await this.threadOf(tenantId, made.id) };
  }

  // ---------------------------------------------------------------- following it

  /** The request as the person who made it sees it: what they and the team wrote, and each change of stage. */
  private async threadOf(tenantId: string, ticketId: string): Promise<SupportThreadDto> {
    const t = await this.ctx.db.selectFrom('support_ticket as st').innerJoin('tenant as o', 'o.id', 'st.tenant_id').select(['st.id', 'st.number', 'st.subject', 'st.status', 'st.stage', 'st.created_at', 'st.updated_at', 'st.resolved_at', 'o.name as org']).where('st.id', '=', ticketId).where('st.tenant_id', '=', tenantId).executeTakeFirst();
    if (!t) throw notFound('Request');
    const desk = await this.support.deskOf(tenantId);
    const rows = await this.ctx.db
      .selectFrom('support_message as m')
      .leftJoin('user_identity as u', 'u.id', 'm.author_id')
      .select(['m.id', 'm.body', 'm.author_kind', 'm.author_name', 'm.attachments', 'm.created_at', 'm.edited_at', 'u.display_name'])
      .where('m.ticket_id', '=', ticketId)
      .where('m.internal', '=', false)
      .where('m.parent_id', 'is', null)
      .orderBy('m.created_at')
      .execute();
    const messages: SupportMessageDto[] = rows
      .filter((r) => THREAD_KINDS.includes(r.author_kind ?? 'requester'))
      // Moving a ticket between stages is the team's own business; the person is told about people joining, not about that.
      .filter((r) => !(r.author_kind === 'system' && /^Stage changed to /.test(r.body)))
      .map((r) => ({
        id: r.id,
        from: ((r.author_kind ?? 'requester') as 'requester' | 'staff' | 'system'),
        name: r.author_kind === 'system' ? 'Update' : (r.author_name ?? r.display_name ?? (r.author_kind === 'staff' ? 'Team' : 'You')),
        body: r.body,
        attachments: (r.attachments as SupportAttachmentDto[]) ?? [],
        editedAt: r.edited_at ? iso(r.edited_at) : null,
        createdAt: iso(r.created_at),
      }));
    const st = stageOf(desk.stages, t);
    return {
      id: t.id,
      ref: `#${t.number}`,
      subject: t.subject,
      orgName: t.org,
      stage: { key: st.key, label: st.label, kind: st.kind },
      createdAt: iso(t.created_at),
      updatedAt: iso(t.updated_at),
      canReply: !(st.kind === 'done' && t.resolved_at && this.ctx.now().getTime() - t.resolved_at.getTime() > 30 * 86_400_000),
      chat: desk.chat,
      answered: messages.some((m) => m.from === 'staff'),
      agentTyping: agentTyping(ticketId),
      messages,
    };
  }

  async threadByToken(token: string): Promise<SupportThreadDto> {
    const t = readSupportToken(this.ctx.secretsKey, token);
    if (!t) throw notFound('Request');
    return this.threadOf(t.tenantId, t.itemId);
  }

  async mine(actor: Actor, tenantId: string): Promise<SupportMineDto> {
    await this.member(actor, tenantId);
    const desk = await this.support.deskOf(tenantId);
    const rows = await this.ctx.db.selectFrom('support_ticket').select(['id', 'number', 'subject', 'status', 'stage', 'updated_at']).where('tenant_id', '=', tenantId).where('created_by', '=', actor.id).where('channel', '=', 'help').orderBy('updated_at', 'desc').limit(50).execute();
    return rows.map((r) => {
      const st = stageOf(desk.stages, r);
      return { id: r.id, ref: `#${r.number}`, subject: r.subject, stage: { key: st.key, label: st.label, kind: st.kind }, updatedAt: iso(r.updated_at) };
    });
  }

  /** The person is typing: the team sees the words as they come. */
  private async visitorIsTyping(tenantId: string, id: string, text: string) {
    const t = await this.ctx.db.selectFrom('support_ticket').select(['requester_name']).where('id', '=', id).where('tenant_id', '=', tenantId).executeTakeFirst();
    if (t) setVisitorTyping(id, t.requester_name ?? 'The person', text);
  }
  async typingByToken(token: string, text: string, ip: string): Promise<void> {
    const t = readSupportToken(this.ctx.secretsKey, token);
    if (!t) throw notFound('Request');
    if (!this.limiter.allow(`typing|${ip}`, 120, 60_000)) return;
    await this.visitorIsTyping(t.tenantId, t.itemId, text);
  }
  async typingFor(actor: Actor, tenantId: string, id: string, text: string): Promise<void> {
    await this.own(actor, tenantId, id);
    await this.visitorIsTyping(tenantId, id, text);
  }

  async threadFor(actor: Actor, tenantId: string, id: string): Promise<SupportThreadDto> {
    await this.own(actor, tenantId, id);
    return this.threadOf(tenantId, id);
  }

  private async own(actor: Actor, tenantId: string, id: string) {
    await this.member(actor, tenantId);
    const t = await this.ctx.db.selectFrom('support_ticket').select('id').where('id', '=', id).where('tenant_id', '=', tenantId).where('created_by', '=', actor.id).executeTakeFirst();
    if (!t) throw notFound('Request');
  }

  // ---------------------------------------------------------------- talking

  private async say(tenantId: string, ticketId: string, who: { userId: string | null; name: string }, input: z.output<typeof SupportReplyInput>) {
    if (!input.body.trim() && !input.attachments.length) throw badRequest('Write a message or attach a file.');
    const t = await this.ctx.db.selectFrom('support_ticket').select(['id', 'number', 'subject', 'status', 'stage', 'resolved_at', 'assignee_id', 'audience']).where('id', '=', ticketId).where('tenant_id', '=', tenantId).executeTakeFirst();
    if (!t) throw notFound('Request');
    const desk = await this.support.deskOf(tenantId);
    const st = stageOf(desk.stages, t);
    if (st.kind === 'done' && t.resolved_at && this.ctx.now().getTime() - t.resolved_at.getTime() > 30 * 86_400_000) throw badRequest('This request was closed a while ago. Please send a new one.');
    const now = this.ctx.now();
    // Writing back to something finished opens it again, at the first stage that is being worked.
    const reopen: SupportStage | null = st.kind === 'done' && t.audience === 'organisation' ? (desk.stages.find((s) => s.kind === 'active') ?? desk.stages[0]!) : null;
    await this.ctx.db.transaction().execute(async (tx) => {
      const files = await this.support.attach(tx, tenantId, ticketId, input.attachments);
      await tx.insertInto('support_message').values({ id: uuidv7(), ticket_id: ticketId, author_id: who.userId, author_name: who.name, author_kind: 'requester', body: input.body, attachments: JSON.stringify(files), created_at: now }).execute();
      if (reopen) await tx.insertInto('support_message').values({ id: uuidv7(), ticket_id: ticketId, author_id: null, author_kind: 'system', body: `Stage changed to ${reopen.label}`, created_at: now }).execute();
      await tx.updateTable('support_ticket').set({ updated_at: now, ...(reopen && { stage: reopen.key, status: statusOfStage(reopen), resolved_at: null }) }).where('id', '=', ticketId).execute();
    });
    await this.support.notifyHandlers(tenantId, `Re: [#${t.number}] ${t.subject}`, `${who.name} wrote${reopen ? ' (this reopens it)' : ''}:\n\n${input.body || '(a file)'}\n\n${this.ctx.workspaceUrl}/o/${tenantId}/support/${ticketId}`, who.userId, t.assignee_id);
  }

  async replyByToken(token: string, input: z.output<typeof SupportReplyInput>, ip: string): Promise<SupportThreadDto> {
    const t = readSupportToken(this.ctx.secretsKey, token);
    if (!t) throw notFound('Request');
    if (!this.limiter.allow(`say|${t.itemId}`, 60, 3_600_000)) throw new HttpError(429, 'You are sending messages too quickly.');
    if (!this.limiter.allow(`all|${ip}`, 120, 60_000)) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
    const row = await this.ctx.db.selectFrom('support_ticket').select('requester_name').where('id', '=', t.itemId).executeTakeFirst();
    await this.say(t.tenantId, t.itemId, { userId: null, name: row?.requester_name ?? 'Requester' }, input);
    return this.threadOf(t.tenantId, t.itemId);
  }

  async replyFor(actor: Actor, tenantId: string, id: string, input: z.output<typeof SupportReplyInput>): Promise<SupportThreadDto> {
    await this.own(actor, tenantId, id);
    if (!this.limiter.allow(`say|${id}`, 60, 3_600_000)) throw new HttpError(429, 'You are sending messages too quickly.');
    const u = await this.ctx.db.selectFrom('user_identity').select(['display_name', 'email']).where('id', '=', actor.id).executeTakeFirst();
    await this.say(tenantId, id, { userId: actor.id, name: u?.display_name || u?.email || 'Someone' }, input);
    return this.threadOf(tenantId, id);
  }
}

void SUPPORT_ATTACHMENT_MAX_BYTES;
