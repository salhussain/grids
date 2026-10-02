import { z } from 'zod';
import { AuditEntryDto } from './logs.js';
import { TicketSummary } from './support.js';

export const PlatformOverview = z.object({
  tenants: z.record(z.string(), z.number().int()),
  totalTenants: z.number().int(),
  totalMembers: z.number().int(),
  mrr: z.array(z.object({ currency: z.string(), amount: z.number().int() })),
  outstanding: z.array(
    z.object({ currency: z.string(), amount: z.number().int(), overdueCount: z.number().int() }),
  ),
  openTickets: z.number().int(),
  urgentTickets: z.number().int(),
  emailsFailed24h: z.number().int(),
  awaitingPayment: z.array(z.object({ id: z.string(), name: z.string(), since: z.string() })),
  recentTickets: z.array(TicketSummary),
  recentActivity: z.array(AuditEntryDto),
});
export type PlatformOverview = z.infer<typeof PlatformOverview>;
