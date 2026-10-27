import { z } from 'zod';
import { Key } from './common.js';
import { Freshness } from './projects.js';

// ---------------------------------------------------------------- jobs (M4)
// A job is a pipeline of typed steps over a list of rows. Field mappings are
// JSONata expressions evaluated against each row (`$` = the row).

const Expr = z.string().trim().min(1).max(2000);
const StepBase = z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]*$/).max(40), label: z.string().max(80).optional() });

export const HttpExtractStep = StepBase.extend({
  type: z.literal('http.extract'),
  url: z.url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().max(10_000).optional(),
  /** JSONata over the response body producing the rows (default: the body itself). */
  rows: Expr.optional(),
  timeoutSeconds: z.number().int().min(1).max(120).default(30),
});
export const FileParseStep = StepBase.extend({
  type: z.literal('file.parse'),
  /** Key of the project file; the latest upload is read. */
  file: Key,
  format: z.enum(['auto', 'csv', 'json', 'ndjson']).default('auto'),
  /** CSV field separator (auto-detected from the header line when omitted). */
  delimiter: z.enum([',', ';', '\t', '|']).optional(),
  /** JSONata over the parsed content (CSV: the array of rows) producing the rows; default: the content itself. */
  rows: Expr.optional(),
});
export const TransformStep = StepBase.extend({
  type: z.literal('transform'),
  /** JSONata over each row, returning the new row (objects are merged unless `replace`). */
  expression: Expr,
  replace: z.boolean().default(true),
});
export const FilterStep = StepBase.extend({
  type: z.literal('filter'),
  /** JSONata predicate per row. */
  condition: Expr,
});
export const EntityUpsertStep = StepBase.extend({
  type: z.literal('entity.upsert'),
  entityType: Key,
  code: Expr,
  name: Expr,
  parentType: Key.optional(),
  parentCode: Expr.optional(),
  attributes: z.record(Key, Expr).default({}),
  lon: Expr.optional(),
  lat: Expr.optional(),
});
export const ObservationWriteStep = StepBase.extend({
  type: z.literal('observation.write'),
  entityType: Key,
  entityCode: Expr,
  /** Defaults to the run time. */
  at: Expr.optional(),
  values: z.record(Key, Expr),
});
export const DatasetWriteStep = StepBase.extend({
  type: z.literal('dataset.write'),
  dataset: Key,
  mode: z.enum(['replace', 'append']).default('replace'),
  /** Ordered columns (JSONB doesn't keep object key order); omitted = keep the row as is. */
  columns: z.array(z.object({ name: z.string().min(1).max(63), value: Expr })).max(100).optional(),
});
export const JobStep = z.discriminatedUnion('type', [
  HttpExtractStep,
  FileParseStep,
  TransformStep,
  FilterStep,
  EntityUpsertStep,
  ObservationWriteStep,
  DatasetWriteStep,
]);
export type JobStep = z.infer<typeof JobStep>;
export type JobStepInput = z.input<typeof JobStep>;
export const STEP_TYPES = ['http.extract', 'file.parse', 'transform', 'filter', 'entity.upsert', 'observation.write', 'dataset.write'] as const;

/** Five-field cron, e.g. "*\/5 * * * *". */
const Cron = z
  .string()
  .trim()
  .regex(/^(\S+\s+){4}\S+$/, 'Five cron fields: minute hour day month weekday');

/** Events that can trigger a job (spec §7); `ref` narrows to one form, type, dataset or job. */
export const JOB_EVENTS = ['submission.created', 'submission.approved', 'submission.rejected', 'submission.returned', 'entity.changed', 'dataset.materialised', 'job.succeeded', 'job.failed'] as const;
export const JobEvent = z.enum(JOB_EVENTS);
export type JobEvent = z.infer<typeof JobEvent>;
export const JobTriggers = z.object({
  events: z.array(z.object({ event: JobEvent, ref: Key.optional() })).max(10).default([]),
  /** Accept POSTs to a secret URL; the JSON body becomes the run's rows. */
  webhook: z.boolean().default(false),
});
export type JobTriggers = z.infer<typeof JobTriggers>;
/** Polls a URL; when the cursor (JSONata over the response, default: a hash of it) changes, the job runs. */
export const JobSensor = z.object({
  url: z.url(),
  headers: z.record(z.string(), z.string()).default({}),
  cursor: Expr.optional(),
  everyMinutes: z.number().int().min(1).max(1440).default(5),
});
export type JobSensor = z.infer<typeof JobSensor>;

export const JobInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  steps: z.array(JobStep).min(1).max(20),
  schedule: Cron.nullable().default(null),
  timezone: z.string().max(60).default('UTC'),
  enabled: z.boolean().default(true),
  maxRetries: z.number().int().min(0).max(10).default(2),
  timeoutSeconds: z.number().int().min(10).max(3600).default(300),
  freshnessMinutes: z.number().int().min(1).max(5_256_000).nullable().default(null),
  /** Queue a run whenever a file this job parses is uploaded. */
  runOnUpload: z.boolean().default(false),
  triggers: JobTriggers.default({ events: [], webhook: false }),
  sensor: JobSensor.nullable().default(null),
});
export type JobInput = z.input<typeof JobInput>;

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export const RunStatus = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunDto = z.object({
  id: z.string(),
  jobId: z.string(),
  jobName: z.string(),
  status: RunStatus,
  trigger: z.string(),
  attempt: z.number().int(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
  stats: z.record(z.string(), z.number()),
});
export type RunDto = z.infer<typeof RunDto>;

export const RunLogDto = z.object({
  at: z.string(),
  level: z.enum(['info', 'warn', 'error']),
  step: z.string().nullable(),
  message: z.string(),
});
export const RunDetail = RunDto.extend({ logs: z.array(RunLogDto) });
export type RunDetail = z.infer<typeof RunDetail>;

export const JobDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  steps: z.array(JobStep),
  schedule: z.string().nullable(),
  timezone: z.string(),
  enabled: z.boolean(),
  maxRetries: z.number().int(),
  timeoutSeconds: z.number().int(),
  freshnessMinutes: z.number().int().nullable(),
  runOnUpload: z.boolean(),
  triggers: JobTriggers,
  sensor: JobSensor.nullable(),
  /** Path of the webhook (managers only; it embeds the secret). */
  webhookPath: z.string().nullable(),
  sensorState: z
    .object({ lastCheckedAt: z.string().nullable(), nextCheckAt: z.string(), cursor: z.string().nullable(), lastError: z.string().nullable() })
    .nullable(),
  nextRunAt: z.string().nullable(),
  lastRun: RunDto.nullable(),
  freshness: Freshness,
  successRate: z.number().nullable(),
});
export type JobDto = z.infer<typeof JobDto>;

export const RunQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
  jobId: z.uuid().optional(),
  status: RunStatus.optional(),
});

// ---------------------------------------------------------------- datasets
// A dataset is a table that charts read. It is one of:
//   rows        filled by a job or an upload
//   connection  a table or SQL query that runs on a database connection (physical / virtual)
//   local       SQL over forms, files, APIs and other datasets, run by the embedded engine (DuckDB)
// Query-based datasets are materialised into rows on refresh, so every chart works on every kind.

const Alias = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,62}$/, 'snake_case starting with a letter');

/** A table the SQL of a `local` dataset can read. */
export const DatasetInputRef = z.discriminatedUnion('kind', [
  /** The submissions of a form: one row each, answers as columns. */
  z.object({ kind: z.literal('form'), ref: Key, as: Alias }),
  /** Another dataset's rows. */
  z.object({ kind: z.literal('dataset'), ref: Key, as: Alias }),
  /** The entities of one type (`ref` is the type's key): one row each, attributes as columns. */
  z.object({ kind: z.literal('entity'), ref: Key, as: Alias }),
  /** The project's entity types: one row each (`ref` is always `entity_types`). */
  z.object({ kind: z.literal('entity_types'), ref: Key, as: Alias }),
  /**
   * A connection: a file kind gives its rows, http an API response (`endpoint` appended to the base address,
   * `path` the dotted path to the rows), a database kind the result of `sql` there.
   */
  z.object({
    kind: z.literal('connection'),
    ref: Key,
    as: Alias,
    sql: z.string().max(20_000).optional(),
    endpoint: z.string().max(500).optional(),
    path: z.string().max(200).optional(),
  }),
]);
export type DatasetInputRef = z.infer<typeof DatasetInputRef>;

/** The languages a dataset's code can be written in. SQL runs on DuckDB; the others run in a sandbox. */
export const SCRIPT_LANGUAGES = ['python', 'r', 'javascript'] as const;
export type ScriptLanguage = (typeof SCRIPT_LANGUAGES)[number];

export const DatasetSource = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rows') }),
  z.object({
    type: z.literal('connection'),
    connection: Key,
    /** Set for a physical dataset ("schema.table"): `sql` is then `select *` from it. */
    table: z.string().max(200).optional(),
    sql: z.string().trim().min(1).max(50_000),
  }),
  z.object({
    type: z.literal('local'),
    sql: z.string().trim().min(1).max(50_000),
    inputs: z.array(DatasetInputRef).max(20).default([]),
  }),
  /** Code that reads the inputs (as data frames or lists of rows) and makes the dataset's table. */
  z.object({
    type: z.literal('script'),
    language: z.enum(SCRIPT_LANGUAGES),
    code: z.string().trim().min(1).max(100_000),
    inputs: z.array(DatasetInputRef).max(20).default([]),
  }),
]);
export type DatasetSource = z.infer<typeof DatasetSource>;

/** How a metric combines a column's values. */
export const METRIC_AGGREGATIONS = ['sum', 'avg', 'min', 'max', 'count', 'distinct', 'last'] as const;
/**
 * What is wrong with a SQL expression a metric is worked out by, or null. It is one expression: no second statement, no
 * comments (they could swallow the rest of the query), and every bracket closed where it was opened.
 */
export function metricExpressionProblem(e: string): string | null {
  const text = e.trim();
  if (!text) return 'Write an expression, such as sum(visits)';
  if (text.length > 500) return 'The expression is too long';
  // Strings are set aside first, so a semicolon or "--" inside quotes is not mistaken for SQL.
  const bare = text.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, '');
  if (/;|--|\/\*|\*\//.test(bare)) return 'Use one expression, without semicolons or comments';
  if (/'/.test(bare)) return 'A quote is not closed';
  let depth = 0;
  for (const ch of bare) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return 'A bracket is closed that was never opened';
  }
  return depth ? 'A bracket is not closed' : null;
}

/** A saved aggregation widgets can pick by name, such as "Total patients = sum of patients". */
export const DatasetMetric = z.object({
  key: Alias,
  label: z.string().trim().min(1).max(80),
  /** Omitted for a count of rows. */
  column: z.string().max(63).optional(),
  aggregation: z.enum(METRIC_AGGREGATIONS).default('sum'),
  /** A database dataset only: the metric is this SQL expression over the query's columns, worked out by the database. */
  expression: z
    .string()
    .trim()
    .max(500)
    .superRefine((e, ctx) => {
      const problem = metricExpressionProblem(e);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    })
    .optional(),
});
export type DatasetMetric = z.infer<typeof DatasetMetric>;

export const PARAM_TYPES = ['text', 'number', 'date'] as const;
/** A value the query or code takes: `{{ name }}` in SQL, `params["name"]` in Python/R/JavaScript. The default is used on refresh. */
export const DatasetParam = z.object({
  name: Alias,
  label: z.string().trim().max(80).default(''),
  type: z.enum(PARAM_TYPES).default('text'),
  default: z.string().max(500).default(''),
  /** The column of the result this value stands for, so a dashboard can offer it as a filter on that column. */
  column: z.string().max(63).optional(),
  /** How the column is matched: equal to the value, at least it (from, minimum), or at most it (until, maximum). Text is always equal. */
  compare: z.enum(['equals', 'at_least', 'at_most']).optional(),
  /** The text that means "no filter" (such as All). */
  any: z.string().max(80).optional(),
});
export type DatasetParam = z.infer<typeof DatasetParam>;

/** What a dataset adds on top of its rows. */
export const DatasetSettings = z.object({
  /** The date column dashboard periods filter, and charts over time default to. */
  timeColumn: z.string().max(63).nullable().default(null),
  metrics: z.array(DatasetMetric).max(40).refine((l) => new Set(l.map((m) => m.key)).size === l.length, 'Two metrics share a name').default([]),
  parameters: z.array(DatasetParam).max(20).refine((l) => new Set(l.map((x) => x.name)).size === l.length, 'Two parameters share a name').default([]),
  /**
   * Run the query again for the values a viewer picks on a dashboard (kept for a while, for large data or live
   * databases), instead of storing everything once and filtering the stored rows.
   */
  runPerViewer: z.boolean().default(false),
});
export type DatasetSettings = z.infer<typeof DatasetSettings>;

/** A dataset on a database is never copied into the platform: each read queries the database (briefly shared). */
export const isLiveSource = (s: { type: string }) => s.type === 'connection';

export const DATASET_KINDS = ['rows', 'physical', 'virtual'] as const;
export type DatasetKind = (typeof DATASET_KINDS)[number];

export const DatasetDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  columns: z.array(z.string()),
  /** Column name to its SQL type (query-based datasets). */
  columnTypes: z.record(z.string(), z.string()),
  rowCount: z.number().int(),
  lastMaterialisedAt: z.string().nullable(),
  freshness: Freshness,
  /** The cadence set on the dataset itself (else the job's applies). */
  freshnessMinutes: z.number().int().nullable(),
  source: DatasetSource,
  kind: z.enum(DATASET_KINDS),
  /** Why the last refresh failed. */
  refreshError: z.string().nullable(),
  settings: DatasetSettings,
});
export type DatasetDto = z.infer<typeof DatasetDto>;

export const DatasetInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  columns: z.array(z.string().trim().min(1).max(63)).max(100).default([]),
  freshnessMinutes: z.number().int().min(1).max(5_256_000).nullable().default(null),
  source: DatasetSource.default({ type: 'rows' }),
  settings: DatasetSettings.default({ timeColumn: null, metrics: [], parameters: [], runPerViewer: false }),
});
export type DatasetInput = z.input<typeof DatasetInput>;
/** What a dataset was at one save: everything that defines it, not its rows. */
export const DatasetVersionDto = z.object({
  version: z.number().int(),
  savedAt: z.string(),
  savedBy: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  freshnessMinutes: z.number().int().nullable(),
  source: DatasetSource,
  settings: DatasetSettings,
});
export type DatasetVersionDto = z.infer<typeof DatasetVersionDto>;

export const DatasetRowsInput = z.object({
  mode: z.enum(['replace', 'append']).default('replace'),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(50_000),
});
export type DatasetRowsInput = z.input<typeof DatasetRowsInput>;

// ---------------------------------------------------------------- SQL

/** Runs SQL without saving anything (the SQL editor). */
export const SqlRunInput = z.object({
  source: DatasetSource.refine((s) => s.type !== 'rows', 'Choose a connection or local sources'),
  limit: z.number().int().min(1).max(50_000).default(500),
  /** Values for the dataset's parameters while trying the query. */
  params: z.record(z.string(), z.string().max(500)).default({}),
  /** The parameters' types, so values are quoted correctly. */
  parameters: z.array(DatasetParam).max(20).default([]),
  /** Code datasets: lines to look at the variables on, and whether to stop at the first one reached. */
  debug: z.object({ lines: z.array(z.number().int().min(1).max(100_000)).max(50), stop: z.boolean().default(false) }).optional(),
});
export type SqlRunInput = z.input<typeof SqlRunInput>;

export const SqlColumn = z.object({ name: z.string(), type: z.string() });
export const SqlResult = z.object({
  columns: z.array(SqlColumn),
  rows: z.array(z.record(z.string(), z.unknown())),
  /** More rows exist than were returned. */
  truncated: z.boolean(),
  ms: z.number().int(),
  /** Code datasets run with breakpoints: the variables at each marked line passed, and whether the run stopped there. */
  debug: z
    .object({
      hits: z.array(z.object({ line: z.number().int(), vars: z.array(z.object({ name: z.string(), type: z.string(), preview: z.string() })) })),
      stopped: z.boolean(),
    })
    .optional(),
});
export type SqlResult = z.infer<typeof SqlResult>;

/** The tables of a database, for the editor's browser and autocomplete. */
export const CatalogDto = z.object({
  dialect: z.string(),
  tables: z.array(z.object({ schema: z.string(), name: z.string(), columns: z.array(SqlColumn) })),
  truncated: z.boolean(),
});
export type CatalogDto = z.infer<typeof CatalogDto>;

/** What a `local` dataset can read: forms, other datasets and connections. */
export const LocalSourcesDto = z.object({
  /** `defaults`: what a question starts as when the form opens, by column. */
  forms: z.array(z.object({ key: z.string(), name: z.string(), columns: z.array(z.string()), defaults: z.record(z.string(), z.string()).default({}) })),
  datasets: z.array(z.object({ key: z.string(), name: z.string(), columns: z.array(z.string()) })),
  /** One per entity type, then the table of the types themselves. */
  entities: z.array(z.object({ key: z.string(), name: z.string(), columns: z.array(z.string()) })),
  entityTypes: z.object({ columns: z.array(z.string()) }),
  connections: z.array(z.object({ key: z.string(), name: z.string(), kind: z.string() })),
});
export type LocalSourcesDto = z.infer<typeof LocalSourcesDto>;

// ---------------------------------------------------------------- files

export const FILE_MAX_BYTES = 20 * 1024 * 1024;
export const FileDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  sha256: z.string(),
  uploadedBy: z.string().nullable(),
  uploadedAt: z.string(),
  /** Earlier uploads under the same key. */
  versions: z.number().int(),
  /** Jobs that parse this file. */
  jobs: z.array(z.object({ key: z.string(), name: z.string(), runOnUpload: z.boolean() })),
});
export type FileDto = z.infer<typeof FileDto>;
export const UploadResult = z.object({ file: FileDto, runs: z.array(z.object({ id: z.string(), job: z.string() })) });
export type UploadResult = z.infer<typeof UploadResult>;
