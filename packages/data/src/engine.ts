import jsonata from 'jsonata';
import { sql } from 'kysely';
import { uuidv7, type JobStep } from '@grids/schema';
import { entityIdsByCode, upsertEntities, writeObservations, type CellTx } from './model.js';

export type Row = Record<string, unknown>;
export type LogFn = (level: 'info' | 'warn' | 'error', step: string | null, message: string) => void | Promise<void>;

export interface EngineContext {
  tenantId: string;
  projectId: string;
  runId: string;
  now: Date;
  fetch: typeof fetch;
  log: LogFn;
  /** Aborts long HTTP calls when the run times out or is cancelled. */
  signal?: AbortSignal;
}

export class StepError extends Error {
  constructor(
    readonly step: string,
    message: string,
  ) {
    super(`${step}: ${message}`);
  }
}

const MAX_ROWS = 100_000;
const MAX_BODY = 50 * 1024 * 1024;

/** Compiled JSONata with the run's bindings ($runTime). */
function compile(expr: string, step: string) {
  try {
    return jsonata(expr);
  } catch (e) {
    throw new StepError(step, `invalid expression "${expr}": ${(e as { message?: string }).message ?? e}`);
  }
}

async function evalOn(expr: ReturnType<typeof jsonata>, input: unknown, ctx: EngineContext): Promise<unknown> {
  const v = await expr.evaluate(input, { runTime: ctx.now.toISOString(), runId: ctx.runId });
  return v;
}

/** JSONata returns arrays with a `sequence` flag and null-prototype objects; normalise. */
const plain = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v ?? null)));
const asRows = (v: unknown): Row[] => {
  const p = plain(v);
  const list = Array.isArray(p) ? p : p === null ? [] : [p];
  return list.map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Row) : { value: x }));
};

/** Minimal CSV (RFC 4180 quotes) for text/csv responses and uploaded files. */
export function parseCsv(input: string, delimiter = ','): Row[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delimiter) {
      cur.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = '';
    } else field += c;
  }
  if (field || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  const [head, ...body] = rows.filter((r) => r.some((x) => x !== ''));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/** The separator that splits the header line into the most fields. */
export function detectDelimiter(text: string): string {
  const head = text.slice(0, text.search(/\r?\n|$/));
  let best = ',';
  let most = 0;
  for (const d of [',', ';', '\t', '|']) {
    const n = head.split(d).length;
    if (n > most) [best, most] = [d, n];
  }
  return best;
}

/** Parses an uploaded file's text as CSV, JSON or newline-delimited JSON. */
export function parseFile(text: string, format: 'auto' | 'csv' | 'json' | 'ndjson', hint: { name: string; contentType: string }, delimiter?: string): { kind: 'csv' | 'json' | 'ndjson'; body: unknown } {
  const name = hint.name.toLowerCase();
  const kind =
    format !== 'auto'
      ? format
      : /\.(ndjson|jsonl)$/.test(name) || hint.contentType.includes('ndjson')
        ? 'ndjson'
        : name.endsWith('.json') || hint.contentType.includes('json')
          ? 'json'
          : 'csv';
  if (kind === 'csv') return { kind, body: parseCsv(text, delimiter ?? detectDelimiter(text)) };
  if (kind === 'json') return { kind, body: JSON.parse(text) };
  return {
    kind,
    body: text
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l)),
  };
}

/** Runs a job's steps in order inside the tenant transaction; returns run statistics. */
export async function executeSteps(tx: CellTx, steps: JobStep[], ctx: EngineContext): Promise<Record<string, number>> {
  const stats: Record<string, number> = {};
  const add = (k: string, n: number) => (stats[k] = (stats[k] ?? 0) + n);
  let rows: Row[] = [];

  for (const step of steps) {
    const sid = step.id;
    const started = Date.now();
    switch (step.type) {
      case 'http.extract': {
        const res = await ctx.fetch(step.url, {
          method: step.method,
          headers: { accept: 'application/json, text/csv;q=0.9, */*;q=0.5', 'user-agent': 'Grids/1.0 (+https://grids.local)', ...step.headers },
          body: step.method === 'POST' ? step.body : undefined,
          signal: AbortSignal.any([AbortSignal.timeout(step.timeoutSeconds * 1000), ...(ctx.signal ? [ctx.signal] : [])]),
        }).catch((e: Error) => {
          throw new StepError(sid, `request failed: ${e.message}`);
        });
        if (!res.ok) throw new StepError(sid, `HTTP ${res.status} from ${new URL(step.url).host}`);
        const text = await res.text();
        if (text.length > MAX_BODY) throw new StepError(sid, 'response too large');
        const type = res.headers.get('content-type') ?? '';
        let body: unknown;
        if (type.includes('csv') || (!type.includes('json') && /^[^{[]/.test(text.trim()) && text.includes(','))) body = parseCsv(text);
        else
          try {
            body = JSON.parse(text);
          } catch {
            throw new StepError(sid, 'response is not JSON or CSV');
          }
        rows = asRows(step.rows ? await evalOn(compile(step.rows, sid), body, ctx) : body);
        add('rows_fetched', rows.length);
        await ctx.log('info', sid, `Fetched ${rows.length} rows from ${new URL(step.url).host} in ${Date.now() - started} ms`);
        break;
      }
      case 'file.parse': {
        const f = await tx
          .selectFrom('project_file')
          .select(['name', 'content_type', 'content', 'uploaded_at'])
          .where('project_id', '=', ctx.projectId)
          .where('key', '=', step.file)
          .orderBy('uploaded_at', 'desc')
          .limit(1)
          .executeTakeFirst();
        if (!f) throw new StepError(sid, `no file has been uploaded as "${step.file}"`);
        let parsed;
        try {
          parsed = parseFile(f.content.toString('utf8'), step.format, { name: f.name, contentType: f.content_type }, step.delimiter);
        } catch (e) {
          throw new StepError(sid, `${f.name} could not be parsed: ${(e as Error).message}`);
        }
        rows = asRows(step.rows ? await evalOn(compile(step.rows, sid), parsed.body, ctx) : parsed.body);
        add('rows_parsed', rows.length);
        await ctx.log('info', sid, `Parsed ${rows.length} rows from ${f.name} (${parsed.kind}, uploaded ${f.uploaded_at.toISOString()})`);
        break;
      }
      case 'transform': {
        const expr = compile(step.expression, sid);
        const out: Row[] = [];
        for (const r of rows) {
          const v = plain(await evalOn(expr, r, ctx));
          if (v === null) continue;
          if (Array.isArray(v)) out.push(...asRows(v));
          else if (typeof v === 'object') out.push(step.replace ? (v as Row) : { ...r, ...(v as Row) });
        }
        await ctx.log('info', sid, `Transformed ${rows.length} → ${out.length} rows`);
        rows = out;
        break;
      }
      case 'filter': {
        const expr = compile(step.condition, sid);
        const out: Row[] = [];
        for (const r of rows) if (await evalOn(expr, r, ctx)) out.push(r);
        await ctx.log('info', sid, `Kept ${out.length} of ${rows.length} rows`);
        add('rows_filtered_out', rows.length - out.length);
        rows = out;
        break;
      }
      case 'entity.upsert': {
        const e = {
          code: compile(step.code, sid),
          name: compile(step.name, sid),
          parentCode: step.parentCode ? compile(step.parentCode, sid) : null,
          lon: step.lon ? compile(step.lon, sid) : null,
          lat: step.lat ? compile(step.lat, sid) : null,
          attrs: Object.entries(step.attributes).map(([k, x]) => [k, compile(x, sid)] as const),
        };
        const input = [];
        let noLocation = 0;
        for (const r of rows) {
          const code = plain(await evalOn(e.code, r, ctx));
          if (code === null || code === '') continue;
          const attributes: Row = {};
          for (const [k, x] of e.attrs) attributes[k] = plain(await evalOn(x, r, ctx));
          const lon = e.lon ? Number(plain(await evalOn(e.lon, r, ctx))) : NaN;
          const lat = e.lat ? Number(plain(await evalOn(e.lat, r, ctx))) : NaN;
          const hasPoint = Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
          if (e.lon && !hasPoint) noLocation++;
          input.push({
            code: String(code).trim(),
            name: String(plain(await evalOn(e.name, r, ctx)) ?? code).trim() || String(code),
            parentCode: e.parentCode ? (plain(await evalOn(e.parentCode, r, ctx)) as string | null) : null,
            parentType: step.parentType ?? null,
            attributes,
            ...(e.lon ? { geometry: hasPoint ? { type: 'Point' as const, coordinates: [lon, lat] } : null } : {}),
          });
        }
        const res = await upsertEntities(tx, {
          tenantId: ctx.tenantId,
          projectId: ctx.projectId,
          typeKey: step.entityType,
          rows: input,
          source: 'job',
          sourceRef: ctx.runId,
        });
        add('entities_created', res.created);
        add('entities_updated', res.updated);
        add('entities_unchanged', res.unchanged);
        await ctx.log('info', sid, `${step.entityType}: ${res.created} created, ${res.updated} updated, ${res.unchanged} unchanged${noLocation ? `, ${noLocation} without a location` : ''}`);
        break;
      }
      case 'observation.write': {
        const codeX = compile(step.entityCode, sid);
        const atX = step.at ? compile(step.at, sid) : null;
        const vals = Object.entries(step.values).map(([k, x]) => [k, compile(x, sid)] as const);
        const pending: { code: string; at: Date; element: string; value: unknown }[] = [];
        for (const r of rows) {
          const code = plain(await evalOn(codeX, r, ctx));
          if (code === null || code === '') continue;
          const rawAt = atX ? plain(await evalOn(atX, r, ctx)) : null;
          const at = rawAt === null ? ctx.now : typeof rawAt === 'number' ? new Date(rawAt < 1e12 ? rawAt * 1000 : rawAt) : new Date(String(rawAt));
          for (const [k, x] of vals) pending.push({ code: String(code).trim(), at, element: k, value: plain(await evalOn(x, r, ctx)) });
        }
        const ids = await entityIdsByCode(tx, ctx.projectId, step.entityType, pending.map((p) => p.code));
        const items = pending.filter((p) => ids.has(p.code)).map((p) => ({ entityId: ids.get(p.code)!, element: p.element, at: p.at, value: p.value }));
        const res = await writeObservations(tx, { tenantId: ctx.tenantId, projectId: ctx.projectId, items, source: 'job', sourceRef: ctx.runId });
        const missing = pending.length - items.length;
        add('observations_written', res.written);
        await ctx.log(missing ? 'warn' : 'info', sid, `${res.written} observations written${res.skipped ? `, ${res.skipped} empty` : ''}${missing ? `, ${missing} for unknown ${step.entityType} codes` : ''}`);
        break;
      }
      case 'dataset.write': {
        const cols = step.columns ? step.columns.map((c) => [c.name, compile(c.value, sid)] as const) : null;
        const out: Row[] = [];
        for (const r of rows) {
          if (!cols) out.push(r);
          else {
            const o: Row = {};
            for (const [k, x] of cols) o[k] = plain(await evalOn(x, r, ctx));
            out.push(o);
          }
        }
        const columns = cols ? cols.map(([k]) => k) : [...new Set(out.slice(0, 200).flatMap((r) => Object.keys(r)))];
        let ds = await tx.selectFrom('dataset').select(['id']).where('project_id', '=', ctx.projectId).where('key', '=', step.dataset).executeTakeFirst();
        if (!ds) {
          ds = { id: uuidv7() };
          await tx
            .insertInto('dataset')
            .values({ id: ds.id, tenant_id: ctx.tenantId, project_id: ctx.projectId, key: step.dataset, name: step.dataset.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), columns: JSON.stringify(columns) })
            .execute();
        }
        if (step.mode === 'replace') await tx.deleteFrom('dataset_row').where('dataset_id', '=', ds.id).execute();
        for (let i = 0; i < out.length; i += 1000)
          await tx
            .insertInto('dataset_row')
            .values(out.slice(i, i + 1000).map((data) => ({ tenant_id: ctx.tenantId, dataset_id: ds!.id, data: JSON.stringify(data) })))
            .execute();
        await tx
          .updateTable('dataset')
          .set({
            columns: JSON.stringify(columns),
            row_count: sql`(select count(*) from dataset_row where dataset_id = ${ds.id})`,
            last_materialised_at: ctx.now,
            last_run_id: ctx.runId,
          })
          .where('id', '=', ds.id)
          .execute();
        add('dataset_rows', out.length);
        await ctx.log('info', sid, `${step.mode === 'replace' ? 'Replaced' : 'Appended'} ${out.length} rows in dataset ${step.dataset}`);
        break;
      }
    }
    if (rows.length > MAX_ROWS) throw new StepError(sid, `more than ${MAX_ROWS} rows`);
  }
  return stats;
}
