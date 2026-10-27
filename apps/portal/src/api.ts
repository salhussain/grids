import type * as S from '@grids/schema';
import type { MeDto } from '@grids/schema';
import { createRequester, qs } from '@grids/ui';
import { currentUser } from './auth';
import { env } from './env';

const request = createRequester(env.apiUrl, async () => (await currentUser())?.access_token ?? null);
const t = (id: string) => `/tenants/${id}`;

export const api = {
  publicCatalogue: () => request<S.PublicProjectCard[]>('GET', '/public/projects', undefined, { anonymous: true }),
  me: () => request<MeDto>('GET', '/me'),
  projects: (id: string, archived = false) =>
    request<S.ProjectDto[]>('GET', `${t(id)}/projects${qs({ archived: archived || undefined })}`),
  elements: (id: string, p: string) =>
    request<S.DataElementDto[]>('GET', `${t(id)}/projects/${p}/elements`),
  dashboards: (id: string, p: string) =>
    request<S.DashboardDto[]>('GET', `${t(id)}/projects/${p}/dashboards`),
  explore: (id: string, p: string, entity?: string | null) =>
    request<S.ExploreDto>('GET', `${t(id)}/projects/${p}/explore${qs({ entity })}`),
  places: (id: string, p: string, parent?: string | null) => request<S.PlaceNode[]>('GET', `${t(id)}/projects/${p}/places${qs({ parent })}`),
  searchPlaces: (id: string, p: string, q: string) => request<S.SearchHit[]>('GET', `${t(id)}/projects/${p}/search${qs({ q })}`),
  overlays: (id: string, p: string) => request<S.MapOverlayDto[]>('GET', `${t(id)}/projects/${p}/overlays`),
  overlayValues: (id: string, p: string, key: string, entity?: string | null, period: S.OverlayPeriod = {}) =>
    request<S.OverlayResult>('GET', `${t(id)}/projects/${p}/overlays/${key}/values${qs({ entity, ...period })}`),
  widget: (id: string, p: string, dashboard: string, widget: string, params: S.DashboardParams = {}) =>
    request<S.QueryResult>('GET', `${t(id)}/projects/${p}/dashboards/${dashboard}/widgets/${widget}${qs(params)}`),
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
  // Help for people on a public page (no account needed).
  publicHelpInfo: (slug: string) => request<S.SupportInfo>('GET', `/public/orgs/${slug}/help`, undefined, { anonymous: true }),
  publicCaptcha: () => request<S.CaptchaChallenge>('GET', '/public/captcha', undefined, { anonymous: true }),
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
  helpTyping: (id: string, thread: string, text: string) => request<void>('POST', `${t(id)}/help/requests/${thread}/typing`, { text }),
  helpInfo: (id: string) => request<S.SupportInfo>('GET', `${t(id)}/help`),
  helpMine: (id: string) => request<S.SupportMineDto>('GET', `${t(id)}/help/requests`),
  helpCreate: (id: string, input: S.SupportRequestInput) => request<S.SupportSent>('POST', `${t(id)}/help/requests`, input),
  helpThread: (id: string, requestId: string) => request<S.SupportThreadDto>('GET', `${t(id)}/help/requests/${requestId}`),
  helpReply: (id: string, requestId: string, input: S.SupportReplyInput) => request<S.SupportThreadDto>('POST', `${t(id)}/help/requests/${requestId}/messages`, input),
  helpUpload: (id: string, file: Blob, name: string) =>
    request<S.SupportAttachmentDto>('PUT', `${t(id)}/help/files${qs({ name, type: file.type || 'application/octet-stream' })}`, file),
  /** A file that came with a message, as bytes (the API needs the sign-in token). */
  helpFile: async (id: string, fileId: string): Promise<Blob> => {
    const token = (await currentUser())?.access_token;
    const res = await fetch(`${env.apiUrl}${t(id)}/help/files/${fileId}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('The file could not be loaded');
    return res.blob();
  },
  createTicket: (id: string, input: S.CreateTicketInput) => request<S.TicketDetail>('POST', `${t(id)}/tickets`, input),
  platform: () => request<S.PlatformSettingsDto>('GET', '/public/platform', undefined, { anonymous: true }),
};
