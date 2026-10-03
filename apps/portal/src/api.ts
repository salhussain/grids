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
  overlayValues: (id: string, p: string, key: string, entity?: string | null) =>
    request<S.OverlayResult>('GET', `${t(id)}/projects/${p}/overlays/${key}/values${qs({ entity })}`),
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
  publicOverlay: (tenant: string, project: string, key: string, entity?: string | null) =>
    request<S.OverlayResult>('GET', `/public/projects/${tenant}/${project}/overlays/${key}/values${qs({ entity })}`, undefined, { anonymous: true }),
  publicPlaces: (tenant: string, project: string, parent?: string | null) =>
    request<S.PlaceNode[]>('GET', `/public/projects/${tenant}/${project}/places${qs({ parent })}`, undefined, { anonymous: true }),
  publicSearch: (tenant: string, project: string, q: string) =>
    request<S.SearchHit[]>('GET', `/public/projects/${tenant}/${project}/search${qs({ q })}`, undefined, { anonymous: true }),
  platform: () => request<S.PlatformSettingsDto>('GET', '/public/platform', undefined, { anonymous: true }),
};
