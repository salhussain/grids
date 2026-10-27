import { inProject } from '@grids/data';
import { scopeAnd, type Scope } from './scope.js';
import { sql, type Transaction } from 'kysely';
import type { CellDB } from '@grids/db';
import {
  MapOverlayInput,
  uuidv7,
  type ExploreDto,
  type ExplorePlace,
  type MapOverlay,
  type MapOverlayDto,
  type OverlayGroupDto,
  type OverlayGroupInput,
  type OverlayPeriod,
  type OverlayResult,
  type PlaceNode,
  type SearchHit,
} from '@grids/schema';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { canSee, markerProps, type ProjectService } from './projects.js';
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
type PlaceRow = {
  id: string;
  name: string;
  code: string;
  type_key: string;
  type_name: string;
  type_plural: string;
  type_color: string;
};
/** Geometry and map marker columns of a place (`e`, type `t`): its shape, or its point when it has none. */
const mapSelect = sql`ST_AsGeoJSON(coalesce(e.geom, e.point), 6) as geo, case when e.geom is not null then ST_AsGeoJSON(e.point, 6) end as pt, t.icon as type_icon, t.marker as type_marker, e.attributes`;
type MapRow = {
  geo: string;
  pt: string | null;
  type_icon: string;
  type_marker: unknown;
  attributes: Record<string, unknown>;
};
const located = sql`(e.geom is not null or e.point is not null)`;
const mapProps = (r: MapRow) =>
  markerProps({ icon: r.type_icon, marker: r.type_marker, attributes: r.attributes, point: r.pt });
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
      (await tx.selectFrom('data_element').select(['ref', 'name']).where('project_id', '=', projectId).execute()).map((d) => [d.ref, d.name]),
    );
    const dsNames = new Map((await tx.selectFrom('dataset').select(['key', 'name']).where('project_id', '=', projectId).execute()).map((d) => [d.key, d.name]));
    const paths = new Map((await this.groupRows(tx, projectId)).map((g) => [g.id, g.path]));
    return rows.map((r) => {
      const groupId = r.group_id && paths.has(r.group_id) ? r.group_id : null;
      const o = MapOverlayInput.parse({ ...r.config, key: r.key, isPublic: r.is_public, groupId, ...(groupId && { group: paths.get(groupId) }) });
      const source = o.element ?? o.dataset?.dataset ?? '';
      return { ...o, id: r.id, elementName: names.get(source) ?? dsNames.get(source) ?? source, updatedAt: iso(r.updated_at) };
    });
  }

  // ---------- overlay groups (levels) ----------

  private async groupRows(tx: Tx, projectId: string): Promise<OverlayGroupDto[]> {
    const rows = await tx
      .selectFrom('map_overlay_group as g')
      .selectAll('g')
      .select((eb) => eb.selectFrom('map_overlay as o').select((e2) => e2.fn.countAll<string>().as('n')).whereRef('o.group_id', '=', 'g.id').as('n'))
      .where('g.project_id', '=', projectId)
      .orderBy('g.sort')
      .orderBy('g.name')
      .execute();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const path = (id: string, seen = new Set<string>()): string => {
      const g = byId.get(id)!;
      if (!g.parent_id || seen.has(g.parent_id) || !byId.has(g.parent_id)) return g.name;
      seen.add(id);
      return `${path(g.parent_id, seen)} › ${g.name}`;
    };
    return rows
      .map((r) => ({ id: r.id, parentId: r.parent_id, name: r.name, path: path(r.id), sort: r.sort, overlayCount: Number(r.n ?? 0) }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async overlayGroups(actor: Actor, tenantId: string, project: string): Promise<OverlayGroupDto[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, (tx) => this.groupRows(tx, a.project.id));
  }

  async saveOverlayGroup(actor: Actor, tenantId: string, project: string, input: OverlayGroupInput & { parentId: string | null; sort: number }, id?: string): Promise<OverlayGroupDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, async (tx) => {
      if (input.parentId) {
        const groups = await this.groupRows(tx, a.project.id);
        if (!groups.some((g) => g.id === input.parentId)) throw badRequest('Unknown parent group');
        // No cycles: the parent may not be this group or one of its descendants.
        for (let p: string | null = input.parentId; p; p = groups.find((g) => g.id === p)?.parentId ?? null)
          if (p === id) throw badRequest('A group cannot sit inside itself');
      }
      const values = { name: input.name, parent_id: input.parentId, sort: input.sort };
      if (id) {
        const r = await tx.updateTable('map_overlay_group').set(values).where('id', '=', id).where('project_id', '=', a.project.id).executeTakeFirst();
        if (!r.numUpdatedRows) throw notFound('Group');
      } else await tx.insertInto('map_overlay_group').values({ id: uuidv7(), tenant_id: tenantId, project_id: a.project.id, ...values }).execute();
    });
    return this.overlayGroups(actor, tenantId, project);
  }

  async deleteOverlayGroup(actor: Actor, tenantId: string, project: string, id: string): Promise<OverlayGroupDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, async (tx) => {
      if (await tx.selectFrom('map_overlay_group').select('id').where('parent_id', '=', id).executeTakeFirst())
        throw conflict('Group has sub-groups', 'Move or delete its sub-groups first.');
      await tx.deleteFrom('map_overlay_group').where('id', '=', id).where('project_id', '=', a.project.id).execute();
    });
    return this.overlayGroups(actor, tenantId, project);
  }

  async overlays(actor: Actor, tenantId: string, project: string): Promise<MapOverlayDto[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return (await this.projects.cellTx(tenantId, (tx) => this.overlayRows(tx, a.project.id))).filter((o) => canSee(a, o.permissionGroup));
  }

  async saveOverlay(actor: Actor, tenantId: string, project: string, input: MapOverlay, existingKey?: string): Promise<MapOverlayDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    try {
      await this.projects.cellTx(tenantId, async (tx) => {
        if (!input.element === !input.dataset) throw badRequest('Choose an indicator or a dataset to colour the map by');
        if (input.element) {
          const el = await tx.selectFrom('data_element').select('id').where('project_id', '=', a.project.id).where('ref', '=', input.element).executeTakeFirst();
          if (!el) throw badRequest(`Unknown data element "${input.element}"`);
        }
        if (input.dataset) {
          const d = input.dataset;
          const ds = await tx.selectFrom('dataset').select('columns').where('project_id', '=', a.project.id).where('key', '=', d.dataset).executeTakeFirst();
          if (!ds) throw badRequest(`Unknown dataset "${d.dataset}"`);
          const cols = new Set(ds.columns as string[]);
          for (const [what, c] of [['place', d.entityColumn], ['value', d.valueColumn], ['date', d.timeColumn]] as const)
            if (c && !cols.has(c)) throw badRequest(`The dataset has no ${what} column "${c}"`);
          if (!d.valueColumn && !['count', 'distinct'].includes(input.aggregation)) throw badRequest('Choose the column with the number, or count the rows');
          if (d.entityType && !(await tx.selectFrom('entity_type').select('id').where('project_id', '=', a.project.id).where('key', '=', d.entityType).executeTakeFirst())) throw badRequest(`Unknown entity type "${d.entityType}"`);
        }
        await this.projects.assertGroup(tx, a.project.id, input.permissionGroup);
        if (input.level) {
          const t = await tx.selectFrom('entity_type').select('id').where('project_id', '=', a.project.id).where('key', '=', input.level).executeTakeFirst();
          if (!t) throw badRequest(`Unknown entity type "${input.level}"`);
        }
        if (input.groupId) {
          const g = await tx.selectFrom('map_overlay_group').select('id').where('id', '=', input.groupId).where('project_id', '=', a.project.id).executeTakeFirst();
          if (!g) throw badRequest('Unknown overlay group');
        }
        const sorted = [...input.thresholds].sort((x, y) => x - y);
        const { key, isPublic, groupId, ...config } = { ...input, thresholds: sorted };
        const values = { key, is_public: isPublic, group_id: groupId, config: JSON.stringify(config), updated_at: this.ctx.now() };
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
  private async place(tx: Tx, projectId: string, roots: Scope, entityId: string | null): Promise<{ row: PlaceRow; path: string; parentId: string | null } | null> {
    const id = entityId;
    // Limited to a single entity: start there. Several: show the project, restricted to them.
    const root = roots?.length === 1 ? roots[0]! : null;
    if (!id && !root) return null;
    const r = await sql<PlaceRow & { path: string; parent_id: string | null }>`
      select ${placeSelect}, e.path::text as path, e.parent_id
      from entity e join entity_type t on t.id = e.type_id
      where ${inProject('e', projectId)}
        ${id ? sql`and e.id = ${id}` : sql`and e.path = ${root}::ltree`}
        ${scopeAnd('e.path', roots)}
    `.execute(tx);
    const row = r.rows[0];
    if (!row) throw notFound('Place');
    return { row, path: row.path, parentId: row.parent_id };
  }

  async exploreIn(tx: Tx, projectId: string, roots: Scope, entityId: string | null): Promise<ExploreDto> {
    const p = await this.place(tx, projectId, roots, entityId);
    const ancestors = p
      ? (
          await sql<PlaceRow>`
            select ${placeSelect} from entity e join entity_type t on t.id = e.type_id
            where ${inProject('e', projectId)} and e.path @> ${p.path}::ltree and e.path <> ${p.path}::ltree
              ${scopeAnd('e.path', roots)}
            order by nlevel(e.path)
          `.execute(tx)
        ).rows.map(toPlace)
      : [];
    const scope = p ? sql`and e.path <@ ${p.path}::ltree` : sql``;
    const ext = await sql<{ b: string | null }>`
      select ST_AsGeoJSON(ST_Extent(coalesce(e.geom, e.point))) as b from entity e where ${inProject('e', projectId)} and ${located} ${scope}
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
    const kids = await sql<PlaceRow & MapRow & { has_children: boolean }>`
      select ${placeSelect}, ${mapSelect},
        exists (select 1 from entity c where c.parent_id = e.id and ${inProject('c', projectId)}) as has_children
      from entity e join entity_type t on t.id = e.type_id
      where ${inProject('e', projectId)} and ${located}
        and ${p ? sql`e.parent_id = ${p.row.id}` : sql`e.parent_id is null`}
      order by e.name
      limit 5000
    `.execute(tx);
    const feature = (r: PlaceRow & MapRow & { has_children?: boolean }): Feature => ({
      type: 'Feature',
      id: r.id,
      geometry: JSON.parse(r.geo),
      properties: {
        ...mapProps(r),
        id: r.id,
        name: r.name,
        code: r.code,
        type: r.type_key,
        typeName: r.type_name,
        color: r.type_color,
        hasChildren: !!r.has_children,
      },
    });
    const counts = new Map<string, number>();
    for (const k of kids.rows) counts.set(k.type_plural, (counts.get(k.type_plural) ?? 0) + 1);
    const childLevel = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    let self: Feature | null = null;
    if (p) {
      const g = await sql<
        MapRow & { geo: string | null }
      >`select ${mapSelect} from entity e join entity_type t on t.id = e.type_id where e.id = ${p.row.id}`.execute(
        tx,
      );
      if (g.rows[0]?.geo) self = feature({ ...p.row, ...g.rows[0], geo: g.rows[0].geo });
    }
    return { entity: p ? toPlace(p.row) : null, ancestors, bounds, children: { type: 'FeatureCollection', features: kids.rows.map(feature) }, childLevel, self };
  }

  async explore(actor: Actor, tenantId: string, project: string, entityId: string | null): Promise<ExploreDto> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, (tx) => this.exploreIn(tx, a.project.id, a.roots, entityId));
  }

  // ---------- overlay values ----------

  /**
   * The rows of a dataset as observations: each row's place found by its key column, with the row's number and date.
   * Without a "latest" window every row counts; with one, only rows inside it (or each place's newest row when `from` is null and a date column is set).
   */
  private datasetObs(projectId: string, d: NonNullable<MapOverlay['dataset']>, from: Date | null, to: Date | null, live: { rows: unknown[]; queriedAt: Date } | null = null) {
    const num = (col: string) => sql`case when dr.data ->> ${col}::text ~ '^\\s*-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?\\s*$' then (dr.data ->> ${col}::text)::float8 end`;
    const at = d.timeColumn ? sql`case when dr.data ->> ${d.timeColumn}::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then (dr.data ->> ${d.timeColumn}::text)::timestamptz end` : sql`ds.last_materialised_at`;
    const match = d.entityKey === 'id' ? sql`c.id::text = dr.data ->> ${d.entityColumn}::text` : d.entityKey === 'name' ? sql`lower(c.name) = lower(dr.data ->> ${d.entityColumn}::text)` : sql`c.code = dr.data ->> ${d.entityColumn}::text`;
    const base = sql`select c.id as entity_id, ${d.valueColumn ? num(d.valueColumn) : sql`1::float8`} as v, ${at} as at
      from dataset ds join ${live ? sql`(select e.value as data from jsonb_array_elements(${JSON.stringify(live.rows)}::jsonb) as e(value)) dr on true` : sql`dataset_row dr on dr.dataset_id = ds.id`}
      join entity c on ${inProject('c', projectId)} and ${match} ${d.entityType ? sql`and exists (select 1 from entity_type ct where ct.id = c.type_id and ct.key = ${d.entityType})` : sql``}
      where ds.project_id = ${projectId} and ds.key = ${d.dataset}`;
    const window = from && d.timeColumn ? sql`where x.at >= ${from} ${to ? sql`and x.at < ${to}` : sql``}` : sql``;
    // No window: a place's latest row (by date when there is one), so a table of daily figures shows today's.
    return !from && d.timeColumn ? sql`select distinct on (x.entity_id) x.entity_id, x.v, x.at from (${base}) x where x.v is not null order by x.entity_id, x.at desc` : sql`select x.entity_id, x.v, x.at from (${base}) x ${window}`;
  }

  /**
   * Values of an overlay for the places shown under `entityId`: its children, or
   * its descendants of the overlay's level. Each value aggregates the
   * observations of the place and everything inside it.
   */
  async overlayIn(tx: Tx, projectId: string, roots: Scope, o: MapOverlay, entityId: string | null, period: OverlayPeriod = {}): Promise<OverlayResult> {
    const p = await this.place(tx, projectId, roots, entityId);
    const shown = o.level
      ? sql`exists (select 1 from entity_type lt where lt.id = e.type_id and lt.key = ${o.level}) ${p ? sql`and e.path <@ ${p.path}::ltree` : sql``}`
      : p
        ? sql`e.parent_id = ${p.row.id}`
        : sql`e.parent_id is null`;
    // The reporting period (when one is picked) replaces the overlay's own window.
    const custom = period.from && period.to ? { from: new Date(`${period.from}T00:00:00Z`), to: new Date(new Date(`${period.to}T00:00:00Z`).getTime() + 86_400_000) } : null;
    const hours = period.hours ?? o.hours;
    const from = custom ? custom.from : hours ? new Date(this.ctx.now().getTime() - hours * 3_600_000) : null;
    const until = custom ? sql`and o.at < ${custom.to}` : sql``;
    // A dataset on a database is read from the database, not from a stored copy.
    let live: { rows: unknown[]; queriedAt: Date } | null = null;
    if (o.dataset) {
      const ds = await tx.selectFrom('dataset').select('tenant_id').where('project_id', '=', projectId).where('key', '=', o.dataset.dataset).executeTakeFirst();
      if (ds) live = await this.query.liveRowsOf(ds.tenant_id, projectId, o.dataset.dataset);
    }
    const obs = o.dataset
      ? this.datasetObs(projectId, o.dataset, from, custom ? custom.to : null, live)
      : from
        ? sql`select o.entity_id, o.value_num as v, o.at from observation o where o.project_id = ${projectId} and o.element_id = (select id from data_element where project_id = ${projectId} and ref = ${o.element}) and o.at >= ${from} ${until}`
        : sql`select distinct on (o.entity_id) o.entity_id, o.value_num as v, o.at from observation o
            where o.project_id = ${projectId} and o.element_id = (select id from data_element where project_id = ${projectId} and ref = ${o.element})
            order by o.entity_id, o.at desc`;
    const rows = await sql<PlaceRow & MapRow & { value: number | null; has_children: boolean }>`
      with shown as (
        select e.id, e.path from entity e
        where ${inProject('e', projectId)} and ${located} and ${shown}
          ${scopeAnd('e.path', roots)}
        limit 5000
      ),
      obs as (${obs}),
      vals as (
        select s.id, ${sql.raw(ROLLUP[o.aggregation])}::float8 as value
        from shown s
        join entity c on c.path <@ s.path and ${inProject('c', projectId)}
        join (select entity_id as c_id, v, at from obs) x on x.c_id = c.id
        group by s.id
      )
      select ${placeSelect}, ${mapSelect}, v.value,
        exists (select 1 from entity k where k.parent_id = e.id and ${inProject('k', projectId)}) as has_children
      from shown s join entity e on e.id = s.id join entity_type t on t.id = e.type_id
      left join vals v on v.id = s.id
      order by e.name
    `.execute(tx);
    const values = rows.rows.map((r) => r.value).filter((v): v is number => v !== null);
    const features = rows.rows.map((r) => ({
      type: 'Feature' as const,
      id: r.id,
      geometry: JSON.parse(r.geo),
      properties: {
        ...mapProps(r),
        id: r.id,
        name: r.name,
        code: r.code,
        type: r.type_key,
        typeName: r.type_name,
        color: r.type_color,
        hasChildren: r.has_children,
        value: r.value === null ? null : Math.round(r.value * 1e6) / 1e6,
      },
    }));
    return {
      features: { type: 'FeatureCollection', features },
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      freshness: await this.query.projectFreshness(tx, projectId),
    };
  }

  async overlay(actor: Actor, tenantId: string, project: string, key: string, entityId: string | null, period: OverlayPeriod = {}): Promise<OverlayResult> {
    const a = await this.projects.access(actor, tenantId, project);
    const o = await this.projects.cellTx(tenantId, async (tx) => (await this.overlayRows(tx, a.project.id)).find((x) => x.key === key));
    if (!o || !canSee(a, o.permissionGroup)) throw notFound('Overlay');
    return this.query.cached(tenantId, a.project.id, a.roots, { overlay: o, entityId, period }, () =>
      this.projects.cellTx(tenantId, (tx) => this.overlayIn(tx, a.project.id, a.roots, o, entityId, period)),
    );
  }

  // ---------- hierarchy browser ----------

  /** Places directly inside `parentId` (the top level, or a scoped member's own root). */
  async childrenIn(tx: Tx, projectId: string, roots: Scope, parentId: string | null): Promise<PlaceNode[]> {
    const where = parentId
      ? sql`e.parent_id = ${parentId} ${scopeAnd('e.path', roots)}`
      : roots
        ? sql`e.path = any(${roots}::ltree[])`
        : sql`e.parent_id is null`;
    const rows = await sql<PlaceRow & { n: number }>`
      select ${placeSelect}, (select count(*)::int from entity c where c.parent_id = e.id and ${inProject('c', projectId)}) as n
      from entity e join entity_type t on t.id = e.type_id
      where ${inProject('e', projectId)} and not t.system and ${where}
      order by t.sort, e.name
      limit 1000
    `.execute(tx);
    return rows.rows.map((r) => ({ ...toPlace(r), hasChildren: r.n > 0, childCount: r.n }));
  }

  async children(actor: Actor, tenantId: string, project: string, parentId: string | null): Promise<PlaceNode[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, (tx) => this.childrenIn(tx, a.project.id, a.roots, parentId));
  }

  async publicChildren(tenantSlug: string, projectKey: string, parentId: string | null) {
    const t = await this.publicIds(tenantSlug, projectKey);
    return this.projects.cellTx(t.tenantId, (tx) => this.childrenIn(tx, t.projectId, null, parentId));
  }

  // ---------- search ----------

  async searchIn(tx: Tx, projectId: string, roots: Scope, q: string): Promise<SearchHit[]> {
    const term = q.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`);
    if (!term) return [];
    const rows = await sql<PlaceRow & { trail: string | null }>`
      select ${placeSelect},
        (select string_agg(a.name, ' › ' order by nlevel(a.path)) from entity a
          where (a.project_id = e.project_id or a.project_id is null) and a.path @> e.path and a.path <> e.path) as trail
      from entity e join entity_type t on t.id = e.type_id
      where ${inProject('e', projectId)} and not t.system and (lower(e.name) like ${`%${term}%`} or lower(e.code) = ${term})
        ${scopeAnd('e.path', roots)}
      order by (lower(e.name) like ${`${term}%`}) desc, nlevel(e.path), e.name
      limit 12
    `.execute(tx);
    return rows.rows.map((r) => ({ ...toPlace(r), path: r.trail ?? '' }));
  }

  async search(actor: Actor, tenantId: string, project: string, q: string): Promise<SearchHit[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, (tx) => this.searchIn(tx, a.project.id, a.roots, q));
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

  async publicOverlay(tenantSlug: string, projectKey: string, key: string, entityId: string | null, period: OverlayPeriod = {}) {
    const t = await this.publicIds(tenantSlug, projectKey);
    const o = await this.projects.cellTx(t.tenantId, async (tx) => (await this.overlayRows(tx, t.projectId, true)).find((x) => x.key === key));
    if (!o) throw notFound('Overlay');
    return this.query.cached(t.tenantId, t.projectId, null, { overlay: o, entityId, period }, () =>
      this.projects.cellTx(t.tenantId, (tx) => this.overlayIn(tx, t.projectId, null, o, entityId, period)),
    );
  }

  async publicSearch(tenantSlug: string, projectKey: string, q: string) {
    const t = await this.publicIds(tenantSlug, projectKey);
    return this.projects.cellTx(t.tenantId, (tx) => this.searchIn(tx, t.projectId, null, q));
  }
}
