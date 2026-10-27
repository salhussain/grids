import { withTenant, type CellDB } from '@grids/db';
import { sql, type Transaction } from 'kysely';
import { LIMIT_KEYS, type LimitKey, type PlanLimits, type UsageItem } from '@grids/schema';
import { HttpError, LimitExceededError } from '../errors.js';
import type { ServiceContext } from './context.js';

type Tx = Transaction<CellDB>;

const GB = 1_000_000_000;
const startOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * What an organisation has used of each allowance its plan sets, and the refusals when one is used up:
 *  - projects (archived ones too: archiving is not deleting), forms, submissions, people: counted from the data;
 *  - storage: uploaded files plus the size of dataset rows;
 *  - run minutes and rows ingested: added up from this month's job runs;
 *  - API calls: requests from outside the workspace (public pages and forms, webhooks), counted as they arrive.
 */
export class UsageService {
  constructor(
    private readonly ctx: Pick<ServiceContext, 'db' | 'cells' | 'now'>,
    private readonly deps: { seatsUsed: (tenantId: string) => Promise<number> },
  ) {}

  async limits(tenantId: string): Promise<PlanLimits> {
    const row = await this.ctx.db
      .selectFrom('tenant as t')
      .leftJoin('plan as p', 'p.id', 't.plan_id')
      .select('p.limits')
      .where('t.id', '=', tenantId)
      .executeTakeFirst();
    return (row?.limits as PlanLimits | null) ?? ({} as PlanLimits);
  }

  // ---------- counting ----------

  private async counts(tx: Tx) {
    const month = startOfMonth(this.ctx.now());
    const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql<T>>) => (await q.execute(tx)).rows[0]!;
    const projects = await one<{ n: string }>(sql`select count(*)::text as n from project`);
    const forms = await one<{ n: string }>(sql`select count(*)::text as n from form where archived_at is null`);
    const subs = await one<{ n: string }>(sql`select count(*)::text as n from submission where submitted_at >= ${month}`);
    const bytes = await one<{ n: string }>(sql`
      select (
        coalesce((select sum(size) from form_attachment), 0) +
        coalesce((select sum(pg_column_size(data)) from dataset_row), 0)
      )::text as n`);
    const runs = await one<{ minutes: string; rows: string }>(sql`
      select
        coalesce(sum(extract(epoch from (coalesce(finished_at, ${this.ctx.now()}) - started_at)) / 60), 0)::text as minutes,
        coalesce(sum(greatest(
          coalesce((stats->>'rows_fetched')::numeric, 0),
          coalesce((stats->>'rows_parsed')::numeric, 0),
          coalesce((stats->>'rows_received')::numeric, 0)
        )), 0)::text as rows
      from run where started_at >= ${month}`);
    return {
      projects: Number(projects.n),
      forms: Number(forms.n),
      submissions_per_month: Number(subs.n),
      storage_gb: round(Number(bytes.n) / GB),
      run_minutes_per_month: round(Number(runs.minutes), 1),
      rows_ingested_per_month: Math.round(Number(runs.rows)),
    };
  }

  private async apiCalls(tenantId: string): Promise<number> {
    const row = await this.ctx.db
      .selectFrom('usage_counter')
      .select('n')
      .where('tenant_id', '=', tenantId)
      .where('month', '=', startOfMonth(this.ctx.now()))
      .where('key', '=', 'api_calls_per_month')
      .executeTakeFirst();
    return Number(row?.n ?? 0) + (this.pending.get(tenantId) ?? 0);
  }

  /** Use against every limit (`limit` null: unlimited). */
  async items(tenantId: string): Promise<UsageItem[]> {
    const [limits, users, counts, calls] = await Promise.all([
      this.limits(tenantId),
      this.deps.seatsUsed(tenantId),
      withTenant(await this.ctx.cells.forTenant(tenantId), tenantId, (tx) => this.counts(tx)).catch(() => null),
      this.apiCalls(tenantId).catch(() => 0),
    ]);
    const used: Record<LimitKey, number> = {
      users,
      projects: counts?.projects ?? 0,
      forms: counts?.forms ?? 0,
      submissions_per_month: counts?.submissions_per_month ?? 0,
      storage_gb: counts?.storage_gb ?? 0,
      run_minutes_per_month: counts?.run_minutes_per_month ?? 0,
      rows_ingested_per_month: counts?.rows_ingested_per_month ?? 0,
      api_calls_per_month: calls,
    };
    return LIMIT_KEYS.map((key) => ({ key, used: used[key], limit: limits[key] ?? null }));
  }

  // ---------- refusing ----------

  /** Refuses one more `forms` or `submissions_per_month` once the plan's limit is used up, counting inside the open transaction. */
  async assertIn(tx: Tx, tenantId: string, key: 'forms' | 'submissions_per_month'): Promise<void> {
    const limit = (await this.limits(tenantId))[key];
    if (limit === null || limit === undefined) return;
    const used = (await this.counts(tx))[key];
    if (used + 1 > limit) throw new LimitExceededError(key, limit);
  }

  /** Refuses an upload that would take storage past the plan's allowance. */
  async assertStorage(tenantId: string, addingBytes: number): Promise<void> {
    const limit = (await this.limits(tenantId)).storage_gb;
    if (limit === null || limit === undefined) return;
    const counts = await withTenant(await this.ctx.cells.forTenant(tenantId), tenantId, (tx) => this.counts(tx));
    if (counts.storage_gb + addingBytes / GB > limit) throw new LimitExceededError('storage_gb', limit);
  }

  /** Refuses to start a run once this month's run minutes or ingested rows are used up. */
  async assertRun(tenantId: string): Promise<void> {
    const limits = await this.limits(tenantId);
    if (limits.run_minutes_per_month == null && limits.rows_ingested_per_month == null) return;
    const c = await withTenant(await this.ctx.cells.forTenant(tenantId), tenantId, (tx) => this.counts(tx));
    if (limits.run_minutes_per_month != null && c.run_minutes_per_month >= limits.run_minutes_per_month)
      throw new LimitExceededError('run_minutes_per_month', limits.run_minutes_per_month);
    if (limits.rows_ingested_per_month != null && c.rows_ingested_per_month >= limits.rows_ingested_per_month)
      throw new LimitExceededError('rows_ingested_per_month', limits.rows_ingested_per_month);
  }

  // ---------- API calls ----------

  private readonly pending = new Map<string, number>();
  private readonly seen = new Map<string, { total: number; at: number; limit: number | null }>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Counts one request from outside the workspace; refuses it (429) once the month's allowance is used up. */
  async recordApiCall(tenantId: string): Promise<void> {
    let s = this.seen.get(tenantId);
    if (!s || Date.now() - s.at > 30_000) {
      s = { total: (await this.apiCalls(tenantId)) - (this.pending.get(tenantId) ?? 0), at: Date.now(), limit: (await this.limits(tenantId)).api_calls_per_month ?? null };
      this.seen.set(tenantId, s);
    }
    const pending = this.pending.get(tenantId) ?? 0;
    if (s.limit !== null && s.total + pending >= s.limit) throw new HttpError(429, 'Too many requests', 'This organisation has used its API allowance for the month.');
    this.pending.set(tenantId, pending + 1);
    this.timer ??= setTimeout(() => void this.flush(), 5_000).unref();
  }

  /** Writes the counted requests to the database. */
  async flush(): Promise<void> {
    this.timer = null;
    const month = startOfMonth(this.ctx.now());
    for (const [tenantId, n] of [...this.pending]) {
      this.pending.delete(tenantId);
      await this.ctx.db
        .insertInto('usage_counter')
        .values({ tenant_id: tenantId, month, key: 'api_calls_per_month', n })
        .onConflict((oc) => oc.columns(['tenant_id', 'month', 'key']).doUpdateSet((eb) => ({ n: sql`usage_counter.n + ${eb.ref('excluded.n')}` })))
        .execute()
        .catch(() => this.pending.set(tenantId, (this.pending.get(tenantId) ?? 0) + n));
      const s = this.seen.get(tenantId);
      if (s) s.total += n;
    }
  }

  // ---------- the worker's copy ----------

  /** Copies the plan's allowances into the data cell, where the worker holds scheduled runs to them. */
  async pushLimits(tenantId: string): Promise<void> {
    const limits = await this.limits(tenantId);
    await withTenant(await this.ctx.cells.forTenant(tenantId), tenantId, async (tx) => {
      await tx.updateTable('tenant_profile').set({ limits: JSON.stringify(limits) }).where('tenant_id', '=', tenantId).execute();
    }).catch(() => undefined);
  }

  async pushAllLimits(): Promise<void> {
    const tenants = await this.ctx.db.selectFrom('tenant').select('id').where('status', '=', 'active').execute();
    for (const t of tenants) await this.pushLimits(t.id);
  }
}
