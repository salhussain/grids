import type { ExplorerSource } from '@grids/viz';
import type { DashboardDto } from '@grids/schema';
import { api } from '../api';

export function memberSource(tenantId: string, project: string): ExplorerSource {
  return {
    keys: {
      explore: ['explore', tenantId, project],
      overlays: ['overlays', tenantId, project],
      dashboards: ['dashboards', tenantId, project],
      widget: ['widget', tenantId, project],
      search: ['place-search', tenantId, project],
      names: ['element-names', tenantId, project],
    },
    explore: (entity) => api.explore(tenantId, project, entity),
    overlays: () => api.overlays(tenantId, project),
    overlay: (key, entity) => api.overlayValues(tenantId, project, key, entity),
    search: (q) => api.searchPlaces(tenantId, project, q),
    places: (parent) => api.places(tenantId, project, parent),
    dashboards: () => api.dashboards(tenantId, project),
    names: async () => Object.fromEntries((await api.elements(tenantId, project)).map((e) => [e.key, e.name])),
    widget: (d, w, params) => api.widget(tenantId, project, d.key, w.id, params),
  };
}

export function publicSource(tenant: string, project: string, dashboards: DashboardDto[], elements: { key: string; name: string }[]): ExplorerSource {
  return {
    keys: {
      explore: ['public-explore', tenant, project],
      overlays: ['public-overlays', tenant, project],
      dashboards: ['public-dashboards', tenant, project],
      widget: ['public-widget', tenant, project],
      search: ['public-search', tenant, project],
      names: ['public-elements', tenant, project],
    },
    explore: (entity) => api.publicExplore(tenant, project, entity),
    overlays: () => api.publicOverlays(tenant, project),
    overlay: (key, entity) => api.publicOverlay(tenant, project, key, entity),
    search: (q) => api.publicSearch(tenant, project, q),
    places: (parent) => api.publicPlaces(tenant, project, parent),
    dashboards: async () => dashboards,
    names: async () => Object.fromEntries(elements.map((e) => [e.key, e.name])),
    widget: (d, w, params) => api.publicWidget(tenant, project, d.key, w.id, params),
  };
}
