import type { ScriptLanguage } from '@grids/schema';
export type { ScriptLanguage };

/** What the child process is given on its standard input. */
export interface ScriptRequest {
  language: ScriptLanguage;
  code: string;
  /** The source tables, by the name the code refers to them by. */
  tables: { name: string; rows: Record<string, unknown>[] }[];
  limit: number;
  /** The dataset's parameters, by name: `params` in the code. */
  params?: Record<string, string | number>;
  /** Breakpoints: the lines to look at the variables on, and whether to stop at the first one reached. */
  debug?: { lines: number[]; stop: boolean };
}

/** The variables at one pass over a marked line. */
export interface DebugHit {
  line: number;
  vars: { name: string; type: string; preview: string }[];
}

/** What it writes back: the table the code produced, or what went wrong. */
export type ScriptResponse =
  | { ok: true; columns: string[]; rows: Record<string, unknown>[]; truncated: boolean; log: string; debug?: { hits: DebugHit[]; stopped: boolean } }
  | { ok: false; error: string; log: string };
