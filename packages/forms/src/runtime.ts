import type { CodeGenerator, FormDefinition, Question } from '@grids/schema';
import { evalExpr, ExprError, truthy, type Answers } from './expr.js';

/** What a required question says when left empty, unless the question has its own wording. */
export const DEFAULT_REQUIRED_MESSAGE = 'This is a required field';

export const questionsOf = (def: FormDefinition): Question[] => def.sections.flatMap((s) => s.questions);

/** What is known about one set of questions: the top level of the form, or one row of a repeating section. */
export interface Scope {
  /** Answers plus calculated values. */
  values: Answers;
  /** Keys of questions (and sections) currently relevant. */
  relevant: Set<string>;
  /** Keys of questions the person filling in sees: relevant and not hidden. */
  shown: Set<string>;
}

export interface FormState extends Scope {
  /** For each repeating section that applies, the state of each of its rows. */
  rows: Record<string, Scope[]>;
}

/** A question whose value is worked out from its `calculation` instead of being asked. */
const computed = (q: Question) => !!q.calculation && (q.type === 'calculate' || !!q.hidden);

/** Questions of a hidden section are hidden themselves. */
const withHiddenSections = (def: FormDefinition): FormDefinition =>
  def.sections.some((s) => s.hidden) ? { ...def, sections: def.sections.map((s) => (s.hidden ? { ...s, questions: s.questions.map((q) => ({ ...q, hidden: true })) } : s)) } : def;

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ExprError) return fallback;
    throw e;
  }
};

const isRow = (x: unknown): x is Answers => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Evaluates calculations and relevance of some sections' questions. Calculations may depend on each
 * other, so they are evaluated until stable (bounded by the number of calculations). `outer` holds
 * values an expression can also read (the rest of the form, for a row of a repeating section).
 */
function evalScope(sections: FormDefinition['sections'], answers: Answers, outer: Answers): Scope {
  const values: Answers = { ...answers };
  const env = () => ({ ...outer, ...values });
  const questions = sections.flatMap((s) => s.questions);
  const calcs = questions.filter(computed);
  for (let pass = 0; pass <= calcs.length; pass++) {
    let changed = false;
    for (const q of calcs) {
      const v = safe(() => evalExpr(q.calculation!, env()), null);
      const next = typeof v === 'number' && !Number.isFinite(v) ? null : v;
      if (values[q.key] !== next) {
        values[q.key] = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // A hidden question with a fixed value and no formula keeps that value.
  for (const q of questions) if (q.hidden && !q.calculation && q.defaultValue !== undefined) values[q.key] = q.defaultValue;
  const relevant = new Set<string>();
  const shown = new Set<string>();
  for (const s of sections) {
    if (s.relevant && !safe(() => truthy(evalExpr(s.relevant!, env())), true)) continue;
    relevant.add(s.key);
    for (const q of s.questions) {
      if (!q.relevant || safe(() => truthy(evalExpr(q.relevant!, env())), true)) {
        relevant.add(q.key);
        if (!q.hidden) shown.add(q.key);
      }
    }
    // A section whose questions are all hidden has nothing to show.
    if (!s.questions.length || s.questions.some((q) => shown.has(q.key))) shown.add(s.key);
  }
  return { values, relevant, shown };
}

/** Evaluates the whole form: its top level, and each row of each repeating section. */
export function formState(source: FormDefinition, answers: Answers): FormState {
  const def = withHiddenSections(source);
  const top = evalScope(def.sections.filter((s) => !s.repeat), answers, {});
  const rows: Record<string, Scope[]> = {};
  for (const s of def.sections.filter((x) => x.repeat)) {
    if (s.relevant && !safe(() => truthy(evalExpr(s.relevant!, top.values)), true)) continue;
    top.relevant.add(s.key);
    const given = Array.isArray(answers[s.key]) ? (answers[s.key] as unknown[]).filter(isRow) : [];
    rows[s.key] = given.map((row) => evalScope([{ ...s, relevant: undefined }], row, top.values));
    top.values[s.key] = rows[s.key]!.map((r) => r.values);
    if (!s.questions.length || s.questions.some((q) => !q.hidden)) top.shown.add(s.key);
  }
  return { ...top, rows };
}

const CHARSETS = { alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digits: '0123456789', clear: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' } as const;

/** A random code as the generator describes it. */
export function generateCode(g: CodeGenerator): string {
  const chars = CHARSETS[g.charset];
  const bytes = crypto.getRandomValues(new Uint32Array(g.groups.reduce((n, x) => n + x, 0)));
  let at = 0;
  const groups = g.groups.map((n) => Array.from({ length: n }, () => chars[bytes[at++]! % chars.length]).join(''));
  return [g.prefix, ...groups].filter(Boolean).join(g.separator);
}

/** How long the generated code is. */
export const generatedLength = (g: CodeGenerator) => [g.prefix, ...g.groups.map((n) => 'x'.repeat(n))].filter(Boolean).join(g.separator).length;

/** What a question's answer starts as: its default value, or a fresh code for a generated one. */
const startValue = (q: Question) => (q.type === 'text' && q.generate ? generateCode(q.generate) : q.defaultValue);

/** The answers a form opens with: each question's default value. */
export function defaultAnswers(def: FormDefinition): Answers {
  const out: Answers = {};
  for (const q of questionsOf(def)) if (startValue(q) !== undefined && !q.hidden && q.type !== 'note' && q.type !== 'calculate') out[q.key] = startValue(q) as Answers[string];
  return out;
}

/** A new row of a repeating section, with its questions' default values. */
export function defaultRow(section: FormDefinition['sections'][number]): Answers {
  const out: Answers = {};
  for (const q of section.questions) if (startValue(q) !== undefined && !q.hidden && q.type !== 'note' && q.type !== 'calculate') out[q.key] = startValue(q) as Answers[string];
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Checks one answer's type, options and bounds; returns an error message or null. */
function checkType(q: Question, v: unknown): string | null {
  if (q.multiple && (q.type === 'image' || q.type === 'file')) {
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !UUID.test(x))) return q.type === 'image' ? 'Add pictures' : 'Add files';
    return v.length > (q.maxItems ?? 10) ? `Add at most ${q.maxItems ?? 10}` : null;
  }
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
    case 'time': {
      const m = typeof v === 'string' ? /^(\d{2}):(\d{2})$/.exec(v) : null;
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return 'Enter a time';
      break;
    }
    case 'email':
      if (typeof v !== 'string' || v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address';
      break;
    case 'phone':
      if (typeof v !== 'string' || !/^\+?[0-9 ()\-.]{6,25}$/.test(v) || v.replace(/\D/g, '').length < 6) return 'Enter a valid phone number';
      break;
    case 'url': {
      const ok = (() => {
        try {
          return typeof v === 'string' && v.length <= 2000 && /^https?:$/.test(new URL(v).protocol);
        } catch {
          return false;
        }
      })();
      if (!ok) return 'Enter a web address starting with http:// or https://';
      break;
    }
    case 'rating':
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > (q.max ?? 5)) return 'Choose a rating';
      break;
    case 'qr':
      if (typeof v !== 'string' || !v.trim()) return 'Scan or enter a code';
      if (v.length > 500) return 'Too long';
      break;
    case 'image':
    case 'file':
    case 'signature':
    case 'entity':
      if (typeof v !== 'string' || !UUID.test(v)) return q.type === 'image' ? 'Add a picture' : q.type === 'file' ? 'Add a file' : q.type === 'signature' ? 'Add a signature' : 'Choose one';
      break;
    case 'text':
    case 'textarea':
      if (typeof v !== 'string') return 'Enter text';
      if (v.length > Math.min(q.maxLength ?? Infinity, q.type === 'text' ? 1000 : 10000)) return q.maxLength ? `At most ${q.maxLength} characters` : 'Too long';
      if (q.minLength && v.length < q.minLength) return `At least ${q.minLength} characters`;
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
  /** Relevant answers only, with calculations applied, minus the questions marked `discard` (what gets stored). */
  clean: Answers;
  /** Like `clean` but with the discarded answers too (for checks that need them, e.g. entity filters). */
  all: Answers;
}

/** Checks the answers of one scope (the top level, or one row) and adds to `errors`, keyed with `prefix`. */
function validateScope(questions: Question[], st: Scope, outer: Answers, prefix: string, errors: Record<string, string>): { clean: Answers; all: Answers } {
  const clean: Answers = {};
  const all: Answers = {};
  const env = { ...outer, ...st.values };
  for (const q of questions) {
    if (q.type === 'note' || !st.relevant.has(q.key)) continue;
    const v = st.values[q.key];
    if (isEmpty(v)) {
      if (q.required && q.type !== 'calculate' && !q.hidden) errors[prefix + q.key] = q.requiredMessage || DEFAULT_REQUIRED_MESSAGE;
      continue;
    }
    if (!computed(q)) {
      const typeError = checkType(q, v);
      if (typeError) {
        errors[prefix + q.key] = typeError;
        continue;
      }
      if (q.constraint && !safe(() => truthy(evalExpr(q.constraint!, env, v)), false)) {
        errors[prefix + q.key] = q.constraintMessage || 'This answer isn’t allowed';
        continue;
      }
    }
    all[q.key] = v;
    if (!q.discard) clean[q.key] = v;
  }
  return { clean, all };
}

/**
 * Validates a full submission the same way on every platform. Errors of a question in a repeating
 * section are keyed `<section>.<row>.<question>`; a section's own problem (too few rows) by its key.
 */
export function validate(source: FormDefinition, answers: Answers): Validation {
  const def = withHiddenSections(source);
  const st = formState(def, answers);
  const errors: Record<string, string> = {};
  const { clean, all } = validateScope(def.sections.filter((s) => !s.repeat).flatMap((s) => s.questions), st, {}, '', errors);
  for (const s of def.sections.filter((x) => x.repeat)) {
    const rows = st.rows[s.key];
    if (!rows) continue;
    const { min = 0, max = 100 } = s.repeat!;
    if (rows.length < min) errors[s.key] = min === 1 ? 'Add at least one' : `Add at least ${min}`;
    else if (rows.length > max) errors[s.key] = `Add at most ${max}`;
    const checked = rows.map((r, i) => validateScope(s.questions, r, st.values, `${s.key}.${i}.`, errors));
    if (rows.length) {
      clean[s.key] = checked.map((c) => c.clean);
      all[s.key] = checked.map((c) => c.all);
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, clean, all };
}

/** Checks every expression in a definition parses and only references known questions. */
export function lintDefinition(def: FormDefinition): string[] {
  const problems: string[] = [];
  // A repeating section's own key can be used too, to count its rows: count-selected(${members}).
  const keys = new Set([...questionsOf(def).map((q) => q.key), ...def.sections.filter((s) => s.repeat).map((s) => s.key)]);
  const seen = new Set<string>();
  for (const q of questionsOf(def)) {
    if (seen.has(q.key)) problems.push(`Duplicate question key "${q.key}"`);
    seen.add(q.key);
    if ((q.type === 'select' || q.type === 'multiselect') && !(q.options ?? []).length)
      problems.push(`"${q.key}" needs at least one option`);
    if (q.type === 'calculate' && !q.calculation) problems.push(`"${q.key}" needs a calculation`);
    if (q.hidden && q.type !== 'calculate' && !q.calculation && q.defaultValue === undefined) problems.push(`"${q.key}" is hidden but has no calculation or default value, so it would always be empty`);
    if (q.defaultValue !== undefined && q.type !== 'note' && q.type !== 'calculate') {
      const bad = ['entity', 'file'].includes(q.type) || (q.type === 'image' && q.multiple) ? 'cannot have a default value' : checkType(q, q.defaultValue) && `has a default value that does not fit (${checkType(q, q.defaultValue)!.toLowerCase()})`;
      if (bad) problems.push(`"${q.key}" ${bad}`);
    }
    if (q.minLength !== undefined && q.maxLength !== undefined && q.minLength > q.maxLength) problems.push(`"${q.key}" has a minimum length above its maximum`);
    if (q.generate && q.type !== 'text') problems.push(`"${q.key}" makes a code but is not a short text question`);
    if (q.generate && q.type === 'text' && q.maxLength !== undefined && generatedLength(q.generate) > q.maxLength) problems.push(`"${q.key}" makes codes longer than its maximum length`);
    if (q.discard && (q.bind || q.primary)) problems.push(`"${q.key}" is not kept with the submission, so it cannot be saved to an entity or be the main place`);
    if (q.type === 'entity') {
      if (!q.entityType) problems.push(`"${q.key}" needs an entity type to choose from`);
      if (q.filter && q.filter.of !== '$subject' && !questionsOf(def).some((x) => x.key === q.filter!.of && x.type === 'entity' && x.key !== q.key))
        problems.push(`"${q.key}" is limited by "${q.filter.of}", which is not another entity question`);
    } else if (q.primary || q.filter || q.entityType) problems.push(`"${q.key}" has entity settings but is not an entity question`);
    if (q.bind?.entity && !questionsOf(def).some((x) => x.key === q.bind!.entity && x.type === 'entity'))
      problems.push(`"${q.key}" saves to "${q.bind.entity}", which is not an entity question`);
    if (q.bind?.entity && !q.bind.attribute && !q.bind.element) problems.push(`"${q.key}" names an entity to save to but not what to save`);
  }
  const repeatOf = new Map(def.sections.filter((s) => s.repeat).flatMap((s) => s.questions.map((q) => [q.key, s.key] as const)));
  for (const s of def.sections) {
    if (s.repeat?.min !== undefined && s.repeat.max !== undefined && s.repeat.min > s.repeat.max) problems.push(`Section "${s.key}" asks for more rows than it allows`);
    if (!s.repeat) continue;
    for (const q of s.questions) {
      if (q.bind || q.primary) problems.push(`"${q.key}" is in a repeating section, so it cannot be saved to an entity or be the main place`);
      if (q.filter && q.filter.of !== '$subject' && repeatOf.get(q.filter.of) !== s.key && repeatOf.has(q.filter.of)) problems.push(`"${q.key}" is limited by a question in another repeating section`);
    }
  }
  for (const q of questionsOf(def)) {
    if (q.multiple && q.type !== 'image' && q.type !== 'file') problems.push(`"${q.key}" cannot take several answers`);
  }
  if (questionsOf(def).filter((q) => q.primary).length > 1) problems.push('Only one question can be the form’s main entity');
  const check = (where: string, src: string | undefined, scope?: string) => {
    if (!src) return;
    try {
      for (const ref of refsOf(src)) {
        if (!keys.has(ref)) problems.push(`${where}: unknown question \${${ref}}`);
        else if (repeatOf.has(ref) && repeatOf.get(ref) !== scope) problems.push(`${where}: "${ref}" is inside a repeating section, so only questions in the same section can use it`);
      }
    } catch (e) {
      problems.push(`${where}: ${(e as Error).message}`);
    }
  };
  for (const s of def.sections) {
    check(`Section "${s.key}" relevance`, s.relevant);
    for (const q of s.questions) {
      check(`"${q.key}" relevance`, q.relevant, s.repeat ? s.key : undefined);
      check(`"${q.key}" constraint`, q.constraint, s.repeat ? s.key : undefined);
      check(`"${q.key}" calculation`, q.calculation, s.repeat ? s.key : undefined);
    }
  }
  return problems;
}

import { references as refsOf } from './expr.js';

/** Start of the reporting period containing `date` (`week` starts on Monday, `week_sun` on Sunday). */
export function periodStart(period: FormDefinition['period'], date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (period === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (period === 'week_sun') d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  if (period === 'month') d.setUTCDate(1);
  if (period === 'year') d.setUTCMonth(0, 1);
  return period === 'none' ? date : d;
}

/** The form as the person applying fills it: the parts that approvers fill in at a step are not there. */
export function forFiller(def: FormDefinition): FormDefinition {
  return def.sections.some((s) => s.fillAt) ? { ...def, sections: def.sections.filter((s) => !s.fillAt) } : def;
}

/** Only the parts the approvers of one step fill in. */
export function forStage(def: FormDefinition, nodeId: string): FormDefinition {
  return { ...def, sections: def.sections.filter((s) => s.fillAt === nodeId) };
}

/** The answer keys of the parts approvers fill in (a repeating section answers under its own key). */
export function stageAnswerKeys(def: FormDefinition): string[] {
  return def.sections.filter((s) => s.fillAt).flatMap((s) => (s.repeat ? [s.key] : s.questions.map((q) => q.key)));
}
