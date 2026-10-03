import { sql } from 'kysely';
import {
  uuidv7,
  type CreateTicketInput,
  type Page,
  type ReplyInput,
  type TicketDetail,
  type TicketListQuery,
  type TicketSummary,
  type UpdateTicketInput,
} from '@grids/schema';
import { badRequest, forbidden, notFound } from '../errors.js';
import { can, requireStaff, requireTenantAccess } from './authz.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { iso, mapPage, paginate } from './util.js';

type NewTicket = Required<Pick<CreateTicketInput, 'subject' | 'body'>> & {
  category: NonNullable<CreateTicketInput['category']>;
  priority: NonNullable<CreateTicketInput['priority']>;
};

/**
 * Support desk. Organisation members raise and reply to tickets for their own
 * organisation; staff (by permission) see every ticket, triage, assign and add
 * internal notes that customers never see.
 */
export class SupportService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(actor: Actor, query: Partial<TicketListQuery> = {}): Promise<Page<TicketSummary>> {
    if (!can(actor, 'support.view')) {
      if (!query.tenantId) throw badRequest('tenantId is required');
      await requireTenantAccess(this.ctx, actor, query.tenantId, {
        staff: 'support.view',
        workspace: 'support.view',
      });
    }
    let q = this.summaryQuery().orderBy('st.updated_at', 'desc');
    if (query.tenantId) q = q.where('st.tenant_id', '=', query.tenantId);
    if (query.status === 'active') q = q.where('st.status', 'in', ['open', 'pending']);
    else if (query.status) q = q.where('st.status', '=', query.status);
    if (query.priority) q = q.where('st.priority', '=', query.priority);
    if (query.q) {
      const like = `%${query.q}%`;
      const n = Number(query.q.replace(/^#/, ''));
      q = q.where((eb) =>
        eb.or([
          eb('st.subject', 'ilike', like),
          ...(Number.isInteger(n) ? [eb('st.number', '=', n)] : []),
        ]),
      );
    }
    return mapPage(
      await paginate(q, { page: query.page ?? 1, pageSize: query.pageSize ?? 25 }),
      toSummary,
    );
  }

  async get(actor: Actor, ticketId: string): Promise<TicketDetail> {
    const t = await this.summaryQuery().where('st.id', '=', ticketId).executeTakeFirst();
    if (!t) throw notFound('Ticket');
    await requireTenantAccess(this.ctx, actor, t.tenant_id, {
      staff: 'support.view',
      workspace: 'support.view',
    });
    const staffView = can(actor, 'support.view');
    let mq = this.ctx.db
      .selectFrom('support_message as m')
      .innerJoin('user_identity as u', 'u.id', 'm.author_id')
      .select([
        'm.id',
        'm.body',
        'm.internal',
        'm.created_at',
        'u.id as author_id',
        'u.display_name',
        'u.email',
      ])
      .select((eb) =>
        eb
          .exists(eb.selectFrom('staff_member as sm').whereRef('sm.user_id', '=', 'u.id'))
          .as('is_staff'),
      )
      .where('m.ticket_id', '=', ticketId)
      .orderBy('m.created_at');
    if (!staffView) mq = mq.where('m.internal', '=', false);
    const messages = await mq.execute();
    return {
      ...toSummary(t),
      messages: messages.map((m) => ({
        id: m.id,
        author: {
          id: m.author_id,
          name: m.display_name ?? m.email ?? 'User',
          email: m.email,
          isStaff: Boolean(m.is_staff),
        },
        body: m.body,
        internal: m.internal,
        createdAt: iso(m.created_at),
      })),
    };
  }

  async create(actor: Actor, tenantId: string, input: NewTicket): Promise<TicketDetail> {
    await requireTenantAccess(this.ctx, actor, tenantId, {
      staff: 'support.create',
      workspace: 'support.create',
    });
    const { db } = this.ctx;
    const tenant = await db
      .selectFrom('tenant')
      .select('name')
      .where('id', '=', tenantId)
      .executeTakeFirst();
    if (!tenant) throw notFound('Organisation');
    const id = uuidv7();
    const number = Number(
      (await sql<{ n: string }>`select nextval('ticket_number_seq')::text as n`.execute(db))
        .rows[0]!.n,
    );
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
        })
        .execute();
      await tx
        .insertInto('support_message')
        .values({ id: uuidv7(), ticket_id: id, author_id: actor.id, body: input.body })
        .execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'ticket.created', {
      ticket: `#${number}`,
      subject: input.subject,
      priority: input.priority,
    });
    await this.ctx.email.send('ticket_created', tenantId, {
      to: this.ctx.supportEmail,
      subject: `[#${number}] ${input.subject} (${tenant.name}, ${input.priority})`,
      text: `New ${input.category.replace('_', ' ')} ticket from ${actor.email ?? 'a user'} at ${tenant.name}.

${input.body}

Open in console: ${this.ctx.consoleUrl}/support/${id}`,
    });
    return this.get(actor, id);
  }

  async reply(actor: Actor, ticketId: string, input: Required<ReplyInput>): Promise<TicketDetail> {
    const t = await this.summaryQuery().where('st.id', '=', ticketId).executeTakeFirst();
    if (!t) throw notFound('Ticket');
    const asStaff = can(actor, 'support.reply');
    await requireTenantAccess(this.ctx, actor, t.tenant_id, {
      staff: 'support.reply',
      workspace: 'support.create',
    });
    if (input.internal && !asStaff) throw forbidden('Only staff can add internal notes.');

    // Staff replies wait on the customer; customer replies reopen the ticket.
    const status = input.internal ? t.status : asStaff ? 'pending' : 'open';
    await this.ctx.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('support_message')
        .values({
          id: uuidv7(),
          ticket_id: ticketId,
          author_id: actor.id,
          body: input.body,
          internal: input.internal,
        })
        .execute();
      await tx
        .updateTable('support_ticket')
        .set({
          status,
          updated_at: this.ctx.now(),
          ...(status !== 'resolved' && { resolved_at: null }),
        })
        .where('id', '=', ticketId)
        .execute();
    });
    await audit(
      this.ctx,
      actor.id,
      t.tenant_id,
      input.internal ? 'ticket.note_added' : 'ticket.replied',
      { ticket: `#${t.number}` },
    );

    if (!input.internal) {
      const to = asStaff ? t.creator_email : (t.assignee_email ?? this.ctx.supportEmail);
      if (to) {
        await this.ctx.email.send('ticket_reply', t.tenant_id, {
          to,
          subject: `Re: [#${t.number}] ${t.subject}`,
          text: `${actor.email ?? 'Someone'} replied to ticket #${t.number}:

${input.body}

${asStaff ? `Reply in your workspace: ${this.ctx.workspaceUrl}/o/${t.tenant_id}/support/${ticketId}` : `Open in console: ${this.ctx.consoleUrl}/support/${ticketId}`}`,
        });
      }
    }
    return this.get(actor, ticketId);
  }

  async update(actor: Actor, ticketId: string, input: UpdateTicketInput): Promise<TicketDetail> {
    requireStaff(actor, 'support.triage');
    const t = await this.ctx.db
      .selectFrom('support_ticket')
      .selectAll()
      .where('id', '=', ticketId)
      .executeTakeFirst();
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

  private summaryQuery() {
    return this.ctx.db
      .selectFrom('support_ticket as st')
      .innerJoin('tenant as t', 't.id', 'st.tenant_id')
      .innerJoin('user_identity as c', 'c.id', 'st.created_by')
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
  created_by: string;
  creator_name: string | null;
  creator_email: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  message_count: string | null;
  created_at: Date;
  updated_at: Date;
};

function toSummary(t: SummaryRow): TicketSummary {
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
      id: t.created_by,
      name: t.creator_name ?? t.creator_email ?? 'User',
      email: t.creator_email,
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
  };
}
