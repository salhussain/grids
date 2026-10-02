import type { OrgUnitDto } from '@grids/schema';

/** Ids of `roots` and all their descendants. */
export function subtreeIds(units: OrgUnitDto[], roots: string[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const u of units)
    if (u.parentId) children.set(u.parentId, [...(children.get(u.parentId) ?? []), u.id]);
  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    (children.get(id) ?? []).forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/** Indented label for selects: "— — Northland". */
export const indent = (u: OrgUnitDto) =>
  `${'— '.repeat(u.depth)}${u.name}${u.levelLabel ? ` (${u.levelLabel})` : ''}`;
