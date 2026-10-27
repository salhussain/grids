import type { z } from 'zod';
import type * as S from '@grids/schema';
import { Theme as ThemeSchema } from '@grids/schema';
import type {
  AuditPage,
  CreatedInvitation,
  CreatedOAuthClient,
  OAuthClientDto,
  OAuthClientsDto,
  DomainDto,
  GrantDto,
  InvitationPreview,
  InvoiceDto,
  LocalizationDto,
  MeDto,
  OrgBillingDto,
  OrgPlanDto,
  MembersDto,
  OrgUnitDto,
  Page,
  TenantDetail,
  SessionPolicy,
  ActiveSessionsDto,
  PastSessionsDto,
  Theme,
  TicketDetail,
  TicketSummary,
  WorkspaceDto,
  WorkspaceRoleDto,
} from '@grids/schema';
import { createRequester, qs } from '@grids/ui';
import { accessToken } from './auth';
import { env } from './env';

type In<T extends z.ZodType> = z.input<T>;
const request = createRequester(env.apiUrl, accessToken);
const t = (id: string) => `/tenants/${id}`;

export const api = {
  me: () => request<MeDto>('GET', '/me'),
  setPreferences: (input: In<typeof S.PreferencesInput>) =>
    request<MeDto>('PUT', '/me/preferences', input),
  setLocalization: (id: string, input: In<typeof S.LocalizationInput>) =>
    request<LocalizationDto>('PUT', `${t(id)}/localization`, input),

  // projects (M3–M6)
  projects: (id: string, archived: boolean | 'all' = false) =>
    request<S.ProjectDto[]>('GET', `${t(id)}/projects${qs({ archived: archived === 'all' ? 'all' : archived || undefined })}`),
  sharedEntities: (id: string, query: Partial<S.EntityQuery>) => request<Page<S.EntitySummary>>('GET', `${t(id)}/shared-entities${qs(query)}`),
  sharedEntity: (id: string, entityId: string) => request<S.EntityDetail>('GET', `${t(id)}/shared-entities/${entityId}`),
  createSharedEntity: (id: string, input: In<typeof S.EntityInput>) => request<S.EntitySummary>('POST', `${t(id)}/shared-entities`, input),
  updateSharedEntity: (id: string, entityId: string, input: In<typeof S.EntityUpdate>) => request<S.EntitySummary>('PATCH', `${t(id)}/shared-entities/${entityId}`, input),
  deleteSharedEntity: (id: string, entityId: string) => request<void>('DELETE', `${t(id)}/shared-entities/${entityId}`),
  importSharedEntities: (id: string, input: In<typeof S.ImportRowsInput>) =>
    request<{ created: number; updated: number; unchanged: number; skipped: number }>('POST', `${t(id)}/shared-entities/import`, input),
  orgTypes: (id: string) => request<S.EntityTypeDto[]>('GET', `${t(id)}/entity-types`),
  saveOrgType: (id: string, input: In<typeof S.EntityTypeInput>, key?: string) =>
    request<S.EntityTypeDto[]>(key ? 'PUT' : 'POST', `${t(id)}/entity-types${key ? `/${key}` : ''}`, input),
  deleteOrgType: (id: string, key: string) => request<S.EntityTypeDto[]>('DELETE', `${t(id)}/entity-types/${key}`),
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
  dataGroups: (id: string, p: string) => request<S.DataGroupDto[]>('GET', `${t(id)}/projects/${p}/data-groups`),
  saveDataGroup: (id: string, p: string, input: S.DataGroupInput, key?: string) =>
    request<S.DataGroupDto[]>(key ? 'PUT' : 'POST', `${t(id)}/projects/${p}/data-groups${key ? `/${key}` : ''}`, input),
  deleteDataGroup: (id: string, p: string, key: string, cascade = false) => request<S.DataGroupDto[]>('DELETE', `${t(id)}/projects/${p}/data-groups/${key}${cascade ? '?cascade=true' : ''}`),
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
  series: (id: string, p: string, entityId: string, element: string, rollup = false) =>
    request<{ at: string; value: number | string | null; source: string }[]>(
      'GET',
      `${t(id)}/projects/${p}/entities/${entityId}/series${qs({ element, ...(rollup && { rollup: '1' }) })}`,
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
  variables: (id: string, p: string) => request<S.VariableDto[]>('GET', `${t(id)}/projects/${p}/variables`),
  saveVariable: (id: string, p: string, input: In<typeof S.VariableInput>, key?: string) =>
    request<S.VariableDto[]>(key ? 'PUT' : 'POST', `${t(id)}/projects/${p}/variables${key ? `/${key}` : ''}`, input),
  deleteVariable: (id: string, p: string, key: string) => request<S.VariableDto[]>('DELETE', `${t(id)}/projects/${p}/variables/${key}`),
  connections: (id: string, p: string) => request<S.ConnectionDto[]>('GET', `${t(id)}/projects/${p}/connections`),
  saveConnection: (id: string, p: string, input: In<typeof S.ConnectionInput>, key?: string) =>
    request<S.ConnectionDto[]>(key ? 'PUT' : 'POST', `${t(id)}/projects/${p}/connections${key ? `/${key}` : ''}`, input),
  deleteConnection: (id: string, p: string, key: string) => request<S.ConnectionDto[]>('DELETE', `${t(id)}/projects/${p}/connections/${key}`),
  testConnection: (id: string, p: string, key: string) => request<S.TestResult>('POST', `${t(id)}/projects/${p}/connections/${key}/test`),
  testConnectionDraft: (id: string, p: string, input: In<typeof S.ConnectionInput>) => request<S.TestResult>('POST', `${t(id)}/projects/${p}/connection-test`, input),
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
  explore: (id: string, p: string, entity?: string | null) =>
    request<S.ExploreDto>('GET', `${t(id)}/projects/${p}/explore${qs({ entity })}`),
  places: (id: string, p: string, parent?: string | null) => request<S.PlaceNode[]>('GET', `${t(id)}/projects/${p}/places${qs({ parent })}`),
  searchPlaces: (id: string, p: string, q: string) => request<S.SearchHit[]>('GET', `${t(id)}/projects/${p}/search${qs({ q })}`),
  overlays: (id: string, p: string) => request<S.MapOverlayDto[]>('GET', `${t(id)}/projects/${p}/overlays`),
  saveOverlay: (id: string, p: string, input: In<typeof S.MapOverlayInput>, key?: string) =>
    request<S.MapOverlayDto[]>(key ? 'PUT' : 'POST', `${t(id)}/projects/${p}/overlays${key ? `/${key}` : ''}`, input),
  deleteOverlay: (id: string, p: string, key: string) => request<S.MapOverlayDto[]>('DELETE', `${t(id)}/projects/${p}/overlays/${key}`),
  overlayValues: (id: string, p: string, key: string, entity?: string | null, period: S.OverlayPeriod = {}) =>
    request<S.OverlayResult>('GET', `${t(id)}/projects/${p}/overlays/${key}/values${qs({ entity, ...period })}`),
  permissionGroups: (id: string, p: string) => request<S.PermissionGroupDto[]>('GET', `${t(id)}/projects/${p}/permission-groups`),
  savePermissionGroup: (id: string, p: string, input: In<typeof S.PermissionGroupInput>, groupId?: string) =>
    request<S.PermissionGroupDto[]>(groupId ? 'PUT' : 'POST', `${t(id)}/projects/${p}/permission-groups${groupId ? `/${groupId}` : ''}`, input),
  deletePermissionGroup: (id: string, p: string, groupId: string) => request<S.PermissionGroupDto[]>('DELETE', `${t(id)}/projects/${p}/permission-groups/${groupId}`),
  filterValues: (id: string, p: string, dashboard: string, filter: string, cf?: string) => request<string[]>('GET', `${t(id)}/projects/${p}/dashboards/${dashboard}/filters/${filter}/values${qs({ cf })}`),
  widget: (id: string, p: string, dashboard: string, widget: string, params: S.DashboardParams = {}) =>
    request<S.QueryResult>('GET', `${t(id)}/projects/${p}/dashboards/${dashboard}/widgets/${widget}${qs(params)}`),
  files: (id: string, p: string) => request<S.FileDto[]>('GET', `${t(id)}/projects/${p}/files`),
  uploadFile: (id: string, p: string, key: string, file: File) =>
    request<S.UploadResult>('PUT', `${t(id)}/projects/${p}/files/${key}${qs({ name: file.name, type: file.type || undefined })}`, file),
  deleteFile: (id: string, p: string, key: string) => request<S.FileDto[]>('DELETE', `${t(id)}/projects/${p}/files/${key}`),
  rerun: (id: string, p: string, runId: string) => request<S.RunDto>('POST', `${t(id)}/projects/${p}/runs/${runId}/rerun`),
  cancelRun: (id: string, p: string, runId: string) =>
    request<S.RunDetail>('POST', `${t(id)}/projects/${p}/runs/${runId}/cancel`),
  datasets: (id: string, p: string) => request<S.DatasetDto[]>('GET', `${t(id)}/projects/${p}/datasets`),
  saveDataset: (id: string, p: string, input: In<typeof S.DatasetInput>, key?: string) =>
    request<S.DatasetDto[]>(key ? 'PUT' : 'POST', `${t(id)}/projects/${p}/datasets${key ? `/${key}` : ''}`, input),
  runSql: (id: string, p: string, input: In<typeof S.SqlRunInput>) =>
    request<S.SqlResult>('POST', `${t(id)}/projects/${p}/sql/run`, input),
  catalog: (id: string, p: string, connection: string) =>
    request<S.CatalogDto>('GET', `${t(id)}/projects/${p}/connections/${connection}/catalog`),
  localSources: (id: string, p: string) => request<S.LocalSourcesDto>('GET', `${t(id)}/projects/${p}/sql/sources`),
  refreshDataset: (id: string, p: string, key: string) =>
    request<S.DatasetDto[]>('POST', `${t(id)}/projects/${p}/datasets/${key}/refresh`),
  datasetVersions: (id: string, p: string, key: string) => request<S.DatasetVersionDto[]>('GET', `${t(id)}/projects/${p}/datasets/${key}/versions`),
  deleteDataset: (id: string, p: string, key: string) => request<S.DatasetDto[]>('DELETE', `${t(id)}/projects/${p}/datasets/${key}`),
  uploadDatasetRows: (id: string, p: string, key: string, input: In<typeof S.DatasetRowsInput>) =>
    request<{ rows: number; added: number }>('PUT', `${t(id)}/projects/${p}/datasets/${key}/rows`, input),
  overlayGroups: (id: string, p: string) => request<S.OverlayGroupDto[]>('GET', `${t(id)}/projects/${p}/overlay-groups`),
  saveOverlayGroup: (id: string, p: string, input: In<typeof S.OverlayGroupInput>, groupId?: string) =>
    request<S.OverlayGroupDto[]>(groupId ? 'PUT' : 'POST', `${t(id)}/projects/${p}/overlay-groups${groupId ? `/${groupId}` : ''}`, input),
  deleteOverlayGroup: (id: string, p: string, groupId: string) => request<S.OverlayGroupDto[]>('DELETE', `${t(id)}/projects/${p}/overlay-groups/${groupId}`),
  projectFormGroups: (id: string, p: string) => request<S.FormGroupDto[]>('GET', `${t(id)}/projects/${p}/form-groups`),
  saveProjectFormGroup: (id: string, p: string, input: In<typeof S.FormGroupInput>, groupId?: string) =>
    request<S.FormGroupDto[]>(groupId ? 'PUT' : 'POST', `${t(id)}/projects/${p}/form-groups${groupId ? `/${groupId}` : ''}`, input),
  deleteProjectFormGroup: (id: string, p: string, groupId: string) => request<S.FormGroupDto[]>('DELETE', `${t(id)}/projects/${p}/form-groups/${groupId}`),
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
  uploadAttachment: (id: string, p: string, formKey: string, file: Blob, name: string) =>
    request<S.AttachmentDto>('PUT', `${t(id)}/projects/${p}/forms/${formKey}/attachments${qs({ name, type: file.type || 'application/octet-stream' })}`, file),
  /** A stored picture as bytes (the API needs the sign-in token, so an <img src> cannot fetch it). */
  attachment: async (id: string, p: string, attachmentId: string): Promise<Blob> => {
    const token = await accessToken();
    const res = await fetch(`${env.apiUrl}${t(id)}/projects/${p}/attachments/${attachmentId}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('The picture could not be loaded');
    return res.blob();
  },
  formLinks: (id: string, p: string, key: string) => request<S.FormLinkDto[]>('GET', `${t(id)}/projects/${p}/forms/${key}/links`),
  createFormLinks: (id: string, p: string, key: string, input: In<typeof S.FormLinkInput>) =>
    request<S.FormLinkDto[]>('POST', `${t(id)}/projects/${p}/forms/${key}/links`, input),
  updateFormLink: (id: string, p: string, key: string, linkId: string, input: In<typeof S.FormLinkUpdate>) =>
    request<S.FormLinkDto[]>('PATCH', `${t(id)}/projects/${p}/forms/${key}/links/${linkId}`, input),
  revokeFormLink: (id: string, p: string, key: string, linkId: string) =>
    request<S.FormLinkDto[]>('DELETE', `${t(id)}/projects/${p}/forms/${key}/links/${linkId}`),
  // Work: tickets, tasks, visits, maintenance.
  workTypes: (id: string, p: string) => request<S.WorkTypeDto[]>('GET', `${t(id)}/projects/${p}/work/types`),
  saveWorkType: (id: string, p: string, input: In<typeof S.WorkTypeInput>, key?: string) =>
    request<S.WorkTypeDto[]>(key ? 'PUT' : 'POST', `${t(id)}/projects/${p}/work/types${key ? `/${key}` : ''}`, input),
  deleteWorkType: (id: string, p: string, key: string) => request<S.WorkTypeDto[]>('DELETE', `${t(id)}/projects/${p}/work/types/${key}`),
  workSchedules: (id: string, p: string) => request<S.WorkScheduleDto[]>('GET', `${t(id)}/projects/${p}/work/schedules`),
  saveWorkSchedule: (id: string, p: string, input: In<typeof S.WorkScheduleInput>, key?: string) =>
    request<S.WorkScheduleDto[]>(key ? 'PUT' : 'POST', `${t(id)}/projects/${p}/work/schedules${key ? `/${key}` : ''}`, input),
  deleteWorkSchedule: (id: string, p: string, key: string) => request<S.WorkScheduleDto[]>('DELETE', `${t(id)}/projects/${p}/work/schedules/${key}`),
  work: (id: string, p: string, query: Partial<S.WorkQuery>) => request<S.WorkPageDto>('GET', `${t(id)}/projects/${p}/work${qs(query)}`),
  workItem: (id: string, p: string, itemId: string) => request<S.WorkDetailDto>('GET', `${t(id)}/projects/${p}/work/${itemId}`),
  createWork: (id: string, p: string, input: In<typeof S.WorkItemInput>) => request<S.WorkDetailDto>('POST', `${t(id)}/projects/${p}/work`, input),
  updateWork: (id: string, p: string, itemId: string, patch: In<typeof S.WorkItemUpdate>) => request<S.WorkDetailDto>('PATCH', `${t(id)}/projects/${p}/work/${itemId}`, patch),
  commentWork: (id: string, p: string, itemId: string, input: In<typeof S.WorkComment>) => request<S.WorkDetailDto>('POST', `${t(id)}/projects/${p}/work/${itemId}/comments`, input),
  myWork: (id: string) => request<S.WorkMineDto>('GET', `${t(id)}/work/mine`),
  // A form opened through a link: no sign-in.
  publicForm: (path: string) => request<S.PublicFormDto>('GET', `/public/forms/${path}`, undefined, { anonymous: true }),
  publicCaptcha: () => request<S.CaptchaChallenge>('GET', '/public/captcha', undefined, { anonymous: true }),
  /** A document made from a submission, as bytes (the API needs the sign-in token, so a plain link cannot fetch it). */
  submissionDocument: async (id: string, p: string, formKey: string, submissionId: string, docId: string, format: S.DocumentFormat): Promise<Blob> => {
    const token = await accessToken();
    const res = await fetch(`${env.apiUrl}${t(id)}/projects/${p}/forms/${formKey}/submissions/${submissionId}/documents/${docId}${qs({ format })}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('The document could not be made');
    return res.blob();
  },
  saveDocumentDraft: (id: string, p: string, formKey: string, input: S.DocumentDraftInput) => request<void>('PUT', `${t(id)}/projects/${p}/forms/${formKey}/documents/draft`, input),
  publishDocuments: (id: string, p: string, formKey: string, document?: string) => request<void>('POST', `${t(id)}/projects/${p}/forms/${formKey}/documents/publish${document ? `?document=${encodeURIComponent(document)}` : ''}`),
  discardDocuments: (id: string, p: string, formKey: string, document?: string) => request<void>('POST', `${t(id)}/projects/${p}/forms/${formKey}/documents/discard${document ? `?document=${encodeURIComponent(document)}` : ''}`),
  documentRevisions: (id: string, p: string, formKey: string, docId: string) => request<S.DocumentRevisionDto[]>('GET', `${t(id)}/projects/${p}/forms/${formKey}/documents/${docId}/revisions`),
  /** A trial document from the template being edited, with sample answers. */
  sampleDocument: async (id: string, p: string, formKey: string, input: In<typeof S.DocumentSampleInput>): Promise<Blob> => {
    const token = await accessToken();
    const res = await fetch(`${env.apiUrl}${t(id)}/projects/${p}/forms/${formKey}/documents/sample`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? 'The sample could not be made');
    return res.blob();
  },
  publicFormPlaces: (path: string, question: string, of?: string) => request<S.PublicPlaceDto[]>('GET', `/public/forms/${path}/places${qs({ question, of })}`, undefined, { anonymous: true }),
  publicUploadAttachment: (path: string, file: Blob, name: string) =>
    request<S.AttachmentDto>('PUT', `/public/forms/${path}/attachments${qs({ name, type: file.type || 'application/octet-stream' })}`, file, { anonymous: true }),
  publicAttachment: async (path: string, attachmentId: string): Promise<Blob> => {
    const res = await fetch(`${env.apiUrl}/public/forms/${path}/attachments/${attachmentId}`);
    if (!res.ok) throw new Error('The file could not be loaded');
    return res.blob();
  },
  publicEmailCode: (path: string, email: string) => request<S.EmailCodeSent>('POST', `/public/forms/${path}/email-code`, { email }, { anonymous: true }),
  publicStartPayment: (path: string, input: In<typeof S.StartPaymentInput>) => request<S.PaymentStarted>('POST', `/public/forms/${path}/payments`, input, { anonymous: true }),
  publicPaymentState: (path: string, id: string) => request<S.PaymentState>('GET', `/public/forms/${path}/payments/${id}`, undefined, { anonymous: true }),
  publicSubmit: (path: string, input: In<typeof S.PublicSubmissionInput>) =>
    request<{ message: string }>('POST', `/public/forms/${path}/submissions`, input, { anonymous: true }),
  formVersions: (id: string, p: string, key: string) => request<S.FormVersionDto[]>('GET', `${t(id)}/projects/${p}/forms/${key}/versions`),
  archiveForm: (id: string, p: string, key: string) =>
    request<S.FormDto[]>('DELETE', `${t(id)}/projects/${p}/forms/${key}`),
  submit: (id: string, p: string, key: string, input: In<typeof S.SubmissionInput>) =>
    request<S.SubmissionDto>('POST', `${t(id)}/projects/${p}/forms/${key}/submissions`, input),
  submissions: (id: string, p: string, key: string, query: { page: number; pageSize: number; entityId?: string; status?: S.SubmissionStatus }) =>
    request<Page<S.SubmissionDto>>('GET', `${t(id)}/projects/${p}/forms/${key}/submissions${qs(query)}`),
  submission: (id: string, p: string, subId: string) => request<S.SubmissionDto>('GET', `${t(id)}/projects/${p}/submissions/${subId}`),
  review: (id: string, p: string, subId: string, input: In<typeof S.ReviewInput>) =>
    request<S.SubmissionDto>('POST', `${t(id)}/projects/${p}/submissions/${subId}/review`, input),
  resubmit: (id: string, p: string, subId: string, input: In<typeof S.ResubmitInput>) =>
    request<S.SubmissionDto>('PUT', `${t(id)}/projects/${p}/submissions/${subId}`, input),
  formsMenu: (id: string) => request<S.FormsMenuDto>('GET', `${t(id)}/forms/menu`),
  inbox: (id: string) => request<S.InboxDto>('GET', `${t(id)}/forms/inbox`),
  formGroups: (id: string) => request<S.FormGroupDto[]>('GET', `${t(id)}/form-groups`),
  saveFormGroup: (id: string, input: In<typeof S.FormGroupInput>, groupId?: string) =>
    request<S.FormGroupDto[]>(groupId ? 'PUT' : 'POST', `${t(id)}/form-groups${groupId ? `/${groupId}` : ''}`, input),
  deleteFormGroup: (id: string, groupId: string) => request<S.FormGroupDto[]>('DELETE', `${t(id)}/form-groups/${groupId}`),

  // public (no sign-in)
  publicProject: (tenant: string, project: string) =>
    request<S.PublicProjectDto>('GET', `/public/projects/${tenant}/${project}`, undefined, { anonymous: true }),
  publicWidget: (tenant: string, project: string, dashboard: string, widget: string, params: S.DashboardParams = {}) =>
    request<S.QueryResult>(
      'GET',
      `/public/projects/${tenant}/${project}/dashboards/${dashboard}/widgets/${widget}${qs(params)}`,
      undefined,
      { anonymous: true },
    ),
  publicExplore: (tenant: string, project: string, entity?: string | null) =>
    request<S.ExploreDto>('GET', `/public/projects/${tenant}/${project}/explore${qs({ entity })}`, undefined, { anonymous: true }),
  publicOverlays: (tenant: string, project: string) =>
    request<S.MapOverlayDto[]>('GET', `/public/projects/${tenant}/${project}/overlays`, undefined, { anonymous: true }),
  publicOverlay: (tenant: string, project: string, key: string, entity?: string | null, period: S.OverlayPeriod = {}) =>
    request<S.OverlayResult>('GET', `/public/projects/${tenant}/${project}/overlays/${key}/values${qs({ entity, ...period })}`, undefined, { anonymous: true }),
  publicPlaces: (tenant: string, project: string, parent?: string | null) =>
    request<S.PlaceNode[]>('GET', `/public/projects/${tenant}/${project}/places${qs({ parent })}`, undefined, { anonymous: true }),
  publicSearch: (tenant: string, project: string, q: string) =>
    request<S.SearchHit[]>('GET', `/public/projects/${tenant}/${project}/search${qs({ q })}`, undefined, { anonymous: true }),
  publicAreas: (tenant: string, project: string, dashboard: string) =>
    request<{ id: string; name: string; type: { key: string; name: string } }[]>('GET', `/public/projects/${tenant}/${project}/dashboards/${dashboard}/areas`, undefined, { anonymous: true }),

  // billing (organisation self-service)
  billing: (id: string) => request<OrgBillingDto>('GET', `${t(id)}/billing`),
  billingPlans: (id: string) => request<OrgPlanDto[]>('GET', `${t(id)}/billing/plans`),
  invoices: (id: string, page: { page: number; pageSize: number }) =>
    request<Page<InvoiceDto>>('GET', `${t(id)}/billing/invoices${qs(page)}`),
  /** An invoice, or the receipt for a paid one, as PDF bytes (the API needs the sign-in token). */
  invoicePdf: async (id: string, invoiceId: string, kind: 'invoice' | 'receipt'): Promise<Blob> => {
    const token = await accessToken();
    const res = await fetch(`${env.apiUrl}${t(id)}/billing/invoices/${invoiceId}/pdf?kind=${kind}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('The PDF could not be created');
    return res.blob();
  },
  payments: (id: string) => request<S.PaymentsDto>('GET', `${t(id)}/payments`),
  /** The payments as a CSV file, narrowed by the same filters as the list. */
  exportPayments: async (id: string, f: { status?: string; form?: string; method?: string; from?: string; to?: string; q?: string }): Promise<Blob> => {
    const token = await accessToken();
    const res = await fetch(`${env.apiUrl}${t(id)}/payments/export${qs(f)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('The file could not be made');
    return res.blob();
  },
  /** One receipt as a PDF. */
  paymentReceipt: async (id: string, paymentId: string): Promise<Blob> => {
    const token = await accessToken();
    const res = await fetch(`${env.apiUrl}${t(id)}/payments/${paymentId}/receipt`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('The receipt could not be made');
    return res.blob();
  },
  /** Several receipts as a ZIP of separate PDFs; payments that went no further have none (`skipped`). */
  paymentReceipts: async (id: string, ids: string[]): Promise<{ blob: Blob; count: number; skipped: number }> => {
    const token = await accessToken();
    const res = await fetch(`${env.apiUrl}${t(id)}/payments/receipts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error('The receipts could not be made');
    return { blob: await res.blob(), count: Number(res.headers.get('x-receipts') ?? 0), skipped: Number(res.headers.get('x-receipts-skipped') ?? 0) };
  },
  /** Where the person who paid gets their receipt. */
  publicReceiptUrl: (path: string, paymentId: string) => `${env.apiUrl}/public/forms/${path}/payments/${paymentId}/receipt`,
  /** The merchants a form can be set to pay (names and logos only). */
  merchantChoices: (id: string) => request<Pick<S.MerchantDto, 'id' | 'name' | 'mode' | 'enabled' | 'logo' | 'methods'>[]>('GET', `${t(id)}/payments/merchant-choices`),
  addMethod: (id: string, input: In<typeof S.MethodInput>) => request<S.PaymentsDto>('POST', `${t(id)}/payments/methods`, input),
  changeMethod: (id: string, key: string, input: In<typeof S.MethodInput>) => request<S.PaymentsDto>('PUT', `${t(id)}/payments/methods/${key}`, input),
  removeMethod: (id: string, key: string) => request<S.PaymentsDto>('DELETE', `${t(id)}/payments/methods/${key}`),
  addMerchant: (id: string, input: In<typeof S.MerchantInput>) => request<S.PaymentsDto>('POST', `${t(id)}/payments/merchants`, input),
  changeMerchant: (id: string, merchantId: string, input: In<typeof S.MerchantInput>) => request<S.PaymentsDto>('PUT', `${t(id)}/payments/merchants/${merchantId}`, input),
  removeMerchant: (id: string, merchantId: string) => request<S.PaymentsDto>('DELETE', `${t(id)}/payments/merchants/${merchantId}`),
  setCancellation: (id: string, cancel: boolean) =>
    request<OrgBillingDto>('PUT', `${t(id)}/billing/cancellation`, { cancel }),
  invoice: (id: string, invoiceId: string) =>
    request<InvoiceDto>('GET', `${t(id)}/billing/invoices/${invoiceId}`),
  workspace: (id: string) =>
    request<WorkspaceDto>('GET', `${t(id)}/workspace`).then((w) => ({ ...w, theme: ThemeSchema.parse(w.theme) })),
  emailPreview: (id: string, input: In<typeof S.EmailPreviewInput>) => request<S.EmailPreviewDto>('POST', `${t(id)}/email/preview`, input),
  emailTest: (id: string, input: In<typeof S.EmailTestInput>) => request<{ sent: boolean; to: string }>('POST', `${t(id)}/email/test`, input),
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
  activeSessions: (id: string) => request<ActiveSessionsDto>('GET', `${t(id)}/sessions`),
  pastSessions: (id: string) => request<PastSessionsDto>('GET', `${t(id)}/sessions/past`),
  revokeSession: (id: string, sessionId: string) =>
    request<ActiveSessionsDto>('DELETE', `${t(id)}/sessions/${sessionId}`),
  setSessionPolicy: (id: string, policy: SessionPolicy) =>
    request<TenantDetail>('PUT', `${t(id)}/session-policy`, policy),
  oauthClients: (id: string) => request<OAuthClientsDto>('GET', `${t(id)}/oauth-clients`),
  createOAuthClient: (id: string, input: In<typeof S.OAuthClientInput>) =>
    request<CreatedOAuthClient>('POST', `${t(id)}/oauth-clients`, input),
  updateOAuthClient: (id: string, clientId: string, input: In<typeof S.OAuthClientUpdate>) =>
    request<OAuthClientDto>('PATCH', `${t(id)}/oauth-clients/${clientId}`, input),
  rotateOAuthSecret: (id: string, clientId: string) =>
    request<CreatedOAuthClient>('POST', `${t(id)}/oauth-clients/${clientId}/secret`),
  deleteOAuthClient: (id: string, clientId: string) =>
    request<void>('DELETE', `${t(id)}/oauth-clients/${clientId}`),
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
  tickets: (id: string, q: { status?: string; audience?: string; assignee?: string; label?: string; stage?: string; channel?: string; favorite?: string; untouched?: string; priority?: string; q?: string; page?: number; pageSize?: number } = {}) =>
    request<Page<TicketSummary>>('GET', `${t(id)}/tickets${qs(q)}`),
  ticketStats: (id: string) => request<S.TicketStats>('GET', `${t(id)}/tickets/stats`),
  setFavorite: (ticketId: string, favorite: boolean) => request<S.TicketDetail>('PUT', `/tickets/${ticketId}/favorite`, { favorite }),
  agentTyping: (id: string, ticketId: string, typing: boolean) => request<void>('POST', `${t(id)}/tickets/${ticketId}/typing`, { typing }),
  linkTicket: (id: string, ticketId: string, input: S.TicketLinkInput) => request<S.TicketDetail>('POST', `${t(id)}/tickets/${ticketId}/links`, input),
  unlinkTicket: (id: string, ticketId: string, linkId: string) => request<S.TicketDetail>('DELETE', `${t(id)}/tickets/${ticketId}/links/${linkId}`),
  updateOrgTicket: (id: string, ticketId: string, patch: S.OrgTicketUpdate) => request<S.TicketDetail>('PATCH', `${t(id)}/tickets/${ticketId}`, patch),
  escalateTicket: (id: string, ticketId: string, note?: string) =>
    request<S.TicketDetail>('POST', `${t(id)}/tickets/${ticketId}/escalate`, { note }),
  platform: () => request<S.PlatformSettingsDto>('GET', '/public/platform', undefined, { anonymous: true }),
  createTicket: (id: string, input: In<typeof S.CreateTicketInput>) =>
    request<TicketDetail>('POST', `${t(id)}/tickets`, input),
  ticket: (ticketId: string) => request<TicketDetail>('GET', `/tickets/${ticketId}`),
  replyTicket: (ticketId: string, input: { body: string; internal?: boolean; attachments?: string[]; parentId?: string }) =>
    request<TicketDetail>('POST', `/tickets/${ticketId}/messages`, input),
  editTicketMessage: (ticketId: string, messageId: string, body: string) => request<TicketDetail>('PATCH', `/tickets/${ticketId}/messages/${messageId}`, { body }),
  resolveThread: (ticketId: string, messageId: string, resolved: boolean) => request<TicketDetail>('POST', `/tickets/${ticketId}/messages/${messageId}/resolve`, { resolved }),
  // The organisation's help desk: its stages, labels and how it takes requests.
  supportDesk: (id: string) => request<S.HelpDeskConfig>('GET', `${t(id)}/support/desk`),
  saveSupportDesk: (id: string, input: S.HelpDeskConfigInput) => request<S.HelpDeskConfig>('PUT', `${t(id)}/support/desk`, input),
  supportHandlers: (id: string) => request<{ id: string; name: string; email: string | null }[]>('GET', `${t(id)}/support/handlers`),
  uploadSupportFile: (id: string, file: Blob, name: string) =>
    request<S.SupportAttachmentDto>('PUT', `${t(id)}/support/files${qs({ name, type: file.type || 'application/octet-stream' })}`, file),
  /** A ticket's file as bytes (the API needs the sign-in token). */
  supportFile: async (fileId: string): Promise<Blob> => {
    const token = await accessToken();
    const res = await fetch(`${env.apiUrl}/support/files/${fileId}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('The file could not be loaded');
    return res.blob();
  },
  // Help for people on the organisation's public pages (no account needed).
  publicHelpInfo: (slug: string) => request<S.SupportInfo>('GET', `/public/orgs/${slug}/help`, undefined, { anonymous: true }),
  publicHelpEmbedCheck: (slug: string, token: string) => request<{ ok: boolean; host: string | null; identity: { name?: string; email?: string } | null }>('GET', `/public/orgs/${slug}/help/embed-check${qs({ token })}`, undefined, { anonymous: true }),
  embedUsage: (id: string) => request<S.SupportEmbedUsage>('GET', `${t(id)}/support/desk/embed-usage`),
  embedSecret: (id: string, siteId: string) => request<{ secret: string }>('GET', `${t(id)}/support/desk/embed-secret${qs({ siteId })}`),
  rotateEmbedSecret: (id: string, siteId: string) => request<S.HelpDeskConfig>('POST', `${t(id)}/support/desk/embed-secret`, { siteId }),
  checkSupportSite: (id: string, host: string) => request<S.SupportSiteCheck>('POST', `${t(id)}/support/desk/check-site`, { host }),
  rotateEmbedKey: (id: string, siteId: string) => request<S.HelpDeskConfig>('POST', `${t(id)}/support/desk/embed-key`, { siteId }),
  publicHelpCreate: (slug: string, input: S.SupportRequestInput) => request<S.SupportSent>('POST', `/public/orgs/${slug}/help/requests`, input, { anonymous: true }),
  publicHelpUpload: (slug: string, file: Blob, name: string) =>
    request<S.SupportAttachmentDto>('PUT', `/public/orgs/${slug}/help/files${qs({ name, type: file.type || 'application/octet-stream' })}`, file, { anonymous: true }),
  publicHelpEmailCode: (slug: string, email: string) => request<{ expiresInMinutes: number }>('POST', `/public/orgs/${slug}/help/email-code`, { email }, { anonymous: true }),
  publicHelpEmailVerify: (slug: string, email: string, code: string) => request<{ proof: string }>('POST', `/public/orgs/${slug}/help/email-verify`, { email, code }, { anonymous: true }),
  publicHelpTyping: (token: string, text: string) => request<void>('POST', `/public/help/${token}/typing`, { text }, { anonymous: true }),
  publicHelpThread: (token: string) => request<S.SupportThreadDto>('GET', `/public/help/${token}`, undefined, { anonymous: true }),
  publicHelpReply: (token: string, input: S.SupportReplyInput) => request<S.SupportThreadDto>('POST', `/public/help/${token}/messages`, input, { anonymous: true }),
  publicHelpUploadReply: (token: string, file: Blob, name: string) =>
    request<S.SupportAttachmentDto>('PUT', `/public/help/${token}/files${qs({ name, type: file.type || 'application/octet-stream' })}`, file, { anonymous: true }),

  // activity
  insights: (id: string) => request<S.OrgInsightsDto>('GET', `${t(id)}/insights`),
  activity: (id: string, query: Partial<S.AuditQuery>) =>
    request<AuditPage>('GET', `${t(id)}/activity${qs(query)}`),
  activitySummary: (id: string, query: Partial<S.ActivitySummaryQuery> = {}) => request<S.ActivitySummaryDto>('GET', `${t(id)}/activity/summary${qs(query)}`),
  projectActivitySummary: (id: string, p: string, query: Partial<S.ActivitySummaryQuery> = {}) => request<S.ActivitySummaryDto>('GET', `${t(id)}/projects/${p}/activity/summary${qs(query)}`),
  projectActivity: (id: string, p: string, query: Partial<S.AuditQuery>) =>
    request<AuditPage>('GET', `${t(id)}/projects/${p}/activity${qs(query)}`),
};
