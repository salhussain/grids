import type { PlaceRow, PlacesStore } from '@grids/offline';
import { db } from '../db';

interface Row {
  id: string;
  code: string;
  name: string;
  type: string;
  parent_id: string | null;
  attributes: string;
  lat: number | null;
  lon: number | null;
  shared: number;
}

export interface Place {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
}

const toPlace = (r: Row): Place => ({ id: r.id, code: r.code, name: r.name, type: r.type, parentId: r.parent_id });

export const sqlitePlaces: PlacesStore = {
  async cursor(scope) {
    return (await (await db()).getFirstAsync<{ server_time: string }>('select server_time from cursors where scope = ?', scope))?.server_time ?? null;
  },
  async upsert(scope, rows: PlaceRow[]) {
    const d = await db();
    await d.withTransactionAsync(async () => {
      for (const r of rows) {
        await d.runAsync(
          'insert or replace into places (scope, id, code, name, type, parent_id, attributes, lat, lon, shared) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          scope, r.id, r.code, r.name, r.type, r.parentId, JSON.stringify(r.attributes), r.point?.lat ?? null, r.point?.lon ?? null, r.shared ? 1 : 0,
        );
      }
    });
  },
  async prune(scope, keep) {
    const d = await db();
    const have = await d.getAllAsync<{ id: string }>('select id from places where scope = ?', scope);
    const gone = have.filter((r) => !keep.has(r.id));
    await d.withTransactionAsync(async () => {
      for (const r of gone) await d.runAsync('delete from places where scope = ? and id = ?', scope, r.id);
    });
    return gone.length;
  },
  async setCursor(scope, serverTime) {
    await (await db()).runAsync('insert or replace into cursors (scope, server_time) values (?, ?)', scope, serverTime);
  },
};

export interface PlaceQuery {
  scope: string;
  type?: string | undefined;
  q?: string | undefined;
  /** Only places under (or directly in) these parents. */
  parentIds?: string[] | undefined;
  /** Only these places. */
  ids?: string[] | undefined;
  limit?: number | undefined;
}

/** Places for a picker, from what is on the device. */
export async function findPlaces(query: PlaceQuery): Promise<Place[]> {
  const where = ['scope = ?'];
  const args: (string | number)[] = [query.scope];
  if (query.type) {
    where.push('type = ?');
    args.push(query.type);
  }
  if (query.parentIds) {
    if (!query.parentIds.length) return [];
    where.push(`parent_id in (${query.parentIds.map(() => '?').join(',')})`);
    args.push(...query.parentIds);
  }
  if (query.ids) {
    if (!query.ids.length) return [];
    where.push(`id in (${query.ids.map(() => '?').join(',')})`);
    args.push(...query.ids);
  }
  if (query.q) {
    where.push(`(lower(name) like ? escape '\\' or lower(code) like ? escape '\\')`);
    const like = `%${query.q.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`;
    args.push(like, like);
  }
  const rows = await (await db()).getAllAsync<Row>(`select * from places where ${where.join(' and ')} order by name limit ?`, ...args, query.limit ?? 100);
  return rows.map(toPlace);
}

export async function placeById(scope: string, id: string): Promise<Place | null> {
  const r = await (await db()).getFirstAsync<Row>('select * from places where scope = ? and id = ?', scope, id);
  return r ? toPlace(r) : null;
}

/** The ids under a place: its children, or everything below it. */
export async function placesUnder(scope: string, id: string, relation: 'children' | 'descendants'): Promise<string[]> {
  const d = await db();
  let level = [id];
  const out: string[] = [];
  while (level.length) {
    const rows = await d.getAllAsync<{ id: string }>(`select id from places where scope = ? and parent_id in (${level.map(() => '?').join(',')})`, scope, ...level);
    level = rows.map((r) => r.id);
    out.push(...level);
    if (relation === 'children') break;
  }
  return out;
}

/** The places above one (parent, grandparent…), nearest first. */
export async function placesAbove(scope: string, id: string, relation: 'parent' | 'ancestors'): Promise<string[]> {
  const out: string[] = [];
  let at = await placeById(scope, id);
  while (at?.parentId) {
    out.push(at.parentId);
    if (relation === 'parent') break;
    at = await placeById(scope, at.parentId);
  }
  return out;
}

export async function placeCount(scope: string) {
  return (await (await db()).getFirstAsync<{ n: number }>('select count(*) as n from places where scope = ?', scope))?.n ?? 0;
}
