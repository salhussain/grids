export interface PlaceRow {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  attributes: Record<string, unknown>;
  point: { lat: number; lon: number } | null;
  shared: boolean;
  updatedAt: string;
}

export interface PlacesPage {
  items: PlaceRow[];
  next: string | null;
  serverTime: string;
  ids: string[] | null;
}

export interface PlacesStore {
  /** The `serverTime` of the last complete download of this scope, if any. */
  cursor(scope: string): Promise<string | null>;
  upsert(scope: string, rows: PlaceRow[]): Promise<void>;
  /** Forget the places of this scope that are not in `keep`. */
  prune(scope: string, keep: Set<string>): Promise<number>;
  setCursor(scope: string, serverTime: string): Promise<void>;
}

export interface PlacesApi {
  page(since: string | null, after: string | null): Promise<PlacesPage>;
}

export interface PlacesResult {
  changed: number;
  removed: number;
}

/**
 * Brings the places of one scope (a project) up to date: only what changed since last time, and
 * anything no longer visible is dropped. The cursor moves only after the whole download worked,
 * so an interrupted one starts again from the same point.
 */
export async function syncPlaces(store: PlacesStore, api: PlacesApi, scope: string): Promise<PlacesResult> {
  const since = await store.cursor(scope);
  let after: string | null = null;
  let started: string | null = null;
  let changed = 0;
  for (;;) {
    const page = await api.page(since, after);
    started ??= page.serverTime;
    await store.upsert(scope, page.items);
    changed += page.items.length;
    if (!page.next) {
      const removed = page.ids ? await store.prune(scope, new Set(page.ids)) : 0;
      await store.setCursor(scope, started);
      return { changed, removed };
    }
    after = page.next;
  }
}
