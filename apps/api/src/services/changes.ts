/** One thing that changed: what it was, and what it is now. Either side is null when there was nothing (a new thing, a removed one). */
export interface Change {
  field: string;
  before: string | null;
  after: string | null;
}

/** A value as people read it in the log: nothing for empty, a list joined, long text cut short. */
export function show(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = Array.isArray(v) ? v.map((x) => show(x) ?? '').filter(Boolean).join(', ') : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
  return s ? (s.length > 300 ? `${s.slice(0, 300)}…` : s) : null;
}

/** The fields that differ, from `[field, before, after]` triples. */
export function changes(triples: [field: string, before: unknown, after: unknown][]): Change[] {
  return triples.flatMap(([field, b, a]) => {
    const before = show(b);
    const after = show(a);
    return before === after ? [] : [{ field, before, after }];
  });
}
