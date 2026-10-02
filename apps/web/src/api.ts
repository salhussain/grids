import type { z } from 'zod';
import type * as S from '@grids/schema';
import type {
  AuditPage,
  CreatedInvitation,
  DomainDto,
  GrantDto,
  InvitationPreview,
  InvoiceDto,
  LocalizationDto,
  MeDto,
  OrgBillingDto,
  MembersDto,
  OrgUnitDto,
  Page,
  TenantDetail,
  Theme,
  TicketDetail,
  TicketSummary,
  WorkspaceDto,
  WorkspaceRoleDto,
} from '@grids/schema';
import { createRequester, qs } from '@grids/ui';
import { currentUser } from './auth';
import { env } from './env';

type In<T extends z.ZodType> = z.input<T>;
const request = createRequester(
  env.apiUrl,
  async () => (await currentUser())?.access_token ?? null,
);
const t = (id: string) => `/tenants/${id}`;

export const api = {
  me: () => request<MeDto>('GET', '/me'),
  setPreferences: (input: In<typeof S.PreferencesInput>) =>
    request<MeDto>('PUT', '/me/preferences', input),
  setLocalization: (id: string, input: In<typeof S.LocalizationInput>) =>
    request<LocalizationDto>('PUT', `${t(id)}/localization`, input),

  // projects (M3–M6)
  projects: (id: string, archived = false) =>
    request<S.ProjectDto[]>('GET', `${t(id)}/projects${qs({ archived: archived || undefined })}`),
  createProject: (id: string, input: In<typeof S.ProjectInput>) =>
    request<S.ProjectDto>('POST', `${t(id)}/projects`, input),
  project: (id: string, p: string) => request<S.ProjectDto>('GET', `${t(id)}/projects/${p}`),
  updateProject: (id: string, p: string, input: In<typeof S.ProjectUpdate>) =>
    request<S.ProjectDto>('PATCH', `${t(id)}/projects/${p}`, input),
  archiveProject: (id: string, p: string, archived: boolean) =>
    request<S.ProjectDto>('POST', `${t(id)}/projects/${p}/archive`, { archived }),
  projectMembers: (id: string, p: string) =>
    request<S.ProjectMemberDto[]>('GET', `${t(id)}/projects/${p}/members`),
  setProjectMember: (id: string, p: string, input: In<typeof S.ProjectMemberInput>) =>
    request<S.ProjectMemberDto[]>('PUT', `${t(id)}/projects/${p}/members`, input),
  removeProjectMember: (id: string, p: string, userId: string) =>
    request<S.ProjectMemberDto[]>('DELETE', `${t(id)}/projects/${p}/members/${userId}`),
  types: (id: string, p: string) => request<S.EntityTypeDto[]>('GET', `${t(id)}/projects/${p}/types`),
  saveType: (id: string, p: string, input: In<typeof S.EntityTypeInput>, key?: string) =>
    request<S.EntityTypeDto[]>(key ? 'PUT' : 'POST', `${t(id)}/projects/${p}/types${key ? `/${key}` : ''}`, input),
  deleteType: (id: string, p: string, key: string) =>
    request<S.EntityTypeDto[]>('DELETE', `${t(id)}/projects/${p}/types/${key}`),
  elements: (id: string, p: string) =>
    request<S.DataElementDto[]>('GET', `${t(id)}/projects/${p}/elements`),
  saveElement: (id: string, p: string, input: In<typeof S.DataElementInput>, key?: string) =>
    request<S.DataElementDto[]>(key ? 'PUT' : 'POST', `${t(id)}/projects/${p}/elements${key ? `/${key}` : ''}`, input),
  deleteElement: (id: string, p: string, key: string) =>
    request<S.DataElementDto[]>('DELETE', `${t(id)}/projects/${p}/elements/${key}`),
  entities: (id: string, p: string, query: Partial<S.EntityQuery>) =>
    request<Page<S.EntitySummary>>('GET', `${t(id)}/projects/${p}/entities${qs(query)}`),
  entity: (id: string, p: string, entityId: string) =>
    request<S.EntityDetail>('GET', `${t(id)}/projects/${p}/entities/${entityId}`),
  createEntity: (id: string, p: string, input: In<typeof S.EntityInput>) =>
    request<S.EntityDetail>('POST', `${t(id)}/projects/${p}/entities`, input),
  updateEntity: (id: string, p: string, entityId: string, input: In<typeof S.EntityUpdate>) =>
    request<S.EntityDetail>('PATCH', `${t(id)}/projects/${p}/entities/${entityId}`, input),
  deleteEntity: (id: string, p: string, entityId: string) =>
    request<void>('DELETE', `${t(id)}/projects/${p}/entities/${entityId}`),
  series: (id: string, p: string, entityId: string, element: string) =>
    request<{ at: string; value: number | string | null; source: string }[]>(
      'GET',
      `${t(id)}/projects/${p}/entities/${entityId}/series${qs({ element })}`,
    ),
  importRows: (id: string, p: string, input: In<typeof S.ImportRowsInput>) =>
    request<{ created: number; updated: number; unchanged: number; skipped: number }>(
      'POST',
      `${t(id)}/projects/${p}/import`,
      input,
    ),
  query: (id: string, p: string, spec: S.QuerySpecInput) =>
    request<S.QueryResult>('POST', `${t(id)}/projects/${p}/query`, spec),
  dashboards: (id: string, p: string) =>
    request<S.DashboardDto[]>('GET', `${t(id)}/projects/${p}/dashboards`),
  saveDashboard: (id: string, p: string, input: In<typeof S.DashboardInput>, key?: string) =>
    request<S.DashboardDto[]>(key ? 'PUT' : 'POST', `${t(id)}/projects/${p}/dashboards${key ? `/${key}` : ''}`, input),
  deleteDashboard: (id: string, p: string, key: string) =>
    request<S.DashboardDto[]>('DELETE', `${t(id)}/projects/${p}/dashboards/${key}`),
  jobs: (id: string, p: string) => request<S.JobDto[]>('GET', `${t(id)}/projects/${p}/jobs`),
  saveJob: (id: string, p: string, input: In<typeof S.JobInput>, key?: string) =>
    request<S.JobDto[]>(key ? 'PUT' : 'POST', `${t(id)}/projects/${p}/jobs${key ? `/${key}` : ''}`, input),
  deleteJob: (id: string, p: string, key: string) =>
    request<S.JobDto[]>('DELETE', `${t(id)}/projects/${p}/jobs/${key}`),
  runJob: (id: string, p: string, key: string) =>
    request<S.RunDto>('POST', `${t(id)}/projects/${p}/jobs/${key}/run`),
  runs: (id: string, p: string, query: { page: number; pageSize: number; jobId?: string; status?: string }) =>
    request<Page<S.RunDto>>('GET', `${t(id)}/projects/${p}/runs${qs(query)}`),
  run: (id: string, p: string, runId: string) =>
    request<S.RunDetail>('GET', `${t(id)}/projects/${p}/runs/${runId}`),
  files: (id: string, p: string) => request<S.FileDto[]>('GET', `${t(id)}/projects/${p}/files`),
  uploadFile: (id: string, p: string, key: string, file: File) =>
    request<S.UploadResult>('PUT', `${t(id)}/projects/${p}/files/${key}${qs({ name: file.name, type: file.type || undefined })}`, file),
  deleteFile: (id: string, p: string, key: string) => request<S.FileDto[]>('DELETE', `${t(id)}/projects/${p}/files/${key}`),
  rerun: (id: string, p: string, runId: string) => request<S.RunDto>('POST', `${t(id)}/projects/${p}/runs/${runId}/rerun`),
  cancelRun: (id: string, p: string, runId: string) =>
    request<S.RunDetail>('POST', `${t(id)}/projects/${p}/runs/${runId}/cancel`),
  datasets: (id: string, p: string) => request<S.DatasetDto[]>('GET', `${t(id)}/projects/${p}/datasets`),
  datasetRows: (id: string, p: string, key: string, page: { page: number; pageSize: number }) =>
    request<{ columns: string[]; items: Record<string, unknown>[]; total: number; page: number; pageSize: number }>(
      'GET',
      `${t(id)}/projects/${p}/datasets/${key}/rows${qs(page)}`,
    ),
  forms: (id: string, p: string) => request<S.FormDto[]>('GET', `${t(id)}/projects/${p}/forms`),
  saveForm: (id: string, p: string, input: In<typeof S.FormInput>, key?: string) =>
    request<S.FormDto[]>(key ? 'PUT' : 'POST', `${t(id)}/projects/${p}/forms${key ? `/${key}` : ''}`, input),
  publishForm: (id: string, p: string, key: string) =>
    request<S.FormDto[]>('POST', `${t(id)}/projects/${p}/forms/${key}/publish`),
  archiveForm: (id: string, p: string, key: string) =>
    request<S.FormDto[]>('DELETE', `${t(id)}/projects/${p}/forms/${key}`),
  submit: (id: string, p: string, key: string, input: In<typeof S.SubmissionInput>) =>
    request<S.SubmissionDto>('POST', `${t(id)}/projects/${p}/forms/${key}/submissions`, input),
  submissions: (id: string, p: string, key: string, query: { page: number; pageSize: number; entityId?: string }) =>
    request<Page<S.SubmissionDto>>('GET', `${t(id)}/projects/${p}/forms/${key}/submissions${qs(query)}`),

  // public (no sign-in)
  publicProject: (tenant: string, project: string) =>
    request<S.PublicProjectDto>('GET', `/public/projects/${tenant}/${project}`, undefined, { anonymous: true }),
  publicWidget: (tenant: string, project: string, dashboard: string, widget: string) =>
    request<S.QueryResult>(
      'GET',
      `/public/projects/${tenant}/${project}/dashboards/${dashboard}/widgets/${widget}`,
      undefined,
      { anonymous: true },
    ),

  // billing (organisation self-service)
  billing: (id: string) => request<OrgBillingDto>('GET', `${t(id)}/billing`),
  invoices: (id: string, page: { page: number; pageSize: number }) =>
    request<Page<InvoiceDto>>('GET', `${t(id)}/billing/invoices${qs(page)}`),
  invoice: (id: string, invoiceId: string) =>
    request<InvoiceDto>('GET', `${t(id)}/billing/invoices/${invoiceId}`),
  workspace: (id: string) => request<WorkspaceDto>('GET', `${t(id)}/workspace`),
  setTheme: (id: string, theme: In<typeof S.Theme>) =>
    request<Theme>('PUT', `${t(id)}/theme`, theme),

  // people
  members: (id: string) => request<MembersDto>('GET', `${t(id)}/members`),
  updateMember: (id: string, userId: string, input: In<typeof S.UpdateMemberInput>) =>
    request<MembersDto>('PATCH', `${t(id)}/members/${userId}`, input),
  placeMember: (id: string, userId: string, orgUnitId: string | null) =>
    request<MembersDto>('PUT', `${t(id)}/members/${userId}/placement`, { orgUnitId }),
  invite: (id: string, input: In<typeof S.CreateInvitationInput>) =>
    request<CreatedInvitation>('POST', `${t(id)}/invitations`, input),
  resendInvite: (id: string, invitationId: string) =>
    request<CreatedInvitation>('POST', `${t(id)}/invitations/${invitationId}/resend`),
  revokeInvite: (id: string, invitationId: string) =>
    request<MembersDto>('DELETE', `${t(id)}/invitations/${invitationId}`),
  previewInvite: (token: string) => request<InvitationPreview>('GET', `/invitations/${token}`),
  acceptInvite: (token: string) => request<MeDto>('POST', `/invitations/${token}/accept`),

  // structure
  units: (id: string) => request<OrgUnitDto[]>('GET', `${t(id)}/org-units`),
  createUnit: (id: string, input: In<typeof S.OrgUnitInput>) =>
    request<OrgUnitDto[]>('POST', `${t(id)}/org-units`, input),
  updateUnit: (id: string, unitId: string, input: In<typeof S.OrgUnitInput>) =>
    request<OrgUnitDto[]>('PUT', `${t(id)}/org-units/${unitId}`, input),
  deleteUnit: (id: string, unitId: string) =>
    request<OrgUnitDto[]>('DELETE', `${t(id)}/org-units/${unitId}`),

  // roles & access
  roles: (id: string) => request<WorkspaceRoleDto[]>('GET', `${t(id)}/roles`),
  createRole: (id: string, input: In<typeof S.WorkspaceRoleInput>) =>
    request<WorkspaceRoleDto[]>('POST', `${t(id)}/roles`, input),
  updateRole: (id: string, roleId: string, input: In<typeof S.WorkspaceRoleInput>) =>
    request<WorkspaceRoleDto[]>('PUT', `${t(id)}/roles/${roleId}`, input),
  deleteRole: (id: string, roleId: string) =>
    request<WorkspaceRoleDto[]>('DELETE', `${t(id)}/roles/${roleId}`),
  grants: (id: string, userId?: string) =>
    request<GrantDto[]>('GET', `${t(id)}/grants${qs({ userId })}`),
  grant: (id: string, input: In<typeof S.GrantInput>) =>
    request<GrantDto[]>('POST', `${t(id)}/grants`, input),
  revokeGrant: (id: string, grantId: string) =>
    request<GrantDto[]>('DELETE', `${t(id)}/grants/${grantId}`),

  // settings
  setSecurity: (id: string, mfaRequired: boolean) =>
    request<TenantDetail>('PUT', `${t(id)}/security`, { mfaRequired }),
  domains: (id: string) => request<DomainDto[]>('GET', `${t(id)}/domains`),
  addDomain: (id: string, hostname: string) =>
    request<DomainDto[]>('POST', `${t(id)}/domains`, { hostname }),
  verifyDomain: (id: string, domainId: string) =>
    request<DomainDto[]>('POST', `${t(id)}/domains/${domainId}/verify`),
  primaryDomain: (id: string, domainId: string) =>
    request<DomainDto[]>('POST', `${t(id)}/domains/${domainId}/primary`),
  removeDomain: (id: string, domainId: string) =>
    request<DomainDto[]>('DELETE', `${t(id)}/domains/${domainId}`),

  // support
  tickets: (id: string, q: { status?: string; page?: number; pageSize?: number } = {}) =>
    request<Page<TicketSummary>>('GET', `${t(id)}/tickets${qs(q)}`),
  createTicket: (id: string, input: In<typeof S.CreateTicketInput>) =>
    request<TicketDetail>('POST', `${t(id)}/tickets`, input),
  ticket: (ticketId: string) => request<TicketDetail>('GET', `/tickets/${ticketId}`),
  replyTicket: (ticketId: string, body: string) =>
    request<TicketDetail>('POST', `/tickets/${ticketId}/messages`, { body }),

  // activity
  activity: (id: string, page: { page: number; pageSize: number }) =>
    request<AuditPage>('GET', `${t(id)}/activity${qs(page)}`),
};
