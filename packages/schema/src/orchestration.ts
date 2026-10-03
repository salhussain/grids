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
export const JOB_EVENTS = ['submission.created', 'submission.approved', 'submission.rejected', 'entity.changed', 'dataset.materialised', 'job.succeeded', 'job.failed'] as const;
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
  freshnessMinutes: z.number().int().min(1).max(525_600).nullable().default(null),
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

export const DatasetDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  columns: z.array(z.string()),
  rowCount: z.number().int(),
  lastMaterialisedAt: z.string().nullable(),
  freshness: Freshness,
});
export type DatasetDto = z.infer<typeof DatasetDto>;

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
