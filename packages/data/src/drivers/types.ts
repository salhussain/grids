import type { DATABASE_KINDS } from '@grids/schema';

export type DatabaseKind = (typeof DATABASE_KINDS)[number];
import type { Row } from '../engine.js';
export type { Row };

/** A connection with its {{VARIABLE}}s already filled in. */
export interface DriverConfig {
  kind: DatabaseKind;
  target: string;
  options: Record<string, string>;
}

export interface QueryOptions {
  /** Most rows to return; the driver fetches one more to tell whether there were others. */
  limit: number;
  timeoutMs: number;
}

export interface SqlColumn {
  name: string;
  type: string;
}

/** What a driver returns: values are plain JSON (see `normalise`). */
export interface RawResult {
  columns: { name: string; type?: string }[];
  rows: unknown[][];
  truncated: boolean;
}

export interface QueryResult {
  columns: SqlColumn[];
  rows: Row[];
  truncated: boolean;
}

export interface Driver {
  label: string;
  /** A cheap read-only statement that proves the connection works. */
  testQuery: string;
  /** Quotes a table or column name. */
  quote(id: string): string;
  /** Selects `table_schema, table_name, column_name, data_type` (in this order) for the browser. */
  catalogSql(cfg: DriverConfig): string;
  /** Runs one read-only statement. `sql` has no trailing semicolon. */
  query(cfg: DriverConfig, sql: string, opts: QueryOptions): Promise<RawResult>;
}
