import type { DatasetParam } from '@grids/schema';
import { badRequest } from '../errors.js';

/** The value of each parameter: what was given, else its default. Checked against its type. */
export function paramValues(params: DatasetParam[], given: Record<string, string> = {}): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const p of params) {
    const raw = (given[p.name] ?? p.default).trim();
    if (p.type === 'number') {
      if (raw === '') throw badRequest(`Give ${p.label || p.name} a number`);
      const n = Number(raw);
      if (!Number.isFinite(n)) throw badRequest(`${p.label || p.name} must be a number`, `"${raw}" is not one.`);
      out[p.name] = n;
    } else if (p.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw badRequest(`${p.label || p.name} must be a date`, 'Use the form 2025-01-31.');
      out[p.name] = raw;
    } else {
      // A backslash is an escape in some databases and not in others: no value may carry one into the query.
      if (/[\\\0]/.test(raw)) throw badRequest(`${p.label || p.name} cannot contain a backslash`);
      out[p.name] = raw;
    }
  }
  return out;
}

/**
 * Puts the values in the SQL where it says `:name` (or `{{ name }}`). A number goes in as it is, text and dates as quoted
 * strings, so a value can never end the string or add SQL of its own. A `:name` is only a parameter where SQL could not
 * mean something else: not inside a string, a quoted name or a comment, not the `::` of a cast (`x::text`), and not
 * the colon of a slice (`a[1:n]`). A `:name` that is not one of the parameters is left alone.
 */
export function fillParams(sql: string, params: DatasetParam[], values: Record<string, string | number>): string {
  const known = new Map(params.map((p) => [p.name, p]));
  const literal = (name: string) => {
    const v = values[name];
    return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  };
  const braces = sql.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_, name: string) => {
    if (!known.has(name)) throw badRequest(`{{ ${name} }} is not a parameter`, 'Add it under Parameters, or remove it from the query.');
    return literal(name);
  });
  return braces.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\/|(?<![:\w]):([a-z][a-z0-9_]*)\b/g, (m, name: string | undefined) =>
    name && known.has(name) ? literal(name) : m,
  );
}
