import { applyParams, type DashboardDto, type ExploreDto, type MapOverlayDto, type OverlayResult, type QueryResult, type SearchHit, type Widget } from '@grids/schema';
import { api } from '../api';

/** Where the explorer reads from: a member's project, or a public project anonymously. */
export interface ExplorerSource {
  /** Query-key prefix: [kind, scopeA, scopeB] so live events can invalidate it. */
  keys: { explore: unknown[]; overlays: unknown[]; dashboards: unknown[]; widget: unknown[]; search: unknown[]; names: unknown[] };
  explore(entity: string | null): Promise<ExploreDto>;
  overlays(): Promise<MapOverlayDto[]>;
  overlay(key: string, entity: string | null): Promise<OverlayResult>;
  search(q: string): Promise<SearchHit[]>;
  dashboards(): Promise<DashboardDto[]>;
  /** Data element key → name (chart legends). */
  names(): Promise<Record<string, string>>;
  widget(d: DashboardDto, w: Widget, params: { entity?: string; hours?: number }): Promise<QueryResult>;
}

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
    dashboards: () => api.dashboards(tenantId, project),
    names: async () => Object.fromEntries((await api.elements(tenantId, project)).map((e) => [e.key, e.name])),
    widget: (d, w, params) => api.query(tenantId, project, applyParams(w.query!, params, { areaType: null, period: d.filters.period })),
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
    dashboards: async () => dashboards,
    names: async () => Object.fromEntries(elements.map((e) => [e.key, e.name])),
    widget: (d, w, params) => api.publicWidget(tenant, project, d.key, w.id, params),
  };
}
