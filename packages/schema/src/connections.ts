import { z } from 'zod';
import { Key } from './common.js';

// ---------------------------------------------------------------- variables and connections
// Variables hold secrets (API tokens, passwords): stored encrypted, replaceable but never readable.
// Connections describe an external API or database and refer to variables as {{NAME}}.

export const VARIABLE_KEY = /^[A-Z][A-Z0-9_]*$/;
export const VariableName = z
  .string()
  .trim()
  .max(64)
  .regex(VARIABLE_KEY, 'UPPER_SNAKE_CASE starting with a letter');

export const VariableInput = z.object({
  key: VariableName,
  /** Left empty when editing, the stored value is kept. */
  value: z.string().max(8192).default(''),
  description: z.string().trim().max(200).default(''),
});
export type VariableInput = z.input<typeof VariableInput>;

export const VariableDto = z.object({
  key: z.string(),
  description: z.string(),
  /** Keys of the connections that refer to it. */
  usedBy: z.array(z.string()),
  updatedAt: z.string(),
});
export type VariableDto = z.infer<typeof VariableDto>;

/** Databases a dataset can run SQL on. Each has a driver in @grids/data. */
export const DATABASE_KINDS = [
  'postgres',
  'redshift',
  'mysql',
  'mariadb',
  'mssql',
  'oracle',
  'clickhouse',
  'snowflake',
  'bigquery',
] as const;
export const FILE_KINDS = ['file', 's3', 'azure_blob', 'gcs', 'gdrive'] as const;
/** http is an API; databases are queried with SQL; the file kinds read a CSV or Excel file from where it is hosted. */
export const CONNECTION_KINDS = ['http', ...DATABASE_KINDS, ...FILE_KINDS] as const;
export const isFileKind = (k: string): boolean => (FILE_KINDS as readonly string[]).includes(k);
export const isDatabaseKind = (k: string): boolean => (DATABASE_KINDS as readonly string[]).includes(k);
export const ConnectionKind = z.enum(CONNECTION_KINDS);
export type ConnectionKind = z.infer<typeof ConnectionKind>;

export const ConnectionHeader = z.object({
  name: z.string().trim().min(1).max(100),
  value: z.string().max(2000),
});
export type ConnectionHeader = z.infer<typeof ConnectionHeader>;

/** Settings of a file or database connection. Credentials (see SECRET_OPTIONS) must be {{VARIABLE}} references. */
export const FILE_OPTIONS = [
  'format',
  'sheet',
  'region',
  'endpoint',
  'accessKeyId',
  'secretAccessKey',
  'sessionToken',
  'sasToken',
  'accountKey',
  'token',
  'serviceAccount',
  'apiKey',
  // databases: snowflake (warehouse, role, database, schema, tokenType) and bigquery (project, dataset)
  'warehouse',
  'role',
  'database',
  'schema',
  'tokenType',
  'project',
  'dataset',
] as const;
export const SECRET_OPTIONS = [
  'secretAccessKey',
  'sessionToken',
  'sasToken',
  'accountKey',
  'token',
  'serviceAccount',
  'apiKey',
] as const;
export const ConnectionOptions = z.partialRecord(z.enum(FILE_OPTIONS), z.string().trim().max(2000));
export type ConnectionOptions = z.infer<typeof ConnectionOptions>;

export const ConnectionInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).default(''),
  kind: ConnectionKind,
  /**
   * http: the base URL. Databases: a connection string such as postgres://user:{{PW}}@host:5432/db
   * (snowflake: the account, bigquery: the project id). May contain {{VARIABLE}}.
   */
  target: z.string().trim().min(1).max(1000),
  /** file kinds: the file's address (https://…, s3://bucket/key, gs://bucket/object, a Drive link or id). */
  /** http and file: extra request headers. */
  headers: z.array(ConnectionHeader).max(20).default([]),
  /** http: a path to request (default /). postgres: a read-only query (default select 1). */
  test: z.string().trim().max(500).default(''),
  /** file kinds and databases. */
  options: ConnectionOptions.default({}),
});
export type ConnectionInput = z.input<typeof ConnectionInput>;

/** The first rows of a file, shown when a file connection is tested. */
export const FilePreview = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  total: z.number().int(),
  format: z.string(),
});
export type FilePreview = z.infer<typeof FilePreview>;

export const TestResult = z.object({
  ok: z.boolean(),
  message: z.string(),
  ms: z.number().int(),
  at: z.string(),
  preview: FilePreview.optional(),
});
export type TestResult = z.infer<typeof TestResult>;

export const ConnectionDto = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  kind: ConnectionKind,
  target: z.string(),
  headers: z.array(ConnectionHeader),
  test: z.string(),
  options: ConnectionOptions,
  lastTest: TestResult.nullable(),
  updatedAt: z.string(),
});
export type ConnectionDto = z.infer<typeof ConnectionDto>;
