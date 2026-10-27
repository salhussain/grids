import { z } from 'zod';
import { PageQuery, pageOf } from '../common.js';

const TenantRef = z.object({ id: z.string(), name: z.string() }).nullable();

/** What kind of thing an activity entry is, for filtering and for the label beside it. */
export const AUDIT_CATEGORIES = ['submission', 'approval', 'invitation', 'view', 'public', 'entity', 'access', 'change'] as const;
export const AuditCategory = z.enum(AUDIT_CATEGORIES);
export type AuditCategory = z.infer<typeof AuditCategory>;
export const AUDIT_CATEGORY_LABEL: Record<AuditCategory, string> = {
  submission: 'Submissions',
  approval: 'Approvals',
  invitation: 'Invitations',
  view: 'Views',
  public: 'Public access',
  entity: 'Places and things',
  access: 'People and access',
  change: 'Changes',
};
/** The category an action belongs to (the same rule the log is backfilled with). */
export function categoryOf(action: string): AuditCategory {
  if (action.endsWith('.viewed')) return 'view';
  if (action.startsWith('public.')) return 'public';
  if (action === 'submission.reviewed') return 'approval';
  if (action.startsWith('submission.') || action.startsWith('submissions.')) return 'submission';
  if (action.startsWith('invitation.') || action.startsWith('form.link_') || action === 'staff.invited') return 'invitation';
  if (action.startsWith('entity.') || action.startsWith('entities.') || action.startsWith('shared_entity.') || action === 'project.imported') return 'entity';
  if (action.startsWith('access.') || action.startsWith('project.member_') || action.startsWith('member.') || action.startsWith('permission_group.')) return 'access';
  return 'change';
}

export const AuditEntryDto = z.object({
  id: z.string(),
  at: z.string(),
  action: z.string(),
  actorEmail: z.string().nullable(),
  tenant: TenantRef,
  details: z.record(z.string(), z.unknown()),
  category: AuditCategory.default('change'),
  /** The project it was about, by key. */
  project: z.string().nullable().default(null),
  /** Where it came from: the address, a place ("Suva, Fiji"), and the browser. */
  ip: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  userAgent: z.string().nullable().default(null),
});
export type AuditEntryDto = z.infer<typeof AuditEntryDto>;

export const AuditQuery = PageQuery.extend({
  tenantId: z.uuid().optional(),
  action: z.string().trim().max(60).optional(),
  q: z.string().trim().max(100).optional(),
  project: z.string().trim().max(63).optional(),
  /** One kind, or several separated by commas. */
  category: z.string().trim().max(120).regex(/^[a-z]+(,[a-z]+)*$/).optional(),
  /** Only entries from this address. */
  ip: z.string().trim().max(60).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

export const AuditPage = pageOf(AuditEntryDto);

/** The log at a glance: this week against the one before, the last fortnight day by day, and who and where from. */
const Tile = z.object({ now: z.number().int(), before: z.number().int() });
export const ActivitySummaryDto = z.object({
  tiles: z.object({ events: Tile, submissions: Tile, changes: Tile, publicVisits: Tile }),
  days: z.array(z.object({ day: z.string(), total: z.number().int(), byCategory: z.partialRecord(AuditCategory, z.number().int()) })),
  places: z.array(z.object({ label: z.string(), count: z.number().int() })),
  people: z.array(z.object({ label: z.string(), count: z.number().int() })),
});
export type ActivitySummaryDto = z.infer<typeof ActivitySummaryDto>;
/** How much of the log the summary covers: days in the chart, rows in each list, and how far back the lists look. */
export const ActivitySummaryQuery = z.object({
  days: z.coerce.number().int().min(14).max(180).default(14),
  limit: z.coerce.number().int().min(1).max(200).default(6),
  span: z.coerce.number().int().min(7).max(180).default(30),
});
export type ActivitySummaryQuery = z.infer<typeof ActivitySummaryQuery>;
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
