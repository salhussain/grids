import { sql, type Transaction } from 'kysely';
import type { CellDB } from '@grids/db';
import {
  MapOverlayInput,
  uuidv7,
  type ExploreDto,
  type ExplorePlace,
  type MapOverlay,
  type MapOverlayDto,
  type OverlayResult,
  type PlaceNode,
  type SearchHit,
} from '@grids/schema';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { canSee, type ProjectService } from './projects.js';
import type { QueryService } from './query.js';
import { iso, isUniqueViolation } from './util.js';

type Tx = Transaction<CellDB>;
type Feature = { type: 'Feature'; id: string; geometry: unknown; properties: Record<string, unknown> };

/** Roll-up aggregations over the observations (`v`) of a place's subtree. */
const ROLLUP: Record<MapOverlay['aggregation'], string> = {
  sum: 'sum(v)',
  avg: 'avg(v)',
  min: 'min(v)',
  max: 'max(v)',
  count: 'count(*)',
  distinct: 'count(distinct c_id)',
  last: '(array_agg(v order by at desc))[1]',
};

const placeSelect = sql`e.id, e.name, e.code, t.key as type_key, t.name as type_name, t.plural as type_plural, t.color as type_color`;
type PlaceRow = { id: string; name: string; code: string; type_key: string; type_name: string; type_plural: string; type_color: string };
const toPlace = (r: PlaceRow): ExplorePlace => ({
  id: r.id,
  name: r.name,
  code: r.code,
  type: { key: r.type_key, name: r.type_name, plural: r.type_plural, color: r.type_color },
});

/**
 * The project explorer (spec §9): places on the map, drilling down the
 * hierarchy, and map overlays whose values roll up each place's subtree.
 * Scoped members only ever see their own subtree.
 */
export class ExploreService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
    private readonly query: QueryService,
  ) {}

  // ---------- overlays (configuration) ----------

  private async overlayRows(tx: Tx, projectId: string, publicOnly = false): Promise<MapOverlayDto[]> {
    let q = tx.selectFrom('map_overlay').selectAll().where('project_id', '=', projectId).orderBy('sort').orderBy('key');
    if (publicOnly) q = q.where('is_public', '=', true);
    const rows = (await q.execute()).filter((r) => !publicOnly || !(r.config as { permissionGroup?: string | null }).permissionGroup);
    const names = new Map(
      (await tx.selectFrom('data_element').select(['key', 'name']).where('project_id', '=', projectId).execute()).map((d) => [d.key, d.name]),
    );
    return rows.map((r) => {
      const o = MapOverlayInput.parse({ ...r.config, key: r.key, isPublic: r.is_public });
      return { ...o, id: r.id, elementName: names.get(o.element) ?? o.element, updatedAt: iso(r.updated_at) };
    });
  }

  async overlays(actor: Actor, tenantId: string, project: string): Promise<MapOverlayDto[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return (await this.projects.cellTx(tenantId, (tx) => this.overlayRows(tx, a.project.id))).filter((o) => canSee(a, o.permissionGroup));
  }

  async saveOverlay(actor: Actor, tenantId: string, project: string, input: MapOverlay, existingKey?: string): Promise<MapOverlayDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    try {
      await this.projects.cellTx(tenantId, async (tx) => {
        const el = await tx.selectFrom('data_element').select('id').where('project_id', '=', a.project.id).where('key', '=', input.element).executeTakeFirst();
        if (!el) throw badRequest(`Unknown data element "${input.element}"`);
        await this.projects.assertGroup(tx, a.project.id, input.permissionGroup);
        if (input.level) {
          const t = await tx.selectFrom('entity_type').select('id').where('project_id', '=', a.project.id).where('key', '=', input.level).executeTakeFirst();
          if (!t) throw badRequest(`Unknown entity type "${input.level}"`);
        }
        const sorted = [...input.thresholds].sort((x, y) => x - y);
        const { key, isPublic, ...config } = { ...input, thresholds: sorted };
        const values = { key, is_public: isPublic, config: JSON.stringify(config), updated_at: this.ctx.now() };
        if (existingKey) {
          const r = await tx.updateTable('map_overlay').set(values).where('project_id', '=', a.project.id).where('key', '=', existingKey).executeTakeFirst();
          if (!r.numUpdatedRows) throw notFound('Overlay');
        } else {
          const n = await tx.selectFrom('map_overlay').select((eb) => eb.fn.countAll<string>().as('n')).where('project_id', '=', a.project.id).executeTakeFirstOrThrow();
          await tx.insertInto('map_overlay').values({ id: uuidv7(), tenant_id: tenantId, project_id: a.project.id, sort: Number(n.n), ...values }).execute();
        }
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Key taken', `An overlay with key "${input.key}" already exists.`);
      throw e;
    }
    await audit(this.ctx, actor.id, tenantId, existingKey ? 'overlay.updated' : 'overlay.created', { project: a.project.key, overlay: input.key });
    return this.overlays(actor, tenantId, project);
  }

  async deleteOverlay(actor: Actor, tenantId: string, project: string, key: string): Promise<MapOverlayDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, (tx) => tx.deleteFrom('map_overlay').where('project_id', '=', a.project.id).where('key', '=', key).execute());
    await audit(this.ctx, actor.id, tenantId, 'overlay.deleted', { project: a.project.key, overlay: key });
    return this.overlays(actor, tenantId, project);
  }

  // ---------- navigation ----------

  /** The place to show: the requested one (within scope), else the caller's root (or the project). */
  private async place(tx: Tx, projectId: string, rootPath: string | null, entityId: string | null): Promise<{ row: PlaceRow; path: string; parentId: string | null } | null> {
    const id = entityId;
    if (!id && !rootPath) return null;
    const r = await sql<PlaceRow & { path: string; parent_id: string | null }>`
      select ${placeSelect}, e.path::text as path, e.parent_id
      from entity e join entity_type t on t.id = e.type_id
      where e.project_id = ${projectId}
        ${id ? sql`and e.id = ${id}` : sql`and e.path = ${rootPath}::ltree`}
        ${rootPath ? sql`and e.path <@ ${rootPath}::ltree` : sql``}
    `.execute(tx);
    const row = r.rows[0];
    if (!row) throw notFound('Place');
    return { row, path: row.path, parentId: row.parent_id };
  }

  async exploreIn(tx: Tx, projectId: string, rootPath: string | null, entityId: string | null): Promise<ExploreDto> {
    const p = await this.place(tx, projectId, rootPath, entityId);
    const ancestors = p
      ? (
          await sql<PlaceRow>`
            select ${placeSelect} from entity e join entity_type t on t.id = e.type_id
            where e.project_id = ${projectId} and e.path @> ${p.path}::ltree and e.path <> ${p.path}::ltree
              ${rootPath ? sql`and e.path <@ ${rootPath}::ltree` : sql``}
            order by nlevel(e.path)
          `.execute(tx)
        ).rows.map(toPlace)
      : [];
    const scope = p ? sql`and e.path <@ ${p.path}::ltree` : sql``;
    const ext = await sql<{ b: string | null }>`
      select ST_AsGeoJSON(ST_Extent(e.geom)) as b from entity e where e.project_id = ${projectId} and e.geom is not null ${scope}
    `.execute(tx);
    let bounds: ExploreDto['bounds'] = null;
    if (ext.rows[0]?.b) {
      const coords = (JSON.parse(ext.rows[0].b) as { coordinates: unknown }).coordinates;
      const flat: [number, number][] = [];
      const walk = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === 'number') flat.push(c as [number, number]);
        else if (Array.isArray(c)) c.forEach(walk);
      };
      walk(coords);
      const xs = flat.map((c) => c[0]);
      const ys = flat.map((c) => c[1]);
      bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    const kids = await sql<PlaceRow & { geo: string; has_children: boolean }>`
      select ${placeSelect}, ST_AsGeoJSON(e.geom, 6) as geo,
        exists (select 1 from entity c where c.parent_id = e.id) as has_children
      from entity e join entity_type t on t.id = e.type_id
      where e.project_id = ${projectId} and e.geom is not null
        and ${p ? sql`e.parent_id = ${p.row.id}` : sql`e.parent_id is null`}
      order by e.name
      limit 5000
    `.execute(tx);
    const feature = (r: PlaceRow & { geo: string; has_children?: boolean }): Feature => ({
      type: 'Feature',
      id: r.id,
      geometry: JSON.parse(r.geo),
      properties: { id: r.id, name: r.name, code: r.code, type: r.type_key, typeName: r.type_name, color: r.type_color, hasChildren: !!r.has_children },
    });
    const counts = new Map<string, number>();
    for (const k of kids.rows) counts.set(k.type_plural, (counts.get(k.type_plural) ?? 0) + 1);
    const childLevel = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    let self: Feature | null = null;
    if (p) {
      const g = await sql<{ geo: string | null }>`select ST_AsGeoJSON(geom, 6) as geo from entity where id = ${p.row.id}`.execute(tx);
      if (g.rows[0]?.geo) self = feature({ ...p.row, geo: g.rows[0].geo });
    }
    return { entity: p ? toPlace(p.row) : null, ancestors, bounds, children: { type: 'FeatureCollection', features: kids.rows.map(feature) }, childLevel, self };
  }

  async explore(actor: Actor, tenantId: string, project: string, entityId: string | null): Promise<ExploreDto> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, (tx) => this.exploreIn(tx, a.project.id, a.rootPath, entityId));
  }

  // ---------- overlay values ----------

  /**
   * Values of an overlay for the places shown under `entityId`: its children, or
   * its descendants of the overlay's level. Each value aggregates the
   * observations of the place and everything inside it.
   */
  async overlayIn(tx: Tx, projectId: string, rootPath: string | null, o: MapOverlay, entityId: string | null): Promise<OverlayResult> {
    const p = await this.place(tx, projectId, rootPath, entityId);
    const shown = o.level
      ? sql`exists (select 1 from entity_type lt where lt.id = e.type_id and lt.key = ${o.level}) ${p ? sql`and e.path <@ ${p.path}::ltree` : sql``}`
      : p
        ? sql`e.parent_id = ${p.row.id}`
        : sql`e.parent_id is null`;
    const from = o.hours ? new Date(this.ctx.now().getTime() - o.hours * 3_600_000) : null;
    const obs = from
      ? sql`select o.entity_id, o.value_num as v, o.at from observation o where o.project_id = ${projectId} and o.element_id = (select id from data_element where project_id = ${projectId} and key = ${o.element}) and o.at >= ${from}`
      : sql`select distinct on (o.entity_id) o.entity_id, o.value_num as v, o.at from observation o
            where o.project_id = ${projectId} and o.element_id = (select id from data_element where project_id = ${projectId} and key = ${o.element})
            order by o.entity_id, o.at desc`;
    const rows = await sql<PlaceRow & { geo: string; value: number | null; has_children: boolean }>`
      with shown as (
        select e.id, e.path from entity e
        where e.project_id = ${projectId} and e.geom is not null and ${shown}
          ${rootPath ? sql`and e.path <@ ${rootPath}::ltree` : sql``}
        limit 5000
      ),
      obs as (${obs}),
      vals as (
        select s.id, ${sql.raw(ROLLUP[o.aggregation])}::float8 as value
        from shown s
        join entity c on c.path <@ s.path
        join (select entity_id as c_id, v, at from obs) x on x.c_id = c.id
        group by s.id
      )
      select ${placeSelect}, ST_AsGeoJSON(e.geom, 6) as geo, v.value,
        exists (select 1 from entity k where k.parent_id = e.id) as has_children
      from shown s join entity e on e.id = s.id join entity_type t on t.id = e.type_id
      left join vals v on v.id = s.id
      order by e.name
    `.execute(tx);
    const values = rows.rows.map((r) => r.value).filter((v): v is number => v !== null);
    const features = rows.rows.map((r) => ({
      type: 'Feature' as const,
      id: r.id,
      geometry: JSON.parse(r.geo),
      properties: { id: r.id, name: r.name, code: r.code, type: r.type_key, typeName: r.type_name, hasChildren: r.has_children, value: r.value === null ? null : Math.round(r.value * 1e6) / 1e6 },
    }));
    return {
      features: { type: 'FeatureCollection', features },
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      freshness: await this.query.projectFreshness(tx, projectId),
    };
  }

  async overlay(actor: Actor, tenantId: string, project: string, key: string, entityId: string | null): Promise<OverlayResult> {
    const a = await this.projects.access(actor, tenantId, project);
    const o = await this.projects.cellTx(tenantId, async (tx) => (await this.overlayRows(tx, a.project.id)).find((x) => x.key === key));
    if (!o || !canSee(a, o.permissionGroup)) throw notFound('Overlay');
    return this.query.cached(tenantId, a.project.id, a.rootPath, { overlay: o, entityId }, () =>
      this.projects.cellTx(tenantId, (tx) => this.overlayIn(tx, a.project.id, a.rootPath, o, entityId)),
    );
  }

  // ---------- hierarchy browser ----------

  /** Places directly inside `parentId` (the top level, or a scoped member's own root). */
  async childrenIn(tx: Tx, projectId: string, rootPath: string | null, parentId: string | null): Promise<PlaceNode[]> {
    const where = parentId
      ? sql`e.parent_id = ${parentId} ${rootPath ? sql`and e.path <@ ${rootPath}::ltree` : sql``}`
      : rootPath
        ? sql`e.path = ${rootPath}::ltree`
        : sql`e.parent_id is null`;
    const rows = await sql<PlaceRow & { n: number }>`
      select ${placeSelect}, (select count(*)::int from entity c where c.parent_id = e.id) as n
      from entity e join entity_type t on t.id = e.type_id
      where e.project_id = ${projectId} and ${where}
      order by t.sort, e.name
      limit 1000
    `.execute(tx);
    return rows.rows.map((r) => ({ ...toPlace(r), hasChildren: r.n > 0, childCount: r.n }));
  }

  async children(actor: Actor, tenantId: string, project: string, parentId: string | null): Promise<PlaceNode[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, (tx) => this.childrenIn(tx, a.project.id, a.rootPath, parentId));
  }

  async publicChildren(tenantSlug: string, projectKey: string, parentId: string | null) {
    const t = await this.publicIds(tenantSlug, projectKey);
    return this.projects.cellTx(t.tenantId, (tx) => this.childrenIn(tx, t.projectId, null, parentId));
  }

  // ---------- search ----------

  async searchIn(tx: Tx, projectId: string, rootPath: string | null, q: string): Promise<SearchHit[]> {
    const term = q.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`);
    if (!term) return [];
    const rows = await sql<PlaceRow & { trail: string | null }>`
      select ${placeSelect},
        (select string_agg(a.name, ' › ' order by nlevel(a.path)) from entity a
          where a.project_id = e.project_id and a.path @> e.path and a.path <> e.path) as trail
      from entity e join entity_type t on t.id = e.type_id
      where e.project_id = ${projectId} and (lower(e.name) like ${`%${term}%`} or lower(e.code) = ${term})
        ${rootPath ? sql`and e.path <@ ${rootPath}::ltree` : sql``}
      order by (lower(e.name) like ${`${term}%`}) desc, nlevel(e.path), e.name
      limit 12
    `.execute(tx);
    return rows.rows.map((r) => ({ ...toPlace(r), path: r.trail ?? '' }));
  }

  async search(actor: Actor, tenantId: string, project: string, q: string): Promise<SearchHit[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, (tx) => this.searchIn(tx, a.project.id, a.rootPath, q));
  }

  // ---------- public projects ----------

  private async publicIds(tenantSlug: string, projectKey: string) {
    const { tenant, project } = await this.query.publicProject(tenantSlug, projectKey);
    return { tenantId: tenant.id, projectId: project.id };
  }

  async publicExplore(tenantSlug: string, projectKey: string, entityId: string | null) {
    const t = await this.publicIds(tenantSlug, projectKey);
    return this.projects.cellTx(t.tenantId, (tx) => this.exploreIn(tx, t.projectId, null, entityId));
  }

  async publicOverlays(tenantSlug: string, projectKey: string) {
    const t = await this.publicIds(tenantSlug, projectKey);
    return this.projects.cellTx(t.tenantId, (tx) => this.overlayRows(tx, t.projectId, true));
  }

  async publicOverlay(tenantSlug: string, projectKey: string, key: string, entityId: string | null) {
    const t = await this.publicIds(tenantSlug, projectKey);
    const o = await this.projects.cellTx(t.tenantId, async (tx) => (await this.overlayRows(tx, t.projectId, true)).find((x) => x.key === key));
    if (!o) throw notFound('Overlay');
    return this.query.cached(t.tenantId, t.projectId, null, { overlay: o, entityId }, () =>
      this.projects.cellTx(t.tenantId, (tx) => this.overlayIn(tx, t.projectId, null, o, entityId)),
    );
  }

  async publicSearch(tenantSlug: string, projectKey: string, q: string) {
    const t = await this.publicIds(tenantSlug, projectKey);
    return this.projects.cellTx(t.tenantId, (tx) => this.searchIn(tx, t.projectId, null, q));
  }
}
