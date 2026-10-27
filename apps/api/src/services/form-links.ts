import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { fillState, publicDefinition, publicProblems, validate, zonedInstant } from '@grids/forms';
import { ATTACHMENT_MAX_BYTES, FormDefinition, FormSettings, uuidv7, type FormLinkInput, type FormLinkUpdate, type PublicSubmissionInput, type AttachmentDto, type CaptchaChallenge, type FormLinkDto, type PublicFormDto, type PublicPlaceDto } from '@grids/schema';
import type { z } from 'zod';
import type { UsageService } from './usage.js';
import type { PaymentService } from './payments.js';
import { badRequest, forbidden, HttpError, LimitExceededError, notFound } from '../errors.js';
import { noteView } from './activity.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { ATTACHMENT_TYPES, SubmissionInvalid, type FormService } from './forms.js';
import type { ProjectService } from './projects.js';
import { iso, isoOrNull } from './util.js';

type LinkInput = z.output<typeof FormLinkInput>;
type SubmissionIn = z.output<typeof PublicSubmissionInput>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const settingsOf = (raw: unknown) => FormSettings.parse(raw ?? {});
/** The form as a link shows it: when the link names no place, the person chooses it, so the main question stays. */
const visibleOf = (r: { def: FormDefinition; subject_type_id: string | null; type_system: boolean | null; entity_id: string | null }) =>
  publicDefinition(r.def, { keepMain: !!r.subject_type_id && !r.type_system && !r.entity_id });

/** A count per key over a sliding window, kept in memory (a restart, or a second server, starts afresh). */
export class Limiter {
  private readonly hits = new Map<string, number[]>();
  /** How many hits fell within `windowMs`. */
  count(key: string, windowMs: number, now = Date.now()): number {
    return (this.hits.get(key) ?? []).filter((t) => now - t < windowMs).length;
  }
  /** Records a hit; false when `limit` hits already fell within `windowMs`. */
  allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 20_000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < windowMs)) this.hits.delete(k);
    return true;
  }
}

const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_ATTEMPTS = 5;

const CAPTCHA_MAX = 40_000;
const CAPTCHA_LIFETIME_MS = 10 * 60_000;

/**
 * Links that let people without an account fill a form in (one shared link, and single-use invites),
 * and what happens when they do. Answers that come in this way are stored with the submissions but
 * never write to entities or indicators, and skip the approval workflow.
 */
export class FormLinkService {
  /** Set where the services are put together: the plan's allowances (storage, API calls, submissions). */
  usage?: UsageService;
  /** Set where the services are put together: payments a form can ask for. */
  payments?: PaymentService;
  private readonly limiter = new Limiter();
  private readonly spent = new Map<string, number>();

  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
    private readonly forms: FormService,
  ) {}

  // ---------- for the form's managers ----------

  private async formOf(tx: Parameters<Parameters<ProjectService['cellTx']>[1]>[0], projectId: string, key: string) {
    const f = await tx
      .selectFrom('form as f')
      .leftJoin('entity_type as t', 't.id', 'f.subject_type_id')
      .select(['f.id', 'f.name', 'f.subject_type_id', 'f.settings', 't.system as type_system'])
      .where('f.project_id', '=', projectId)
      .where('f.key', '=', key)
      .where('f.archived_at', 'is', null)
      .executeTakeFirst();
    if (!f) throw notFound('Form');
    return f;
  }

  async list(actor: Actor, tenantId: string, project: string, key: string): Promise<FormLinkDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    return this.projects.cellTx(tenantId, async (tx) => {
      const f = await this.formOf(tx, a.project.id, key);
      const rows = await tx
        .selectFrom('form_link as l')
        .leftJoin('entity as e', 'e.id', 'l.entity_id')
        .select(['l.id', 'l.kind', 'l.token', 'l.label', 'l.email', 'l.max_uses', 'l.uses', 'l.opens_at', 'l.closes_at', 'l.language', 'l.revoked_at', 'l.created_at', 'l.last_used_at', 'e.id as entity_id', 'e.code as entity_code', 'e.name as entity_name'])
        .where('l.form_id', '=', f.id)
        .orderBy('l.created_at', 'desc')
        .limit(1000)
        .execute();
      return rows.map((l) => ({
        id: l.id,
        kind: l.kind,
        path: `${tenantId}.${l.token}`,
        label: l.label,
        email: l.email,
        entity: l.entity_id ? { id: l.entity_id, code: l.entity_code!, name: l.entity_name! } : null,
        uses: l.uses,
        maxUses: l.max_uses,
        opensAt: l.opens_at,
        closesAt: l.closes_at,
        language: l.language,
        revoked: !!l.revoked_at,
        createdAt: iso(l.created_at),
        lastUsedAt: isoOrNull(l.last_used_at),
      }));
    });
  }

  /** A new shared link (replacing the one in use) or a batch of single-use invites. */
  async create(actor: Actor, tenantId: string, project: string, key: string, input: LinkInput): Promise<FormLinkDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const mails: { to: string; name: string; token: string; form: string }[] = [];
    await this.projects.cellTx(tenantId, async (tx) => {
      const f = await this.formOf(tx, a.project.id, key);
      // A form about a place needs to know which one the link is for.
      // The place is optional: a link that names none lets each person choose it on the form.
      if (f.subject_type_id && !f.type_system && input.entityId) {
        const e = await tx.selectFrom('entity').select('id').where('id', '=', input.entityId).where('project_id', '=', a.project.id).executeTakeFirst();
        if (!e) throw badRequest('That place is not in this project');
      }
      const entityId = f.subject_type_id && !f.type_system ? (input.entityId ?? null) : null;
      const zone = settingsOf(f.settings).availability.timezone;
      const own = input.kind === 'invite' ? { opens: input.opensAt, closes: input.closesAt } : { opens: null, closes: null };
      const opens = zonedInstant(own.opens, zone);
      const closes = zonedInstant(own.closes, zone);
      if ((own.opens && !opens) || (own.closes && !closes)) throw badRequest('That is not a valid date and time');
      if (opens && closes && closes <= opens) throw badRequest('The invite must close after it opens');
      const row = (kind: 'shared' | 'invite', label: string, email: string | null) => ({
        id: uuidv7(),
        tenant_id: tenantId,
        project_id: a.project.id,
        form_id: f.id,
        kind,
        token: randomBytes(24).toString('base64url'),
        label,
        email,
        entity_id: entityId,
        max_uses: kind === 'invite' ? (input.kind === 'invite' ? input.maxUses : 1) : null,
        opens_at: own.opens,
        closes_at: own.closes,
        language: input.language,
        created_by: actor.id,
      });
      if (input.kind === 'shared') {
        if (settingsOf(f.settings).publicAccess.inviteOnly) throw badRequest('This form is by invitation only: send invites instead of an open link');
        await tx.updateTable('form_link').set({ revoked_at: this.ctx.now() }).where('form_id', '=', f.id).where('kind', '=', 'shared').where('revoked_at', 'is', null).execute();
        await tx.insertInto('form_link').values(row('shared', '', null)).execute();
      } else {
        // The same person is not invited twice: a list that names someone twice counts them once, and someone who
        // already has a live invite (used or not) cannot be given another. Revoke it first to invite them again.
        const seen = new Set<string>();
        const invites = input.invites.filter((i) => {
          if (!i.email) return true;
          const k = i.email.toLowerCase();
          return seen.has(k) ? false : (seen.add(k), true);
        });
        const held = new Set((await tx.selectFrom('form_link').select('email').where('form_id', '=', f.id).where('kind', '=', 'invite').where('revoked_at', 'is', null).where('email', 'is not', null).execute()).map((r) => r.email!.toLowerCase()));
        const again = invites.filter((i) => i.email && held.has(i.email.toLowerCase())).map((i) => i.email!);
        if (again.length) throw badRequest(again.length === 1 ? `${again[0]} has already been invited` : `Already invited: ${again.join(', ')}`, 'Revoke their invite first if they need a new link.');
        const rows = invites.map((i) => row('invite', i.label, i.email));
        await tx.insertInto('form_link').values(rows).execute();
        if (input.sendEmail) mails.push(...rows.filter((r) => r.email).map((r) => ({ to: r.email!, name: r.label, token: r.token, form: f.name })));
      }
    });
    // Each person is emailed their own link.
    for (const m of mails)
      await this.ctx.email.send('form_invite', tenantId, {
        to: m.to,
        subject: `You are invited to fill in ${m.form}`,
        text: `${m.name ? `Hello ${m.name},\n\n` : ''}You have been invited to fill in "${m.form}".\n\nYour link: ${this.ctx.workspaceUrl}/f/${tenantId}.${m.token}\n\nThe link is yours alone: please do not share it.`,
      });
    await audit(this.ctx, actor.id, tenantId, 'form.link_created', { project, form: key, kind: input.kind, count: input.kind === 'invite' ? input.invites.length : 1 });
    return this.list(actor, tenantId, project, key);
  }

  /** Changes an invite: more uses (even after it was used up), or dates of its own. */
  async update(actor: Actor, tenantId: string, project: string, key: string, id: string, input: z.output<typeof FormLinkUpdate>): Promise<FormLinkDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, async (tx) => {
      const f = await this.formOf(tx, a.project.id, key);
      const l = await tx.selectFrom('form_link').select(['kind', 'uses', 'max_uses', 'opens_at', 'closes_at', 'revoked_at']).where('id', '=', id).where('form_id', '=', f.id).executeTakeFirst();
      if (!l || l.kind !== 'invite' || l.revoked_at) throw notFound('Invite');
      const maxUses = input.maxUses ?? l.max_uses ?? 1;
      // It cannot be allowed fewer uses than it has had.
      if (maxUses < l.uses) throw badRequest(`This invite has already been used ${l.uses} ${l.uses === 1 ? 'time' : 'times'}`);
      const opens = input.opensAt !== undefined ? input.opensAt : l.opens_at;
      const closes = input.closesAt !== undefined ? input.closesAt : l.closes_at;
      const zone = settingsOf(f.settings).availability.timezone;
      const [from, to] = [zonedInstant(opens, zone), zonedInstant(closes, zone)];
      if ((opens && !from) || (closes && !to)) throw badRequest('That is not a valid date and time');
      if (from && to && to <= from) throw badRequest('The invite must close after it opens');
      await tx.updateTable('form_link').set({ max_uses: maxUses, opens_at: opens, closes_at: closes }).where('id', '=', id).execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'form.link_updated', { project, form: key, link: id });
    return this.list(actor, tenantId, project, key);
  }

  async revoke(actor: Actor, tenantId: string, project: string, key: string, id: string): Promise<FormLinkDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, async (tx) => {
      const f = await this.formOf(tx, a.project.id, key);
      const r = await tx.updateTable('form_link').set({ revoked_at: this.ctx.now() }).where('id', '=', id).where('form_id', '=', f.id).where('revoked_at', 'is', null).executeTakeFirst();
      if (!r.numUpdatedRows) throw notFound('Link');
    });
    await audit(this.ctx, actor.id, tenantId, 'form.link_revoked', { project, form: key, link: id });
    return this.list(actor, tenantId, project, key);
  }

  // ---------- for anyone with a link ----------

  /** A fresh puzzle: its answer is not in the reply, and only this server can have signed it. */
  captcha(): CaptchaChallenge {
    const salt = `${randomBytes(8).toString('hex')}.${Date.now() + CAPTCHA_LIFETIME_MS}`;
    const challenge = sha(`${salt}${randomInt(0, CAPTCHA_MAX + 1)}`);
    return { salt, challenge, signature: this.sign(salt, challenge), maxNumber: CAPTCHA_MAX };
  }

  private sign(salt: string, challenge: string) {
    return createHmac('sha256', this.ctx.secretsKey).update(`${salt}:${challenge}`).digest('hex');
  }

  /** Checks a solved puzzle from anyone without an account; each one works once. Throws when it does not pass. */
  verifyCaptcha(c: NonNullable<SubmissionIn['captcha']>) {
    this.checkCaptcha(c);
  }

  private checkCaptcha(c: NonNullable<SubmissionIn['captcha']>) {
    const bad = () => new HttpError(400, 'The check did not pass. Reload the page and try again.');
    const want = Buffer.from(this.sign(c.salt, c.challenge));
    const got = Buffer.from(c.signature);
    if (want.length !== got.length || !timingSafeEqual(want, got)) throw bad();
    const expires = Number(c.salt.split('.')[1]);
    if (!Number.isFinite(expires) || expires < Date.now()) throw bad();
    if (c.number < 0 || c.number > CAPTCHA_MAX || sha(`${c.salt}${c.number}`) !== c.challenge) throw bad();
    // Each solved puzzle works once.
    if (this.spent.has(c.challenge)) throw bad();
    this.spent.set(c.challenge, expires);
    if (this.spent.size > 10_000) for (const [k, t] of this.spent) if (t < Date.now()) this.spent.delete(k);
  }

  /** Runs in the tenant's data; a link naming a tenant that does not exist reads like any other dead link. */
  private async inCell<T>(tenantId: string, fn: (tx: Parameters<Parameters<ProjectService['cellTx']>[1]>[0]) => Promise<T>): Promise<T> {
    try {
      // Every public request counts against the organisation's API allowance.
      await this.usage?.recordApiCall(tenantId);
      return await this.projects.cellTx(tenantId, fn);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('No placement for tenant')) throw notFound('Form');
      throw e;
    }
  }

  private parse(path: string) {
    const [tenantId, token] = path.split('.');
    if (!tenantId || !token || !UUID.test(tenantId) || !TOKEN.test(token)) throw notFound('Form');
    return { tenantId, token };
  }

  /** Looks the link up; every way it can be unusable reads the same to the caller. */
  private async resolve(tx: Parameters<Parameters<ProjectService['cellTx']>[1]>[0], token: string) {
    const r = await tx
      .selectFrom('form_link as l')
      .innerJoin('form as f', 'f.id', 'l.form_id')
      .innerJoin('project as p', 'p.id', 'f.project_id')
      .leftJoin('form_version as v', (j) => j.onRef('v.form_id', '=', 'f.id').onRef('v.version', '=', 'f.current_version'))
      .leftJoin('entity_type as t', 't.id', 'f.subject_type_id')
      .select(['l.id as link_id', 'l.kind', 'l.label as link_label', 'l.email as link_email', 'l.entity_id', 'l.max_uses', 'l.uses', 'l.opens_at', 'l.closes_at', 'l.language as link_language', 'l.revoked_at', 'f.id as form_id', 'f.key', 'f.name', 'f.settings', 'f.current_version', 'f.subject_type_id', 'f.archived_at', 'p.id as project_id', 'p.key as project_key', 'p.name as project_name', 'p.archived_at as project_archived', 't.system as type_system', 't.key as type_key', 'v.definition'])
      .where('l.token', '=', token)
      .executeTakeFirst();
    if (!r || r.revoked_at || r.archived_at || r.project_archived || r.current_version === null || !r.definition) throw notFound('Form');
    const own = settingsOf(r.settings);
    // An invite with dates of its own, or more than one use, is let in on those: the form's dates and total limit do not apply.
    const custom = r.kind === 'invite' && (!!r.opens_at || !!r.closes_at || (r.max_uses ?? 1) > 1);
    const settings = custom ? { ...own, availability: { ...own.availability, opensAt: r.opens_at, closesAt: r.closes_at }, limits: { ...own.limits, maxSubmissions: null } } : own;
    // An open link needs the form to be publicly available and not by invitation only (a form by invitation only has no
    // open link, whatever was made earlier). An invite works whenever the form is public or by invitation only.
    const pa = settings.publicAccess;
    if (r.kind === 'shared' ? !pa.enabled || pa.inviteOnly : !(pa.enabled || pa.inviteOnly)) throw notFound('Form');
    const def = FormDefinition.parse(r.definition);
    if (publicProblems(def).length) throw notFound('Form');
    return { ...r, settings, def, version: r.current_version };
  }

  private async total(tx: Parameters<Parameters<ProjectService['cellTx']>[1]>[0], formId: string) {
    return Number((await tx.selectFrom('submission').select((e) => e.fn.countAll<string>().as('n')).where('form_id', '=', formId).executeTakeFirstOrThrow()).n);
  }

  async preview(path: string): Promise<PublicFormDto> {
    const { tenantId, token } = this.parse(path);
    return this.inCell(tenantId, async (tx) => {
      const r = await this.resolve(tx, token);
      noteView(this.ctx, null, tenantId, 'public.form_viewed', { project: r.project_key, form: r.key, link: r.kind, ...(r.link_label && { label: r.link_label }) });
      const state = fillState(r.settings, this.ctx.now(), { total: await this.total(tx, r.form_id), mine: 0 });
      const used = r.max_uses !== null && r.uses >= r.max_uses;
      const pay = r.settings.payment;
      const payment = pay.enabled && pay.amount > 0 && (await this.payments?.available(tenantId)) ? { amount: pay.amount, currency: pay.currency, description: pay.description || r.name } : null;
      return {
        payment,
        name: r.name,
        projectName: r.project_name,
        kind: r.kind,
        version: r.version,
        definition: visibleOf(r),
        language: r.link_language,
        availability: used ? { state: 'limit' as const, message: 'This link has already been used.' } : { state: state.state, message: state.message },
        // An invite already knows who it is for: nothing to ask, nothing to confirm.
        askName: r.kind === 'invite' ? false : r.settings.publicAccess.askName,
        verifyEmail: r.kind === 'invite' ? false : r.settings.publicAccess.verifyEmail,
        captcha: r.settings.publicAccess.captcha,
      };
    });
  }

  /** The places an entity question of a public form offers: of its type, narrowed the way the question says. */
  async places(path: string, questionKey: string, of: string | null, ip: string): Promise<PublicPlaceDto[]> {
    const { tenantId, token } = this.parse(path);
    if (!this.limiter.allow(`all|${ip}`, 60, 60_000)) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
    return this.inCell(tenantId, async (tx) => {
      const r = await this.resolve(tx, token);
      const q = visibleOf(r).sections.flatMap((x) => x.questions).find((x) => x.key === questionKey && x.type === 'entity');
      if (!q?.entityType) throw notFound('Question');
      let qb = tx
        .selectFrom('entity as e')
        .innerJoin('entity_type as t', 't.id', 'e.type_id')
        .leftJoin('entity as pe', 'pe.id', 'e.parent_id')
        .select(['e.id', 'e.code', 'e.name', 'pe.name as parent_name'])
        .where('t.key', '=', q.entityType)
        .where(sql<boolean>`(e.project_id = ${r.project_id} or e.project_id is null)`);
      if (q.filter) {
        // Narrowed by the place the link is for, or by the answer to another question.
        const base = q.filter.of === '$subject' ? r.entity_id : of;
        if (!base) return [];
        const there = await tx.selectFrom('entity').select('id').where('id', '=', base).where(sql<boolean>`(project_id = ${r.project_id} or project_id is null)`).executeTakeFirst();
        if (!there) return [];
        const rel = q.filter.relation;
        qb = qb.where(
          rel === 'children'
            ? sql<boolean>`e.parent_id = ${base}`
            : rel === 'descendants'
              ? sql<boolean>`e.path <@ (select path from entity where id = ${base}) and e.id <> ${base}`
              : rel === 'parent'
                ? sql<boolean>`e.id = (select parent_id from entity where id = ${base})`
                : sql<boolean>`e.path @> (select path from entity where id = ${base}) and e.id <> ${base}`,
        );
      }
      const rows = await qb.orderBy('e.name').limit(200).execute();
      return rows.map((e) => ({ id: e.id, code: e.code, name: e.name, parent: e.parent_name }));
    });
  }

  /** A picture, signature or document attached while filling the form in through a link. */
  async uploadAttachment(path: string, file: { name: string; contentType: string; content: Buffer }, ip: string): Promise<AttachmentDto> {
    const { tenantId, token } = this.parse(path);
    if (!this.limiter.allow(`all|${ip}`, 60, 60_000)) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
    if (!ATTACHMENT_TYPES.test(file.contentType)) throw badRequest('Only pictures (JPEG, PNG, WebP, GIF), PDF, Word, Excel, PowerPoint, CSV or text files can be attached');
    if (file.content.length > ATTACHMENT_MAX_BYTES) throw badRequest('That file is larger than 10 MB');
    await this.usage?.assertStorage(tenantId, file.content.length).catch((e) => {
      if (e instanceof LimitExceededError) throw new HttpError(403, 'This form isn’t taking files at the moment. Please try again later.');
      throw e;
    });
    return this.inCell(tenantId, async (tx) => {
      const r = await this.resolve(tx, token);
      if (!visibleOf(r).sections.some((s) => s.questions.some((q) => ['image', 'file', 'signature'].includes(q.type)))) throw forbidden('This form does not take files.');
      if (!this.limiter.allow(`up|${r.form_id}|${ip}`, 30, 3_600_000)) throw new HttpError(429, 'You have sent too many files. Try again later.');
      const state = fillState(r.settings, this.ctx.now(), { total: await this.total(tx, r.form_id), mine: 0 });
      if (state.state !== 'open') throw new HttpError(403, state.message ?? 'This form is not open.');
      const id = uuidv7();
      const name = file.name.replace(/[/\\]/g, '').replace(/\p{Cc}/gu, '').slice(0, 200) || 'file';
      await tx.insertInto('form_attachment').values({ id, tenant_id: tenantId, project_id: r.project_id, form_key: r.key, name, content_type: file.contentType, size: file.content.length, content: file.content, uploaded_by: null }).execute();
      return { id, name, contentType: file.contentType, size: file.content.length };
    });
  }

  /** Something uploaded through this form's links, so the page can show it back. */
  async attachment(path: string, id: string): Promise<{ name: string; contentType: string; content: Buffer }> {
    const { tenantId, token } = this.parse(path);
    if (!UUID.test(id)) throw notFound('File');
    return this.inCell(tenantId, async (tx) => {
      const r = await this.resolve(tx, token);
      const f = await tx.selectFrom('form_attachment').select(['name', 'content_type', 'content']).where('id', '=', id).where('project_id', '=', r.project_id).where('form_key', '=', r.key).where('uploaded_by', 'is', null).executeTakeFirst();
      if (!f) throw notFound('File');
      return { name: f.name, contentType: f.content_type, content: f.content };
    });
  }

  private hashCode(id: string, code: string) {
    return createHmac('sha256', this.ctx.secretsKey).update(`code:${id}:${code}`).digest('hex');
  }

  /** Emails a one-time code to someone who is about to fill a form in, so their address can be confirmed. */
  async sendEmailCode(path: string, rawEmail: string, ip: string): Promise<{ expiresInMinutes: number }> {
    const { tenantId, token } = this.parse(path);
    if (!this.limiter.allow(`all|${ip}`, 60, 60_000)) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
    const email = rawEmail.trim().toLowerCase();
    await this.inCell(tenantId, async (tx) => {
      const r = await this.resolve(tx, token);
      if (r.kind === 'invite' || !r.settings.publicAccess.verifyEmail) throw badRequest('This form does not check email addresses');
      const state = fillState(r.settings, this.ctx.now(), { total: await this.total(tx, r.form_id), mine: 0 });
      if (state.state !== 'open') throw new HttpError(403, state.message ?? 'This form is not open.');
      if (!this.limiter.allow(`code|${r.form_id}|${ip}`, 10, 3_600_000)) throw new HttpError(429, 'Too many codes asked for. Try again later.');
      if (!this.limiter.allow(`code-to|${r.form_id}|${email}`, 5, 3_600_000)) throw new HttpError(429, 'Too many codes sent to this address. Try again later.');
      const now = this.ctx.now();
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const id = uuidv7();
      // A new code replaces any earlier one for this address.
      await tx.updateTable('form_email_code').set({ used_at: now }).where('form_id', '=', r.form_id).where('email', '=', email).where('used_at', 'is', null).execute();
      await tx.insertInto('form_email_code').values({ id, tenant_id: tenantId, form_id: r.form_id, email, code_hash: this.hashCode(id, code), expires_at: new Date(now.getTime() + CODE_TTL_MS) }).execute();
      const sent = await this.ctx.email.send('form_public_verify', tenantId, {
        to: email,
        subject: `Your code for ${r.name}: ${code}`,
        text: `Your code is ${code}\n\nEnter it on the form to confirm this email address. It works once and expires in ${CODE_TTL_MS / 60_000} minutes.\n\nIf you did not ask for it, you can ignore this message.`,
      });
      if (!sent) throw new HttpError(502, 'The code could not be emailed. Try again in a moment.');
    });
    return { expiresInMinutes: CODE_TTL_MS / 60_000 };
  }

  /**
   * Checks the code emailed to an address and spends it, in the same transaction as the submission: if the
   * submission is refused, the code is not used up. Wrong guesses are counted outside that transaction, so
   * they stay counted.
   */
  private async useEmailCode(tenantId: string, tx: Parameters<Parameters<ProjectService['cellTx']>[1]>[0], formId: string, email: string, code: string) {
    const bad = () => new HttpError(400, 'That code is not right, or it has expired. Ask for a new one.');
    const now = this.ctx.now();
    const row = await tx.selectFrom('form_email_code').selectAll().where('form_id', '=', formId).where('email', '=', email).where('used_at', 'is', null).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    if (!row || row.expires_at < now || row.attempts >= CODE_MAX_ATTEMPTS) throw bad();
    if (!timingSafeEqual(Buffer.from(this.hashCode(row.id, code)), Buffer.from(row.code_hash))) {
      await this.projects.cellTx(tenantId, (other) => other.updateTable('form_email_code').set({ attempts: sql`attempts + 1` }).where('id', '=', row.id).execute());
      throw bad();
    }
    const spent = await tx.updateTable('form_email_code').set({ used_at: now }).where('id', '=', row.id).where('used_at', 'is', null).executeTakeFirst();
    if (!spent.numUpdatedRows) throw bad();
  }

  async submit(path: string, input: SubmissionIn, ip: string): Promise<{ message: string }> {
    try {
      return await this.saveSubmission(path, input, ip);
    } catch (e) {
      // The organisation's plan has no room left: the person filling the form is not told about plans.
      if (e instanceof LimitExceededError) throw new HttpError(403, 'This form isn’t taking responses at the moment. Please try again later.');
      throw e;
    }
  }

  private async saveSubmission(path: string, input: SubmissionIn, ip: string): Promise<{ message: string }> {
    const { tenantId, token } = this.parse(path);
    // Whatever the form allows, one address cannot hammer the server.
    if (!this.limiter.allow(`all|${ip}`, 60, 60_000)) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
    return this.inCell(tenantId, async (tx) => {
      const r = await this.resolve(tx, token);
      const pa = r.settings.publicAccess;
      if (!this.limiter.allow(`form|${r.form_id}|${ip}`, pa.perIpPerHour, 3_600_000)) throw new HttpError(429, 'You have sent this form too many times. Try again later.');
      if (pa.captcha) {
        if (!input.captcha) throw new HttpError(400, 'The check did not pass. Reload the page and try again.');
        this.checkCaptcha(input.captcha);
      }
      const done = await tx.selectFrom('submission').select(['id', 'form_id']).where('id', '=', input.id).executeTakeFirst();
      if (done) {
        if (done.form_id !== r.form_id) throw badRequest('Submission id in use');
        return { message: r.def.thankYou }; // a retry of something already saved
      }
      if (input.version !== r.version) throw new HttpError(409, 'The form was updated. Reload the page to continue.');
      // A form that checks addresses wants the code that was emailed to the one given.
      let verifiedEmail: string | null = null;
      if (pa.verifyEmail && r.kind !== 'invite') {
        if (!input.emailCode) throw new HttpError(400, 'Enter your email address and the code we sent you.');
        verifiedEmail = input.emailCode.email.trim().toLowerCase();
        await this.useEmailCode(tenantId, tx, r.form_id, verifiedEmail, input.emailCode.code);
      }
      const state = fillState(r.settings, this.ctx.now(), { total: await this.total(tx, r.form_id), mine: 0 });
      if (state.state !== 'open') throw new HttpError(403, state.message ?? 'This form is not open.');
      // A form that asks for a fee is only taken once the fee has been paid.
      const fee = r.settings.payment;
      const paymentId = fee.enabled && fee.amount > 0 ? input.paymentId ?? null : null;
      if (fee.enabled && fee.amount > 0 && this.payments) await this.payments.requirePaid(tenantId, paymentId, { project: r.project_key, form: r.key, amount: fee.amount });
      // An invite works once: the claim is atomic, so two sends at once cannot both get in.
      const claimed = await tx
        .updateTable('form_link')
        .set({ uses: sql`uses + 1`, last_used_at: this.ctx.now() })
        .where('id', '=', r.link_id)
        .where('revoked_at', 'is', null)
        .where(sql<boolean>`(max_uses is null or uses < max_uses)`)
        .executeTakeFirst();
      if (!claimed.numUpdatedRows) throw new HttpError(403, 'This link has already been used.');

      // The place the form is about is the one the link was made for.
      let entityId: string | null = null;
      let subject: { id: string; code: string; name: string; path: string } | undefined;
      if (r.subject_type_id) {
        const cols = ['id', 'code', 'name', sql<string>`path::text`.as('path')] as const;
        let e = r.type_system
          ? await tx.selectFrom('entity').select(cols).where('type_id', '=', r.subject_type_id).where('project_id', '=', r.project_id).executeTakeFirst()
          : r.entity_id
            ? await tx.selectFrom('entity').select(cols).where('id', '=', r.entity_id).executeTakeFirst()
            : undefined;
        if (!r.type_system && !r.entity_id) {
          // The link names no place: the person chose it in the form's main question.
          const asked = r.def.sections.flatMap((x) => x.questions).find((q) => q.primary);
          const picked = asked ? input.answers[asked.key] : undefined;
          e = typeof picked === 'string' && UUID.test(picked) ? await tx.selectFrom('entity').select(cols).where('id', '=', picked).where(sql<boolean>`(project_id = ${r.project_id} or project_id is null)`).executeTakeFirst() : undefined;
          if (!e) throw new SubmissionInvalid({ [asked?.key ?? 'place']: 'Choose one' });
        }
        if (!e) throw forbidden('This link is no longer valid.');
        entityId = e.id;
        subject = { ...e, path: r.type_system ? '' : e.path };
      }
      const visible = visibleOf(r);
      const result = validate(visible, input.answers);
      if (!result.ok) throw new SubmissionInvalid(result.errors);
      // The places must be ones the form offers, and the files ones people sent through this form's links.
      await this.forms.checkReferences(tx, { roots: null, project: { id: r.project_id } }, visible, result.all, subject);
      const files = [
        ...new Set(
          visible.sections.flatMap((sec) => {
            const rows = sec.repeat ? (Array.isArray(result.all[sec.key]) ? (result.all[sec.key] as Record<string, unknown>[]) : []) : [result.all];
            return rows.flatMap((row) =>
              sec.questions
                .filter((q) => ['image', 'file', 'signature'].includes(q.type))
                // A picture the form's author set as the question's fixed value (a hidden signature) is theirs, not the visitor's.
                .flatMap((q) => (Array.isArray(row[q.key]) ? (row[q.key] as unknown[]) : [row[q.key]]).filter((x): x is string => typeof x === 'string' && !(q.hidden && x === q.defaultValue))),
            );
          }),
        ),
      ];
      if (files.length) {
        const mine = await tx.selectFrom('form_attachment').select('id').where('project_id', '=', r.project_id).where('form_key', '=', r.key).where('uploaded_by', 'is', null).where('id', 'in', files).execute();
        if (mine.length !== files.length) throw badRequest('A file was not sent through this form. Add it again.');
      }
      const answers = { ...result.clean };
      const main = r.def.sections.flatMap((s) => s.questions).find((q) => q.primary);
      if (main && entityId) answers[main.key] = entityId;
      const collectedAt = new Date(input.collectedAt);
      const now = this.ctx.now();
      // Stored and routed exactly like a signed-in person's: the workflow, and what is saved to entities and indicators.
      await this.forms.storeSubmission(tx, {
        tenantId,
        projectId: r.project_id,
        form: { id: r.form_id, key: r.key, name: r.name, typeKey: r.type_key },
        def: r.def,
        settings: r.settings,
        entity: subject,
        version: r.version,
        answers,
        checked: { ...result.all, ...(main && entityId ? { [main.key]: entityId } : {}) },
        collectedAt: collectedAt > now ? now : collectedAt,
        submissionId: input.id,
        submittedBy: null,
        location: null,
        link: { id: r.link_id, submitter: r.kind === 'invite' ? r.link_email || r.link_label || null : pa.verifyEmail ? verifiedEmail : pa.askName ? input.submitter : null },
      });
      // The payment belongs to this submission alone (if this fails, the whole submission is rolled back).
      if (paymentId && this.payments) await this.payments.claim(tenantId, paymentId, input.id);
      return { message: r.def.thankYou };
    });
  }

  /** Starts the payment a form asks for: sends back where the person goes to pay. */
  async startPayment(path: string, input: { returnUrl: string; email?: string }, ip: string) {
    const { tenantId, token } = this.parse(path);
    if (!this.limiter.allow(`pay|${ip}`, 20, 60_000)) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
    if (!this.payments) throw forbidden('Payments are not available.');
    const r = await this.inCell(tenantId, (tx) => this.resolve(tx, token));
    const fee = r.settings.payment;
    if (!fee.enabled || fee.amount <= 0) throw badRequest('This form does not ask for a payment.');
    return this.payments.start(tenantId, { project: r.project_key, form: r.key, amount: fee.amount, currency: fee.currency, description: fee.description || r.name, merchantId: fee.merchantId }, input);
  }

  async paymentState(path: string, paymentId: string) {
    const { tenantId } = this.parse(path);
    return { status: await this.payments!.stateOf(tenantId, paymentId) };
  }

  /** The receipt of a payment that went through, for the person who paid. */
  async paymentReceipt(path: string, paymentId: string) {
    const { tenantId } = this.parse(path);
    if (!this.payments) throw forbidden('Payments are not available.');
    return this.payments.publicReceipt(tenantId, paymentId);
  }
}
