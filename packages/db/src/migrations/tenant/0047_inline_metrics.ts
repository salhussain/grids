import { sql, type Kysely } from 'kysely';

// Metrics are no longer defined on a dataset: a widget says what to calculate itself (a column and how to combine it,
// or a SQL expression). Each widget that used a dataset's metric now carries what the metric stood for, and the
// datasets' metric lists are cleared.
export async function up(db: Kysely<unknown>): Promise<void> {
  const k = db as Kysely<Record<string, Record<string, unknown>>>;
  const datasets = (await sql<{ project_id: string; key: string; settings: { metrics?: { key: string; column?: string; aggregation?: string; expression?: string }[] } | null }>`
    select project_id, key, settings from dataset
  `.execute(k)).rows;
  const metricOf = (project: string, dataset: string, metric: string) => datasets.find((d) => d.project_id === project && d.key === dataset)?.settings?.metrics?.find((m) => m.key === metric);
  const dashboards = (await sql<{ id: string; project_id: string; widgets: unknown }>`select id, project_id, widgets from dashboard`.execute(k)).rows;
  for (const d of dashboards) {
    let changed = false;
    const widgets = (Array.isArray(d.widgets) ? d.widgets : []).map((w: unknown) => {
      const widget = w as { query?: Record<string, unknown> };
      const q = widget.query;
      if (!q || q.kind !== 'dataset' || typeof q.metric !== 'string' || typeof q.dataset !== 'string') return w;
      const m = metricOf(d.project_id, q.dataset, q.metric);
      if (!m) return w;
      changed = true;
      const { metric: _gone, ...rest } = q;
      return { ...widget, query: { ...rest, ...(m.expression ? { expression: m.expression } : { aggregation: m.aggregation ?? 'sum', ...(m.column ? { value: m.column } : {}) }) } };
    });
    if (changed) await sql`update dashboard set widgets = ${JSON.stringify(widgets)}::jsonb where id = ${d.id}`.execute(k);
  }
  await sql`update dataset set settings = settings - 'metrics' where settings ? 'metrics'`.execute(k);
}

export async function down(): Promise<void> {
  // The metrics cannot be brought back; widgets keep what they were calculating.
}
