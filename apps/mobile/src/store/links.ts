import type { FormDefinition, PublicFormDto, PublicPlaceDto } from '@grids/schema';
import { db } from '../db';

export interface SavedLink {
  path: string;
  name: string;
  projectName: string;
  definition: FormDefinition;
  version: number;
  askName: boolean;
}

interface Row {
  path: string;
  name: string;
  project_name: string;
  definition: string;
  version: number;
  ask_name: number;
}

const toLink = (r: Row): SavedLink => ({ path: r.path, name: r.name, projectName: r.project_name, definition: JSON.parse(r.definition), version: r.version, askName: !!r.ask_name });

/** Forms opened from a link, kept so they can be filled in without a connection. */
export async function saveLink(path: string, f: PublicFormDto, places: Record<string, PublicPlaceDto[]>) {
  const d = await db();
  await d.withTransactionAsync(async () => {
    await d.runAsync('insert or replace into links (path, name, project_name, definition, version, ask_name, added_at) values (?, ?, ?, ?, ?, ?, ?)', path, f.name, f.projectName, JSON.stringify(f.definition), f.version, f.askName ? 1 : 0, Date.now());
    await d.runAsync('delete from link_places where path = ?', path);
    for (const [q, rows] of Object.entries(places)) await d.runAsync('insert into link_places (path, question, rows) values (?, ?, ?)', path, q, JSON.stringify(rows));
  });
}

export async function listLinks(): Promise<SavedLink[]> {
  return (await (await db()).getAllAsync<Row>('select * from links order by added_at desc')).map(toLink);
}

export async function getLink(path: string): Promise<SavedLink | null> {
  const r = await (await db()).getFirstAsync<Row>('select * from links where path = ?', path);
  return r ? toLink(r) : null;
}

export async function linkPlaces(path: string, question: string): Promise<PublicPlaceDto[]> {
  const r = await (await db()).getFirstAsync<{ rows: string }>('select rows from link_places where path = ? and question = ?', path, question);
  return r ? (JSON.parse(r.rows) as PublicPlaceDto[]) : [];
}

export async function removeLink(path: string) {
  await (await db()).runAsync('delete from links where path = ?', path);
}

/** The address people are given is `…/f/<path>`; the code alone works too. */
export const pathFromLink = (text: string): string | null => {
  const m = text.trim().match(/(?:\/f\/)?([A-Za-z0-9_-]{40,120})\/?(?:[?#].*)?$/);
  return m?.[1] ?? null;
};
