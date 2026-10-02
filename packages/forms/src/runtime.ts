import type { FormDefinition, Question } from '@grids/schema';
import { evalExpr, ExprError, truthy, type Answers } from './expr.js';

export const questionsOf = (def: FormDefinition): Question[] => def.sections.flatMap((s) => s.questions);

export interface FormState {
  /** Answers plus calculated values. */
  values: Answers;
  /** Keys of questions (and sections) currently shown. */
  relevant: Set<string>;
}

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ExprError) return fallback;
    throw e;
  }
};

/**
 * Evaluates calculations and relevance. Calculations may depend on each other, so
 * they are evaluated until stable (bounded by the number of calculations).
 */
export function formState(def: FormDefinition, answers: Answers): FormState {
  const values: Answers = { ...answers };
  const calcs = questionsOf(def).filter((q) => q.type === 'calculate' && q.calculation);
  for (let pass = 0; pass <= calcs.length; pass++) {
    let changed = false;
    for (const q of calcs) {
      const v = safe(() => evalExpr(q.calculation!, values), null);
      const next = typeof v === 'number' && !Number.isFinite(v) ? null : v;
      if (values[q.key] !== next) {
        values[q.key] = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const relevant = new Set<string>();
  for (const s of def.sections) {
    if (s.relevant && !safe(() => truthy(evalExpr(s.relevant!, values)), true)) continue;
    relevant.add(s.key);
    for (const q of s.questions) {
      if (!q.relevant || safe(() => truthy(evalExpr(q.relevant!, values)), true)) relevant.add(q.key);
    }
  }
  return { values, relevant };
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Checks one answer's type, options and bounds; returns an error message or null. */
function checkType(q: Question, v: unknown): string | null {
  switch (q.type) {
    case 'integer':
      if (typeof v !== 'number' || !Number.isInteger(v)) return 'Enter a whole number';
      break;
    case 'decimal':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'Enter a number';
      break;
    case 'boolean':
      if (typeof v !== 'boolean') return 'Choose yes or no';
      break;
    case 'select':
      if (typeof v !== 'string' || !(q.options ?? []).some((o) => o.value === v)) return 'Choose one of the options';
      break;
    case 'multiselect':
      if (!Array.isArray(v) || v.some((x) => !(q.options ?? []).some((o) => o.value === x))) return 'Choose from the options';
      break;
    case 'date':
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Enter a date';
      break;
    case 'datetime':
      if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return 'Enter a date and time';
      break;
    case 'geopoint': {
      const p = v as { lat?: unknown; lon?: unknown };
      if (typeof p !== 'object' || typeof p.lat !== 'number' || typeof p.lon !== 'number' || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)
        return 'Enter a location';
      break;
    }
    case 'text':
    case 'textarea':
      if (typeof v !== 'string') return 'Enter text';
      if (v.length > (q.type === 'text' ? 1000 : 10000)) return 'Too long';
      break;
  }
  if (typeof v === 'number') {
    if (q.min !== undefined && v < q.min) return `Must be at least ${q.min}`;
    if (q.max !== undefined && v > q.max) return `Must be at most ${q.max}`;
  }
  return null;
}

export interface Validation {
  ok: boolean;
  errors: Record<string, string>;
  /** Relevant answers only, with calculations applied (what gets stored). */
  clean: Answers;
}

/** Validates a full submission the same way on every platform. */
export function validate(def: FormDefinition, answers: Answers): Validation {
  const { values, relevant } = formState(def, answers);
  const errors: Record<string, string> = {};
  const clean: Answers = {};
  for (const q of questionsOf(def)) {
    if (q.type === 'note' || !relevant.has(q.key)) continue;
    const v = values[q.key];
    if (isEmpty(v)) {
      if (q.required && q.type !== 'calculate') errors[q.key] = 'Required';
      continue;
    }
    if (q.type !== 'calculate') {
      const typeError = checkType(q, v);
      if (typeError) {
        errors[q.key] = typeError;
        continue;
      }
      if (q.constraint && !safe(() => truthy(evalExpr(q.constraint!, values, v)), false)) {
        errors[q.key] = q.constraintMessage || 'This answer isn’t allowed';
        continue;
      }
    }
    clean[q.key] = v;
  }
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

/** Checks every expression in a definition parses and only references known questions. */
export function lintDefinition(def: FormDefinition): string[] {
  const problems: string[] = [];
  const keys = new Set(questionsOf(def).map((q) => q.key));
  const seen = new Set<string>();
  for (const q of questionsOf(def)) {
    if (seen.has(q.key)) problems.push(`Duplicate question key "${q.key}"`);
    seen.add(q.key);
    if ((q.type === 'select' || q.type === 'multiselect') && !(q.options ?? []).length)
      problems.push(`"${q.key}" needs at least one option`);
    if (q.type === 'calculate' && !q.calculation) problems.push(`"${q.key}" needs a calculation`);
  }
  const check = (where: string, src: string | undefined) => {
    if (!src) return;
    try {
      for (const ref of refsOf(src)) if (!keys.has(ref)) problems.push(`${where}: unknown question \${${ref}}`);
    } catch (e) {
      problems.push(`${where}: ${(e as Error).message}`);
    }
  };
  for (const s of def.sections) {
    check(`Section "${s.key}" relevance`, s.relevant);
    for (const q of s.questions) {
      check(`"${q.key}" relevance`, q.relevant);
      check(`"${q.key}" constraint`, q.constraint);
      check(`"${q.key}" calculation`, q.calculation);
    }
  }
  return problems;
}

import { references as refsOf } from './expr.js';

/** Start of the reporting period containing `date` (ISO week starts Monday). */
export function periodStart(period: FormDefinition['period'], date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (period === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (period === 'month') d.setUTCDate(1);
  return period === 'none' ? date : d;
}
