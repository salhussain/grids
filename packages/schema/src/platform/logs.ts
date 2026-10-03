import { z } from 'zod';
import { PageQuery, pageOf } from '../common.js';

const TenantRef = z.object({ id: z.string(), name: z.string() }).nullable();

export const AuditEntryDto = z.object({
  id: z.string(),
  at: z.string(),
  action: z.string(),
  actorEmail: z.string().nullable(),
  tenant: TenantRef,
  details: z.record(z.string(), z.unknown()),
});
export type AuditEntryDto = z.infer<typeof AuditEntryDto>;

export const AuditQuery = PageQuery.extend({
  tenantId: z.uuid().optional(),
  action: z.string().trim().max(60).optional(),
  q: z.string().trim().max(100).optional(),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

export const AuditPage = pageOf(AuditEntryDto);
export type AuditPage = z.infer<typeof AuditPage>;

export const EmailLogDto = z.object({
  id: z.string(),
  at: z.string(),
  tenant: TenantRef,
  template: z.string(),
  to: z.string(),
  subject: z.string(),
  status: z.enum(['sent', 'failed']),
  error: z.string().nullable(),
});
export type EmailLogDto = z.infer<typeof EmailLogDto>;

export const EmailLogDetail = EmailLogDto.extend({ bodyText: z.string() });
export type EmailLogDetail = z.infer<typeof EmailLogDetail>;

export const EmailLogQuery = PageQuery.extend({
  tenantId: z.uuid().optional(),
  status: z.enum(['sent', 'failed']).optional(),
  q: z.string().trim().max(100).optional(),
});
export type EmailLogQuery = z.infer<typeof EmailLogQuery>;
