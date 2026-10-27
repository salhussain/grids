import { Ban, CalendarClock, Hash, ToggleLeft, Type, type LucideIcon } from 'lucide-react';

export type ColumnKind = 'date' | 'number' | 'flag' | 'text';
export const KIND_ICON: Record<ColumnKind, LucideIcon> = {
  date: CalendarClock,
  number: Hash,
  flag: ToggleLeft,
  text: Type,
};
export const KIND_LABEL: Record<ColumnKind, string> = {
  date: 'Date',
  number: 'Number',
  flag: 'Yes/no',
  text: 'Text',
};

/** What a column holds, from its SQL type when the dataset has one, else from its sample values, else from its name. */
export function columnKind(name: string, sqlType?: string, samples: unknown[] = []): ColumnKind {
  const t = (sqlType ?? '').toLowerCase();
  if (t) {
    if (/bool|bit\b/.test(t)) return 'flag';
    if (/date|time|interval/.test(t)) return 'date';
    if (/int|numeric|decimal|float|double|real|number|money|serial/.test(t)) return 'number';
    return 'text';
  }
  const seen = samples
    .filter((v) => v !== null && v !== undefined && v !== '')
    .slice(0, 50)
    .map(String);
  if (seen.length) {
    if (seen.every((v) => /^(true|false|yes|no)$/i.test(v))) return 'flag';
    if (seen.every((v) => /^-?\d+(\.\d+)?%?$/.test(v.trim()))) return 'number';
    if (
      seen.every(
        (v) =>
          /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(v) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(v),
      )
    )
      return 'date';
    return 'text';
  }
  if (/(^|_)(date|time|at|on|week|month|year|day|period)(_|$)/i.test(name)) return 'date';
  return 'text';
}

/** Listbox options for picking a column: each with the icon of what it holds. `none` adds a first "None" choice. */
export function columnOptions(
  columns: string[],
  types: Record<string, string> = {},
  sample?: (c: string) => unknown[],
  none?: string,
) {
  return [
    ...(none ? [{ value: '', label: none, icon: Ban }] : []),
    ...columns.map((c) => {
      const k = columnKind(c, types[c], sample?.(c));
      return { value: c, label: c, description: KIND_LABEL[k], icon: KIND_ICON[k] };
    }),
  ];
}

/** The ways of combining a column's values that make sense for its kind: totals need numbers, dates have a first and last, text can be counted. */
const AGGREGATIONS_FOR: Record<ColumnKind, readonly ('sum' | 'avg' | 'min' | 'max' | 'distinct' | 'last')[]> = {
  number: ['sum', 'avg', 'min', 'max', 'distinct', 'last'],
  date: ['min', 'max', 'distinct', 'last'],
  flag: ['sum', 'avg', 'distinct', 'last'],
  text: ['distinct', 'last'],
};
export const aggregationsFor = (kind: ColumnKind) => AGGREGATIONS_FOR[kind];
