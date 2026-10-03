import type { z } from 'zod';
import type {
  AuditPage,
  BillingOverview,
  CreatedInvitation,
  DomainDto,
  EmailLogDetail,
  EmailLogDto,
  InvitationPreview,
  InvoiceDto,
  MeDto,
  MembersDto,
  Page,
  StaffRoleDto,
  StaffUserDto,
  PlanDto,
  PlatformOverview,
  StaffDto,
  SubscriptionDto,
  TenantDetail,
  TenantSummary,
  TicketDetail,
  TicketSummary,
} from '@grids/schema';
import { createRequester, qs } from '@grids/ui';
import { currentUser } from './auth';
import type * as S from '@grids/schema';
import { env } from './env';

/** Request bodies accept the schema's input shape (defaults are applied server-side). */
type In<T extends z.ZodType> = z.input<T>;
type PageArgs = { page?: number; pageSize?: number };

const request = createRequester(
  env.apiUrl,
  async () => (await currentUser())?.access_token ?? null,
);

const t = (id: string) => `/tenants/${id}`;
const pt = (id: string) => `/platform/tenants/${id}`;

export const api = {
  me: () => request<MeDto>('GET', '/me'),
  setPreferences: (input: { colorMode?: 'light' | 'dark' | 'system' }) =>
    request<MeDto>('PUT', '/me/preferences', input),
  overview: () => request<PlatformOverview>('GET', '/platform/overview'),
  staff: () => request<StaffDto[]>('GET', '/platform/staff'),

  // plans
  plans: (includeArchived = false) =>
    request<PlanDto[]>('GET', `/platform/plans${qs({ includeArchived })}`),
  planOptions: () => request<PlanDto[]>('GET', '/platform/plans/options'),
  createPlan: (input: In<typeof S.CreatePlanInput>) =>
    request<PlanDto>('POST', '/platform/plans', input),
  updatePlan: (id: string, input: In<typeof S.PlanInput>) =>
    request<PlanDto>('PUT', `/platform/plans/${id}`, input),

  // organisations
  tenants: (q: { status?: string; q?: string } & PageArgs = {}) =>
    request<Page<TenantSummary>>('GET', `/platform/tenants${qs(q)}`),
  tenant: (id: string) => request<TenantDetail>('GET', pt(id)),
  createTenant: (input: In<typeof S.CreateTenantInput>) =>
    request<TenantDetail>('POST', '/platform/tenants', input),
  updateTenant: (id: string, input: In<typeof S.UpdateTenantInput>) =>
    request<TenantDetail>('PATCH', pt(id), input),
  setTenantStatus: (id: string, input: In<typeof S.TenantStatusInput>) =>
    request<TenantDetail>('PUT', `${pt(id)}/status`, input),
  setSecurity: (id: string, mfaRequired: boolean) =>
    request<TenantDetail>('PUT', `${t(id)}/security`, { mfaRequired }),

  // billing
  subscribe: (id: string, input: In<typeof S.CreateSubscriptionInput>) =>
    request<SubscriptionDto>('POST', `${pt(id)}/subscription`, input),
  changeSubscription: (id: string, input: In<typeof S.ChangeSubscriptionInput>) =>
    request<SubscriptionDto>('PATCH', `${pt(id)}/subscription`, input),
  issueRenewal: (id: string) => request<InvoiceDto>('POST', `${pt(id)}/invoices`),
  billingOverview: () => request<BillingOverview>('GET', '/platform/billing/overview'),
  subscriptions: (q: { status?: string } & PageArgs = {}) =>
    request<Page<SubscriptionDto>>('GET', `/platform/billing/subscriptions${qs(q)}`),
  invoices: (q: { status?: string; tenantId?: string; overdue?: boolean } & PageArgs = {}) =>
    request<Page<InvoiceDto>>('GET', `/platform/invoices${qs(q)}`),
  recordPayment: (id: string, input: In<typeof S.RecordPaymentInput>) =>
    request<InvoiceDto>('POST', `/platform/invoices/${id}/payments`, input),
  voidInvoice: (id: string) => request<InvoiceDto>('POST', `/platform/invoices/${id}/void`),

  // people
  members: (id: string) => request<MembersDto>('GET', `${t(id)}/members`),
  updateMember: (id: string, userId: string, input: In<typeof S.UpdateMemberInput>) =>
    request<MembersDto>('PATCH', `${t(id)}/members/${userId}`, input),
  invite: (id: string, input: In<typeof S.CreateInvitationInput>) =>
    request<CreatedInvitation>('POST', `${t(id)}/invitations`, input),
  resendInvite: (id: string, invitationId: string) =>
    request<CreatedInvitation>('POST', `${t(id)}/invitations/${invitationId}/resend`),
  revokeInvite: (id: string, invitationId: string) =>
    request<MembersDto>('DELETE', `${t(id)}/invitations/${invitationId}`),
  previewInvite: (token: string) => request<InvitationPreview>('GET', `/invitations/${token}`),
  acceptInvite: (token: string) => request<MeDto>('POST', `/invitations/${token}/accept`),

  // domains
  addDomain: (id: string, hostname: string) =>
    request<DomainDto[]>('POST', `${t(id)}/domains`, { hostname }),
  verifyDomain: (id: string, domainId: string) =>
    request<DomainDto[]>('POST', `${t(id)}/domains/${domainId}/verify`),
  primaryDomain: (id: string, domainId: string) =>
    request<DomainDto[]>('POST', `${t(id)}/domains/${domainId}/primary`),
  removeDomain: (id: string, domainId: string) =>
    request<DomainDto[]>('DELETE', `${t(id)}/domains/${domainId}`),

  // support
  tickets: (
    q: { status?: string; priority?: string; tenantId?: string; q?: string } & PageArgs = {},
  ) => request<Page<TicketSummary>>('GET', `/platform/support/tickets${qs(q)}`),
  ticket: (id: string) => request<TicketDetail>('GET', `/tickets/${id}`),
  createTicket: (input: In<typeof S.StaffCreateTicketInput>) =>
    request<TicketDetail>('POST', '/platform/support/tickets', input),
  replyTicket: (id: string, input: In<typeof S.ReplyInput>) =>
    request<TicketDetail>('POST', `/tickets/${id}/messages`, input),
  updateTicket: (id: string, input: In<typeof S.UpdateTicketInput>) =>
    request<TicketDetail>('PATCH', `/tickets/${id}`, input),

  // logs
  auditLog: (q: { tenantId?: string; action?: string; q?: string } & PageArgs = {}) =>
    request<AuditPage>('GET', `/platform/logs/audit${qs(q)}`),
  emailLog: (q: { tenantId?: string; status?: string; q?: string } & PageArgs = {}) =>
    request<Page<EmailLogDto>>('GET', `/platform/logs/emails${qs(q)}`),
  email: (id: string) => request<EmailLogDetail>('GET', `/platform/logs/emails/${id}`),

  // staff & roles
  staffUsers: (q: { q?: string } & PageArgs = {}) =>
    request<Page<StaffUserDto>>('GET', `/platform/staff/users${qs(q)}`),
  inviteStaff: (input: In<typeof S.InviteStaffInput>) =>
    request<StaffUserDto>('POST', '/platform/staff/users', input),
  updateStaff: (id: string, input: In<typeof S.UpdateStaffInput>) =>
    request<StaffUserDto>('PATCH', `/platform/staff/users/${id}`, input),
  staffRoles: () => request<StaffRoleDto[]>('GET', '/platform/staff/roles'),
  createStaffRole: (input: In<typeof S.StaffRoleInput>) =>
    request<StaffRoleDto>('POST', '/platform/staff/roles', input),
  updateStaffRole: (id: string, input: In<typeof S.StaffRoleInput>) =>
    request<StaffRoleDto>('PUT', `/platform/staff/roles/${id}`, input),
  deleteStaffRole: (id: string) => request<void>('DELETE', `/platform/staff/roles/${id}`),
};
