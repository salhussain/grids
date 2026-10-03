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
});
export type TicketSummary = z.infer<typeof TicketSummary>;

export const TicketMessage = z.object({
  id: z.string(),
  author: Person.extend({ isStaff: z.boolean() }),
  body: z.string(),
  internal: z.boolean(),
  createdAt: z.string(),
});
export type TicketMessage = z.infer<typeof TicketMessage>;

export const TicketDetail = TicketSummary.extend({ messages: z.array(TicketMessage) });
export type TicketDetail = z.infer<typeof TicketDetail>;

export const CreateTicketInput = z.object({
  subject: z.string().trim().min(4).max(200),
  category: TicketCategory.default('question'),
  priority: TicketPriority.default('normal'),
  body: z.string().trim().min(1).max(20000),
});
export type CreateTicketInput = z.input<typeof CreateTicketInput>;

/** Staff opening a ticket for an organisation (e.g. after a phone call). */
export const StaffCreateTicketInput = CreateTicketInput.extend({ tenantId: z.uuid() });
export type StaffCreateTicketInput = z.input<typeof StaffCreateTicketInput>;

export const ReplyInput = z.object({
  body: z.string().trim().min(1).max(20000),
  internal: z.boolean().default(false),
});
export type ReplyInput = z.input<typeof ReplyInput>;

export const UpdateTicketInput = z.object({
  status: TicketStatus.optional(),
  priority: TicketPriority.optional(),
  assigneeId: z.uuid().nullable().optional(),
});
export type UpdateTicketInput = z.infer<typeof UpdateTicketInput>;

export const TicketListQuery = PageQuery.extend({
  status: z.enum(['open', 'pending', 'resolved', 'closed', 'active']).optional(),
  priority: TicketPriority.optional(),
  tenantId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
});
export type TicketListQuery = z.infer<typeof TicketListQuery>;

export const StaffDto = Person;
export type StaffDto = z.infer<typeof StaffDto>;
