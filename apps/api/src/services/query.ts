import type { UsageService } from './usage.js';
import { scopeAnd, type Scope } from './scope.js';
import { sql, type RawBuilder, type Transaction } from 'kysely';
import { freshness, worstFreshness, inProject } from '@grids/data';
import type { CellDB } from '@grids/db';
import {
  AGGREGATIONS,
  applyParams,
  DashboardFilters,
  columnConditions,
  parseColumnValues,
  DatasetSettings,
  uuidv7,
  Widget,
  type DashboardParams,
  type DashboardDto,
  type Freshness,
  type PublicProjectCard,
  type PublicProjectDto,
  type QueryResult,
  type QuerySpec,
} from '@grids/schema';
import type { z } from 'zod';
import type { Condition, DashboardInput } from '@grids/schema';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import type { EventBus } from './events.js';
import type { Aggregated, AggregatePlan } from './datasets.js';
import { canSee, explorerOf, reportingOf, type ProjectService } from './projects.js';
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
 * the caller's entity scope (`roots`) is always added; only whitelisted
 * aggregations/intervals reach SQL as raw text.
 */
export class QueryService {
  /** Set where the services are put together: public requests count against the organisation's API allowance. */
  usage?: UsageService;
  /** Result cache: tenant|project|scope|spec → result (insertion-ordered for LRU eviction). */
  private readonly cache = new Map<string, { at: number; result: unknown }>();
  /** Runs a dataset again for a viewer's values and gives back where its rows are kept (set by the services once they exist). */
  variants?: (tenantId: string, projectId: string, dataset: string, params: Record<string, string>) => Promise<string>;
  /** Reads a dataset on a database from the database (null when the dataset keeps a copy instead). */
  live?: (tenantId: string, projectId: string, dataset: string, params: Record<string, string>) => Promise<{ rows: unknown[]; queriedAt: Date } | null>;
  /** A widget's grouping worked out by the database itself; null when it cannot be, and the rows are read and grouped here. */
  aggregate?: (tenantId: string, projectId: string, dataset: string, plan: AggregatePlan) => Promise<Aggregated | null>;
  /** The same for a table widget's rows, and for a filter's list of values. */
  tableRows?: (tenantId: string, projectId: string, dataset: string, req: { columns: string[]; sort: string | null; desc?: boolean; conditions?: Condition[]; limit: number; params: Record<string, string> }) => Promise<Aggregated | null>;
  distinct?: (tenantId: string, projectId: string, dataset: string, req: { column: string; conditions?: Condition[] }) => Promise<string[] | null>;

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
  async cached<T>(tenantId: string, projectId: string, roots: Scope, spec: unknown, compute: () => Promise<T>): Promise<T> {
    const live = this.events ? await this.events.ensure(tenantId).catch(() => false) : false;
    if (!live) return compute();
    const key = `${tenantId}|${projectId}|${roots?.join(',') ?? '*'}|${JSON.stringify(spec)}`;
    const hit = this.cache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < this.cacheOpts.ttlMs) return hit.result as T;
    const result = await compute();
    this.cache.delete(key);
    this.cache.set(key, { at: now, result });
    if (this.cache.size > this.cacheOpts.maxEntries) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }

  /** `and …` tests on the stored rows of a dataset, one per condition. Columns are bound values, never SQL text. */
  private conditions(list: Condition[] | undefined): RawBuilder<unknown> {
    const parts = (list ?? []).map((c) => {
      const text = sql`(data ->> ${c.column})`;
      if (c.op === 'in') return sql`and ${text} in (${sql.join(c.values)})`;
      if (c.op === 'contains') return sql`and ${text} ilike ${`%${c.text.replace(/[\\%_]/g, '\\$&')}%`}`;
      if (c.op === 'range') {
        const n = sql`(case when jsonb_typeof(data -> ${c.column}) = 'number' then (data ->> ${c.column})::float8 when ${text} ~ '^-?[0-9]+([.][0-9]+)?$' then ${text}::float8 end)`;
        return sql`${c.min !== undefined ? sql`and ${n} >= ${c.min}` : sql``} ${c.max !== undefined ? sql`and ${n} <= ${c.max}` : sql``}`;
      }
      const at = sql`(case when ${text} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then ${text}::timestamptz end)`;
      const to = c.to ? new Date(`${c.to}T00:00:00Z`) : null;
      if (to) to.setUTCDate(to.getUTCDate() + 1);
      return sql`${c.from ? sql`and ${at} >= ${new Date(`${c.from}T00:00:00Z`)}` : sql``} ${to ? sql`and ${at} < ${to}` : sql``}`;
    });
    return parts.length ? sql.join(parts, sql` `) : sql``;
  }

  private range(r: { lastMinutes?: number; lastHours?: number; from?: string; to?: string } | undefined) {
    const now = this.ctx.now();
    const to = r?.to ? new Date(r.to) : now;
    const minutes = r?.lastMinutes ?? (r?.lastHours ?? 24 * 30) * 60;
    const from = r?.from ? new Date(r.from) : new Date(to.getTime() - minutes * 60_000);
    if (from >= to) throw badRequest('The query range is empty');
    return { from, to };
  }

  private scope(spec: { entityType?: string; ancestorId?: string }, roots: Scope, alias = 'e'): RawBuilder<unknown> {
    const e = sql.raw(alias);
    return sql`
      ${spec.entityType ? sql`and exists (select 1 from entity_type tt where tt.id = ${e}.type_id and tt.key = ${spec.entityType})` : sql``}
      ${spec.ancestorId ? sql`and ${e}.path <@ (select path from entity where id = ${spec.ancestorId})` : sql``}
      ${scopeAnd(`${alias}.path`, roots)}
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

  /**
   * Ad-hoc queries (building dashboards, data exploration) need the editor role:
   * viewers read data only through visuals, which their permission groups gate.
   */
  async query(actor: Actor, tenantId: string, project: string, spec: QuerySpec): Promise<QueryResult> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    return this.cached(tenantId, a.project.id, a.roots, spec, () => this.projects.cellTx(tenantId, (tx) => this.run(tx, a.project.id, a.roots, spec)));
  }

  /** Where the rows for a viewer's values are kept, running the dataset's query first when they are not there yet. */
  private runFor(tenantId: string, projectId: string, dataset: string, params: Record<string, string>): Promise<string> {
    if (!this.variants) throw badRequest('Running a dataset for a viewer’s values is not available here.');
    return this.variants(tenantId, projectId, dataset, params);
  }

  /** The rows of a dataset on a database, read now; null when the dataset keeps a copy. */
  async liveRowsOf(tenantId: string, projectId: string, dataset: string, params: Record<string, string> = {}): Promise<{ rows: unknown[]; queriedAt: Date } | null> {
    return this.live ? this.live(tenantId, projectId, dataset, params) : null;
  }

  /** Executes a query inside a tenant transaction. */
  async run(tx: Tx, projectId: string, roots: Scope, spec: QuerySpec): Promise<QueryResult> {
    const fresh = await this.projectFreshness(tx, projectId);
    switch (spec.kind) {
      case 'series': {
        const { from, to } = this.range(spec.range);
        const rows = await sql<{ t: Date; key: string; value: number | null }>`
          select date_trunc(${spec.interval}, o.at) as t, d.ref as key, ${sql.raw(AGG[spec.aggregation]!)} as value
          from observation o
          join data_element d on d.id = o.element_id
          join entity e on e.id = o.entity_id
          where o.project_id = ${projectId} and d.ref in (${sql.join(spec.elements)})
            and o.at >= ${from} and o.at < ${to}
            ${this.scope(spec, roots)}
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
        const keys = spec.elements ?? (spec.element ? [spec.element] : null);
        const multi = !!spec.elements;
        let rows;
        if (!keys) {
          rows = await sql<{ label: string; key: string | null; value: number }>`
            select ${labelExpr} as label, null as key, count(*)::float8 as value
            from entity e ${joins}
            where ${inProject('e', projectId)} ${this.scope(spec, roots)}
            group by 1 order by 3 desc, 1 limit ${spec.limit}
          `.execute(tx);
        } else if (spec.latest) {
          rows = await sql<{ label: string; key: string; value: number }>`
            with latest as (
              select distinct on (o.entity_id, d.ref) o.entity_id, d.ref as key, o.value_num as v, o.at
              from observation o join data_element d on d.id = o.element_id
              where o.project_id = ${projectId} and d.ref in (${sql.join(keys)})
              order by o.entity_id, d.ref, o.at desc
            )
            select ${labelExpr} as label, l.key, ${sql.raw(LATEST_AGG[spec.aggregation]!)}::float8 as value
            from latest l join entity e on e.id = l.entity_id ${joins}
            where true ${this.scope(spec, roots)}
            group by 1, 2
          `.execute(tx);
        } else {
          const { from, to } = this.range(spec.range);
          rows = await sql<{ label: string; key: string; value: number }>`
            select ${labelExpr} as label, d.ref as key, ${sql.raw(AGG[spec.aggregation]!)}::float8 as value
            from observation o join data_element d on d.id = o.element_id
            join entity e on e.id = o.entity_id ${joins}
            where o.project_id = ${projectId} and d.ref in (${sql.join(keys)}) and o.at >= ${from} and o.at < ${to}
              ${this.scope(spec, roots)}
            group by 1, 2
          `.execute(tx);
        }
        // Top labels by their total across elements; rows keep element order.
        const totals = new Map<string, number>();
        for (const r of rows.rows) totals.set(r.label, (totals.get(r.label) ?? 0) + (Number(r.value) || 0));
        const top = [...totals.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, spec.limit).map(([l]) => l);
        const rank = new Map(top.map((l, i) => [l, i]));
        const order = keys ? new Map(keys.map((k, i) => [k, i])) : new Map<string, number>();
        const kept = rows.rows
          .filter((r) => rank.has(r.label))
          .sort((x, y) => rank.get(x.label)! - rank.get(y.label)! || (order.get(x.key ?? '') ?? 0) - (order.get(y.key ?? '') ?? 0));
        if (multi) return { kind: 'breakdown', rows: kept.map((r) => ({ label: r.label, key: r.key, value: round(r.value) })), freshness: fresh };
        return { kind: 'breakdown', rows: kept.map((r) => ({ label: r.label, value: round(r.value) })), freshness: fresh };
      }
      case 'kpi': {
        const one = async (from: Date | null, to: Date | null): Promise<number | null> => {
          if (!spec.element) {
            const r = await sql<{ n: number }>`
              select count(*)::float8 as n from entity e
              where ${inProject('e', projectId)} ${this.scope(spec, roots)}
                ${spec.where ? sql`and e.attributes -> ${spec.where.attribute} = ${JSON.stringify(spec.where.equals)}::jsonb` : sql``}
            `.execute(tx);
            return r.rows[0]?.n ?? 0;
          }
          if (spec.latest) {
            const r = await sql<{ v: number | null }>`
              with latest as (
                select distinct on (o.entity_id) o.entity_id, o.value_num as v, o.at
                from observation o join data_element d on d.id = o.element_id
                where o.project_id = ${projectId} and d.ref = ${spec.element}
                  ${to ? sql`and o.at < ${to}` : sql``}
                order by o.entity_id, o.at desc
              )
              select ${sql.raw(LATEST_AGG[spec.aggregation]!)}::float8 as v from latest l join entity e on e.id = l.entity_id
              where true ${this.scope(spec, roots)}
            `.execute(tx);
            return round(r.rows[0]?.v);
          }
          const r = await sql<{ v: number | null }>`
            select ${sql.raw(AGG[spec.aggregation]!)}::float8 as v
            from observation o join data_element d on d.id = o.element_id join entity e on e.id = o.entity_id
            where o.project_id = ${projectId} and d.ref = ${spec.element} and o.at >= ${from!} and o.at < ${to!}
              ${this.scope(spec, roots)}
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
      case 'work': {
        const now = this.ctx.now();
        const { from, to } = this.range(spec.range);
        const where = (a: Date, b: Date) => sql`
          i.project_id = ${projectId} and i.created_at >= ${a} and i.created_at < ${b}
          ${spec.type ? sql`and t.key = ${spec.type}` : sql``}
          ${spec.state === 'open' ? sql`and i.resolved_at is null` : spec.state === 'done' ? sql`and i.resolved_at is not null` : sql``}
          ${spec.overdue ? sql`and i.resolved_at is null and i.due_at < ${now}` : sql``}
          ${spec.breached ? sql`and i.resolved_at is null and (i.resolve_by < ${now} or (i.first_response_at is null and i.respond_by < ${now}))` : sql``}
          ${spec.entityType ? sql`and exists (select 1 from entity_type tt where tt.id = e.type_id and tt.key = ${spec.entityType})` : sql``}
          ${spec.ancestorId ? sql`and e.path <@ (select path from entity where id = ${spec.ancestorId})` : sql``}
          ${roots ? sql`and (i.entity_id is null or e.path <@ any(${roots}::ltree[]))` : sql``}
        `;
        const source = sql`from work_item i join work_type t on t.id = i.type_id left join entity e on e.id = i.entity_id`;
        const value = {
          count: sql`count(*)::float8`,
          avg_first_response_hours: sql`avg(extract(epoch from (i.first_response_at - i.created_at)) / 3600) filter (where i.first_response_at is not null)::float8`,
          avg_resolve_hours: sql`avg(extract(epoch from (i.resolved_at - i.created_at)) / 3600) filter (where i.resolved_at is not null)::float8`,
        }[spec.measure];
        if (spec.by === 'day' || spec.by === 'week' || spec.by === 'month') {
          const rows = await sql<{ t: Date; value: number | null }>`select date_trunc(${spec.by}, i.created_at) as t, ${value} as value ${source} where ${where(from, to)} group by 1 order by 1`.execute(tx);
          return { kind: 'series', rows: rows.rows.map((r) => ({ t: iso(r.t), key: spec.measure, value: round(r.value) })), freshness: fresh };
        }
        if (spec.by) {
          const label = {
            state: sql`coalesce((select st ->> 'label' from jsonb_array_elements(t.states) st where st ->> 'key' = i.state limit 1), i.state)`,
            priority: sql`initcap(i.priority)`,
            assignee: sql`coalesce(i.assignee_id::text, '')`,
            type: sql`t.name`,
          }[spec.by];
          const rows = await sql<{ label: string; value: number | null }>`select ${label} as label, ${value} as value ${source} where ${where(from, to)} group by 1 order by 2 desc nulls last, 1 limit ${spec.limit}`.execute(tx);
          let names = new Map<string, string>();
          if (spec.by === 'assignee') {
            const ids = rows.rows.map((r) => r.label).filter(Boolean);
            if (ids.length) names = new Map((await this.ctx.db.selectFrom('user_identity').select(['id', 'display_name', 'email']).where('id', 'in', ids).execute()).map((u) => [u.id, u.display_name || u.email || 'Someone']));
          }
          return { kind: 'breakdown', rows: rows.rows.map((r) => ({ label: spec.by === 'assignee' ? (r.label ? (names.get(r.label) ?? 'Someone') : 'Nobody') : r.label, value: round(r.value) })), freshness: fresh };
        }
        const one = async (a: Date, b: Date) => round((await sql<{ v: number | null }>`select ${value} as v ${source} where ${where(a, b)}`.execute(tx)).rows[0]?.v);
        const current = await one(from, to);
        const previous = spec.compare ? await one(new Date(from.getTime() - (to.getTime() - from.getTime())), from) : null;
        return { kind: 'kpi', rows: [{ value: current, previous }], freshness: fresh };
      }
      case 'geo': {
        const fc = await this.projects.geoFeatures(tx, projectId, roots, {
          type: spec.entityType,
          ancestorId: spec.ancestorId,
          element: spec.element,
          limit: spec.limit,
          since: spec.withinMinutes && spec.element ? new Date(this.ctx.now().getTime() - spec.withinMinutes * 60_000) : undefined,
        });
        return { kind: 'geo', rows: [], features: fc, freshness: fresh };
      }
      case 'dataset': {
        const ds = await tx
          .selectFrom('dataset')
          .select(['id', 'tenant_id', 'last_materialised_at', 'freshness_minutes', 'settings'])
          .where('project_id', '=', projectId)
          .where('key', '=', spec.dataset)
          .executeTakeFirst();
        if (!ds) throw notFound('Dataset');
        const settings = DatasetSettings.parse(ds.settings ?? {});
        // A metric saved on the dataset stands for a column and how to combine it.
        let metric: { column?: string; aggregation: (typeof AGGREGATIONS)[number]; expression?: string } | undefined;
        if (spec.metric) {
          const m = settings.metrics.find((x) => x.key === spec.metric);
          if (!m) throw badRequest(`The dataset has no metric "${spec.metric}"`);
          metric = m;
        }
        const column = metric ? metric.column : spec.value;
        const aggregation = metric ? metric.aggregation : spec.aggregation;
        const timeCol = spec.timeColumn ?? settings.timeColumn ?? undefined;
        // The author's own tests on columns, and those from the dashboard's filters.
        const allConditions = [...(spec.filters ?? []), ...(spec.conditions ?? [])];
        // A column's numeric value: JSON numbers, or strings that look like numbers.
        const num = (col: string) =>
          sql`(case when jsonb_typeof(data -> ${col}) = 'number' then (data ->> ${col})::float8 when (data ->> ${col}) ~ '^-?[0-9]+([.][0-9]+)?$' then (data ->> ${col})::float8 end)`;
        const v = column ? num(column) : null;
        const agg =
          !v || aggregation === 'count'
            ? sql`count(*)::float8`
            : aggregation === 'distinct'
              ? sql`count(distinct data ->> ${column!})::float8`
              : aggregation === 'last'
                ? sql`(array_agg(${v}))[count(*)]`
                : sql`${sql.raw(aggregation)}(${v})`;
        // The dashboard's period applies to the dataset's time column, when it has one.
        const window = spec.range && timeCol ? this.range(spec.range) : null;
        // A dataset on a database groups on the database itself when it can: no rows are read at all.
        if (this.aggregate) {
          const pushed = await this.aggregate(ds.tenant_id, projectId, spec.dataset, {
            column,
            aggregation,
            expression: spec.expression ?? metric?.expression,
            groupBy: spec.groupBy,
            thenBy: spec.thenBy,
            timeColumn: spec.timeColumn ? timeCol : undefined,
            interval: spec.interval,
            period: window && timeCol ? { column: timeCol, from: window.from, to: window.to } : undefined,
            filter: spec.filter,
            conditions: allConditions,
            limit: spec.limit,
            params: spec.params ?? {},
          });
          if (pushed) {
            const fr = liveFreshness(pushed.queriedAt);
            if (spec.timeColumn) return { kind: 'series', rows: pushed.rows.map((r) => ({ t: String(r.t), key: column ?? 'rows', value: round(r.value as number | null) })), freshness: fr };
            if (spec.groupBy) return { kind: 'breakdown', rows: pushed.rows.map((r) => ({ label: String(r.label), value: round(r.value as number | null) })), freshness: fr };
            return { kind: 'kpi', rows: [{ value: round((pushed.rows[0]?.value ?? null) as number | null), previous: null }], freshness: fr };
          }
        }
        if (spec.expression ?? metric?.expression) throw badRequest('This value is worked out by the database, and this dataset cannot do that.', 'A value written as SQL needs a dataset on a PostgreSQL or Redshift database.');
        // Values a viewer picked for the dataset's parameters: its query is run again for them (and kept for a while).
        // A dataset on a database is read from the database; otherwise from the stored copy (or the run for a viewer's values).
        const live = await this.liveRowsOf(ds.tenant_id, projectId, spec.dataset, spec.params ?? {});
        const variant = !live && settings.runPerViewer && spec.params && Object.keys(spec.params).length ? await this.runFor(ds.tenant_id, projectId, spec.dataset, spec.params) : null;
        const rowsFrom = live ? liveFrom(live.rows) : variant ? sql`dataset_variant_row` : sql`dataset_row`;
        const ofDataset = live ? sql`true` : variant ? sql`variant_id = ${variant}` : sql`dataset_id = ${ds.id}`;
        const inWindow = window && timeCol
          ? sql`and (data ->> ${timeCol}) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' and (data ->> ${timeCol})::timestamptz >= ${window.from} and (data ->> ${timeCol})::timestamptz < ${window.to}`
          : sql``;
        const where = sql`${ofDataset} ${spec.filter ? sql`and data ->> ${spec.filter.column} = ${String(spec.filter.equals)}` : sql``} ${inWindow} ${this.conditions(allConditions)}`;
        const dsFresh = live ? liveFreshness(live.queriedAt) : ds.last_materialised_at ? freshness(ds.last_materialised_at, ds.freshness_minutes, this.ctx.now()) : fresh;
        if (spec.timeColumn) {
          const rows = await sql<{ t: Date; value: number | null }>`
            select date_trunc(${spec.interval}, (data ->> ${timeCol!})::timestamptz) as t, ${agg} as value
            from ${rowsFrom} where ${where} and (data ->> ${timeCol!}) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            group by 1 order by 1 limit 1000
          `.execute(tx);
          const key = column ?? 'rows';
          return { kind: 'series', rows: rows.rows.map((r) => ({ t: iso(r.t), key, value: round(r.value) })), freshness: dsFresh };
        }
        if (spec.groupBy) {
          const rows = await sql<{ label: string; value: number | null }>`
            select ${sql.join([spec.groupBy, ...[spec.thenBy ?? []].flat()].map((c) => sql`coalesce(data ->> ${c}, '(none)')`), sql` || ' · ' || `)} as label, ${agg} as value
            from ${rowsFrom} where ${where} group by 1 order by 2 desc nulls last, 1 limit ${spec.limit}
          `.execute(tx);
          return { kind: 'breakdown', rows: rows.rows.map((r) => ({ label: r.label, value: round(r.value) })), freshness: dsFresh };
        }
        const one = await sql<{ value: number | null }>`select ${agg} as value from ${rowsFrom} where ${where}`.execute(tx);
        return { kind: 'kpi', rows: [{ value: round(one.rows[0]?.value), previous: null }], freshness: dsFresh };
      }
      case 'table': {
        if (spec.source === 'dataset') {
          if (!spec.dataset) throw badRequest('Choose a dataset');
          const ds = await tx
            .selectFrom('dataset')
            .select(['id', 'tenant_id', 'columns', 'last_materialised_at', 'settings'])
            .where('project_id', '=', projectId)
            .where('key', '=', spec.dataset)
            .executeTakeFirst();
          if (!ds) throw notFound('Dataset');
          const cols = spec.columns?.length ? spec.columns : (ds.columns as string[]);
          const sort = spec.sort && cols.includes(spec.sort) ? spec.sort : null;
          // A dataset on a database sorts and cuts the rows on the database when it can.
          if (this.tableRows) {
            const pushed = await this.tableRows(ds.tenant_id, projectId, spec.dataset, { columns: cols, sort, desc: spec.desc, conditions: spec.conditions, limit: spec.limit, params: spec.params ?? {} });
            if (pushed) return { kind: 'table', columns: cols, rows: pushed.rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))), freshness: liveFreshness(pushed.queriedAt) };
          }
          const live = await this.liveRowsOf(ds.tenant_id, projectId, spec.dataset, spec.params ?? {});
          const variant = !live && DatasetSettings.parse(ds.settings ?? {}).runPerViewer && spec.params && Object.keys(spec.params).length ? await this.runFor(ds.tenant_id, projectId, spec.dataset, spec.params) : null;
          const rows = await sql<{ data: Record<string, unknown> }>`
            select data from ${live ? liveFrom(live.rows) : variant ? sql`dataset_variant_row` : sql`dataset_row`} where ${live ? sql`true` : variant ? sql`variant_id = ${variant}` : sql`dataset_id = ${ds.id}`} ${this.conditions(spec.conditions)}
            ${sort ? sql`order by (case when jsonb_typeof(data -> ${sort}) = 'number' then (data ->> ${sort})::float8 end) ${sql.raw(spec.desc ? 'desc nulls last' : 'asc nulls last')}, data ->> ${sort} ${sql.raw(spec.desc ? 'desc' : 'asc')}` : sql`order by id`}
            limit ${spec.limit}
          `.execute(tx);
          return {
            kind: 'table',
            columns: cols,
            rows: rows.rows.map((r) => Object.fromEntries(cols.map((c) => [c, r.data[c] ?? null]))),
            freshness: live ? liveFreshness(live.queriedAt) : ds.last_materialised_at ? { ...fresh, lastUpdated: iso(ds.last_materialised_at) } : fresh,
          };
        }
        if (spec.source === 'observations') {
          const rows = await sql<{ entity: string; element: string; value: number | null; value_text: string | null; at: Date }>`
            select e.name as entity, d.name as element, o.value_num as value, o.value_text, o.at
            from observation o join data_element d on d.id = o.element_id join entity e on e.id = o.entity_id
            where o.project_id = ${projectId} ${spec.element ? sql`and d.ref = ${spec.element}` : sql``} ${this.scope(spec, roots)}
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
          where ${inProject('e', projectId)} and not t.system ${this.scope(spec, roots)}
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

  private toDashboard(d: { id: string; key: string; name: string; description: string; icon: string; widgets: unknown[]; is_public: boolean; filters: unknown; permission_group: string | null; updated_at: Date }): DashboardDto {
    return {
      id: d.id,
      key: d.key,
      name: d.name,
      description: d.description,
      icon: d.icon,
      widgets: d.widgets.map((w) => Widget.parse(w)),
      isPublic: d.is_public,
      filters: DashboardFilters.parse(d.filters ?? {}),
      permissionGroup: d.permission_group,
      updatedAt: iso(d.updated_at),
    };
  }

  /** Dashboards and widgets the caller's permission groups allow (managers see all). */
  async dashboards(actor: Actor, tenantId: string, project: string): Promise<DashboardDto[]> {
    const a = await this.projects.access(actor, tenantId, project);
    const all = await this.projects.cellTx(tenantId, async (tx) =>
      (await tx.selectFrom('dashboard').selectAll().where('project_id', '=', a.project.id).orderBy('sort').orderBy('name').execute()).map((d) => this.toDashboard(d)),
    );
    return all.filter((d) => canSee(a, d.permissionGroup)).map((d) => ({ ...d, widgets: d.widgets.filter((w) => canSee(a, w.permissionGroup)) }));
  }

  /** One widget's stored query for a member, with explorer/dashboard parameters, if permitted. */
  async widget(actor: Actor, tenantId: string, project: string, dashboardKey: string, widgetId: string, params: DashboardParams): Promise<QueryResult> {
    const a = await this.projects.access(actor, tenantId, project);
    const spec = await this.projects.cellTx(tenantId, async (tx) => {
      const row = await tx.selectFrom('dashboard').selectAll().where('project_id', '=', a.project.id).where('key', '=', dashboardKey).executeTakeFirst();
      const d = row && this.toDashboard(row);
      if (!d || !canSee(a, d.permissionGroup)) throw notFound('Dashboard');
      const w = d.widgets.find((x) => x.id === widgetId);
      if (!w?.query || !canSee(a, w.permissionGroup)) throw notFound('Widget');
      if (params.entity && !(await this.areaExists(tx, a.project.id, null, params.entity))) throw notFound('Place');
      await this.assertLevel(tx, a.project.id, w, d.filters.areaType ? params.area : undefined);
      return applyParams(w.query, params, d.filters, w.id);
    });
    return this.cached(tenantId, a.project.id, a.roots, spec, () => this.projects.cellTx(tenantId, (tx) => this.run(tx, a.project.id, a.roots, spec)));
  }

  async saveDashboard(actor: Actor, tenantId: string, project: string, input: z.output<typeof DashboardInput>, existingKey?: string): Promise<DashboardDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const ids = input.widgets.map((w) => w.id);
    if (new Set(ids).size !== ids.length) throw badRequest('Widget ids must be unique');
    await this.projects.cellTx(tenantId, async (tx) => {
      for (const g of new Set([input.permissionGroup, ...input.widgets.map((w) => w.permissionGroup)])) await this.projects.assertGroup(tx, a.project.id, g);
    });
    if (input.filters.areaType) {
      const wanted = [...new Set([input.filters.areaType, ...input.filters.areaTypes])];
      const found = await this.projects.cellTx(tenantId, (tx) =>
        tx.selectFrom('entity_type').select('key').where('project_id', '=', a.project.id).where('key', 'in', wanted).execute(),
      );
      const missing = wanted.find((k) => !found.some((f) => f.key === k));
      if (missing) throw badRequest(`Unknown entity type "${missing}" for the area filter`);
    }
    const values = {
      key: input.key,
      name: input.name,
      description: input.description,
      icon: input.icon,
      widgets: JSON.stringify(input.widgets),
      is_public: input.isPublic,
      filters: JSON.stringify(input.filters),
      permission_group: input.permissionGroup,
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

  async publicProject(tenantSlug: string, projectKey: string) {
    const t = await this.ctx.db.selectFrom('tenant').select(['id', 'name', 'slug', 'status', 'access_blocked']).where('slug', '=', tenantSlug).executeTakeFirst();
    if (!t || t.status !== 'active' || t.access_blocked) throw notFound('Project');
    await this.usage?.recordApiCall(t.id);
    return this.projects.cellTx(t.id, async (tx) => {
      const p = await tx.selectFrom('project').selectAll().where('key', '=', projectKey).executeTakeFirst();
      if (!p || p.visibility !== 'public' || p.status !== 'live' || p.archived_at) throw notFound('Project');
      const theme = await tx.selectFrom('tenant_profile').select('theme').executeTakeFirst();
      return { tenant: t, project: p, theme: Theme.parse({ ...DEFAULT_THEME, ...((theme?.theme as object) ?? {}) }) };
    });
  }

  async publicView(tenantSlug: string, projectKey: string): Promise<PublicProjectDto> {
    const { tenant, project, theme } = await this.publicProject(tenantSlug, projectKey);
    const [dashboards, elements] = await this.projects.cellTx(tenant.id, (tx) =>
      Promise.all([
        tx.selectFrom('dashboard').selectAll().where('project_id', '=', project.id).where('is_public', '=', true).where('permission_group', 'is', null).orderBy('sort').execute(),
        tx.selectFrom('data_element').select(['ref as key', 'name', 'unit']).where('project_id', '=', project.id).orderBy('ref').execute(),
      ]),
    );
    return {
      tenant: { name: tenant.name, slug: tenant.slug, logo: theme.logo, primaryColor: theme.primaryColor, mapStyles: theme.mapStyles, logoDark: theme.logoDark, favicon: theme.favicon, chartColors: theme.chartColors, poweredBy: true, helpPosition: theme.helpPosition, footer: theme.publicPages.footer },
      project: { key: project.key, name: project.name, description: project.description, color: project.color, explorer: explorerOf(project.settings), reporting: reportingOf(project.settings) },
      // Anonymous viewers have no permission group: only unrestricted widgets.
      dashboards: dashboards.map((d) => this.toDashboard(d)).map((d) => ({ ...d, widgets: d.widgets.filter((w) => !w.permissionGroup) })),
      elements,
    };
  }

  private async areaExists(tx: Tx, projectId: string, typeKey: string | string[] | null, id: string) {
    let q = tx.selectFrom('entity as e').innerJoin('entity_type as t', 't.id', 'e.type_id').select('e.id').where(inProject('e', projectId)).where('e.id', '=', id);
    if (typeKey) q = q.where('t.key', 'in', [typeKey].flat());
    return !!(await q.executeTakeFirst());
  }

  /** A widget set to show only at some levels of the hierarchy is not available at the others, whatever is asked for. */
  private async assertLevel(tx: Tx, projectId: string, w: { options: { levels?: string[] } }, area: string | undefined) {
    const levels = w.options.levels;
    if (!levels?.length) return;
    const t = area
      ? await tx.selectFrom('entity as e').innerJoin('entity_type as t', 't.id', 'e.type_id').select('t.key').where(inProject('e', projectId)).where('e.id', '=', area).executeTakeFirst()
      : null;
    if (!levels.includes(t?.key ?? '_none')) throw notFound('Widget');
  }

  /** Choices for a public dashboard's area filter. */
  async publicAreas(tenantSlug: string, projectKey: string, dashboardKey: string): Promise<{ id: string; name: string; type: { key: string; name: string } }[]> {
    const { tenant, project } = await this.publicProject(tenantSlug, projectKey);
    return this.projects.cellTx(tenant.id, async (tx) => {
      const d = await tx.selectFrom('dashboard').select(['is_public', 'filters', 'permission_group']).where('project_id', '=', project.id).where('key', '=', dashboardKey).executeTakeFirst();
      if (!d?.is_public || d.permission_group) throw notFound('Dashboard');
      const { areaType, areaTypes } = DashboardFilters.parse(d.filters ?? {});
      if (!areaType) return [];
      const rows = await tx
        .selectFrom('entity as e')
        .innerJoin('entity_type as t', 't.id', 'e.type_id')
        .select(['e.id', 'e.name', 't.key as type_key', 't.name as type_name'])
        .where(inProject('e', project.id))
        .where('t.key', 'in', [areaType, ...areaTypes])
        .orderBy('e.name')
        .limit(1000)
        .execute();
      return rows.map((r) => ({ id: r.id, name: r.name, type: { key: r.type_key, name: r.type_name } }));
    });
  }

  /** Ids of a public project, for anonymous event streams. */
  async publicTarget(tenantSlug: string, projectKey: string) {
    const { tenant, project } = await this.publicProject(tenantSlug, projectKey);
    return { tenantId: tenant.id, projectId: project.id };
  }

  /** Runs one widget's stored query for anonymous viewers (no arbitrary queries). */
  /** The values a column filter can offer: the distinct values of its column, for a dashboard the viewer can see. */
  async filterValues(actor: Actor, tenantId: string, project: string, dashboardKey: string, filterId: string, cf?: string): Promise<string[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, async (tx) => {
      const row = await tx.selectFrom('dashboard').selectAll().where('project_id', '=', a.project.id).where('key', '=', dashboardKey).executeTakeFirst();
      const d = row && this.toDashboard(row);
      if (!d || !canSee(a, d.permissionGroup)) throw notFound('Dashboard');
      return this.distinctValues(tx, a.project.id, d.filters, filterId, cf);
    });
  }

  async publicFilterValues(tenantSlug: string, projectKey: string, dashboardKey: string, filterId: string, cf?: string): Promise<string[]> {
    const { tenant, project } = await this.publicProject(tenantSlug, projectKey);
    return this.projects.cellTx(tenant.id, async (tx) => {
      const d = await tx.selectFrom('dashboard').select(['is_public', 'filters', 'permission_group']).where('project_id', '=', project.id).where('key', '=', dashboardKey).executeTakeFirst();
      if (!d?.is_public || d.permission_group) throw notFound('Dashboard');
      return this.distinctValues(tx, project.id, DashboardFilters.parse(d.filters ?? {}), filterId, cf);
    });
  }

  /** The distinct values of a filter's column, narrowed by what the viewer picked on the dashboard's other filters on the same dataset. */
  private async distinctValues(tx: Tx, projectId: string, filters: DashboardFilters, filterId: string, cf?: string): Promise<string[]> {
    const f = filters.columns.find((x) => x.id === filterId);
    if (!f) throw notFound('Filter');
    const ds = await tx.selectFrom('dataset').select(['id', 'tenant_id']).where('project_id', '=', projectId).where('key', '=', f.dataset).executeTakeFirst();
    if (!ds) return [];
    const others = columnConditions(filters.columns.filter((x) => x.id !== filterId), parseColumnValues(cf), f.dataset, '*');
    if (this.distinct) {
      const pushed = await this.distinct(ds.tenant_id, projectId, f.dataset, { column: f.column, conditions: others });
      if (pushed) return pushed;
    }
    const live = await this.liveRowsOf(ds.tenant_id, projectId, f.dataset);
    const rows = await sql<{ v: string }>`select distinct data ->> ${f.column} as v from ${live ? liveFrom(live.rows) : sql`dataset_row`} where ${live ? sql`true` : sql`dataset_id = ${ds.id}`} and data ->> ${f.column} is not null and data ->> ${f.column} <> '' ${this.conditions(others)} order by 1 limit 300`.execute(tx);
    return rows.rows.map((r) => r.v);
  }

  async publicWidget(tenantSlug: string, projectKey: string, dashboardKey: string, widgetId: string, params: DashboardParams = {}): Promise<QueryResult> {
    const { tenant, project } = await this.publicProject(tenantSlug, projectKey);
    const spec = await this.projects.cellTx(tenant.id, async (tx) => {
      const d = await tx
        .selectFrom('dashboard')
        .select(['widgets', 'is_public', 'filters', 'permission_group'])
        .where('project_id', '=', project.id)
        .where('key', '=', dashboardKey)
        .executeTakeFirst();
      if (!d?.is_public || d.permission_group) throw notFound('Dashboard');
      const w = (d.widgets as unknown[]).map((x) => Widget.parse(x)).find((x) => x.id === widgetId);
      if (!w?.query || w.permissionGroup) throw notFound('Widget');
      const filters = DashboardFilters.parse(d.filters ?? {});
      // Anonymous viewers may only pick areas of the dashboard's area type in this project.
      if (params.area && filters.areaType && !(await this.areaExists(tx, project.id, [filters.areaType, ...filters.areaTypes], params.area))) throw notFound('Area');
      await this.assertLevel(tx, project.id, w, filters.areaType ? params.area : undefined);
      if (params.entity && !(await this.areaExists(tx, project.id, null, params.entity))) throw notFound('Place');
      return applyParams(w.query, params, filters, w.id);
    });
    return this.cached(tenant.id, project.id, null, spec, () => this.projects.cellTx(tenant.id, (tx) => this.run(tx, project.id, null, spec)));
  }

  private catalogue: { at: number; value: PublicProjectCard[] } | null = null;

  invalidateCatalogue() {
    this.catalogue = null;
  }

  /** Every live, public project across organisations (the portal's catalogue; cached briefly). */
  async publicCatalogue(): Promise<PublicProjectCard[]> {
    if (this.catalogue && Date.now() - this.catalogue.at < 60_000) return this.catalogue.value;
    const tenants = await this.ctx.db.selectFrom('tenant').select(['id', 'name', 'slug']).where('status', '=', 'active').where('access_blocked', '=', false).execute();
    const out: PublicProjectCard[] = [];
    for (const t of tenants) {
      try {
        const rows = await this.projects.cellTx(t.id, async (tx) => ({
          projects: await tx
            .selectFrom('project')
            .select(['key', 'name', 'description', 'color', 'icon', 'logo', 'cover_image'])
            .where('visibility', '=', 'public')
            .where('status', '=', 'live')
            .where('archived_at', 'is', null)
            .orderBy('name')
            .execute(),
          theme: (await tx.selectFrom('tenant_profile').select('theme').executeTakeFirst())?.theme,
        }));
        if (!rows.projects.length) continue;
        const theme = Theme.parse({ ...DEFAULT_THEME, ...((rows.theme as object) ?? {}) });
        for (const p of rows.projects)
          out.push({
            tenant: { slug: t.slug, name: t.name, logo: theme.logo, primaryColor: theme.primaryColor },
            project: { key: p.key, name: p.name, description: p.description, color: p.color, icon: p.icon, logo: p.logo, coverImage: p.cover_image },
          });
      } catch {
        // A tenant whose cell is unavailable is left out rather than failing the catalogue.
      }
    }
    this.catalogue = { at: Date.now(), value: out };
    return out;
  }
}

/** The rows of a read from a database as a table with the columns the stored rows have (`data`, and `id` for the order). */
const liveFrom = (rows: unknown[]): RawBuilder<unknown> =>
  sql`(select e.value as data, e.ord as id from jsonb_array_elements(${JSON.stringify(rows)}::jsonb) with ordinality as e(value, ord)) as live`;

/** A read from a database has no age: it was just queried. */
const liveFreshness = (at: Date): Freshness => ({ status: 'fresh', lastUpdated: iso(at), expectedMinutes: null, live: true });
