import type { DashboardDto, DashboardParams, ExploreDto, MapOverlayDto, OverlayResult, PlaceNode, QueryResult, SearchHit, Widget } from '@grids/schema';

/** Where the explorer reads from: a member's project, or a public project anonymously. */
export interface ExplorerSource {
  /** Query-key prefix: [kind, scopeA, scopeB] so live events can invalidate it. */
  keys: { explore: unknown[]; overlays: unknown[]; dashboards: unknown[]; widget: unknown[]; search: unknown[]; names: unknown[] };
  explore(entity: string | null): Promise<ExploreDto>;
  overlays(): Promise<MapOverlayDto[]>;
  overlay(key: string, entity: string | null): Promise<OverlayResult>;
  search(q: string): Promise<SearchHit[]>;
  /** Places directly inside a place (null = the top). */
  places(parent: string | null): Promise<PlaceNode[]>;
  dashboards(): Promise<DashboardDto[]>;
  /** Data element key → name (chart legends). */
  names(): Promise<Record<string, string>>;
  widget(d: DashboardDto, w: Widget, params: DashboardParams): Promise<QueryResult>;
}
