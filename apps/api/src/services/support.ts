import { requireFeature } from './features.js';
import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { sql } from 'kysely';
import {
  DEFAULT_SUPPORT_STAGES,
  HelpDeskConfig,
  stageOf,
  statusOfStage,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  uuidv7,
  type CreateTicketInput,
  type HelpDeskConfigInput,
  type OrgTicketUpdate,
  type Page,
  type ReplyInput,
  type SupportAttachmentDto,
  type SupportStage,
  type TicketDetail,
  type TicketListQuery,
  type TicketMessage,
  type LinkedTicket,
  type TicketLinkInput,
  type TicketLinks,
  type SupportSiteCheck,
  type TicketStats,
  type TicketSummary,
  type UpdateTicketInput,
} from '@grids/schema';
import { badRequest, forbidden, notFound } from '../errors.js';
import { can, requireStaff, requireTenantAccess } from './authz.js';
import { workspacePolicy } from './policy.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { ATTACHMENT_TYPES } from './forms.js';
import { supportToken } from './support-token.js';
import { setAgentTyping, visitorTyping } from './typing.js';
import { iso, mapPage, paginate } from './util.js';

type NewTicket = Required<Pick<CreateTicketInput, 'subject' | 'body'>> & {
  category: NonNullable<CreateTicketInput['category']>;
  priority: NonNullable<CreateTicketInput['priority']>;
  audience?: 'organisation' | 'platform';
  page?: string;
  attachments?: string[];
};

const cleanName = (name: string) => [...name].filter((ch) => ch >= ' ' && ch !== '/' && ch !== '\\').join('').slice(0, 200) || 'file';

/**
 * Support desk. Organisation members raise and reply to tickets for their own organisation, and so can people using
 * the organisation's pages (with or without an account). The organisation's team works its tickets through its own
 * stages: assigning, labelling, noting internally and replying; it can pass one on to the Grids team. Staff (by
 * permission) see every ticket sent to them, triage, assign and add internal notes that customers never see.
 */
export class SupportService {
  constructor(private readonly ctx: ServiceContext) {}

  // ---------------------------------------------------------------- the organisation's help desk settings

  /** The organisation's stages, labels and how it takes requests (the starting set until it changes them). */
  async deskOf(tenantId: string): Promise<HelpDeskConfig> {
    const row = await this.ctx.db.selectFrom('support_desk').select('config').where('tenant_id', '=', tenantId).executeTakeFirst();
    return HelpDeskConfig.parse(row?.config ?? {});
  }

  async desk(actor: Actor, tenantId: string): Promise<HelpDeskConfig> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'support.view', workspace: 'support.view' });
    return this.deskOf(tenantId);
  }

  async saveDesk(actor: Actor, tenantId: string, input: HelpDeskConfigInput): Promise<HelpDeskConfig> {
    const policy = await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'support.triage', workspace: 'support.manage' });
    if (policy) await requireFeature(this.ctx.db, tenantId, 'help_desk', 'The help desk');
    const existing = await this.deskOf(tenantId);
    // Each website's id and key are the server's to make and change (see rotateEmbedKey), not something a form can set.
    const old = new Map(existing.embedSites.map((e) => [e.id, e]));
    const parsed = HelpDeskConfig.parse(input);
    const config = HelpDeskConfig.parse({
      ...parsed,
      embedSites: parsed.embedSites.map((e) => {
        const was = e.id ? old.get(e.id) : undefined;
        return { ...e, id: was ? was.id : randomBytes(6).toString('base64url'), key: was ? was.key : randomBytes(18).toString('base64url'), secretVersion: was ? was.secretVersion : 1 };
      }),
    });
    if (new Set(config.embedSites.map((e) => e.host)).size !== config.embedSites.length) throw badRequest('Each website can be added once');
    // A stage or label that tickets still use cannot be taken away.
    const kept = config.stages.map((s) => s.key);
    const used = await this.ctx.db.selectFrom('support_ticket').select('stage').distinct().where('tenant_id', '=', tenantId).where('audience', '=', 'organisation').where('stage', 'is not', null).where('stage', 'not in', kept).execute();
    if (used.length) throw badRequest(`Tickets are still in ${used.map((u) => u.stage).join(', ')}. Move them first, then take that stage away.`);
    await this.ctx.db
      .insertInto('support_desk')
      .values({ tenant_id: tenantId, config: JSON.stringify(config), updated_at: this.ctx.now() })
      .onConflict((oc) => oc.column('tenant_id').doUpdateSet({ config: JSON.stringify(config), updated_at: this.ctx.now() }))
      .execute();
    await audit(this.ctx, actor.id, tenantId, 'support.desk_saved', { enabled: config.enabled, stages: config.stages.length });
    return config;
  }

  /** Looks a website up in DNS (nothing is fetched from the site itself), so a made-up or mistyped name is caught before it is saved. */
  async checkSite(actor: Actor, tenantId: string, rawHost: string): Promise<SupportSiteCheck> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'support.triage', workspace: 'support.manage' });
    const host = rawHost.trim().toLowerCase();
    const wild = host.startsWith('*.');
    const name = host.replace(/^\*\./, '').replace(/:\d+$/, '');
    const empty = { host, name, resolves: false, addresses: [] as string[], cname: [] as string[], nameservers: [] as string[], mail: false, wildcard: null as boolean | null };
    if (name === 'localhost' || isIP(name)) return { ...empty, kind: 'local', resolves: true, addresses: isIP(name) ? [name] : ['127.0.0.1'] };
    const r = new Resolver({ timeout: 2500, tries: 1 });
    const got = async <T>(f: () => Promise<T[]>): Promise<T[]> => f().catch(() => []);
    const [a, aaaa, cname, ns, mx] = await Promise.all([got(() => r.resolve4(name)), got(() => r.resolve6(name)), got(() => r.resolveCname(name)), got(() => r.resolveNs(name)), got(() => r.resolveMx(name))]);
    const wildcard = wild ? (await got(() => r.resolve4(`grids-probe-${randomBytes(4).toString('hex')}.${name}`))).length > 0 : null;
    return { ...empty, kind: 'domain', resolves: a.length + aaaa.length + cname.length > 0, addresses: [...a, ...aaaa].slice(0, 6), cname: cname.slice(0, 3), nameservers: ns.slice(0, 6), mail: mx.length > 0, wildcard };
  }

  /** Renews a website's secret: tokens its server signed with the old one stop working. */
  async rotateEmbedSecret(actor: Actor, tenantId: string, siteId: string): Promise<HelpDeskConfig> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'support.triage', workspace: 'support.manage' });
    const was = await this.deskOf(tenantId);
    if (!was.embedSites.some((e) => e.id === siteId)) throw notFound('Website');
    const config = { ...was, embedSites: was.embedSites.map((e) => (e.id === siteId ? { ...e, secretVersion: e.secretVersion + 1 } : e)) };
    await this.writeDesk(tenantId, config);
    await audit(this.ctx, actor.id, tenantId, 'support.embed_secret_rotated', { site: was.embedSites.find((e) => e.id === siteId)?.host });
    return config;
  }

  /** Switches one website off (no person involved): used when it floods the help desk. */
  async pauseEmbedSite(tenantId: string, siteId: string, why: string): Promise<void> {
    const was = await this.deskOf(tenantId);
    const site = was.embedSites.find((e) => e.id === siteId);
    if (!site || site.paused) return;
    await this.writeDesk(tenantId, { ...was, embedSites: was.embedSites.map((e) => (e.id === siteId ? { ...e, paused: true } : e)) });
    await audit(this.ctx, null, tenantId, 'support.embed_site_paused', { site: site.host, why });
    await this.notifyHandlers(tenantId, `Help window paused on ${site.host}`, `${why}\n\nThe help window is switched off on ${site.host} until you switch it on again in Settings → Help desk → Website embed.\n\n${this.ctx.workspaceUrl}/o/${tenantId}/helpdesk`, null);
  }

  private async writeDesk(tenantId: string, config: HelpDeskConfig) {
    await this.ctx.db
      .insertInto('support_desk')
      .values({ tenant_id: tenantId, config: JSON.stringify(config), updated_at: this.ctx.now() })
      .onConflict((oc) => oc.column('tenant_id').doUpdateSet({ config: JSON.stringify(config), updated_at: this.ctx.now() }))
      .execute();
  }

  /** Makes a new key for one website: every copy of its snippet with the old key stops working. */
  async rotateEmbedKey(actor: Actor, tenantId: string, siteId: string): Promise<HelpDeskConfig> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'support.triage', workspace: 'support.manage' });
    const was = await this.deskOf(tenantId);
    if (!was.embedSites.some((e) => e.id === siteId)) throw notFound('Website');
    const config = { ...was, embedSites: was.embedSites.map((e) => (e.id === siteId ? { ...e, key: randomBytes(18).toString('base64url') } : e)) };
    await this.ctx.db
      .insertInto('support_desk')
      .values({ tenant_id: tenantId, config: JSON.stringify(config), updated_at: this.ctx.now() })
      .onConflict((oc) => oc.column('tenant_id').doUpdateSet({ config: JSON.stringify(config), updated_at: this.ctx.now() }))
      .execute();
    await audit(this.ctx, actor.id, tenantId, 'support.embed_key_rotated', { site: was.embedSites.find((e) => e.id === siteId)?.host });
    return config;
  }

  /** The people a ticket can be given to: the organisation's active members. */
  async handlers(actor: Actor, tenantId: string): Promise<{ id: string; name: string; email: string | null }[]> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'support.view', workspace: 'support.view' });
    const rows = await this.ctx.db
      .selectFrom('membership as m')
      .innerJoin('user_identity as u', 'u.id', 'm.user_id')
      .select(['u.id', 'u.display_name', 'u.email'])
      .where('m.tenant_id', '=', tenantId)
      .where('m.status', '=', 'active')
      .orderBy('u.display_name')
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.display_name ?? r.email ?? 'Member', email: r.email }));
  }

  // ---------------------------------------------------------------- reading

  async list(actor: Actor, query: Partial<TicketListQuery> = {}): Promise<Page<TicketSummary>> {
    if (!can(actor, 'support.view')) {
      if (!query.tenantId) throw badRequest('tenantId is required');
      await requireTenantAccess(this.ctx, actor, query.tenantId, {
        staff: 'support.view',
        workspace: 'support.view',
      });
    }
    let q = this.summaryQuery().orderBy('st.updated_at', 'desc');
    // Organisation-internal tickets stay inside the organisation.
    const member = query.tenantId ? await workspacePolicy(this.ctx, actor, query.tenantId) : null;
    if (!member) q = q.where('st.audience', '=', 'platform');
    // The organisation's own tickets are read by its support team, and by the person who raised them.
    else if (!member.has('support.manage') && !can(actor, 'support.view')) q = q.where((eb) => eb.or([eb('st.audience', '<>', 'organisation'), eb('st.created_by', '=', actor.id)]));
    if (query.audience) q = q.where('st.audience', '=', query.audience);
    if (query.tenantId) q = q.where('st.tenant_id', '=', query.tenantId);
    if (query.status === 'active') q = q.where('st.status', 'in', ['open', 'pending']);
    else if (query.status) q = q.where('st.status', '=', query.status);
    const many = (v?: string) => (v ? v.split(',').filter(Boolean) : []);
    const pri = many(query.priority);
    if (pri.length) q = q.where('st.priority', 'in', pri as TicketSummary['priority'][]);
    const who = many(query.assignee);
    if (who.length) {
      const ids = who.filter((x) => x !== 'me' && x !== 'none');
      if (who.includes('me')) ids.push(actor.id);
      q = q.where((eb) => eb.or([...(ids.length ? [eb('st.assignee_id', 'in', ids)] : []), ...(who.includes('none') ? [eb('st.assignee_id', 'is', null)] : [])]));
    }
    const lab = many(query.label);
    if (lab.length) q = q.where(sql<boolean>`st.labels && ${lab}::text[]`);
    const stg = many(query.stage);
    if (stg.length) q = q.where('st.stage', 'in', stg);
    if (query.channel) q = q.where('st.channel', '=', query.channel);
    if (query.untouched) q = q.where('st.status', '=', 'open').where(sql<boolean>`(select count(*) from support_message m where m.ticket_id = st.id and m.parent_id is null) <= 1`);
    if (query.favorite) q = q.where(sql<boolean>`exists (select 1 from support_favorite f where f.ticket_id = st.id and f.user_id = ${actor.id})`);
    if (query.q) {
      const like = `%${query.q}%`;
      const n = Number(query.q.replace(/^#/, ''));
      // Labels are found by their names too.
      const needle = query.q.trim().toLowerCase();
      const byLabel = query.tenantId ? (await this.desks([query.tenantId])).get(query.tenantId)!.labels.filter((l) => l.label.toLowerCase().includes(needle)).map((l) => l.key) : [];
      q = q.where((eb) =>
        eb.or([
          ...(byLabel.length ? [sql<boolean>`st.labels && ${byLabel}::text[]`] : []),
          eb('st.subject', 'ilike', like),
          eb('st.requester_name', 'ilike', like),
          eb('st.requester_email', 'ilike', like),
          eb('c.email', 'ilike', like),
          eb('c.display_name', 'ilike', like),
          ...(Number.isInteger(n) ? [eb('st.number', '=', n)] : []),
        ]),
      );
    }
    const page = await paginate(q, { page: query.page ?? 1, pageSize: query.pageSize ?? 25 });
    const desks = await this.desks(page.items.map((t) => t.tenant_id));
    const counts = await this.linkCounts(page.items.map((t) => t.id), desks);
    const stars = await this.starred(actor, page.items.map((t) => t.id));
    const excerpts = await this.excerpts(page.items.map((t) => t.id));
    return mapPage(page, (t) => ({ ...toSummary(t, desks.get(t.tenant_id)!.stages), ...(counts.get(t.id) ?? {}), favorite: stars.has(t.id), excerpt: excerpts.get(t.id) ?? '' }));
  }

  /** The Overview tab's numbers for one organisation: what the caller may see, counted. */
  async stats(actor: Actor, tenantId: string): Promise<TicketStats> {
    const all: TicketSummary[] = [];
    let partial = false;
    for (let page = 1; page <= 20; page++) {
      const r = await this.list(actor, { tenantId, audience: 'organisation', page, pageSize: 100 });
      all.push(...r.items);
      if (all.length >= r.total) break;
      if (page === 20) partial = true;
    }
    const isDone = (t: TicketSummary) => (t.stage ? t.stage.kind === 'done' : t.status === 'resolved' || t.status === 'closed');
    const open = all.filter((t) => !isDone(t));
    const count = <K>(rows: TicketSummary[], key: (t: TicketSummary) => K) => {
      const m = new Map<K, number>();
      for (const t of rows) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
      return m;
    };
    const today = new Date();
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (13 - i));
      return d.toISOString().slice(0, 10);
    });
    const dayOf = (iso: string) => new Date(iso).toISOString().slice(0, 10);
    const opened = count(all, (t) => dayOf(t.createdAt));
    const finished = count(all.filter(isDone), (t) => dayOf(t.updatedAt));
    const stages = new Map<string, { key: string; label: string; kind: 'open' | 'active' | 'done'; count: number }>();
    for (const t of all) {
      const st = t.stage ?? { key: t.status, label: t.status, kind: isDone(t) ? ('done' as const) : ('open' as const) };
      const cur = stages.get(st.key) ?? { ...st, count: 0 };
      cur.count++;
      stages.set(st.key, cur);
    }
    const labels = new Map<string, number>();
    for (const t of open) for (const l of t.labels) labels.set(l, (labels.get(l) ?? 0) + 1);
    const people = new Map<string | null, { id: string | null; name: string; count: number }>();
    for (const t of open) {
      const k = t.assignee?.id ?? null;
      const cur = people.get(k) ?? { id: k, name: t.assignee?.name ?? 'Unassigned', count: 0 };
      cur.count++;
      people.set(k, cur);
    }
    const oldest = [...open].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    return {
      total: all.length,
      open: open.length,
      done: all.length - open.length,
      unassigned: open.filter((t) => !t.assignee).length,
      urgent: open.filter((t) => t.priority === 'urgent').length,
      days: days.map((day) => ({ day, opened: opened.get(day) ?? 0, finished: finished.get(day) ?? 0 })),
      byStage: [...stages.values()],
      byPriority: (['urgent', 'high', 'normal', 'low'] as const).map((priority) => ({ priority, count: open.filter((t) => t.priority === priority).length })),
      byAssignee: [...people.values()].sort((a, b) => b.count - a.count),
      byLabel: [...labels].map(([key, n]) => ({ key, count: n })).sort((a, b) => b.count - a.count),
      byChannel: { member: open.filter((t) => t.channel === 'member').length, help: open.filter((t) => t.channel === 'help').length },
      oldest: oldest ? { id: oldest.id, number: oldest.number, subject: oldest.subject, createdAt: oldest.createdAt } : null,
      partial,
    };
  }

  private async desks(tenantIds: string[]): Promise<Map<string, HelpDeskConfig>> {
    const ids = [...new Set(tenantIds)];
    const out = new Map<string, HelpDeskConfig>(ids.map((id) => [id, HelpDeskConfig.parse({})]));
    if (!ids.length) return out;
    for (const r of await this.ctx.db.selectFrom('support_desk').select(['tenant_id', 'config']).where('tenant_id', 'in', ids).execute()) out.set(r.tenant_id, HelpDeskConfig.parse(r.config ?? {}));
    return out;
  }

  async get(actor: Actor, ticketId: string): Promise<TicketDetail> {
    const t = await this.summaryQuery().where('st.id', '=', ticketId).executeTakeFirst();
    if (!t) throw notFound('Ticket');
    const policy = await requireTenantAccess(this.ctx, actor, t.tenant_id, {
      staff: 'support.view',
      workspace: 'support.view',
    });
    const own = await workspacePolicy(this.ctx, actor, t.tenant_id);
    if (t.audience === 'organisation' && (!own || (!own.has('support.manage') && t.created_by !== actor.id))) throw notFound('Ticket');
    // Platform staff read the platform's own notes; the organisation's team reads its own.
    const platformView = can(actor, 'support.view') && t.audience === 'platform';
    const orgView = !!own?.has('support.manage');
    const desk = (await this.desks([t.tenant_id])).get(t.tenant_id)!;
    let mq = this.ctx.db
      .selectFrom('support_message as m')
      .leftJoin('user_identity as u', 'u.id', 'm.author_id')
      .select(['m.id', 'm.body', 'm.internal', 'm.created_at', 'm.author_kind', 'm.author_name', 'm.attachments', 'm.parent_id', 'm.edited_at', 'm.edits', 'm.resolved_at', 'm.resolved_by', 'u.id as author_id', 'u.display_name', 'u.email'])
      .select((eb) => eb.exists(eb.selectFrom('staff_member as sm').whereRef('sm.user_id', '=', 'u.id')).as('is_staff'))
      .where('m.ticket_id', '=', ticketId)
      .orderBy('m.created_at');
    if (!platformView && !orgView) mq = mq.where('m.internal', '=', false);
    // The organisation's private notes stay with it, even after a ticket is passed on.
    else if (platformView && !orgView) mq = mq.where((eb) => eb.or([eb('m.internal', '=', false), eb('m.author_kind', 'is distinct from', 'staff')]));
    void policy;
    const messages = await mq.execute();
    const resolvers = new Map<string, string>();
    const ids = [...new Set(messages.flatMap((m) => (m.resolved_by ? [m.resolved_by] : [])))];
    if (ids.length) for (const r of await this.ctx.db.selectFrom('user_identity').select(['id', 'display_name', 'email']).where('id', 'in', ids).execute()) resolvers.set(r.id, r.display_name ?? r.email ?? 'Someone');
    // Earlier wordings are the team's to read; the person who asked only sees that it was changed.
    const teamView = platformView || orgView;
    const links = orgView ? await this.linksOf(ticketId, desk.stages) : { parent: null, subs: [], related: [], blocks: [], blockedBy: [] };
    return {
      ...toSummary(t, desk.stages),
      favorite: (await this.starred(actor, [ticketId])).has(ticketId),
      visitorTyping: orgView ? visitorTyping(ticketId) : null,
      links,
      // "… has joined the chat" is a note for the person in the chat window; the team already sees who was assigned.
      messages: messages.filter((m) => !(m.author_kind === 'system' && /has joined the chat$/.test(m.body))).map(
        (m): TicketMessage => ({
          id: m.id,
          author: { id: m.author_id ?? 'visitor', name: m.display_name ?? m.author_name ?? m.email ?? 'User', email: m.email, isStaff: Boolean(m.is_staff) },
          body: m.body,
          internal: m.internal,
          kind: (m.author_kind as TicketMessage['kind']) ?? null,
          attachments: (m.attachments as SupportAttachmentDto[]) ?? [],
          parentId: m.parent_id,
          editedAt: m.edited_at ? iso(m.edited_at) : null,
          edits: teamView ? ((m.edits as { body: string; at: string; by: string }[]) ?? []) : [],
          resolvedAt: m.resolved_at ? iso(m.resolved_at) : null,
          resolvedBy: m.resolved_by ? (resolvers.get(m.resolved_by) ?? null) : null,
          createdAt: iso(m.created_at),
        }),
      ),
    };
  }

  // ---------------------------------------------------------------- files

  private checkFile(file: { contentType: string; content: Buffer }) {
    if (!ATTACHMENT_TYPES.test(file.contentType)) throw badRequest('Only pictures (JPEG, PNG, WebP, GIF), PDF, Word, Excel, PowerPoint, CSV or text files can be attached');
    if (!file.content.length) throw badRequest('That file is empty');
    if (file.content.length > SUPPORT_ATTACHMENT_MAX_BYTES) throw badRequest(`Files are limited to ${SUPPORT_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB`);
  }

  /** Stores a file for the organisation (not yet tied to a message). */
  async storeFile(tenantId: string, file: { name: string; contentType: string; content: Buffer }): Promise<SupportAttachmentDto> {
    this.checkFile(file);
    const id = uuidv7();
    const name = cleanName(file.name);
    await this.ctx.db.insertInto('support_file').values({ id, tenant_id: tenantId, name, content_type: file.contentType, size: file.content.length, content: file.content }).execute();
    return { id, name, contentType: file.contentType, size: file.content.length };
  }

  /** A member uploads a file for a ticket or a reply. */
  async uploadFile(actor: Actor, tenantId: string, file: { name: string; contentType: string; content: Buffer }): Promise<SupportAttachmentDto> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'support.create', workspace: 'support.create' });
    return this.storeFile(tenantId, file);
  }

  /** Ties files that were uploaded and not yet used to a ticket; says what they are. */
  async attach(tx: Pick<ServiceContext['db'], 'selectFrom' | 'updateTable'>, tenantId: string, ticketId: string, ids: string[]): Promise<SupportAttachmentDto[]> {
    if (!ids.length) return [];
    const rows = await tx.selectFrom('support_file').select(['id', 'name', 'content_type', 'size']).where('id', 'in', ids).where('tenant_id', '=', tenantId).where('ticket_id', 'is', null).execute();
    if (rows.length !== new Set(ids).size) throw badRequest('One of the files was not found. Attach it again.');
    await tx.updateTable('support_file').set({ ticket_id: ticketId }).where('id', 'in', ids).execute();
    return rows.map((r) => ({ id: r.id, name: r.name, contentType: r.content_type, size: r.size }));
  }

  /** A file of a ticket the person may open. */
  async file(actor: Actor, fileId: string): Promise<{ name: string; contentType: string; content: Buffer }> {
    const f = await this.ctx.db.selectFrom('support_file').select(['name', 'content_type', 'content', 'ticket_id']).where('id', '=', fileId).executeTakeFirst();
    if (!f?.ticket_id) throw notFound('File');
    await this.get(actor, f.ticket_id);
    return { name: f.name, contentType: f.content_type, content: f.content };
  }

  // ---------------------------------------------------------------- raising and answering

  async nextTicketNumber(): Promise<number> {
    return Number((await sql<{ n: string }>`select nextval('ticket_number_seq')::text as n`.execute(this.ctx.db)).rows[0]!.n);
  }

  async create(actor: Actor, tenantId: string, input: NewTicket): Promise<TicketDetail> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'support.create',
      workspace: 'support.create',
    });
    const { db } = this.ctx;
    const tenant = await db.selectFrom('tenant').select('name').where('id', '=', tenantId).executeTakeFirst();
    if (!tenant) throw notFound('Organisation');
    const id = uuidv7();
    const number = await this.nextTicketNumber();
    const first = (await this.deskOf(tenantId)).stages[0]!;
    const body = input.page ? `${input.body}\n\n— Sent from ${input.page}` : input.body;
    await db.transaction().execute(async (tx) => {
      await tx
        .insertInto('support_ticket')
        .values({
          id,
          number,
          tenant_id: tenantId,
          subject: input.subject,
          category: input.category,
          priority: input.priority,
          status: 'open',
          created_by: actor.id,
          audience: input.audience ?? 'platform',
          ...(input.audience === 'organisation' && { stage: first.key }),
        })
        .execute();
      const files = await this.attach(tx, tenantId, id, input.attachments ?? []);
      await tx.insertInto('support_message').values({ id: uuidv7(), ticket_id: id, author_id: actor.id, author_kind: 'requester', body, attachments: JSON.stringify(files) }).execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'ticket.created', {
      ticket: `#${number}`,
      subject: input.subject,
      priority: input.priority,
    });
    if (input.audience === 'organisation') {
      await this.notifyHandlers(tenantId, `[#${number}] ${input.subject}`, `New ${input.category.replace('_', ' ')} ticket from ${actor.email ?? 'a member'}.\n\n${input.body}\n\nOpen: ${this.ctx.workspaceUrl}/o/${tenantId}/support/${id}`, actor.id);
      return this.get(actor, id);
    }
    await this.ctx.email.send('ticket_created', tenantId, {
      to: this.ctx.supportEmail,
      subject: `[#${number}] ${input.subject} (${tenant.name}, ${input.priority})`,
      text: `New ${input.category.replace('_', ' ')} ticket from ${actor.email ?? 'a user'} at ${tenant.name}.

${input.body}

Open in console: ${this.ctx.consoleUrl}/support/${id}`,
    });
    return this.get(actor, id);
  }

  async reply(actor: Actor, ticketId: string, input: Omit<Required<ReplyInput>, 'parentId'> & { parentId?: string }): Promise<TicketDetail> {
    const t = await this.summaryQuery().where('st.id', '=', ticketId).executeTakeFirst();
    if (!t) throw notFound('Ticket');
    const policy = await requireTenantAccess(this.ctx, actor, t.tenant_id, {
      staff: 'support.reply',
      workspace: 'support.create',
    });
    if (t.audience === 'organisation' && (!policy || (!policy.has('support.manage') && t.created_by !== actor.id))) throw notFound('Ticket');
    if (!input.body.trim() && !input.attachments.length) throw badRequest('Write a message or attach a file.');
    // Who is writing: the Grids team on a ticket sent to them, the organisation's team on its own tickets, or the person who asked.
    const onPlatform = can(actor, 'support.reply') && t.audience === 'platform';
    // Someone on the organisation's support team can always write a note, even on a ticket they raised themselves.
    const onTeam = !onPlatform && !!policy?.has('support.manage');
    const orgTeam = onTeam && (t.created_by !== actor.id || input.internal);
    const kind = onPlatform ? 'platform' : orgTeam ? 'staff' : 'requester';
    if (input.internal && !onPlatform && !(onTeam && t.audience === 'organisation')) throw forbidden('Only the team can add internal notes.');
    // An answer in a thread goes under a team note (never under what the person can read).
    let thread: { id: string } | null = null;
    if (input.parentId) {
      if (!input.internal) throw badRequest('Threads are for the team’s own notes.');
      thread = (await this.ctx.db.selectFrom('support_message').select('id').where('id', '=', input.parentId).where('ticket_id', '=', ticketId).where('internal', '=', true).where('parent_id', 'is', null).executeTakeFirst()) ?? null;
      if (!thread) throw notFound('Note');
    }
    const desk = (await this.desks([t.tenant_id])).get(t.tenant_id)!;
    const current = stageOf(desk.stages, t);
    const now = this.ctx.now();

    // On the organisation's own tickets the stage moves it along: the team picking it up starts it, the person writing back to a finished one reopens it.
    let toStage: SupportStage | null = null;
    if (t.audience === 'organisation' && !input.internal) {
      if (kind === 'staff' && current.kind === 'open') toStage = desk.stages.find((s) => s.kind === 'active') ?? null;
      else if (kind === 'requester' && current.kind === 'done') toStage = desk.stages.find((s) => s.kind === 'active') ?? desk.stages[0]!;
    }
    // Staff replies on tickets sent to the platform wait on the customer; customer replies reopen them.
    const status = t.audience === 'platform' ? (input.internal ? t.status : onPlatform ? 'pending' : 'open') : toStage ? statusOfStage(toStage) : t.status;
    await this.ctx.db.transaction().execute(async (tx) => {
      const files = await this.attach(tx, t.tenant_id, ticketId, input.internal ? [] : input.attachments);
      await tx
        .insertInto('support_message')
                .values({ id: uuidv7(), ticket_id: ticketId, author_id: actor.id, author_kind: kind, body: input.body, internal: input.internal, attachments: JSON.stringify(files), parent_id: thread?.id ?? null })
        .execute();
      // Writing in a settled thread opens it again.
      if (thread) await tx.updateTable('support_message').set({ resolved_at: null, resolved_by: null }).where('id', '=', thread.id).execute();
      if (toStage)
        await tx.insertInto('support_message').values({ id: uuidv7(), ticket_id: ticketId, author_id: actor.id, author_kind: 'system', body: `Stage changed to ${toStage.label}`, internal: false }).execute();
      await tx
        .updateTable('support_ticket')
        .set({
          status,
          updated_at: now,
          ...(toStage && { stage: toStage.key }),
          ...(status !== 'resolved' && status !== 'closed' ? { resolved_at: null } : {}),
        })
        .where('id', '=', ticketId)
        .execute();
    });
    await audit(this.ctx, actor.id, t.tenant_id, input.internal ? 'ticket.note_added' : 'ticket.replied', { ticket: `#${t.number}` });

    if (!input.internal && t.audience === 'organisation') {
      const link = `${this.ctx.workspaceUrl}/o/${t.tenant_id}/support/${ticketId}`;
      if (kind === 'staff') await this.tellRequester(t, input.body, input.attachments.length > 0);
      else await this.notifyHandlers(t.tenant_id, `Re: [#${t.number}] ${t.subject}`, `${t.channel === 'help' ? (t.requester_name ?? 'The requester') : (actor.email ?? 'Someone')} replied:\n\n${input.body}\n\n${link}`, actor.id, t.assignee_id);
    } else if (!input.internal) {
      const to = onPlatform ? t.creator_email : (t.assignee_email ?? this.ctx.supportEmail);
      if (to)
        await this.ctx.email.send('ticket_reply', t.tenant_id, {
          to,
          subject: `Re: [#${t.number}] ${t.subject}`,
          text: `${actor.email ?? 'Someone'} replied to ticket #${t.number}:

${input.body}

${onPlatform ? `Reply in your workspace: ${this.ctx.workspaceUrl}/o/${t.tenant_id}/support/${ticketId}` : `Open in console: ${this.ctx.consoleUrl}/support/${ticketId}`}`,
        });
    }
    return this.get(actor, ticketId);
  }

  /** Changes the words of a message you wrote. The earlier wording is kept, for the team to read. */
  async editMessage(actor: Actor, ticketId: string, messageId: string, body: string): Promise<TicketDetail> {
    await this.get(actor, ticketId); // whoever may read the ticket
    const m = await this.ctx.db.selectFrom('support_message').select(['id', 'body', 'author_id', 'author_kind', 'edits']).where('id', '=', messageId).where('ticket_id', '=', ticketId).executeTakeFirst();
    if (!m) throw notFound('Message');
    if (m.author_id !== actor.id || m.author_kind === 'system' || m.author_kind === 'escalation') throw forbidden('You can only change what you wrote.');
    if (m.body === body) return this.get(actor, ticketId);
    const me = await this.ctx.db.selectFrom('user_identity').select(['display_name', 'email']).where('id', '=', actor.id).executeTakeFirst();
    const now = this.ctx.now();
    const edits = [...((m.edits as unknown[]) ?? []), { body: m.body, at: now.toISOString(), by: me?.display_name ?? me?.email ?? 'Someone' }];
    await this.ctx.db.updateTable('support_message').set({ body, edited_at: now, edits: JSON.stringify(edits) }).where('id', '=', messageId).execute();
    await this.ctx.db.updateTable('support_ticket').set({ updated_at: now }).where('id', '=', ticketId).execute();
    const t = await this.ctx.db.selectFrom('support_ticket').select(['tenant_id', 'number']).where('id', '=', ticketId).executeTakeFirstOrThrow();
    await audit(this.ctx, actor.id, t.tenant_id, 'ticket.message_edited', { ticket: `#${t.number}` });
    return this.get(actor, ticketId);
  }

  /** Settles a thread of team notes, or opens it again. */
  async resolveThread(actor: Actor, ticketId: string, messageId: string, resolved: boolean): Promise<TicketDetail> {
    const t = await this.ctx.db.selectFrom('support_ticket').select(['tenant_id', 'audience']).where('id', '=', ticketId).executeTakeFirst();
    if (!t) throw notFound('Ticket');
    const team = can(actor, 'support.reply') && t.audience === 'platform' ? true : !!(await workspacePolicy(this.ctx, actor, t.tenant_id))?.has('support.manage');
    if (!team) throw forbidden('Only the team can settle a thread.');
    const m = await this.ctx.db.selectFrom('support_message').select(['id']).where('id', '=', messageId).where('ticket_id', '=', ticketId).where('internal', '=', true).where('parent_id', 'is', null).executeTakeFirst();
    if (!m) throw notFound('Note');
    await this.ctx.db.updateTable('support_message').set(resolved ? { resolved_at: this.ctx.now(), resolved_by: actor.id } : { resolved_at: null, resolved_by: null }).where('id', '=', messageId).execute();
    return this.get(actor, ticketId);
  }

  /** Writes to the person who asked, at the address they gave (with the link that opens the conversation) or their account's. */
  private async tellRequester(t: SummaryRow, body: string, withFile: boolean) {
    const to = t.requester_email ?? t.creator_email;
    if (!to) return;
    const link = t.channel === 'help' ? `${this.ctx.workspaceUrl}/h/${supportToken(this.ctx.secretsKey, t.tenant_id, t.id)}` : `${this.ctx.workspaceUrl}/o/${t.tenant_id}/support/${t.id}`;
    await this.ctx.email.send('ticket_reply', t.tenant_id, { to, subject: `Re: [#${t.number}] ${t.subject}`, text: `${body || '(a file)'}${withFile ? '\n\n(There is a file with this message.)' : ''}\n\nReply here: ${link}` }).catch(() => undefined);
  }

  async update(actor: Actor, ticketId: string, input: UpdateTicketInput): Promise<TicketDetail> {
    requireStaff(actor, 'support.triage');
    const t = await this.ctx.db.selectFrom('support_ticket').selectAll().where('id', '=', ticketId).executeTakeFirst();
    if (!t) throw notFound('Ticket');
    const set = {
      ...(input.status && {
        status: input.status,
        resolved_at: input.status === 'resolved' ? this.ctx.now() : null,
      }),
      ...(input.priority && { priority: input.priority }),
      ...(input.assigneeId !== undefined && { assignee_id: input.assigneeId }),
    };
    if (Object.keys(set).length) {
      await this.ctx.db
        .updateTable('support_ticket')
        .set({ ...set, updated_at: this.ctx.now() })
        .where('id', '=', ticketId)
        .execute();
      await audit(this.ctx, actor.id, t.tenant_id, 'ticket.updated', {
        ticket: `#${t.number}`,
        ...input,
      });
    }
    return this.get(actor, ticketId);
  }

  /** Organisation admins handle internal tickets: they hear about new ones and replies (the assignee alone, once there is one). */
  async notifyHandlers(tenantId: string, subject: string, text: string, exceptUserId: string | null, assigneeId: string | null = null) {
    let q = this.ctx.db
      .selectFrom('membership as m')
      .innerJoin('user_identity as u', 'u.id', 'm.user_id')
      .select('u.email')
      .where('m.tenant_id', '=', tenantId)
      .where('m.status', '=', 'active');
    q = assigneeId ? q.where('m.user_id', '=', assigneeId) : q.where('m.role', '=', 'org_admin');
    if (exceptUserId) q = q.where('m.user_id', '<>', exceptUserId);
    for (const a of await q.execute()) if (a.email) await this.ctx.email.send('ticket_internal', tenantId, { to: a.email, subject, text }).catch(() => undefined);
  }

  /**
   * Organisation support managers work their own tickets: a stage of the organisation's, a priority, who has it, and its
   * labels. Each change is written in the conversation (the stage where the person can see it, the rest for the team only).
   */
  async orgUpdate(actor: Actor, tenantId: string, ticketId: string, input: OrgTicketUpdate): Promise<TicketDetail> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'support.triage', workspace: 'support.manage' });
    const t = await this.summaryQuery().where('st.id', '=', ticketId).where('st.tenant_id', '=', tenantId).executeTakeFirst();
    if (!t) throw notFound('Ticket');
    if (t.audience !== 'organisation') throw forbidden('The platform team manages escalated tickets.');
    const desk = (await this.desks([tenantId])).get(tenantId)!;
    const current = stageOf(desk.stages, t);
    const now = this.ctx.now();
    const set: Record<string, unknown> = {};
    const notes: { body: string; internal: boolean }[] = [];
    let to: SupportStage | null = null;
    if (input.stage) {
      to = desk.stages.find((s) => s.key === input.stage) ?? null;
      if (!to) throw badRequest(`"${input.stage}" is not one of this organisation’s stages`);
    } else if (input.status && input.status !== t.status) {
      const done = desk.stages.filter((s) => s.kind === 'done');
      to = input.status === 'resolved' ? (done.find((s) => s.key === 'resolved') ?? done[0]!) : input.status === 'closed' ? (done.find((s) => s.key === 'closed') ?? done.at(-1)!) : input.status === 'pending' ? (desk.stages.find((s) => s.kind === 'active') ?? desk.stages[0]!) : desk.stages[0]!;
    }
    if (to && to.key !== current.key) {
      set.stage = to.key;
      set.status = statusOfStage(to);
      set.resolved_at = to.kind === 'done' ? now : null;
      notes.push({ body: `Stage changed to ${to.label}`, internal: false });
    }
    if (input.priority && input.priority !== t.priority) {
      set.priority = input.priority;
      notes.push({ body: `Priority changed from ${t.priority} to ${input.priority}`, internal: true });
    }
    let assigneeName: string | null = null;
    if (input.assigneeId !== undefined && input.assigneeId !== t.assignee_id) {
      if (input.assigneeId) {
        const m = await this.ctx.db.selectFrom('membership as m').innerJoin('user_identity as u', 'u.id', 'm.user_id').select(['u.display_name', 'u.email']).where('m.tenant_id', '=', tenantId).where('m.user_id', '=', input.assigneeId).where('m.status', '=', 'active').executeTakeFirst();
        if (!m) throw badRequest('That person is not part of this organisation');
        assigneeName = m.display_name ?? m.email ?? 'someone';
      }
      set.assignee_id = input.assigneeId;
      notes.push({ body: input.assigneeId ? `Assigned to ${assigneeName}` : 'Unassigned', internal: true });
      // In a chat, the person sees who has picked it up.
      if (input.assigneeId && t.channel === 'help') notes.push({ body: `${assigneeName} has joined the chat`, internal: false });
    }
    if (input.labels) {
      const known = new Map(desk.labels.map((l) => [l.key, l.label]));
      const bad = input.labels.filter((k) => !known.has(k));
      if (bad.length) throw badRequest(`Unknown label(s): ${bad.join(', ')}`);
      const next = [...new Set(input.labels)];
      if (JSON.stringify([...next].sort()) !== JSON.stringify([...(t.labels ?? [])].sort())) {
        set.labels = next;
        notes.push({ body: next.length ? `Labels: ${next.map((k) => known.get(k)).join(', ')}` : 'Labels cleared', internal: true });
      }
    }
    if (Object.keys(set).length) {
      await this.ctx.db.transaction().execute(async (tx) => {
        await tx.updateTable('support_ticket').set({ ...set, updated_at: now } as never).where('id', '=', ticketId).execute();
        await tx.insertInto('support_message').values(notes.map((n) => ({ id: uuidv7(), ticket_id: ticketId, author_id: actor.id, author_kind: 'system', body: n.body, internal: n.internal }))).execute();
      });
      await audit(this.ctx, actor.id, tenantId, 'ticket.updated', { ticket: `#${t.number}`, ...input });
      if (to?.kind === 'done' && to.key !== current.key && t.channel === 'help') await this.tellRequester(t, `This request is now ${to.label.toLowerCase()}. If it is not sorted, reply and it will be opened again.`, false);
      if (set.assignee_id && set.assignee_id !== actor.id) await this.notifyHandlers(tenantId, `[#${t.number}] ${t.subject}`, `${actor.email ?? 'Someone'} assigned this to you.\n\n${this.ctx.workspaceUrl}/o/${tenantId}/support/${ticketId}`, null, String(set.assignee_id));
    }
    return this.get(actor, ticketId);
  }


  // ---------------------------------------------------------------- links between tickets

  private async linksOf(ticketId: string, stages: readonly SupportStage[]): Promise<TicketLinks> {
    const rows = await this.ctx.db
      .selectFrom('support_ticket_link as l')
      .innerJoin('support_ticket as o', (j) => j.on((eb) => eb('o.id', '=', eb.case().when('l.source_id', '=', ticketId).then(eb.ref('l.target_id')).else(eb.ref('l.source_id')).end())))
      .select(['l.id as link_id', 'l.kind', 'l.source_id', 'o.id', 'o.number', 'o.subject', 'o.priority', 'o.status', 'o.stage', 'o.audience'])
      .where((eb) => eb.or([eb('l.source_id', '=', ticketId), eb('l.target_id', '=', ticketId)]))
      .orderBy('o.number')
      .execute();
    const out: TicketLinks = { parent: null, subs: [], related: [], blocks: [], blockedBy: [] };
    for (const r of rows) {
      const mine = r.source_id === ticketId;
      const t: LinkedTicket = { linkId: r.link_id, id: r.id, number: r.number, subject: r.subject, priority: r.priority, stage: stageOf(stages, { stage: r.stage, status: r.status }) };
      if (r.kind === 'related') out.related.push(t);
      else if (r.kind === 'parent') (mine ? out.subs.push(t) : (out.parent = t));
      else (mine ? out.blocks : out.blockedBy).push(t);
    }
    return out;
  }

  /** For the list and the board: how many sub-issues a ticket has (and how many are finished), and how many open tickets block it. */
  private async linkCounts(ids: string[], desks: Map<string, HelpDeskConfig>): Promise<Map<string, { subTotal: number; subDone: number; blockedBy: number }>> {
    const out = new Map<string, { subTotal: number; subDone: number; blockedBy: number }>();
    if (!ids.length) return out;
    const rows = await this.ctx.db
      .selectFrom('support_ticket_link as l')
      .innerJoin('support_ticket as s', 's.id', 'l.source_id')
      .innerJoin('support_ticket as t', 't.id', 'l.target_id')
      .select(['l.kind', 'l.source_id', 'l.target_id', 's.status as s_status', 's.stage as s_stage', 's.tenant_id', 't.status as t_status', 't.stage as t_stage'])
      .where('l.kind', 'in', ['parent', 'blocks'])
      .where((eb) => eb.or([eb('l.source_id', 'in', ids), eb('l.target_id', 'in', ids)]))
      .execute();
    const bump = (id: string) => out.get(id) ?? out.set(id, { subTotal: 0, subDone: 0, blockedBy: 0 }).get(id)!;
    for (const r of rows) {
      const stages = desks.get(r.tenant_id)?.stages ?? DEFAULT_SUPPORT_STAGES;
      const sDone = stageOf(stages, { stage: r.s_stage, status: r.s_status }).kind === 'done';
      const tDone = stageOf(stages, { stage: r.t_stage, status: r.t_status }).kind === 'done';
      if (r.kind === 'parent' && ids.includes(r.source_id)) {
        const c = bump(r.source_id);
        c.subTotal++;
        if (tDone) c.subDone++;
      }
      if (r.kind === 'blocks' && ids.includes(r.target_id) && !sDone) bump(r.target_id).blockedBy++;
    }
    return out;
  }

  /** The first words of what each ticket is about: its opening message, as plain text. */
  private async excerpts(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!ids.length) return out;
    const rows = await this.ctx.db
      .selectFrom('support_message')
      .select(['ticket_id', 'body'])
      .distinctOn('ticket_id')
      .where('ticket_id', 'in', ids)
      .where('internal', '=', false)
      .where('parent_id', 'is', null)
      .where((eb) => eb.or([eb('author_kind', 'is', null), eb('author_kind', 'in', ['requester', 'staff'])]))
      .orderBy('ticket_id')
      .orderBy('created_at')
      .execute();
    for (const r of rows) {
      const text = r.body
        .split(/\n\n(?:Topic:|Sent from)/)[0]!
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^:::.*$/gm, ' ')
        .replace(/[#>*_`~-]+\s?/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      out.set(r.ticket_id, text.slice(0, 220));
    }
    return out;
  }

  private async starred(actor: Actor, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.ctx.db.selectFrom('support_favorite').select('ticket_id').where('user_id', '=', actor.id).where('ticket_id', 'in', ids).execute();
    return new Set(rows.map((r) => r.ticket_id));
  }

  /** Stars a ticket for the caller, or takes the star off. */
  async setFavorite(actor: Actor, ticketId: string, favorite: boolean): Promise<TicketDetail> {
    await this.get(actor, ticketId); // only what they may read
    if (favorite) await this.ctx.db.insertInto('support_favorite').values({ user_id: actor.id, ticket_id: ticketId }).onConflict((oc) => oc.doNothing()).execute();
    else await this.ctx.db.deleteFrom('support_favorite').where('user_id', '=', actor.id).where('ticket_id', '=', ticketId).execute();
    return this.get(actor, ticketId);
  }

  /** The team member starts or stops writing a reply: the person in the chat sees it. */
  async agentIsTyping(actor: Actor, tenantId: string, ticketId: string, typing: boolean): Promise<void> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'support.triage', workspace: 'support.manage' });
    const t = await this.ctx.db.selectFrom('support_ticket').select('id').where('id', '=', ticketId).where('tenant_id', '=', tenantId).where('channel', '=', 'help').executeTakeFirst();
    if (!t) return;
    const u = await this.ctx.db.selectFrom('user_identity').select(['display_name', 'email']).where('id', '=', actor.id).executeTakeFirst();
    setAgentTyping(ticketId, typing ? (u?.display_name ?? u?.email ?? 'Someone from the team') : null);
  }

  /** Links a ticket to another one of the same organisation. */
  async link(actor: Actor, tenantId: string, ticketId: string, input: TicketLinkInput): Promise<TicketDetail> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'support.triage', workspace: 'support.manage' });
    if (input.ticketId === ticketId) throw badRequest('A ticket cannot be linked to itself');
    const both = await this.ctx.db.selectFrom('support_ticket').select(['id', 'number', 'audience']).where('tenant_id', '=', tenantId).where('id', 'in', [ticketId, input.ticketId]).execute();
    const me = both.find((t) => t.id === ticketId);
    const other = both.find((t) => t.id === input.ticketId);
    if (!me || !other) throw notFound('Ticket');
    if (me.audience !== 'organisation' || other.audience !== 'organisation') throw badRequest('Only the organisation’s own tickets can be linked');
    // The link as stored: source → target.
    const [kind, source, target] = ((): ['parent' | 'blocks' | 'related', string, string] => {
      switch (input.kind) {
        case 'parent': return ['parent', other.id, me.id];
        case 'sub': return ['parent', me.id, other.id];
        case 'blocks': return ['blocks', me.id, other.id];
        case 'blocked_by': return ['blocks', other.id, me.id];
        default: return ['related', me.id, other.id];
      }
    })();
    const taken = await this.ctx.db.selectFrom('support_ticket_link').select('id').where('kind', '=', kind).where((eb) => eb.or(kind === 'related' ? [eb.and([eb('source_id', '=', source), eb('target_id', '=', target)]), eb.and([eb('source_id', '=', target), eb('target_id', '=', source)])] : [eb.and([eb('source_id', '=', source), eb('target_id', '=', target)])])).executeTakeFirst();
    if (taken) throw badRequest('These tickets are already linked that way');
    if (kind === 'parent') {
      if (await this.ctx.db.selectFrom('support_ticket_link').select('id').where('kind', '=', 'parent').where('target_id', '=', target).executeTakeFirst()) throw badRequest(`#${target === me.id ? me.number : other.number} already has a parent`);
      // A ticket cannot sit under its own sub-issue: walk up from the new parent.
      for (let at: string | null = source, hops = 0; at && hops < 50; hops++) {
        if (at === target) throw badRequest('That would make a ticket the parent of its own parent');
        at = (await this.ctx.db.selectFrom('support_ticket_link').select('source_id').where('kind', '=', 'parent').where('target_id', '=', at).executeTakeFirst())?.source_id ?? null;
      }
    }
    const words = { parent: ['Parent set to', 'Added sub-issue'], blocks: ['Now blocks', 'Now blocked by'], related: ['Related to', 'Related to'] } as const;
    const [forSource, forTarget] = words[kind];
    const num = (id: string) => (id === me.id ? me.number : other.number);
    await this.ctx.db.transaction().execute(async (tx) => {
      await tx.insertInto('support_ticket_link').values({ id: uuidv7(), tenant_id: tenantId, kind, source_id: source, target_id: target, created_by: actor.id }).execute();
      await tx
        .insertInto('support_message')
        .values([
          { id: uuidv7(), ticket_id: source, author_id: actor.id, author_kind: 'system', body: `${kind === 'parent' ? forTarget : forSource} #${num(target)}`, internal: true },
          { id: uuidv7(), ticket_id: target, author_id: actor.id, author_kind: 'system', body: `${kind === 'parent' ? forSource : forTarget} #${num(source)}`, internal: true },
        ])
        .execute();
    });
    return this.get(actor, ticketId);
  }

  async unlink(actor: Actor, tenantId: string, ticketId: string, linkId: string): Promise<TicketDetail> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'support.triage', workspace: 'support.manage' });
    const l = await this.ctx.db.selectFrom('support_ticket_link').selectAll().where('id', '=', linkId).where('tenant_id', '=', tenantId).where((eb) => eb.or([eb('source_id', '=', ticketId), eb('target_id', '=', ticketId)])).executeTakeFirst();
    if (!l) throw notFound('Link');
    const nums = new Map((await this.ctx.db.selectFrom('support_ticket').select(['id', 'number']).where('id', 'in', [l.source_id, l.target_id]).execute()).map((t) => [t.id, t.number]));
    await this.ctx.db.transaction().execute(async (tx) => {
      await tx.deleteFrom('support_ticket_link').where('id', '=', linkId).execute();
      await tx
        .insertInto('support_message')
        .values([
          { id: uuidv7(), ticket_id: l.source_id, author_id: actor.id, author_kind: 'system', body: `Removed the ${l.kind === 'parent' ? 'sub-issue' : l.kind === 'blocks' ? 'blocking' : 'related'} link to #${nums.get(l.target_id)}`, internal: true },
          { id: uuidv7(), ticket_id: l.target_id, author_id: actor.id, author_kind: 'system', body: `Removed the ${l.kind === 'parent' ? 'parent' : l.kind === 'blocks' ? 'blocking' : 'related'} link to #${nums.get(l.source_id)}`, internal: true },
        ])
        .execute();
    });
    return this.get(actor, ticketId);
  }

  /** Hands an internal ticket to the platform team (the conversation goes with it). */
  async escalate(actor: Actor, tenantId: string, ticketId: string, note: string | undefined): Promise<TicketDetail> {
    await requireTenantAccess(this.ctx, actor, tenantId, { staff: 'support.triage', workspace: 'support.manage' });
    const t = await this.summaryQuery().where('st.id', '=', ticketId).where('st.tenant_id', '=', tenantId).executeTakeFirst();
    if (!t) throw notFound('Ticket');
    if (t.audience === 'platform') throw badRequest('This ticket is already with the platform team');
    await this.ctx.db.transaction().execute(async (tx) => {
      await tx.updateTable('support_ticket').set({ audience: 'platform', escalated_at: this.ctx.now(), status: 'open', updated_at: this.ctx.now() }).where('id', '=', ticketId).execute();
      // The note is for the Grids team; the person who asked only learns that the team asked for help.
      await tx
        .insertInto('support_message')
        .values([
          { id: uuidv7(), ticket_id: ticketId, author_id: actor.id, author_kind: 'escalation', body: `Escalated to the platform team${note ? `: ${note}` : '.'}` },
          { id: uuidv7(), ticket_id: ticketId, author_id: actor.id, author_kind: 'system', body: 'The team asked the Grids support team for help with this.' },
        ])
        .execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'ticket.escalated', { ticket: `#${t.number}` });
    await this.ctx.email.send('ticket_created', tenantId, {
      to: this.ctx.supportEmail,
      subject: `[#${t.number}] ${t.subject} (${t.tenant_name}, escalated)`,
      text: `${actor.email ?? 'An organisation admin'} escalated ticket #${t.number} from ${t.tenant_name}.${note ? `\n\n${note}` : ''}\n\nOpen in console: ${this.ctx.consoleUrl}/support/${ticketId}`,
    });
    return this.get(actor, ticketId);
  }

  private summaryQuery() {
    return this.ctx.db
      .selectFrom('support_ticket as st')
      .innerJoin('tenant as t', 't.id', 'st.tenant_id')
      .leftJoin('user_identity as c', 'c.id', 'st.created_by')
      .leftJoin('user_identity as a', 'a.id', 'st.assignee_id')
      .selectAll('st')
      .select([
        't.name as tenant_name',
        'c.display_name as creator_name',
        'c.email as creator_email',
        'a.display_name as assignee_name',
        'a.email as assignee_email',
      ])
      .select((eb) =>
        eb
          .selectFrom('support_message as m')
          .whereRef('m.ticket_id', '=', 'st.id')
          .where('m.internal', '=', false)
          .where((e2) => e2.or([e2('m.author_kind', 'is', null), e2('m.author_kind', 'in', ['requester', 'staff', 'platform'])]))
          .select(eb.fn.countAll<string>().as('c'))
          .as('message_count'),
      );
  }
}

type SummaryRow = {
  id: string;
  number: number;
  tenant_id: string;
  tenant_name: string;
  subject: string;
  category: TicketSummary['category'];
  priority: TicketSummary['priority'];
  status: TicketSummary['status'];
  created_by: string | null;
  creator_name: string | null;
  creator_email: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  channel: 'member' | 'help';
  source_project: string | null;
  stage: string | null;
  labels: string[] | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  message_count: string | null;
  created_at: Date;
  updated_at: Date;
  audience: 'organisation' | 'platform';
  escalated_at: Date | null;
};

function toSummary(t: SummaryRow, stages: readonly SupportStage[] = DEFAULT_SUPPORT_STAGES): TicketSummary {
  const stage = t.audience === 'organisation' || t.stage ? stageOf(stages, t) : null;
  return {
    id: t.id,
    number: t.number,
    tenantId: t.tenant_id,
    tenantName: t.tenant_name,
    subject: t.subject,
    category: t.category,
    priority: t.priority,
    status: t.status,
    createdBy: {
      id: t.created_by ?? 'visitor',
      name: t.creator_name ?? t.requester_name ?? t.creator_email ?? t.requester_email ?? 'Visitor',
      email: t.creator_email ?? t.requester_email,
    },
    assignee: t.assignee_id
      ? {
          id: t.assignee_id,
          name: t.assignee_name ?? t.assignee_email ?? 'Staff',
          email: t.assignee_email,
        }
      : null,
    messageCount: Number(t.message_count ?? 0),
    createdAt: iso(t.created_at),
    updatedAt: iso(t.updated_at),
    audience: t.audience,
    escalatedAt: t.escalated_at ? iso(t.escalated_at) : null,
    channel: t.channel,
    stage: stage ? { key: stage.key, label: stage.label, kind: stage.kind } : null,
    sourceProject: t.source_project,
    labels: t.labels ?? [],
    requesterPhone: t.requester_phone ?? null,
    excerpt: '',
    favorite: false,
    subTotal: 0,
    subDone: 0,
    blockedBy: 0,
  };
}
