import { sql, type RawBuilder, type Transaction } from 'kysely';
import { freshness, worstFreshness } from '@grids/data';
import type { CellDB } from '@grids/db';
import {
  uuidv7,
  Widget,
  type DashboardDto,
  type Freshness,
  type PublicProjectDto,
  type QueryResult,
  type QuerySpec,
} from '@grids/schema';
import type { z } from 'zod';
import type { DashboardInput } from '@grids/schema';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import type { EventBus } from './events.js';
import type { ProjectService } from './projects.js';
import { iso, isUniqueViolation } from './util.js';
import { DEFAULT_THEME, Theme } from '@grids/schema';

type Tx = Transaction<CellDB>;

const AGG: Record<string, string> = {
  sum: 'sum(o.value_num)',
  avg: 'avg(o.value_num)',
  min: 'min(o.value_num)',
  max: 'max(o.value_num)',
  count: 'count(*)',
  distinct: 'count(distinct o.entity_id)',
  last: '(array_agg(o.value_num order by o.at desc))[1]',
};
const LATEST_AGG: Record<string, string> = {
  sum: 'sum(v)',
  avg: 'avg(v)',
  min: 'min(v)',
  max: 'max(v)',
  count: 'count(*)',
  distinct: 'count(distinct entity_id)',
  last: '(array_agg(v order by at desc))[1]',
};

const round = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 1e6) / 1e6);

/**
 * Compiles declarative queries (spec §9) to SQL. Tenant isolation comes from RLS;
 * the caller's entity scope (`rootPath`) is always added; only whitelisted
 * aggregations/intervals reach SQL as raw text.
 */
export class QueryService {
  /** Result cache: tenant|project|scope|spec → result (insertion-ordered for LRU eviction). */
  private readonly cache = new Map<string, { at: number; result: QueryResult }>();

  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
    private readonly events?: EventBus,
    private readonly cacheOpts = { ttlMs: 30_000, maxEntries: 2_000 },
  ) {
    // Change events (from any API instance or worker) drop the project's results;
    // after a listener gap everything goes, since events may have been missed.
    events?.onAny((e) => this.invalidate(e.tenantId, e.projectId));
    events?.onGap(() => this.cache.clear());
  }

  /** Drops cached results for a project, or the whole tenant. */
  invalidate(tenantId: string, projectId?: string) {
    const prefix = projectId ? `${tenantId}|${projectId}|` : `${tenantId}|`;
    for (const k of this.cache.keys()) if (k.startsWith(prefix)) this.cache.delete(k);
  }

  /**
   * Serves a query from the cache while it is younger than the TTL (which also
   * bounds drift of relative time windows and freshness), else computes it. The
   * cache is only used while change events are flowing for the tenant's cell, so
   * results never outlive a data change by more than the notification latency.
   */
  private async cached(tenantId: string, projectId: string, rootPath: string | null, spec: QuerySpec, compute: () => Promise<QueryResult>): Promise<QueryResult> {
    const live = this.events ? await this.events.ensure(tenantId).catch(() => false) : false;
    if (!live) return compute();
    const key = `${tenantId}|${projectId}|${rootPath ?? '*'}|${JSON.stringify(spec)}`;
    const hit = this.cache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < this.cacheOpts.ttlMs) return hit.result;
    const result = await compute();
    this.cache.delete(key);
    this.cache.set(key, { at: now, result });
    if (this.cache.size > this.cacheOpts.maxEntries) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }

  private range(r: { lastMinutes?: number; lastHours?: number; from?: string; to?: string } | undefined) {
    const now = this.ctx.now();
    const to = r?.to ? new Date(r.to) : now;
    const minutes = r?.lastMinutes ?? (r?.lastHours ?? 24 * 30) * 60;
    const from = r?.from ? new Date(r.from) : new Date(to.getTime() - minutes * 60_000);
    if (from >= to) throw badRequest('The query range is empty');
    return { from, to };
  }

  private scope(spec: { entityType?: string; ancestorId?: string }, rootPath: string | null, alias = 'e'): RawBuilder<unknown> {
    const e = sql.raw(alias);
    return sql`
      ${spec.entityType ? sql`and exists (select 1 from entity_type tt where tt.id = ${e}.type_id and tt.key = ${spec.entityType})` : sql``}
      ${spec.ancestorId ? sql`and ${e}.path <@ (select path from entity where id = ${spec.ancestorId})` : sql``}
      ${rootPath ? sql`and ${e}.path <@ ${rootPath}::ltree` : sql``}
    `;
  }

  /** Project-level freshness: the least fresh of its scheduled jobs. */
  async projectFreshness(tx: Tx, projectId: string): Promise<Freshness> {
    const rows = await tx
      .selectFrom('job as j')
      .select([
        'j.freshness_minutes',
        (eb) =>
          eb
            .selectFrom('run as r')
            .select((e2) => e2.fn.max('r.finished_at').as('f'))
            .whereRef('r.job_id', '=', 'j.id')
            .where('r.status', '=', 'succeeded')
            .as('last'),
      ])
      .where('j.project_id', '=', projectId)
      .where('j.enabled', '=', true)
      .where('j.freshness_minutes', 'is not', null)
      .execute();
    if (rows.length) return worstFreshness(rows.map((r) => freshness(r.last as Date | null, r.freshness_minutes, this.ctx.now())));
    // No jobs: freshness is the latest observation (or entity change).
    const last = await sql<{ at: Date | null }>`
      select greatest((select max(recorded_at) from observation where project_id = ${projectId}),
                      (select max(updated_at) from entity where project_id = ${projectId})) as at
    `.execute(tx);
    return freshness(last.rows[0]?.at ?? null, null, this.ctx.now());
  }

  async query(actor: Actor, tenantId: string, project: string, spec: QuerySpec): Promise<QueryResult> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.cached(tenantId, a.project.id, a.rootPath, spec, () => this.projects.cellTx(tenantId, (tx) => this.run(tx, a.project.id, a.rootPath, spec)));
  }

  /** Executes a query inside a tenant transaction. */
  async run(tx: Tx, projectId: string, rootPath: string | null, spec: QuerySpec): Promise<QueryResult> {
    const fresh = await this.projectFreshness(tx, projectId);
    switch (spec.kind) {
      case 'series': {
        const { from, to } = this.range(spec.range);
        const rows = await sql<{ t: Date; key: string; value: number | null }>`
          select date_trunc(${spec.interval}, o.at) as t, d.key, ${sql.raw(AGG[spec.aggregation]!)} as value
          from observation o
          join data_element d on d.id = o.element_id
          join entity e on e.id = o.entity_id
          where o.project_id = ${projectId} and d.key in (${sql.join(spec.elements)})
            and o.at >= ${from} and o.at < ${to}
            ${this.scope(spec, rootPath)}
          group by 1, 2 order by 1
        `.execute(tx);
        return { kind: 'series', rows: rows.rows.map((r) => ({ t: iso(r.t), key: r.key, value: round(r.value) })), freshness: fresh };
      }
      case 'breakdown': {
        if (spec.by === 'attribute' && !spec.attribute) throw badRequest('Choose the attribute to break down by');
        const labelExpr =
          spec.by === 'parent'
            ? sql`coalesce(p.name, '(none)')`
            : spec.by === 'attribute'
              ? sql`coalesce(e.attributes ->> ${spec.attribute!}, '(none)')`
              : spec.by === 'type'
                ? sql`t.name`
                : sql`e.name`;
        const joins = sql`left join entity p on p.id = e.parent_id join entity_type t on t.id = e.type_id`;
        let rows;
        if (!spec.element) {
          rows = await sql<{ label: string; value: number }>`
            select ${labelExpr} as label, count(*)::float8 as value
            from entity e ${joins}
            where e.project_id = ${projectId} ${this.scope(spec, rootPath)}
            group by 1 order by 2 desc, 1 limit ${spec.limit}
          `.execute(tx);
        } else if (spec.latest) {
          rows = await sql<{ label: string; value: number }>`
            with latest as (
              select distinct on (o.entity_id) o.entity_id, o.value_num as v, o.at
              from observation o join data_element d on d.id = o.element_id
              where o.project_id = ${projectId} and d.key = ${spec.element}
              order by o.entity_id, o.at desc
            )
            select ${labelExpr} as label, ${sql.raw(LATEST_AGG[spec.aggregation]!)}::float8 as value
            from latest l join entity e on e.id = l.entity_id ${joins}
            where true ${this.scope(spec, rootPath)}
            group by 1 order by 2 desc nulls last, 1 limit ${spec.limit}
          `.execute(tx);
        } else {
          const { from, to } = this.range(spec.range);
          rows = await sql<{ label: string; value: number }>`
            select ${labelExpr} as label, ${sql.raw(AGG[spec.aggregation]!)}::float8 as value
            from observation o join data_element d on d.id = o.element_id
            join entity e on e.id = o.entity_id ${joins}
            where o.project_id = ${projectId} and d.key = ${spec.element} and o.at >= ${from} and o.at < ${to}
              ${this.scope(spec, rootPath)}
            group by 1 order by 2 desc nulls last, 1 limit ${spec.limit}
          `.execute(tx);
        }
        return { kind: 'breakdown', rows: rows.rows.map((r) => ({ label: r.label, value: round(r.value) })), freshness: fresh };
      }
      case 'kpi': {
        const one = async (from: Date | null, to: Date | null): Promise<number | null> => {
          if (!spec.element) {
            const r = await sql<{ n: number }>`
              select count(*)::float8 as n from entity e
              where e.project_id = ${projectId} ${this.scope(spec, rootPath)}
                ${spec.where ? sql`and e.attributes -> ${spec.where.attribute} = ${JSON.stringify(spec.where.equals)}::jsonb` : sql``}
            `.execute(tx);
            return r.rows[0]?.n ?? 0;
          }
          if (spec.latest) {
            const r = await sql<{ v: number | null }>`
              with latest as (
                select distinct on (o.entity_id) o.entity_id, o.value_num as v, o.at
                from observation o join data_element d on d.id = o.element_id
                where o.project_id = ${projectId} and d.key = ${spec.element}
                  ${to ? sql`and o.at < ${to}` : sql``}
                order by o.entity_id, o.at desc
              )
              select ${sql.raw(LATEST_AGG[spec.aggregation]!)}::float8 as v from latest l join entity e on e.id = l.entity_id
              where true ${this.scope(spec, rootPath)}
            `.execute(tx);
            return round(r.rows[0]?.v);
          }
          const r = await sql<{ v: number | null }>`
            select ${sql.raw(AGG[spec.aggregation]!)}::float8 as v
            from observation o join data_element d on d.id = o.element_id join entity e on e.id = o.entity_id
            where o.project_id = ${projectId} and d.key = ${spec.element} and o.at >= ${from!} and o.at < ${to!}
              ${this.scope(spec, rootPath)}
          `.execute(tx);
          return round(r.rows[0]?.v);
        };
        const { from, to } = this.range(spec.range);
        const value = await one(from, to);
        let previous: number | null = null;
        if (spec.compare && spec.element) {
          const len = to.getTime() - from.getTime();
          previous = await one(new Date(from.getTime() - len), from);
        }
        return { kind: 'kpi', rows: [{ value, previous }], freshness: fresh };
      }
      case 'geo': {
        const fc = await this.projects.geoFeatures(tx, projectId, rootPath, {
          type: spec.entityType,
          ancestorId: spec.ancestorId,
          element: spec.element,
          limit: spec.limit,
          since: spec.withinMinutes && spec.element ? new Date(this.ctx.now().getTime() - spec.withinMinutes * 60_000) : undefined,
        });
        return { kind: 'geo', rows: [], features: fc, freshness: fresh };
      }
      case 'table': {
        if (spec.source === 'dataset') {
          if (!spec.dataset) throw badRequest('Choose a dataset');
          const ds = await tx
            .selectFrom('dataset')
            .select(['id', 'columns', 'last_materialised_at'])
            .where('project_id', '=', projectId)
            .where('key', '=', spec.dataset)
            .executeTakeFirst();
          if (!ds) throw notFound('Dataset');
          const cols = spec.columns?.length ? spec.columns : (ds.columns as string[]);
          const sort = spec.sort && cols.includes(spec.sort) ? spec.sort : null;
          const rows = await sql<{ data: Record<string, unknown> }>`
            select data from dataset_row where dataset_id = ${ds.id}
            ${sort ? sql`order by (case when jsonb_typeof(data -> ${sort}) = 'number' then (data ->> ${sort})::float8 end) ${sql.raw(spec.desc ? 'desc nulls last' : 'asc nulls last')}, data ->> ${sort} ${sql.raw(spec.desc ? 'desc' : 'asc')}` : sql`order by id`}
            limit ${spec.limit}
          `.execute(tx);
          return {
            kind: 'table',
            columns: cols,
            rows: rows.rows.map((r) => Object.fromEntries(cols.map((c) => [c, r.data[c] ?? null]))),
            freshness: ds.last_materialised_at ? { ...fresh, lastUpdated: iso(ds.last_materialised_at) } : fresh,
          };
        }
        if (spec.source === 'observations') {
          const rows = await sql<{ entity: string; element: string; value: number | null; value_text: string | null; at: Date }>`
            select e.name as entity, d.name as element, o.value_num as value, o.value_text, o.at
            from observation o join data_element d on d.id = o.element_id join entity e on e.id = o.entity_id
            where o.project_id = ${projectId} ${spec.element ? sql`and d.key = ${spec.element}` : sql``} ${this.scope(spec, rootPath)}
            order by o.at desc limit ${spec.limit}
          `.execute(tx);
          return {
            kind: 'table',
            columns: ['entity', 'element', 'value', 'at'],
            rows: rows.rows.map((r) => ({ entity: r.entity, element: r.element, value: r.value ?? r.value_text, at: iso(r.at) })),
            freshness: fresh,
          };
        }
        const attrCols = (spec.columns ?? []).filter((c) => !['code', 'name', 'parent', 'type', 'updated'].includes(c));
        const cols = spec.columns?.length ? spec.columns : ['code', 'name', 'parent'];
        const sortExpr =
          spec.sort === 'code' ? sql`e.code` : spec.sort === 'updated' ? sql`e.updated_at` : spec.sort && attrCols.includes(spec.sort) ? sql`e.attributes -> ${spec.sort}` : sql`e.name`;
        const rows = await sql<{ code: string; name: string; parent: string | null; type: string; updated: Date; attributes: Record<string, unknown> }>`
          select e.code, e.name, p.name as parent, t.name as type, e.updated_at as updated, e.attributes
          from entity e join entity_type t on t.id = e.type_id left join entity p on p.id = e.parent_id
          where e.project_id = ${projectId} ${this.scope(spec, rootPath)}
          order by ${sortExpr} ${sql.raw(spec.desc && spec.sort ? 'desc nulls last' : 'asc')} limit ${spec.limit}
        `.execute(tx);
        return {
          kind: 'table',
          columns: cols,
          rows: rows.rows.map((r) =>
            Object.fromEntries(
              cols.map((c) => [c, c === 'updated' ? iso(r.updated) : c in r && c !== 'attributes' ? r[c as 'code'] : (r.attributes[c] ?? null)]),
            ),
          ),
          freshness: fresh,
        };
      }
    }
  }

  // ---------- dashboards ----------

  private toDashboard(d: { id: string; key: string; name: string; description: string; widgets: unknown[]; is_public: boolean; updated_at: Date }): DashboardDto {
    return {
      id: d.id,
      key: d.key,
      name: d.name,
      description: d.description,
      widgets: d.widgets.map((w) => Widget.parse(w)),
      isPublic: d.is_public,
      updatedAt: iso(d.updated_at),
    };
  }

  async dashboards(actor: Actor, tenantId: string, project: string): Promise<DashboardDto[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, async (tx) =>
      (await tx.selectFrom('dashboard').selectAll().where('project_id', '=', a.project.id).orderBy('sort').orderBy('name').execute()).map((d) =>
        this.toDashboard(d),
      ),
    );
  }

  async saveDashboard(actor: Actor, tenantId: string, project: string, input: z.output<typeof DashboardInput>, existingKey?: string): Promise<DashboardDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const ids = input.widgets.map((w) => w.id);
    if (new Set(ids).size !== ids.length) throw badRequest('Widget ids must be unique');
    const values = {
      key: input.key,
      name: input.name,
      description: input.description,
      widgets: JSON.stringify(input.widgets),
      is_public: input.isPublic,
      updated_at: this.ctx.now(),
    };
    try {
      await this.projects.cellTx(tenantId, async (tx) => {
        if (existingKey) {
          const r = await tx.updateTable('dashboard').set(values).where('project_id', '=', a.project.id).where('key', '=', existingKey).executeTakeFirst();
          if (!r.numUpdatedRows) throw notFound('Dashboard');
        } else {
          const n = await tx.selectFrom('dashboard').select((eb) => eb.fn.countAll<string>().as('n')).where('project_id', '=', a.project.id).executeTakeFirstOrThrow();
          await tx.insertInto('dashboard').values({ id: uuidv7(), tenant_id: tenantId, project_id: a.project.id, sort: Number(n.n), ...values }).execute();
        }
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Key taken', `A dashboard with key "${input.key}" already exists.`);
      throw e;
    }
    await audit(this.ctx, actor.id, tenantId, existingKey ? 'dashboard.updated' : 'dashboard.created', { project: a.project.key, dashboard: input.key, public: input.isPublic });
    return this.dashboards(actor, tenantId, project);
  }

  async deleteDashboard(actor: Actor, tenantId: string, project: string, key: string): Promise<DashboardDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, (tx) => tx.deleteFrom('dashboard').where('project_id', '=', a.project.id).where('key', '=', key).execute());
    return this.dashboards(actor, tenantId, project);
  }

  // ---------- public projects (anonymous, read-only) ----------

  private async publicProject(tenantSlug: string, projectKey: string) {
    const t = await this.ctx.db.selectFrom('tenant').select(['id', 'name', 'slug', 'status']).where('slug', '=', tenantSlug).executeTakeFirst();
    if (!t || t.status !== 'active') throw notFound('Project');
    return this.projects.cellTx(t.id, async (tx) => {
      const p = await tx.selectFrom('project').selectAll().where('key', '=', projectKey).executeTakeFirst();
      if (!p || p.visibility !== 'public' || p.archived_at) throw notFound('Project');
      const theme = await tx.selectFrom('tenant_profile').select('theme').executeTakeFirst();
      return { tenant: t, project: p, theme: Theme.parse({ ...DEFAULT_THEME, ...((theme?.theme as object) ?? {}) }) };
    });
  }

  async publicView(tenantSlug: string, projectKey: string): Promise<PublicProjectDto> {
    const { tenant, project, theme } = await this.publicProject(tenantSlug, projectKey);
    const dashboards = await this.projects.cellTx(tenant.id, (tx) =>
      tx.selectFrom('dashboard').selectAll().where('project_id', '=', project.id).where('is_public', '=', true).orderBy('sort').execute(),
    );
    return {
      tenant: { name: tenant.name, slug: tenant.slug, logo: theme.logo, primaryColor: theme.primaryColor },
      project: { key: project.key, name: project.name, description: project.description, color: project.color },
      dashboards: dashboards.map((d) => this.toDashboard(d)),
    };
  }

  /** Ids of a public project, for anonymous event streams. */
  async publicTarget(tenantSlug: string, projectKey: string) {
    const { tenant, project } = await this.publicProject(tenantSlug, projectKey);
    return { tenantId: tenant.id, projectId: project.id };
  }

  /** Runs one widget's stored query for anonymous viewers (no arbitrary queries). */
  async publicWidget(tenantSlug: string, projectKey: string, dashboardKey: string, widgetId: string): Promise<QueryResult> {
    const { tenant, project } = await this.publicProject(tenantSlug, projectKey);
    const w = await this.projects.cellTx(tenant.id, async (tx) => {
      const d = await tx
        .selectFrom('dashboard')
        .select(['widgets', 'is_public'])
        .where('project_id', '=', project.id)
        .where('key', '=', dashboardKey)
        .executeTakeFirst();
      if (!d?.is_public) throw notFound('Dashboard');
      const w = (d.widgets as unknown[]).map((x) => Widget.parse(x)).find((x) => x.id === widgetId);
      if (!w?.query) throw notFound('Widget');
      return w;
    });
    const spec = w.query!;
    return this.cached(tenant.id, project.id, null, spec, () => this.projects.cellTx(tenant.id, (tx) => this.run(tx, project.id, null, spec)));
  }
}
