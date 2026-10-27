import { sql, type RawBuilder } from 'kysely';

/** The subtrees (ltree paths) a member is limited to. null = the whole project; [] = nothing. */
export type Scope = string[] | null;

/** Whether `path` lies inside one of the subtrees. */
export const within = (scope: Scope, path: string | null): boolean =>
  scope === null || (!!path && scope.some((r) => path === r || path.startsWith(`${r}.`)));

/** `and <col> <@ any(subtrees)`, or nothing for the whole project. */
export const scopeAnd = (col: string, scope: Scope): RawBuilder<unknown> => (scope ? sql`and ${sql.raw(col)} <@ any(${scope}::ltree[])` : sql``);
