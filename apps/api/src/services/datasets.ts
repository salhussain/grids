import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { columnType, runLocalQuery, runScript, type LocalTable, type QueryResult, type Row } from '@grids/data';
import { isLiveSource, metricExpressionProblem, type Condition, type CatalogDto, type DatasetDto, FormDefinition, DatasetParam, DatasetSettings, DatasetSource, LocalSourcesDto, SqlResult, SqlRunInput } from '@grids/schema';
import type { z } from 'zod';
import { badRequest, HttpError, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import type { ConnectionService } from './connections.js';
import type { JobService } from './jobs.js';
import { fillParams, paramValues } from './dataset-params.js';
import { Limiter } from './form-links.js';
import { uuidv7 } from '@grids/schema';
import type { ProjectService } from './projects.js';

/** Most rows a dataset keeps, and an input table may load. */
const MATERIALISE_ROWS = 100_000;
const LOCAL_TIMEOUT = 60_000;
/** Code takes longer to start (Python loads its libraries), so it gets longer than a query. */
const SCRIPT_TIMEOUT = 120_000;

type Tx = Parameters<Parameters<ProjectService['cellTx']>[1]>[0];

/**
 * SQL datasets: the SQL editor's run, the table browser, and refreshing a dataset from its query.
 * A dataset on a database connection runs on that database; a local one runs on DuckDB over its sources.
 */
/** The most rows a run for a viewer's values keeps, the most such runs a dataset keeps, and how many new ones it allows in ten minutes. */
const VARIANT_ROWS = 20_000;
const VARIANTS_KEPT = 40;
const VARIANT_RUNS = 30;
/** A dataset on a database is not copied: each read queries it, and the result is shared for a moment. */
const LIVE_ROWS = 20_000;
const LIVE_TTL = 60_000;
const LIVE_CACHE_MAX = 100;
const LIVE_RUNS = 120;

/** What a read of a database dataset gave: the rows (up to a cap) and when the database was asked. */
export interface LiveRows {
  rows: Row[];
  columns: { name: string; type: string }[];
  queriedAt: Date;
  truncated: boolean;
}

/** Quoting and checking for SQL written for a PostgreSQL-style database from what a widget asks (see `aggregateLive`). */
function pgHelpers(kind: 'postgres' | 'redshift', columns: string[], types: Record<string, string>) {
  const kindOf = (c: string) => (NUMBER_TYPES.has(types[c] ?? '') ? 'number' : DATE_TYPES.has(types[c] ?? '') ? 'date' : 'other');
  const has = (c: string | undefined): c is string => !!c && columns.includes(c);
  const q = (c: string) => `t."${c.replace(/"/g, '""')}"`;
  // A text value as a literal that cannot end early under either setting of backslash handling.
  const lit = (v: string) => {
    if (v.includes('\0')) throw badRequest('That value cannot be used');
    const body = v.replace(/\\/g, '\\\\').replace(/'/g, "''");
    return kind === 'postgres' ? `E'${body}'` : `'${body}'`;
  };
  const num = (n: number) => {
    if (!Number.isFinite(n)) throw badRequest('That value cannot be used');
    return String(n);
  };
  const ts = (d: Date) => `'${d.toISOString()}'::timestamptz`;
  const at = (c: string) => `cast(${q(c)} as timestamptz)`;
  /** The WHERE conditions for a period, an equals filter and the dashboard's conditions; null when one cannot be done here. */
  const where = (w: Pick<AggregatePlan, 'period' | 'filter' | 'conditions'>): string | null => {
    const out: string[] = [];
    if (w.period) {
      if (!has(w.period.column) || kindOf(w.period.column) !== 'date') return null;
      out.push(`${at(w.period.column)} >= ${ts(w.period.from)} and ${at(w.period.column)} < ${ts(w.period.to)}`);
    }
    if (w.filter) {
      if (!has(w.filter.column)) return null;
      out.push(`cast(${q(w.filter.column)} as text) = ${lit(String(w.filter.equals))}`);
    }
    for (const c of w.conditions ?? []) {
      if (!has(c.column)) return null;
      if (c.op === 'in') out.push(`cast(${q(c.column)} as text) in (${c.values.map(lit).join(', ')})`);
      else if (c.op === 'contains') out.push(`cast(${q(c.column)} as text) ilike ${lit(`%${c.text.replace(/[!%_]/g, '!$&')}%`)} escape '!'`);
      else if (c.op === 'range') {
        if (kindOf(c.column) !== 'number') return null;
        if (c.min !== undefined) out.push(`${q(c.column)} >= ${num(c.min)}`);
        if (c.max !== undefined) out.push(`${q(c.column)} <= ${num(c.max)}`);
      } else {
        if (kindOf(c.column) !== 'date') return null;
        if (c.from) out.push(`${at(c.column)} >= ${ts(new Date(`${c.from}T00:00:00Z`))}`);
        if (c.to) {
          const to = new Date(`${c.to}T00:00:00Z`);
          to.setUTCDate(to.getUTCDate() + 1);
          out.push(`${at(c.column)} < ${ts(to)}`);
        }
      }
    }
    return out.length ? `where ${out.join(' and ')}` : '';
  };
  return { kindOf, has, q, lit, num, ts, at, where };
}

/** What a widget asks of a dataset on a database, to be worked out by the database itself. */
export interface AggregatePlan {
  column?: string;
  /** A metric defined as SQL: used instead of the column and aggregation. */
  expression?: string;
  aggregation: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'distinct' | 'last';
  groupBy?: string;
  /** More grouping columns: the label is "first · second · third". */
  thenBy?: string | string[];
  /** A series: the date column, and the step. */
  timeColumn?: string;
  interval: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
  /** Only rows whose date column falls in the dashboard's period. */
  period?: { column: string; from: Date; to: Date };
  filter?: { column: string; equals: string | number | boolean };
  conditions?: Condition[];
  limit: number;
  params: Record<string, string>;
}
export interface Aggregated {
  rows: Record<string, unknown>[];
  queriedAt: Date;
}

const NUMBER_TYPES = new Set(['bigint', 'integer', 'smallint', 'numeric', 'double', 'real']);
const DATE_TYPES = new Set(['date', 'timestamp', 'timestamptz']);

export class DatasetService {
  private readonly limiter = new Limiter();
  /** Runs already under way, so two viewers asking for the same values wait for one run. */
  private readonly running = new Map<string, Promise<string>>();
  /** Results of live reads, kept in memory only and for a minute: never written to the platform database. */
  private readonly liveCache = new Map<string, { until: number; value: LiveRows }>();
  private readonly liveRunning = new Map<string, Promise<LiveRows>>();
  /** The same for grouped answers worked out by the database. */
  private readonly aggCache = new Map<string, { until: number; value: Aggregated }>();
  private readonly aggRunning = new Map<string, Promise<Aggregated>>();

  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
    private readonly connections: ConnectionService,
    private readonly jobs: JobService,
  ) {}

  /** Runs a query for the editor without saving anything. */
  async run(actor: Actor, tenantId: string, project: string, input: z.output<typeof SqlRunInput>): Promise<SqlResult> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const started = Date.now();
    const out = await this.execute(tenantId, a.project.id, input.source, input.limit, input.parameters, paramValues(input.parameters, input.params), input.debug && { lines: input.debug.lines, stop: input.debug.stop });
    return { ...out, ms: Date.now() - started };
  }

  async catalog(actor: Actor, tenantId: string, project: string, connection: string): Promise<CatalogDto> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    return this.connections.catalog(tenantId, a.project.id, connection);
  }

  /** What a local dataset can read, with the columns of forms and datasets. */
  async localSources(actor: Actor, tenantId: string, project: string): Promise<LocalSourcesDto> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    return this.projects.cellTx(tenantId, async (tx) => {
      const forms = await tx.selectFrom('form').select(['id', 'key', 'name', 'draft', 'current_version']).where('project_id', '=', a.project.id).where('archived_at', 'is', null).orderBy('name').execute();
      const out: LocalSourcesDto['forms'] = [];
      for (const f of forms) {
        const { columns, defaults } = await this.formColumns(tx, f);
        out.push({ key: f.key, name: f.name, columns, defaults });
      }
      const datasets = await tx.selectFrom('dataset').select(['key', 'name', 'columns']).where('project_id', '=', a.project.id).orderBy('name').execute();
      const types = await tx.selectFrom('entity_type').select(['id', 'key', 'name', 'plural', 'attributes']).where('project_id', '=', a.project.id).orderBy('sort').orderBy('name').execute();
      const entities: LocalSourcesDto['entities'] = [];
      for (const t of types) entities.push({ key: t.key, name: t.plural || t.name, columns: await this.entityColumns(tx, t) });
      const conns = await tx.selectFrom('project_connection').select(['key', 'name', 'kind']).where('project_id', '=', a.project.id).orderBy('name').execute();
      return {
        forms: out,
        datasets: datasets.map((d) => ({ key: d.key, name: d.name, columns: d.columns as string[] })),
        entities,
        entityTypes: { columns: ENTITY_TYPE_COLUMNS },
        connections: conns,
      };
    });
  }

  /** What a form's table has: its own fields, the questions of the published form (its draft before the first publish), then other answers seen in recent submissions (older versions). */
  private async formColumns(tx: Tx, f: { id: string; draft: unknown; current_version: number | null }): Promise<{ columns: string[]; defaults: Record<string, string> }> {
    const version = f.current_version === null ? null : await tx.selectFrom('form_version').select('definition').where('form_id', '=', f.id).where('version', '=', f.current_version).executeTakeFirst();
    const def = (version?.definition ?? f.draft) as FormDefinition;
    const asked = (def.sections ?? []).flatMap((x) => (x.repeat ? [x.key] : x.questions.filter((q) => q.type !== 'note').map((q) => q.key)));
    const sample = await tx.selectFrom('submission').select('answers').where('form_id', '=', f.id).orderBy('submitted_at', 'desc').limit(50).execute();
    const defaults: Record<string, string> = {};
    for (const q of (def.sections ?? []).flatMap((x) => x.questions)) if (q.defaultValue !== undefined && q.defaultValue !== '') defaults[q.key] = Array.isArray(q.defaultValue) ? q.defaultValue.join(', ') : String(q.defaultValue);
    return { columns: [...SUBMISSION_COLUMNS, ...new Set([...asked, ...sample.flatMap((s) => Object.keys(s.answers))])], defaults };
  }

  /** What an entity type's table has: its own fields, the type's attributes, then other attributes seen on recent entities. */
  private async entityColumns(tx: Tx, t: { id: string; attributes: unknown }): Promise<string[]> {
    const defined = ((t.attributes ?? []) as { key: string }[]).map((a) => a.key);
    const sample = await tx.selectFrom('entity').select('attributes').where('type_id', '=', t.id).orderBy('updated_at', 'desc').limit(50).execute();
    return [...ENTITY_COLUMNS, ...new Set([...defined, ...sample.flatMap((e) => Object.keys(e.attributes))])];
  }

  /** Columns a source has even without rows. */
  private async inputColumns(tx: Tx, projectId: string, input: { kind: string; ref: string }): Promise<string[] | undefined> {
    if (input.kind === 'form') {
      const f = await tx.selectFrom('form').select(['id', 'draft', 'current_version']).where('project_id', '=', projectId).where('key', '=', input.ref).executeTakeFirst();
      return f ? (await this.formColumns(tx, f)).columns : undefined;
    }
    if (input.kind === 'entity') {
      const t = await tx.selectFrom('entity_type').select(['id', 'attributes']).where('project_id', '=', projectId).where('key', '=', input.ref).executeTakeFirst();
      return t ? this.entityColumns(tx, t) : undefined;
    }
    if (input.kind === 'entity_types') return ENTITY_TYPE_COLUMNS;
    if (input.kind === 'dataset') {
      const d = await tx.selectFrom('dataset').select('columns').where('project_id', '=', projectId).where('key', '=', input.ref).executeTakeFirst();
      return d ? (d.columns as string[]) : undefined;
    }
    return undefined;
  }

  /** Re-runs a dataset's query and replaces its rows. A failure is recorded on the dataset and reported. */
  async refresh(actor: Actor, tenantId: string, project: string, key: string): Promise<DatasetDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const ds = await this.projects.cellTx(tenantId, (tx) =>
      tx.selectFrom('dataset').select(['id', 'source', 'settings']).where('project_id', '=', a.project.id).where('key', '=', key).executeTakeFirst(),
    );
    if (!ds) throw notFound('Dataset');
    const source = ds.source as DatasetSource;
    if (source.type === 'rows') throw badRequest('This dataset has no query', 'Its rows come from a job or an upload.');
    let result: QueryResult;
    try {
      const parameters = ((ds.settings as Partial<DatasetSettings>).parameters ?? []) as DatasetParam[];
      result = await this.execute(tenantId, a.project.id, source, MATERIALISE_ROWS, parameters, paramValues(parameters));
    } catch (e) {
      const message = e instanceof Error ? [e.message, (e as { detail?: string }).detail].filter(Boolean).join(': ') : String(e);
      await this.projects.cellTx(tenantId, (tx) => tx.updateTable('dataset').set({ refresh_error: message.slice(0, 500) }).where('id', '=', ds.id).execute());
      throw e;
    }
    const live = isLiveSource(source);
    if (live) this.forgetLive(ds.id);
    await this.projects.cellTx(tenantId, async (tx) => {
      // A database dataset keeps no copy: this only learns its columns and notes when it was last queried.
      await tx.deleteFrom('dataset_row').where('dataset_id', '=', ds.id).execute();
      if (live) await tx.deleteFrom('dataset_variant').where('dataset_id', '=', ds.id).execute();
      else
        for (let i = 0; i < result.rows.length; i += 1000)
          await tx
            .insertInto('dataset_row')
            .values(result.rows.slice(i, i + 1000).map((data) => ({ tenant_id: tenantId, dataset_id: ds.id, data: JSON.stringify(data) })))
            .execute();
      await tx
        .updateTable('dataset')
        .set({
          columns: JSON.stringify(result.columns.map((c) => c.name)),
          column_types: JSON.stringify(Object.fromEntries(result.columns.map((c) => [c.name, c.type]))),
          row_count: result.rows.length,
          last_materialised_at: this.ctx.now(),
          refresh_error: null,
        })
        .where('id', '=', ds.id)
        .execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'dataset.refreshed', { project: a.project.key, dataset: key, rows: result.rows.length, truncated: result.truncated });
    return this.jobs.datasets(actor, tenantId, project);
  }

  // ------------------------------------------------------------ runs for a viewer's values

  /**
   * The stored rows of a dataset run with the values a viewer picked. The first time a set of values is asked for the
   * query runs and its rows are kept apart from the dataset's own; after that they are served until they are as old
   * as the dataset's freshness (an hour when it sets none) or the dataset itself is refreshed. A dataset must say
   * it allows this, and only so many different sets of values are run at once, so a dashboard cannot be used to flood
   * a database.
   */
  async variantFor(tenantId: string, projectId: string, datasetKey: string, given: Record<string, string>): Promise<string> {
    const ds = await this.projects.cellTx(tenantId, (tx) =>
      tx.selectFrom('dataset').select(['id', 'source', 'settings', 'last_materialised_at', 'freshness_minutes']).where('project_id', '=', projectId).where('key', '=', datasetKey).executeTakeFirst(),
    );
    if (!ds) throw notFound('Dataset');
    const settings = ds.settings as Partial<DatasetSettings>;
    const source = ds.source as DatasetSource;
    if (!settings.runPerViewer || source.type === 'rows') throw badRequest('This dataset is not set up to run for a viewer’s values.');
    const parameters = (settings.parameters ?? []) as DatasetParam[];
    // The values are checked against the parameters' types; anything else sent is ignored.
    const values = paramValues(parameters, given);
    const key = createHash('sha256').update(JSON.stringify(Object.keys(values).sort().map((k) => [k, values[k]]))).digest('hex').slice(0, 40);
    const ttl = Math.max(5, ds.freshness_minutes ?? 60) * 60_000;
    const fresh = (v: { refreshed_at: Date }) => v.refreshed_at.getTime() >= Math.max(this.ctx.now().getTime() - ttl, ds.last_materialised_at?.getTime() ?? 0);
    const found = await this.projects.cellTx(tenantId, (tx) => tx.selectFrom('dataset_variant').select(['id', 'refreshed_at']).where('dataset_id', '=', ds.id).where('key', '=', key).executeTakeFirst());
    if (found && fresh(found)) {
      void this.projects.cellTx(tenantId, (tx) => tx.updateTable('dataset_variant').set({ last_used_at: this.ctx.now() }).where('id', '=', found.id).execute()).catch(() => undefined);
      return found.id;
    }
    const flight = `${ds.id}|${key}`;
    const going = this.running.get(flight);
    if (going) return going;
    if (!this.limiter.allow(`runs|${ds.id}`, VARIANT_RUNS, 10 * 60_000)) throw new HttpError(429, 'Too many different filter values are being tried right now. Wait a few minutes and try again.');
    const run = (async () => {
      const result = await this.execute(tenantId, projectId, source, VARIANT_ROWS, parameters, values);
      return this.projects.cellTx(tenantId, async (tx) => {
        const now = this.ctx.now();
        const id = found?.id ?? uuidv7();
        if (found) {
          await tx.deleteFrom('dataset_variant_row').where('variant_id', '=', id).execute();
          await tx.updateTable('dataset_variant').set({ params: JSON.stringify(values), row_count: result.rows.length, refreshed_at: now, last_used_at: now }).where('id', '=', id).execute();
        } else {
          await tx.insertInto('dataset_variant').values({ id, tenant_id: tenantId, dataset_id: ds.id, key, params: JSON.stringify(values), row_count: result.rows.length, refreshed_at: now, last_used_at: now }).onConflict((oc) => oc.columns(['dataset_id', 'key']).doNothing()).execute();
        }
        for (let i = 0; i < result.rows.length; i += 1000)
          await tx.insertInto('dataset_variant_row').values(result.rows.slice(i, i + 1000).map((data) => ({ tenant_id: tenantId, variant_id: id, data: JSON.stringify(data) }))).execute();
        // Keep the most recently used few, and throw away the rest.
        const old = await tx.selectFrom('dataset_variant').select('id').where('dataset_id', '=', ds.id).orderBy('last_used_at', 'desc').offset(VARIANTS_KEPT).execute();
        if (old.length) await tx.deleteFrom('dataset_variant').where('id', 'in', old.map((o) => o.id)).execute();
        return id;
      });
    })().finally(() => this.running.delete(flight));
    this.running.set(flight, run);
    return run;
  }

  // ------------------------------------------------------------ live reads

  /**
   * The rows of a dataset on a database, read from the database now (or a minute ago, if someone just asked): they are
   * not stored. Null when the dataset keeps a copy instead. Values a viewer picked for its parameters are applied.
   * Reads of the same dataset and values share one query, and only so many run a minute, so a dashboard cannot be
   * used to flood a database.
   */
  async liveRows(tenantId: string, projectId: string, datasetKey: string, given: Record<string, string> = {}): Promise<LiveRows | null> {
    const ds = await this.projects.cellTx(tenantId, (tx) =>
      tx.selectFrom('dataset').select(['id', 'source', 'settings']).where('project_id', '=', projectId).where('key', '=', datasetKey).executeTakeFirst(),
    );
    if (!ds) throw notFound('Dataset');
    const source = ds.source as DatasetSource;
    if (!isLiveSource(source)) return null;
    const parameters = ((ds.settings as Partial<DatasetSettings>).parameters ?? []) as DatasetParam[];
    const values = paramValues(parameters, given);
    const key = `${ds.id}|${createHash('sha256').update(JSON.stringify(Object.keys(values).sort().map((k) => [k, values[k]]))).digest('hex').slice(0, 24)}`;
    const now = Date.now();
    const hit = this.liveCache.get(key);
    if (hit && hit.until > now) return hit.value;
    const going = this.liveRunning.get(key);
    if (going) return going;
    if (!this.limiter.allow(`live|${ds.id}`, LIVE_RUNS, 60_000)) {
      // Too many different reads at once: serve the last answer, however old, rather than ask the database again.
      if (hit) return hit.value;
      throw new HttpError(429, 'This data is being asked for too often right now. Try again in a minute.');
    }
    const run = (async () => {
      const res = await this.execute(tenantId, projectId, source, LIVE_ROWS, parameters, values);
      const value: LiveRows = { rows: res.rows, columns: res.columns, queriedAt: this.ctx.now(), truncated: res.truncated };
      this.liveCache.set(key, { until: Date.now() + LIVE_TTL, value });
      // Keep the cache small: drop what has gone stale, then the oldest.
      if (this.liveCache.size > LIVE_CACHE_MAX) {
        for (const [k, v] of this.liveCache) if (v.until <= Date.now()) this.liveCache.delete(k);
        while (this.liveCache.size > LIVE_CACHE_MAX) this.liveCache.delete(this.liveCache.keys().next().value!);
      }
      return value;
    })().finally(() => this.liveRunning.delete(key));
    this.liveRunning.set(key, run);
    return run;
  }

  /** A dataset on a PostgreSQL-style database, with what is needed to write SQL for it; null for any other kind. */
  private async pgDataset(tenantId: string, projectId: string, datasetKey: string) {
    const ds = await this.projects.cellTx(tenantId, (tx) =>
      tx.selectFrom('dataset').select(['id', 'source', 'settings', 'columns', 'column_types']).where('project_id', '=', projectId).where('key', '=', datasetKey).executeTakeFirst(),
    );
    if (!ds) throw notFound('Dataset');
    const source = ds.source as DatasetSource;
    if (!isLiveSource(source) || source.type !== 'connection') return null;
    const conn = await this.connections.open(tenantId, projectId, source.connection);
    if (conn.kind !== 'postgres' && conn.kind !== 'redshift') return null;
    const h = pgHelpers(conn.kind, ds.columns as string[], (ds.column_types ?? {}) as Record<string, string>);
    const parameters = ((ds.settings as Partial<DatasetSettings>).parameters ?? []) as DatasetParam[];
    /** The dataset's own query, with the viewer's values filled in, as a table to select from. */
    const from = (params: Record<string, string>) => `from (${fillParams(source.sql, parameters, paramValues(parameters, params)).trim().replace(/[;\s]+$/, '')}) as t`;
    return { id: ds.id, connection: source.connection, h, from };
  }

  /** Runs generated SQL on the database; asked for by many viewers at once, one query answers them for a minute. */
  private async askDatabase(tenantId: string, projectId: string, d: { id: string; connection: string }, text: string, rows: number): Promise<Aggregated> {
    const key = `${d.id}|${createHash('sha256').update(text).digest('hex').slice(0, 32)}`;
    const hit = this.aggCache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const going = this.aggRunning.get(key);
    if (going) return going;
    if (!this.limiter.allow(`live|${d.id}`, LIVE_RUNS, 60_000)) {
      if (hit) return hit.value;
      throw new HttpError(429, 'This data is being asked for too often right now. Try again in a minute.');
    }
    const run = (async () => {
      const res = await this.connections.query(tenantId, projectId, d.connection, text, rows);
      const value: Aggregated = { rows: res.rows, queriedAt: this.ctx.now() };
      this.aggCache.set(key, { until: Date.now() + LIVE_TTL, value });
      if (this.aggCache.size > LIVE_CACHE_MAX) {
        for (const [k, v] of this.aggCache) if (v.until <= Date.now()) this.aggCache.delete(k);
        while (this.aggCache.size > LIVE_CACHE_MAX) this.aggCache.delete(this.aggCache.keys().next().value!);
      }
      return value;
    })().finally(() => this.aggRunning.delete(key));
    this.aggRunning.set(key, run);
    return run;
  }

  /**
   * Works a widget's grouping out on the database instead of reading the rows: `select …, sum(x) … from (the dataset's
   * query) group by …`. Only the grouped answer comes back, so a table of millions of rows is as easy as a small one.
   * Null when it cannot be done safely (another kind of database, a column of an unknown type, the "last" value): the
   * caller then reads the rows and groups them itself. Every column used must be one the query returned, names are
   * quoted, and values are escaped as text, so nothing a viewer picks can change the shape of the query.
   */
  async aggregateLive(tenantId: string, projectId: string, datasetKey: string, plan: AggregatePlan): Promise<Aggregated | null> {
    const d = await this.pgDataset(tenantId, projectId, datasetKey);
    if (!d) return null;
    const { q, at, has, kindOf } = d.h;
    let value: string;
    if (plan.expression) {
      // Written by whoever made the metric, and checked to be one expression that closes its own brackets.
      const problem = metricExpressionProblem(plan.expression);
      if (problem) throw badRequest('The metric’s expression cannot be used', problem);
      value = `cast((${plan.expression}) as double precision)`;
    } else if (plan.aggregation === 'last') return null;
    else if (plan.aggregation === 'count' || !plan.column) value = 'count(*)';
    else {
      if (!has(plan.column)) return null;
      if (plan.aggregation === 'distinct') value = `count(distinct ${q(plan.column)})`;
      else if (kindOf(plan.column) !== 'number') return null;
      else value = `cast(${plan.aggregation}(${q(plan.column)}) as double precision)`;
    }
    const where = d.h.where(plan);
    if (where === null) return null;
    const from = d.from(plan.params);
    let text: string;
    if (plan.timeColumn) {
      if (!has(plan.timeColumn) || kindOf(plan.timeColumn) !== 'date') return null;
      text = `select date_trunc('${plan.interval}', ${at(plan.timeColumn)}) as t, ${value} as value ${from} ${where} group by 1 order by 1 limit 1000`;
    } else if (plan.groupBy) {
      const more = [plan.thenBy ?? []].flat();
      if (!has(plan.groupBy) || more.some((c) => !has(c))) return null;
      const name = (c: string) => `coalesce(cast(${q(c)} as text), '(none)')`;
      text = `select ${[plan.groupBy, ...more].map(name).join(` || ' · ' || `)} as label, ${value} as value ${from} ${where} group by 1 order by 2 desc nulls last, 1 limit ${Math.min(500, Math.max(1, Math.floor(plan.limit)))}`;
    } else text = `select ${value} as value ${from} ${where}`;
    return this.askDatabase(tenantId, projectId, d, text, 1000);
  }

  /** The rows of a table widget, sorted and cut to its limit by the database. Null when that cannot be done here. */
  async tableLive(tenantId: string, projectId: string, datasetKey: string, req: { columns: string[]; sort: string | null; desc?: boolean; conditions?: Condition[]; limit: number; params: Record<string, string> }): Promise<Aggregated | null> {
    const d = await this.pgDataset(tenantId, projectId, datasetKey);
    if (!d || !req.columns.length || !req.columns.every((c) => d.h.has(c)) || (req.sort && !d.h.has(req.sort))) return null;
    const where = d.h.where({ conditions: req.conditions });
    if (where === null) return null;
    const text = `select ${req.columns.map((c) => `${d.h.q(c)} as "${c.replace(/"/g, '""')}"`).join(', ')} ${d.from(req.params)} ${where} ${req.sort ? `order by ${d.h.q(req.sort)} ${req.desc ? 'desc' : 'asc'} nulls last` : ''} limit ${Math.min(500, Math.max(1, Math.floor(req.limit)))}`;
    return this.askDatabase(tenantId, projectId, d, text, 500);
  }

  /** The distinct values of a column, for a dashboard filter's list, found by the database. Null when that cannot be done here. */
  async distinctLive(tenantId: string, projectId: string, datasetKey: string, req: { column: string; conditions?: Condition[] }): Promise<string[] | null> {
    const d = await this.pgDataset(tenantId, projectId, datasetKey);
    if (!d || !d.h.has(req.column)) return null;
    const where = d.h.where({ conditions: req.conditions });
    if (where === null) return null;
    const col = d.h.q(req.column);
    const text = `select distinct cast(${col} as text) as v ${d.from({})} ${where ? `${where} and` : 'where'} ${col} is not null and cast(${col} as text) <> '' order by 1 limit 300`;
    return (await this.askDatabase(tenantId, projectId, d, text, 300)).rows.map((r) => String(r.v));
  }

  /** Forgets what was read for a dataset (its query changed, or it was refreshed by hand). */
  private forgetLive(datasetId: string) {
    for (const k of this.liveCache.keys()) if (k.startsWith(`${datasetId}|`)) this.liveCache.delete(k);
    for (const k of this.aggCache.keys()) if (k.startsWith(`${datasetId}|`)) this.aggCache.delete(k);
  }

  /** A page of a dataset's rows: from the database for a live dataset, else from the stored copy. */
  async rowsPage(actor: Actor, tenantId: string, project: string, key: string, page: { page: number; pageSize: number }) {
    const a = await this.projects.access(actor, tenantId, project);
    const live = await this.liveRows(tenantId, a.project.id, key);
    if (!live) return this.jobs.datasetRows(actor, tenantId, project, key, page);
    const from = (page.page - 1) * page.pageSize;
    return { columns: live.columns.map((c) => c.name), items: live.rows.slice(from, from + page.pageSize) as Record<string, unknown>[], total: live.rows.length, page: page.page, pageSize: page.pageSize };
  }

  // ------------------------------------------------------------ execution

  private async execute(tenantId: string, projectId: string, source: DatasetSource, limit: number, parameters: DatasetParam[] = [], values: Record<string, string | number> = {}, debug?: { lines: number[]; stop: boolean }): Promise<QueryResult & { debug?: { hits: { line: number; vars: { name: string; type: string; preview: string }[] }[]; stopped: boolean } }> {
    if (source.type === 'rows') throw badRequest('Choose a connection or local sources');
    if (source.type === 'connection') return this.connections.query(tenantId, projectId, source.connection, fillParams(source.sql, parameters, values), limit);
    const tables: LocalTable[] = [];
    for (const input of source.inputs) {
      const rows = await this.inputRows(tenantId, projectId, input);
      const columns = input.kind === 'connection' ? undefined : await this.projects.cellTx(tenantId, (tx) => this.inputColumns(tx, projectId, input));
      tables.push({ name: input.as, rows, ...(columns ? { columns } : {}) });
    }
    if (source.type === 'script') {
      const started = Date.now();
      try {
        const res = await runScript({ language: source.language, code: source.code, tables, limit, params: values, ...(debug?.lines.length && { debug }) }, { limit, timeoutMs: SCRIPT_TIMEOUT });
        // The script says what it made; the type of each column is worked out from its values.
        const LABEL = { BIGINT: 'bigint', DOUBLE: 'double', BOOLEAN: 'boolean', DATE: 'date', TIMESTAMP: 'timestamp', VARCHAR: 'varchar' } as const;
        return {
          columns: res.columns.map((name) => ({ name, type: LABEL[columnType(res.rows.map((r) => r[name]))] })),
          rows: res.rows as Row[],
          truncated: res.truncated,
          ms: Date.now() - started,
          ...(res.debug && { debug: res.debug }),
        } as QueryResult;
      } catch (e) {
        throw badRequest('The script failed', e instanceof Error ? e.message.slice(0, 1000) : String(e));
      }
    }
    try {
      return await runLocalQuery(tables, fillParams(source.sql, parameters, values), { limit, timeoutMs: LOCAL_TIMEOUT });
    } catch (e) {
      throw badRequest('The query failed', e instanceof Error ? e.message.slice(0, 500) : String(e));
    }
  }

  private async inputRows(tenantId: string, projectId: string, input: Extract<DatasetSource, { type: 'local' | 'script' }>['inputs'][number]): Promise<Row[]> {
    if (input.kind === 'connection') return this.connections.rowsOf(tenantId, projectId, input.ref, input, MATERIALISE_ROWS);
    // A dataset on a database has no copy: its query is run.
    if (input.kind === 'dataset') {
      const live = await this.liveRows(tenantId, projectId, input.ref).catch((e) => (e instanceof HttpError && e.statusCode === 404 ? null : Promise.reject(e)));
      if (live) return live.rows;
    }
    return this.projects.cellTx(tenantId, async (tx) => {
      if (input.kind === 'form') return this.submissions(tx, projectId, input.ref);
      if (input.kind === 'entity') return this.entities(tx, projectId, input.ref);
      if (input.kind === 'entity_types') return this.entityTypes(tx, projectId);
      const ds = await tx.selectFrom('dataset').select('id').where('project_id', '=', projectId).where('key', '=', input.ref).executeTakeFirst();
      if (!ds) throw badRequest(`Dataset ${input.ref} does not exist`);
      const rows = await tx.selectFrom('dataset_row').select('data').where('dataset_id', '=', ds.id).orderBy('id').limit(MATERIALISE_ROWS).execute();
      return rows.map((r) => r.data as Row);
    });
  }

  /** One row per entity of a type: its own fields prefixed by an underscore, then its attributes as columns. */
  private async entities(tx: Tx, projectId: string, typeKey: string): Promise<Row[]> {
    const type = await tx.selectFrom('entity_type').select('id').where('project_id', '=', projectId).where('key', '=', typeKey).executeTakeFirst();
    if (!type) throw badRequest(`Entity type ${typeKey} does not exist`);
    const rows = await tx
      .selectFrom('entity as e')
      .leftJoin('entity as p', 'p.id', 'e.parent_id')
      .select([
        'e.id',
        'e.code',
        'e.name',
        'p.code as parent_code',
        'e.attributes',
        'e.created_at',
        'e.updated_at',
        sql<string>`e.path::text`.as('path'),
        sql<string | null>`ST_AsGeoJSON(e.geom, 6)`.as('geo'),
        sql<number | null>`ST_Y(e.point)`.as('lat'),
        sql<number | null>`ST_X(e.point)`.as('lng'),
      ])
      .where('e.type_id', '=', type.id)
      .orderBy('e.path')
      .limit(MATERIALISE_ROWS)
      .execute();
    return rows.map((r) => ({
      _id: r.id,
      _code: r.code,
      _name: r.name,
      _parent_code: r.parent_code,
      _path: r.path,
      _lat: r.lat,
      _lng: r.lng,
      _geometry: r.geo,
      _created_at: r.created_at.toISOString(),
      _updated_at: r.updated_at.toISOString(),
      ...r.attributes,
    }));
  }

  /** One row per entity type of the project. */
  private async entityTypes(tx: Tx, projectId: string): Promise<Row[]> {
    const types = await tx.selectFrom('entity_type').select(['id', 'key', 'name', 'plural', 'geometry', 'parent_types', 'color', 'icon', 'attributes']).where('project_id', '=', projectId).orderBy('sort').orderBy('name').execute();
    const counts = await tx.selectFrom('entity').select(['type_id', sql<number>`count(*)::int`.as('n')]).where('project_id', '=', projectId).groupBy('type_id').execute();
    const n = new Map(counts.map((c) => [c.type_id, c.n]));
    return types.map((t) => ({
      key: t.key,
      name: t.name,
      plural: t.plural,
      geometry: t.geometry,
      parent_types: t.parent_types.join(', '),
      color: t.color,
      icon: t.icon,
      attributes: (t.attributes as { key: string }[]).map((a) => a.key).join(', '),
      entities: n.get(t.id) ?? 0,
    }));
  }

  /** One row per submission: its answers as columns, with its own fields prefixed by an underscore. */
  private async submissions(tx: Tx, projectId: string, formKey: string): Promise<Row[]> {
    const form = await tx.selectFrom('form').select('id').where('project_id', '=', projectId).where('key', '=', formKey).executeTakeFirst();
    if (!form) throw badRequest(`Form ${formKey} does not exist`);
    const rows = await tx
      .selectFrom('submission')
      .select(['id', 'status', 'submitted_at', 'collected_at', 'submitted_by', 'answers'])
      .where('form_id', '=', form.id)
      .orderBy('submitted_at')
      .limit(MATERIALISE_ROWS)
      .execute();
    return rows.map((r) => ({
      _id: r.id,
      _status: r.status,
      _submitted_at: r.submitted_at.toISOString(),
      _collected_at: r.collected_at.toISOString(),
      _submitted_by: r.submitted_by,
      ...r.answers,
    }));
  }
}

const ENTITY_COLUMNS = ['_id', '_code', '_name', '_parent_code', '_path', '_lat', '_lng', '_geometry', '_created_at', '_updated_at'];
const ENTITY_TYPE_COLUMNS = ['key', 'name', 'plural', 'geometry', 'parent_types', 'color', 'icon', 'attributes', 'entities'];
const SUBMISSION_COLUMNS = ['_id', '_status', '_submitted_at', '_collected_at', '_submitted_by'];
