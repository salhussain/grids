import { z } from 'zod';
import { PageQuery } from '../common.js';

export const TicketCategory = z.enum([
  'question',
  'bug',
  'billing',
  'feature_request',
  'account',
  'other',
]);
export const TicketPriority = z.enum(['low', 'normal', 'high', 'urgent']);
export const TicketStatus = z.enum(['open', 'pending', 'resolved', 'closed']);
export type TicketStatus = z.infer<typeof TicketStatus>;
export type TicketPriority = z.infer<typeof TicketPriority>;

const Person = z.object({ id: z.string(), name: z.string(), email: z.string().nullable() });

export const TicketSummary = z.object({
  id: z.string(),
  number: z.number().int(),
  tenantId: z.string(),
  tenantName: z.string(),
  subject: z.string(),
  category: TicketCategory,
  priority: TicketPriority,
  status: TicketStatus,
  createdBy: Person,
  assignee: Person.nullable(),
  messageCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** organisation: handled by the organisation's admins · platform: the platform team. */
  audience: z.enum(['organisation', 'platform']),
  escalatedAt: z.string().nullable(),
  /** `help`: asked from a project's page or the portal, possibly by someone with no account. */
  channel: z.enum(['member', 'help']).default('member'),
  /** The organisation's own stage for it (organisation tickets), as {key, label, kind}. */
  stage: z.object({ key: z.string(), label: z.string(), kind: z.enum(['open', 'active', 'done']) }).nullable().default(null),
  /** The project whose page a help request came from. */
  sourceProject: z.string().nullable().default(null),
  /** The phone number the person gave, when the help desk asks for one. */
  requesterPhone: z.string().nullable().default(null),
  /** Keys of the organisation's labels on it. */
  labels: z.array(z.string()).default([]),
  /** The start of what the ticket is about, as plain text (for the board). */
  excerpt: z.string().default(''),
  /** Whether the person asking has starred it. */
  favorite: z.boolean().default(false),
  /** Sub-issues: how many, and how many are finished. And how many unfinished tickets block it. */
  subTotal: z.number().int().default(0),
  subDone: z.number().int().default(0),
  blockedBy: z.number().int().default(0),
});
export type TicketSummary = z.infer<typeof TicketSummary>;

export const TicketMessage = z.object({
  id: z.string(),
  author: Person.extend({ isStaff: z.boolean() }),
  body: z.string(),
  internal: z.boolean(),
  /** `requester` · `staff` (the organisation's team) · `platform` (the Grids team) · `system`. */
  kind: z.enum(['requester', 'staff', 'platform', 'system', 'escalation']).nullable().default(null),
  attachments: z.array(z.object({ id: z.string(), name: z.string(), contentType: z.string(), size: z.number().int() })).default([]),
  /** The message this answers, when it is a reply in a thread. */
  parentId: z.string().nullable().default(null),
  editedAt: z.string().nullable().default(null),
  /** Every earlier wording (the team sees these). */
  edits: z.array(z.object({ body: z.string(), at: z.string(), by: z.string() })).default([]),
  /** A thread is settled: when, and by whom. */
  resolvedAt: z.string().nullable().default(null),
  resolvedBy: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type TicketMessage = z.infer<typeof TicketMessage>;

/** The numbers behind the Overview tab: where the tickets are, who has them, and how many came and went lately. */
export const TicketStats = z.object({
  total: z.number().int(),
  open: z.number().int(),
  done: z.number().int(),
  unassigned: z.number().int(),
  urgent: z.number().int(),
  /** Tickets opened and finished on each of the last 14 days, oldest first. */
  days: z.array(z.object({ day: z.string(), opened: z.number().int(), finished: z.number().int() })),
  byStage: z.array(z.object({ key: z.string(), label: z.string(), kind: z.enum(['open', 'active', 'done']), count: z.number().int() })),
  byPriority: z.array(z.object({ priority: TicketPriority, count: z.number().int() })),
  byAssignee: z.array(z.object({ id: z.string().nullable(), name: z.string(), count: z.number().int() })),
  byLabel: z.array(z.object({ key: z.string(), count: z.number().int() })),
  byChannel: z.object({ member: z.number().int(), help: z.number().int() }),
  oldest: z.object({ id: z.string(), number: z.number().int(), subject: z.string(), createdAt: z.string() }).nullable(),
  /** True when there were more tickets than were counted (the most recent ones are). */
  partial: z.boolean(),
});
export type TicketStats = z.infer<typeof TicketStats>;

/** A ticket as another one shows it: enough to recognise it, and to open it. */
export const LinkedTicket = z.object({
  /** The link itself (to remove it). */
  linkId: z.string(),
  id: z.string(),
  number: z.number().int(),
  subject: z.string(),
  priority: TicketPriority,
  stage: z.object({ key: z.string(), label: z.string(), kind: z.enum(['open', 'active', 'done']) }).nullable().default(null),
});
export type LinkedTicket = z.infer<typeof LinkedTicket>;
/** How a ticket relates to others, from its own side. */
export const TicketLinks = z.object({
  parent: LinkedTicket.nullable().default(null),
  subs: z.array(LinkedTicket).default([]),
  related: z.array(LinkedTicket).default([]),
  blocks: z.array(LinkedTicket).default([]),
  blockedBy: z.array(LinkedTicket).default([]),
});
export type TicketLinks = z.infer<typeof TicketLinks>;
export const TicketLinkKind = z.enum(['parent', 'sub', 'related', 'blocks', 'blocked_by']);
export type TicketLinkKind = z.infer<typeof TicketLinkKind>;
/** `kind` is what the other ticket is to this one: its parent, a sub-issue, related, something it blocks, or something blocking it. */
export const TicketLinkInput = z.object({ kind: TicketLinkKind, ticketId: z.string().uuid() });
export type TicketLinkInput = z.infer<typeof TicketLinkInput>;

export const TicketDetail = TicketSummary.extend({ /** What the person is typing in the chat right now. */ visitorTyping: z.object({ name: z.string(), text: z.string() }).nullable().default(null), messages: z.array(TicketMessage), links: TicketLinks.default({ parent: null, subs: [], related: [], blocks: [], blockedBy: [] }) });
export type TicketDetail = z.infer<typeof TicketDetail>;

export const CreateTicketInput = z.object({
  subject: z.string().trim().min(4).max(200),
  category: TicketCategory.default('question'),
  priority: TicketPriority.default('normal'),
  body: z.string().trim().min(1).max(20000),
  attachments: z.array(z.uuid()).max(5).default([]),
  /** Raise it within the organisation, or straight to the platform team. */
  audience: z.enum(['organisation', 'platform']).default('platform'),
  /** Page the person was on (support bubble), for context. */
  page: z.string().max(500).optional(),
});
export type CreateTicketInput = z.input<typeof CreateTicketInput>;

/** Staff opening a ticket for an organisation (e.g. after a phone call). */
export const StaffCreateTicketInput = CreateTicketInput.extend({ tenantId: z.uuid() });
export type StaffCreateTicketInput = z.input<typeof StaffCreateTicketInput>;

export const FavoriteInput = z.object({ favorite: z.boolean() });

export const AgentTypingInput = z.object({ typing: z.boolean() });

export const ReplyInput = z.object({
  body: z.string().trim().max(20000).default(''),
  internal: z.boolean().default(false),
  /** Files uploaded for the reply. */
  attachments: z.array(z.uuid()).max(5).default([]),
  /** Answers a team note in its thread. */
  parentId: z.uuid().optional(),
});
export type ReplyInput = z.input<typeof ReplyInput>;

export const UpdateTicketInput = z.object({
  status: TicketStatus.optional(),
  priority: TicketPriority.optional(),
  assigneeId: z.uuid().nullable().optional(),
});
export type UpdateTicketInput = z.infer<typeof UpdateTicketInput>;

/** The organisation moving one of its tickets: to one of its own stages, or (as before) a plain status. */
export const OrgTicketUpdate = z.object({
  status: TicketStatus.optional(),
  stage: z.string().max(63).optional(),
  priority: TicketPriority.optional(),
  assigneeId: z.uuid().nullable().optional(),
  labels: z.array(z.string().max(63)).max(10).optional(),
});
export type OrgTicketUpdate = z.infer<typeof OrgTicketUpdate>;

export const TicketListQuery = PageQuery.extend({
  audience: z.enum(['organisation', 'platform']).optional(),
  status: z.enum(['open', 'pending', 'resolved', 'closed', 'active']).optional(),
  /** One value, or several separated by commas (any of them). */
  priority: z.string().max(60).regex(/^(low|normal|high|urgent)(,(low|normal|high|urgent))*$/).optional(),
  tenantId: z.uuid().optional(),
  /** `me`, `none` (unassigned) or a person's id; several separated by commas. */
  assignee: z.string().max(400).regex(/^(me|none|[0-9a-f-]{36})(,(me|none|[0-9a-f-]{36}))*$/).optional(),
  label: z.string().max(400).optional(),
  stage: z.string().max(400).optional(),
  channel: z.enum(['member', 'help']).optional(),
  /** Only tickets nobody has touched yet: still open, with just the first message and nothing done to them. */
  untouched: z.enum(['true']).optional(),
  /** Only the tickets the person has starred. */
  favorite: z.enum(['true']).optional(),
  q: z.string().trim().max(100).optional(),
});
export type TicketListQuery = z.infer<typeof TicketListQuery>;

export const StaffDto = Person;
export type StaffDto = z.infer<typeof StaffDto>;

/** Changing the words of a message the person wrote; the earlier wording is kept. */
export const EditMessageInput = z.object({ body: z.string().trim().min(1).max(20000) });
export type EditMessageInput = z.infer<typeof EditMessageInput>;
/** Settling a thread of team notes, or opening it again. */
export const ResolveThreadInput = z.object({ resolved: z.boolean() });
export type ResolveThreadInput = z.infer<typeof ResolveThreadInput>;
