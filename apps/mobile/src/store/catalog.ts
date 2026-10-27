import { db } from '../db';

/** Small JSON documents kept for offline use (the projects, the forms of a project). */
export async function readCatalog<T>(key: string): Promise<{ value: T; fetchedAt: number } | null> {
  const r = await (await db()).getFirstAsync<{ value: string; fetched_at: number }>('select value, fetched_at from catalog where key = ?', key);
  return r ? { value: JSON.parse(r.value) as T, fetchedAt: r.fetched_at } : null;
}

export async function writeCatalog(key: string, value: unknown) {
  await (await db()).runAsync('insert or replace into catalog (key, value, fetched_at) values (?, ?, ?)', key, JSON.stringify(value), Date.now());
}

export const catalogKey = {
  projects: (tenantId: string) => `projects:${tenantId}`,
  forms: (tenantId: string, project: string) => `forms:${tenantId}:${project}`,
  me: 'me',
  history: (tenantId: string, project: string) => `history:${tenantId}:${project}`,
};
