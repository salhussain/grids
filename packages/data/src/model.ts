import { sql, type Kysely, type Transaction } from 'kysely';
import type { CellDB } from '@grids/db';
import { uuidv7, type AttributeDef, type Geometry } from '@grids/schema';

export type CellTx = Kysely<CellDB> | Transaction<CellDB>;

/** ltree label for an entity: its id without dashes. */
export const label = (id: string) => id.replace(/-/g, '');

export class DataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Coerces raw values (strings from CSV, numbers from JSON…) to an attribute's type. */
export function coerceAttribute(def: AttributeDef, v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null;
  switch (def.type) {
    case 'number': {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    case 'integer': {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
      return Number.isFinite(n) ? Math.round(n) : null;
    }
    case 'boolean':
      if (typeof v === 'boolean') return v;
      return ['true', 'yes', 'y', '1'].includes(String(v).trim().toLowerCase());
    case 'date': {
      const s = String(v).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    default:
      return String(v).trim().slice(0, 2000);
  }
}

export function coerceAttributes(defs: AttributeDef[], raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) if (d.key in raw) out[d.key] = coerceAttribute(d, raw[d.key]);
  return out;
}

export interface TypeInfo {
  id: string;
  key: string;
  name: string;
  attributes: AttributeDef[];
  parentTypes: string[];
  geometry: string;
}

export async function entityType(tx: CellTx, projectId: string, key: string): Promise<TypeInfo> {
  const t = await tx
    .selectFrom('entity_type')
    .select(['id', 'key', 'name', 'attributes', 'parent_types', 'geometry'])
    .where('project_id', '=', projectId)
    .where('key', '=', key)
    .executeTakeFirst();
  if (!t) throw new DataError(`Unknown entity type "${key}"`, 404);
  return { id: t.id, key: t.key, name: t.name, attributes: t.attributes as AttributeDef[], parentTypes: t.parent_types, geometry: t.geometry };
}

export interface EntityRowInput {
  code: string;
  name: string;
  /** Parent by id, or by code (within `parentType`, else any allowed parent type). */
  parentId?: string | null;
  parentCode?: string | null;
  parentType?: string | null;
  attributes?: Record<string, unknown>;
  geometry?: Geometry | null;
}

export interface UpsertResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  ids: Map<string, string>;
}

const geoKey = (g: Geometry | null | undefined) => (g ? JSON.stringify(g.coordinates, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)) : '');

/**
 * Creates or updates entities of one type by code (idempotent for jobs and imports).
 * Attributes merge into the current state; every change is recorded in entity_change.
 * `scopePath` restricts writes to a subtree (scoped project members).
 */
export async function upsertEntities(
  tx: CellTx,
  opts: {
    tenantId: string;
    projectId: string;
    typeKey: string;
    rows: EntityRowInput[];
    source: string;
    sourceRef?: string | null;
    actorId?: string | null;
    scopePath?: string | null;
  },
): Promise<UpsertResult> {
  const type = await entityType(tx, opts.projectId, opts.typeKey);
  const result: UpsertResult = { created: 0, updated: 0, unchanged: 0, skipped: 0, ids: new Map() };
  // Last row wins for duplicate codes within a batch.
  const rows = [...new Map(opts.rows.filter((r) => r.code && r.name).map((r) => [String(r.code), r])).values()];
  result.skipped = opts.rows.length - rows.length;
  if (!rows.length) return result;

  const existing = new Map(
    (
      await tx
        .selectFrom('entity')
        .select(['id', 'code', 'name', 'attributes', 'parent_id', sql<string>`path::text`.as('path'), sql<string | null>`ST_AsGeoJSON(geom, 6)`.as('geo')])
        .where('project_id', '=', opts.projectId)
        .where('type_id', '=', type.id)
        .where('code', 'in', rows.map((r) => String(r.code)))
        .execute()
    ).map((e) => [e.code, e]),
  );

  // Resolve parents in bulk.
  const parentCodes = [...new Set(rows.map((r) => r.parentCode).filter((c): c is string => !!c))];
  const parentIds = [...new Set(rows.map((r) => r.parentId).filter((c): c is string => !!c))];
  const parentTypeKeys = rows.some((r) => r.parentType) ? [...new Set(rows.map((r) => r.parentType).filter((c): c is string => !!c))] : type.parentTypes;
  const parents = new Map<string, { id: string; path: string; typeKey: string }>();
  if (parentCodes.length || parentIds.length) {
    const found = await tx
      .selectFrom('entity as e')
      .innerJoin('entity_type as t', 't.id', 'e.type_id')
      .select(['e.id', 'e.code', sql<string>`e.path::text`.as('path'), 't.key as type_key'])
      .where('e.project_id', '=', opts.projectId)
      .where((eb) =>
        eb.or([
          ...(parentIds.length ? [eb('e.id', 'in', parentIds)] : []),
          ...(parentCodes.length && parentTypeKeys.length ? [eb.and([eb('e.code', 'in', parentCodes), eb('t.key', 'in', parentTypeKeys)])] : []),
        ]),
      )
      .execute();
    for (const p of found) {
      parents.set(`id:${p.id}`, { id: p.id, path: p.path, typeKey: p.type_key });
      parents.set(`code:${p.code}`, { id: p.id, path: p.path, typeKey: p.type_key });
    }
  }

  const inScope = (path: string) => !opts.scopePath || path === opts.scopePath || path.startsWith(`${opts.scopePath}.`);
  const inserts: { id: string; code: string; name: string; parent_id: string | null; path: string; attributes: string; geo: string | null }[] = [];
  const changes: { tenant_id: string; entity_id: string; changes: string; source: string; source_ref: string | null; actor_id: string | null }[] = [];

  for (const r of rows) {
    const code = String(r.code).slice(0, 80);
    const name = String(r.name).slice(0, 200);
    const attrs = coerceAttributes(type.attributes, r.attributes ?? {});
    const geometry = r.geometry ?? null;
    let parent: { id: string; path: string; typeKey: string } | null = null;
    if (r.parentId || r.parentCode) {
      parent = parents.get(r.parentId ? `id:${r.parentId}` : `code:${r.parentCode}`) ?? null;
      if (!parent) throw new DataError(`Parent ${r.parentCode ?? r.parentId} not found for ${code}`, 422);
      // Parent rules: listed types only; a type with no parent types is top-level.
      if (!type.parentTypes.includes(parent.typeKey))
        throw new DataError(`A ${type.name} can't be placed under a ${parent.typeKey}`, 422);
    }

    const cur = existing.get(code);
    if (!cur) {
      const id = uuidv7();
      const path = parent ? `${parent.path}.${label(id)}` : label(id);
      if (!inScope(path)) throw new DataError(`${code} is outside your part of the project`, 403);
      inserts.push({ id, code, name, parent_id: parent?.id ?? null, path, attributes: JSON.stringify(attrs), geo: geometry ? JSON.stringify(geometry) : null });
      changes.push({ tenant_id: opts.tenantId, entity_id: id, changes: JSON.stringify({ created: true, name, ...attrs }), source: opts.source, source_ref: opts.sourceRef ?? null, actor_id: opts.actorId ?? null });
      result.ids.set(code, id);
      result.created++;
      continue;
    }

    result.ids.set(code, cur.id);
    if (!inScope(cur.path)) throw new DataError(`${code} is outside your part of the project`, 403);
    const before = cur.attributes as Record<string, unknown>;
    const merged = { ...before, ...attrs };
    const diff: Record<string, unknown> = {};
    if (cur.name !== name) diff.name = name;
    for (const [k, v] of Object.entries(attrs)) if (JSON.stringify(before[k] ?? null) !== JSON.stringify(v)) diff[k] = v;
    const curGeo = cur.geo ? (JSON.parse(cur.geo) as Geometry) : null;
    const geoChanged = r.geometry !== undefined && geoKey(curGeo) !== geoKey(geometry);
    if (geoChanged) diff.geometry = geometry ? geometry.type : null;
    const parentChanged = parent && parent.id !== cur.parent_id;
    if (parentChanged) diff.parent = parent!.id;
    if (!Object.keys(diff).length) {
      result.unchanged++;
      continue;
    }
    await tx
      .updateTable('entity')
      .set({
        name,
        attributes: JSON.stringify(merged),
        ...(geoChanged && { geom: geometry ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326)` : null }),
        version: sql`version + 1`,
        updated_at: new Date(),
      })
      .where('id', '=', cur.id)
      .execute();
    if (parentChanged) await moveEntity(tx, cur.id, cur.path, parent!);
    changes.push({ tenant_id: opts.tenantId, entity_id: cur.id, changes: JSON.stringify(diff), source: opts.source, source_ref: opts.sourceRef ?? null, actor_id: opts.actorId ?? null });
    result.updated++;
  }

  for (let i = 0; i < inserts.length; i += 500) {
    await tx
      .insertInto('entity')
      .values(
        inserts.slice(i, i + 500).map((e) => ({
          id: e.id,
          tenant_id: opts.tenantId,
          project_id: opts.projectId,
          type_id: type.id,
          code: e.code,
          name: e.name,
          parent_id: e.parent_id,
          path: e.path,
          attributes: e.attributes,
          geom: e.geo ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${e.geo}), 4326)` : null,
        })),
      )
      .execute();
  }
  for (let i = 0; i < changes.length; i += 1000) await tx.insertInto('entity_change').values(changes.slice(i, i + 1000)).execute();
  return result;
}

/** Re-parents an entity, rewriting the paths of its whole subtree. */
export async function moveEntity(tx: CellTx, id: string, oldPath: string, parent: { id: string; path: string } | null) {
  const newPath = parent ? `${parent.path}.${label(id)}` : label(id);
  if (parent && (parent.path === oldPath || parent.path.startsWith(`${oldPath}.`)))
    throw new DataError('An entity cannot be moved under itself', 422);
  await sql`
    update entity set
      path = case when path = ${oldPath}::ltree then ${newPath}::ltree
                  else ${newPath}::ltree || subpath(path, nlevel(${oldPath}::ltree)) end,
      parent_id = case when id = ${id} then ${parent?.id ?? null}::uuid else parent_id end
    where path <@ ${oldPath}::ltree
  `.execute(tx);
}

export interface ObservationItem {
  entityId: string;
  element: string;
  at: Date;
  value: unknown;
}

/** Upserts observations (entity, element, time) → value. Returns the number written. */
export async function writeObservations(
  tx: CellTx,
  opts: { tenantId: string; projectId: string; items: ObservationItem[]; source: string; sourceRef?: string | null },
): Promise<{ written: number; skipped: number }> {
  if (!opts.items.length) return { written: 0, skipped: 0 };
  const elements = new Map(
    (
      await tx
        .selectFrom('data_element')
        .select(['id', 'key', 'value_type'])
        .where('project_id', '=', opts.projectId)
        .where('key', 'in', [...new Set(opts.items.map((i) => i.element))])
        .execute()
    ).map((e) => [e.key, e]),
  );
  const unknown = [...new Set(opts.items.map((i) => i.element))].filter((k) => !elements.has(k));
  if (unknown.length) throw new DataError(`Unknown data element(s): ${unknown.join(', ')}`, 422);

  // Last value wins for the same (entity, element, time) within a batch.
  const rows = new Map<string, { entity_id: string; element_id: string; at: Date; value_num: number | null; value_text: string | null }>();
  let skipped = 0;
  for (const it of opts.items) {
    const el = elements.get(it.element)!;
    if (it.value === null || it.value === undefined || it.value === '' || Number.isNaN(it.at.getTime())) {
      skipped++;
      continue;
    }
    let value_num: number | null = null;
    let value_text: string | null = null;
    if (el.value_type === 'number') {
      value_num = typeof it.value === 'number' ? it.value : Number(it.value);
      if (!Number.isFinite(value_num)) {
        skipped++;
        continue;
      }
    } else if (el.value_type === 'boolean') {
      value_num = it.value === true || ['true', 'yes', '1'].includes(String(it.value).toLowerCase()) ? 1 : 0;
    } else value_text = String(it.value).slice(0, 2000);
    rows.set(`${it.entityId}|${el.id}|${it.at.toISOString()}`, { entity_id: it.entityId, element_id: el.id, at: it.at, value_num, value_text });
  }
  const values = [...rows.values()].map((r) => ({ ...r, tenant_id: opts.tenantId, project_id: opts.projectId, source: opts.source, source_ref: opts.sourceRef ?? null }));
  for (let i = 0; i < values.length; i += 1000) {
    await tx
      .insertInto('observation')
      .values(values.slice(i, i + 1000))
      .onConflict((oc) =>
        oc.columns(['entity_id', 'element_id', 'at']).doUpdateSet((eb) => ({
          value_num: eb.ref('excluded.value_num'),
          value_text: eb.ref('excluded.value_text'),
          source: eb.ref('excluded.source'),
          source_ref: eb.ref('excluded.source_ref'),
          recorded_at: sql`now()`,
        })),
      )
      .execute();
  }
  return { written: values.length, skipped };
}

/** Looks up entity ids by code for one type. */
export async function entityIdsByCode(tx: CellTx, projectId: string, typeKey: string, codes: string[]): Promise<Map<string, string>> {
  if (!codes.length) return new Map();
  const rows = await tx
    .selectFrom('entity as e')
    .innerJoin('entity_type as t', 't.id', 'e.type_id')
    .select(['e.id', 'e.code'])
    .where('e.project_id', '=', projectId)
    .where('t.key', '=', typeKey)
    .where('e.code', 'in', [...new Set(codes)])
    .execute();
  return new Map(rows.map((r) => [r.code, r.id]));
}
