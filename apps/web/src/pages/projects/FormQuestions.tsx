import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CodeGenerator, DEFAULT_DATA_GROUP, elementRef, PROJECT_SUBJECT, QUESTION_TYPES, QUESTION_WIDTHS, questionWidth, type Audience, type FormDefinition, type Question, type QuestionType, type Section } from '@grids/schema';
import { Button, Dialog, ErrorNotice, Field, Input, Listbox, Select, Switch, Textarea, cx } from '@grids/ui';
import {
  AlignLeft,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Braces,
  Calculator,
  Calendar,
  CalendarClock,
  Camera,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Copy,
  Clock,
  Database,
  Eye,
  EyeOff,
  GitBranch,
  GripVertical,
  Hash,
  Globe,
  Info,
  Link2,
  ListChecks,
  ListTree,
  Lock,
  Mail,
  MapPin,
  MapPinned,
  MessageSquare,
  Minus,
  Paperclip,
  PenLine,
  Phone,
  QrCode,
  Percent,
  Plus,
  Shapes,
  Star,
  ShieldCheck,
  ToggleLeft,
  Trash2,
  Type,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { DEFAULT_REQUIRED_MESSAGE, generateCode } from '@grids/forms';
import { api } from '../../api';
import { ElementForm, freeKey, keyProblem, type ElementDraft } from './ElementForm';
import { iconOf, useProject } from './context';
import { useTypes } from './EntitiesTab';
import { usePermissionGroups } from './permissions';
import { FormEnv, ImageInput, SignatureInput } from './FormInputs';
import { IconPicker } from './fields';

export const TYPE_INFO: Record<QuestionType, { label: string; icon: LucideIcon }> = {
  text: { label: 'Short text', icon: Type },
  textarea: { label: 'Long text', icon: AlignLeft },
  integer: { label: 'Whole number', icon: Hash },
  decimal: { label: 'Decimal', icon: Percent },
  select: { label: 'Single choice', icon: CircleDot },
  multiselect: { label: 'Multiple choice', icon: ListChecks },
  boolean: { label: 'Yes / no', icon: ToggleLeft },
  date: { label: 'Date', icon: Calendar },
  time: { label: 'Time', icon: Clock },
  phone: { label: 'Phone number', icon: Phone },
  email: { label: 'Email address', icon: Mail },
  url: { label: 'Web address', icon: Globe },
  rating: { label: 'Rating', icon: Star },
  file: { label: 'File upload', icon: Paperclip },
  signature: { label: 'Signature', icon: PenLine },
  datetime: { label: 'Date & time', icon: CalendarClock },
  geopoint: { label: 'Location', icon: MapPin },
  qr: { label: 'QR code scan', icon: QrCode },
  image: { label: 'Photo', icon: Camera },
  entity: { label: 'Entity', icon: MapPinned },
  note: { label: 'Note', icon: Info },
  calculate: { label: 'Calculation', icon: Calculator },
};
/** What each kind of question is for, grouped as the "Add a question" list shows them. */
export const TYPE_GROUPS: { title: string; types: [QuestionType, string][] }[] = [
  {
    title: 'Answers',
    types: [
      ['text', 'A short line of text'],
      ['textarea', 'Several lines'],
      ['integer', 'A count, like 24'],
      ['decimal', 'A number with decimals'],
      ['boolean', 'Yes or no'],
      ['rating', 'Stars, 1 to 5'],
      ['phone', 'A phone number'],
      ['email', 'An email address'],
      ['url', 'A web address'],
    ],
  },
  {
    title: 'Choices',
    types: [
      ['select', 'Pick one from a list'],
      ['multiselect', 'Pick any number'],
    ],
  },
  {
    title: 'When and where',
    types: [
      ['date', 'A calendar date'],
      ['datetime', 'A date and a time'],
      ['time', 'A time of day'],
      ['geopoint', 'The device’s position'],
    ],
  },
  {
    title: 'Capture',
    types: [
      ['qr', 'Scan a QR code or barcode'],
      ['image', 'Take or upload a picture'],
      ['file', 'A document, like a PDF'],
      ['signature', 'Signed on the screen'],
    ],
  },
  {
    title: 'Entities in the project',
    types: [['entity', 'Choose an entity, optionally one related to another']],
  },
  {
    title: 'Other',
    types: [
      ['calculate', 'A value worked out from answers'],
      ['note', 'Text to read, no answer'],
    ],
  },
];
const DESCRIBE = Object.fromEntries(TYPE_GROUPS.flatMap((g) => g.types)) as Record<QuestionType, string>;
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'q_$1').slice(0, 60) || 'question';

export type Sel = { kind: 'q'; s: number; q: number } | { kind: 's'; s: number } | null;

const mono = "font-mono";

// ------------------------------------------------------------------ conditions

type Cond = { key: string; op: string; value: string };
type Join = 'and' | 'or';
/** A bracketed set of conditions (or of further groups): all of them, any of them, or the opposite of either. */
type Group = { join: Join; not: boolean; items: Item[] };
type Item = { kind: 'c'; c: Cond } | { kind: 'g'; g: Group };
/** The four ways a group combines its items, as (join, not): the operator, and what it means in words. */
const MATCHES: { id: string; label: string; join: Join; not: boolean; says: string }[] = [
  { id: 'all', label: 'AND', join: 'and', not: false, says: 'Every one of these is true' },
  { id: 'any', label: 'OR', join: 'or', not: false, says: 'At least one of these is true' },
  { id: 'none', label: 'NOR', join: 'or', not: true, says: 'None of these is true' },
  { id: 'notall', label: 'NAND', join: 'and', not: true, says: 'Not all of these are true' },
];

/** The ways a condition can compare an answer: what people see, and how it is written as a formula. */
const OPS: Record<string, { label: string; needsValue: boolean }> = {
  '=': { label: 'is', needsValue: true },
  '!=': { label: 'is not', needsValue: true },
  '>': { label: 'is more than', needsValue: true },
  '>=': { label: 'is at least', needsValue: true },
  '<': { label: 'is less than', needsValue: true },
  '<=': { label: 'is at most', needsValue: true },
  in: { label: 'is one of', needsValue: true },
  selected: { label: 'includes', needsValue: true },
  not_selected: { label: 'does not include', needsValue: true },
  contains: { label: 'contains', needsValue: true },
  not_contains: { label: 'does not contain', needsValue: true },
  starts: { label: 'starts with', needsValue: true },
  answered: { label: 'is answered', needsValue: false },
  empty: { label: 'is empty', needsValue: false },
};
const opsFor = (type: QuestionType | undefined): string[] => {
  switch (type) {
    case 'select':
      return ['=', '!=', 'in', 'answered', 'empty'];
    case 'multiselect':
      return ['selected', 'not_selected', 'answered', 'empty'];
    // Nothing to compare these with: only whether they were given.
    case 'entity':
    case 'image':
    case 'file':
    case 'signature':
    case 'geopoint':
      return ['answered', 'empty'];
    case 'boolean':
      return ['=', '!=', 'answered', 'empty'];
    case 'integer':
    case 'decimal':
    case 'rating':
    case 'date':
    case 'datetime':
    case 'time':
      return ['=', '!=', '>', '>=', '<', '<=', 'answered', 'empty'];
    default:
      return ['=', '!=', 'contains', 'not_contains', 'starts', 'answered', 'empty'];
  }
};
const RAW_TYPES: QuestionType[] = ['integer', 'decimal', 'boolean'];

/** Splits at a top-level `and` / `or` (not inside quotes or brackets). */
function splitTop(expr: string, word: Join): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = false;
  let from = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]!;
    if (c === "'") quote = !quote;
    else if (!quote && c === '(') depth++;
    else if (!quote && c === ')') depth--;
    else if (!quote && depth === 0 && /\s/.test(c)) {
      const m = new RegExp(`^\\s+${word}\\s+`).exec(expr.slice(i));
      if (m) {
        parts.push(expr.slice(from, i));
        i += m[0].length - 1;
        from = i + 1;
      }
    }
  }
  parts.push(expr.slice(from));
  return parts.map((x) => x.trim());
}

const REF = String.raw`(\$\{[A-Za-z0-9_]+\}|\.)`;
/** The key a reference stands for: `${age}` is `age`, a lone `.` is the answer being checked. */
const keyOf = (token: string) => (token === '.' ? '.' : token.slice(2, -1));
const LIT = String.raw`(?:'([^']*)'|(-?\d+(?:\.\d+)?|true|false))`;

function parseOne(raw: string): Omit<Cond, 'join'> | null {
  let part = raw.trim();
  let m: RegExpExecArray | null;
  // "is one of": (${k} = 'a' or ${k} = 'b')
  if (part.startsWith('(') && part.endsWith(')')) {
    const items = splitTop(part.slice(1, -1), 'or').map((x) => new RegExp(`^${REF}\\s*=\\s*${LIT}$`).exec(x));
    if (items.length > 1 && items.every((x) => x && x[1] === items[0]![1])) return { key: keyOf(items[0]![1]!), op: 'in', value: items.map((x) => x![2] ?? x![3]!).join(',') };
    return null;
  }
  let negated = false;
  if (/^not\(/.test(part) && part.endsWith(')')) {
    negated = true;
    part = part.slice(4, -1).trim();
  }
  if ((m = new RegExp(`^(selected|contains)\\(${REF},\\s*'([^']*)'\\)$`).exec(part))) return { key: keyOf(m[2]!), op: m[1] === 'selected' ? (negated ? 'not_selected' : 'selected') : negated ? 'not_contains' : 'contains', value: m[3]! };
  if (negated) return null;
  if ((m = new RegExp(`^starts-with\\(${REF},\\s*'([^']*)'\\)$`).exec(part))) return { key: keyOf(m[1]!), op: 'starts', value: m[2]! };
  if ((m = new RegExp(`^string-length\\(${REF}\\)\\s*(>|=)\\s*0$`).exec(part))) return { key: keyOf(m[1]!), op: m[2] === '>' ? 'answered' : 'empty', value: '' };
  if ((m = new RegExp(`^${REF}\\s*(!=|>=|<=|=|>|<)\\s*${LIT}$`).exec(part))) return { key: keyOf(m[1]!), op: m[2]!, value: m[3] ?? m[4]! };
  return null;
}

/** Index of the bracket that closes the one at `open`, or -1. */
function closing(expr: string, open: number): number {
  let depth = 0;
  let quote = false;
  for (let i = open; i < expr.length; i++) {
    const c = expr[i]!;
    if (c === "'") quote = !quote;
    else if (!quote && c === '(') depth++;
    else if (!quote && c === ')' && --depth === 0) return i;
  }
  return -1;
}

const single = (c: Cond): Group => ({ join: 'and', not: false, items: [{ kind: 'c', c }] });

/** A formula as nested groups, or null when it is anything the builder does not cover. */
function parseGroup(raw: string): Group | null {
  const e = raw.trim();
  if (!e) return { join: 'and', not: false, items: [] };
  for (const join of ['or', 'and'] as const) {
    const parts = splitTop(e, join);
    if (parts.length > 1) {
      const items = parts.map(parseItem);
      return items.every(Boolean) ? { join, not: false, items: items as Item[] } : null;
    }
  }
  const one = parseOne(e);
  if (one) return single(one);
  if (e.startsWith('(') && closing(e, 0) === e.length - 1) return parseGroup(e.slice(1, -1));
  if (e.startsWith('not(') && closing(e, 3) === e.length - 1) {
    const inner = parseGroup(e.slice(4, -1));
    return inner && { ...inner, not: !inner.not };
  }
  return null;
}

/** One entry of a group: a plain condition, or a bracketed group of its own. */
function parseItem(raw: string): Item | null {
  const one = parseOne(raw);
  if (one) return { kind: 'c', c: one };
  const g = parseGroup(raw);
  return g && { kind: 'g', g };
}

function writeCond(def: FormDefinition, c: Cond): string | undefined {
  if (!c.key) return undefined;
  const t = def.sections.flatMap((s) => s.questions).find((q) => q.key === c.key)?.type;
  const quote = (v: string) => `'${v.replace(/'/g, '')}'`;
  const ref = c.key === '.' ? '.' : `\${${c.key}}`;
  const lit = (v: string) => (t && RAW_TYPES.includes(t) ? v || (t === 'boolean' ? 'true' : '0') : quote(v));
  switch (c.op) {
    case 'selected':
      return `selected(${ref}, ${quote(c.value)})`;
    case 'not_selected':
      return `not(selected(${ref}, ${quote(c.value)}))`;
    case 'contains':
      return `contains(${ref}, ${quote(c.value)})`;
    case 'not_contains':
      return `not(contains(${ref}, ${quote(c.value)}))`;
    case 'starts':
      return `starts-with(${ref}, ${quote(c.value)})`;
    case 'answered':
      return `string-length(${ref}) > 0`;
    case 'empty':
      return `string-length(${ref}) = 0`;
    case 'in': {
      const vs = c.value.split(',').filter(Boolean);
      return vs.length > 1 ? `(${vs.map((v) => `${ref} = ${quote(v)}`).join(' or ')})` : `${ref} = ${quote(vs[0] ?? '')}`;
    }
    default:
      return `${ref} ${c.op} ${lit(c.value)}`;
  }
}

/** Nested groups are always bracketed, so they read back as the same groups. */
function writeGroup(def: FormDefinition, g: Group, top = true): string | undefined {
  const parts = g.items.map((it) => (it.kind === 'c' ? writeCond(def, it.c) : writeGroup(def, it.g, false))).filter((x): x is string => !!x);
  if (!parts.length) return undefined;
  const body = parts.join(` ${g.join} `);
  return g.not ? `not(${body})` : top ? body : `(${body})`;
}

/** Applies `fn` to the group at `path` (indices of nested groups from the top) and returns the new tree. */
function editGroup(root: Group, path: number[], fn: (g: Group) => Group | null): Group {
  if (!path.length) return fn(root) ?? root;
  const [i, ...rest] = path;
  return {
    ...root,
    items: root.items.flatMap((it, j) => {
      if (j !== i || it.kind !== 'g') return [it];
      if (rest.length) return [{ kind: 'g' as const, g: editGroup(it.g, rest, fn) }];
      const next = fn(it.g);
      return next ? [{ kind: 'g' as const, g: next }] : [];
    }),
  };
}

/** "Show this when…" as rows of question, comparison and value, in groups, with the formula behind it one click away. */
function ConditionBuilder({ def: base, value, onChange, exclude, noun, self, title, help, empty }: { def: FormDefinition; value: string | undefined; onChange(v: string | undefined): void; exclude?: string; noun?: string; self?: Question; title?: string; help?: string; empty?: string }) {
  const parsed = parseGroup(value ?? '');
  const [raw, setRaw] = useState(parsed === null);
  // With `self`, the question being edited is offered first, as "This answer" (written `.`).
  const def: FormDefinition = self ? { ...base, sections: [...base.sections, { key: '__self', title: '', questions: [{ ...self, key: '.', label: 'This answer' }] }] } : base;
  // A formula sees the top of the form and, inside a repeating section, that section's own questions.
  const homeKey = self?.key ?? exclude;
  const home = homeKey ? base.sections.find((sec) => sec.questions.some((x) => x.key === homeKey)) : undefined;
  const inScope = base.sections.filter((sec) => !sec.repeat || sec === home).flatMap((sec) => sec.questions);
  const questions = [...(self ? [{ ...self, key: '.', label: 'This answer' }] : []), ...inScope.filter((q) => q.key !== (self?.key ?? exclude) && q.type !== 'note' && q.type !== 'entity' && q.type !== 'image')];
  const first = questions[0];
  const newCond = (): Item => ({ kind: 'c', c: { key: first?.key ?? '', op: opsFor(first?.type)[0]!, value: '' } });
  const update = (next: Group) => onChange(writeGroup(def, next));
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-zinc-700">{title ?? `Show this ${noun} when`}</div>
      <p className="mb-1.5 text-xs text-zinc-500">{help ?? 'Hidden ones are skipped and not saved'}</p>
      {raw || parsed === null ? (
        <div className="space-y-1.5">
          <FormulaInput def={def} label="Formula" value={value ?? ''} onChange={(v) => onChange(v || undefined)} placeholder="${age} >= 18" />
          <KeyChips def={base} exclude={self?.key ?? exclude} onPick={(k) => onChange(`${value ? `${value} ` : ''}\${${k}}`)} lead={self ? { label: 'this answer', onPick: () => onChange(`${value ? `${value} ` : ''}.`) } : undefined} />
          {parsed !== null && (
            <Button size="sm" icon={ListTree} onClick={() => setRaw(false)} className="w-full">
              Use the condition builder
            </Button>
          )}
          {parsed === null && <p className="text-xs text-zinc-500">This one uses something the builder does not cover, so it stays a formula.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {!parsed.items.length && <p className="text-sm text-zinc-500">{empty ?? 'Always shown.'}</p>}
          <GroupEditor def={def} group={parsed} path={[]} questions={questions} root={parsed} update={update} newCond={newCond} disabled={!first} />
          {!parsed.items.length && (
            <button type="button" disabled={!first} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-700 hover:underline disabled:opacity-40" onClick={() => update({ ...parsed, items: [newCond()] })}>
              <Plus className="size-3.5" /> Add a condition
            </button>
          )}
          {value && (
            <pre className="m-0 border border-dashed border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all" dir="ltr" aria-label="The formula">
              <Highlighted def={def} src={value} />
            </pre>
          )}
          <Button size="sm" icon={Braces} onClick={() => setRaw(true)} className="w-full">
            Write as formula
          </Button>
        </div>
      )}
    </div>
  );
}

/** The operator joining a group's items, as a dropdown. */
function JoinPicker({ group, onChange }: { group: Group; onChange(m: (typeof MATCHES)[number]): void }) {
  const mode = MATCHES.find((m) => m.join === group.join && m.not === group.not) ?? MATCHES[0]!;
  return (
    <div className="my-1.5 flex items-center gap-2 before:h-px before:flex-1 before:bg-zinc-200 after:h-px after:flex-1 after:bg-zinc-200">
      <Listbox
        label="How the conditions combine"
        value={mode.id}
        align="start"
        trigger={{
          className: 'inline-flex h-6 items-center gap-1 border border-zinc-300 bg-snow px-2 text-[11px] font-semibold tracking-wide text-zinc-700 hover:border-zinc-500',
          children: (
            <>
              {mode.label} <ChevronDown className="size-3 text-zinc-500" />
            </>
          ),
        }}
        options={MATCHES.map((m) => ({ value: m.id, label: m.label, description: m.says }))}
        onChange={(id) => onChange(MATCHES.find((m) => m.id === id)!)}
      />
    </div>
  );
}

/** One group: its items (conditions or nested groups) with the operator picked between them, and adding more. */
function GroupEditor({ def, group, path, questions, root, update, newCond, disabled }: { def: FormDefinition; group: Group; path: number[]; questions: Question[]; root: Group; update(next: Group): void; newCond(): Item; disabled: boolean }) {
  const nested = path.length > 0;
  const edit = (fn: (g: Group) => Group | null) => update(editGroup(root, path, fn));
  if (!group.items.length) return null;
  const pick = (m: (typeof MATCHES)[number]) => edit((g) => ({ ...g, join: m.join, not: m.not }));
  return (
    <div className={cx('space-y-2', nested && 'border-s-[3px] border-zinc-300 bg-zinc-50 py-2 ps-2.5 pe-2')}>
      <div>
        {/* A single item has nothing to join, but a negated one still needs a way back. */}
        {group.items.length === 1 && group.not && <JoinPicker group={group} onChange={pick} />}
        {group.items.map((it, i) => (
          <div key={i}>
            {i > 0 && <JoinPicker group={group} onChange={pick} />}
            {it.kind === 'g' ? (
              <GroupEditor def={def} group={it.g} path={[...path, i]} questions={questions} root={root} update={update} newCond={newCond} disabled={disabled} />
            ) : (
              <CondRow
                c={it.c}
                questions={questions}
                onChange={(patch) => edit((g) => ({ ...g, items: g.items.map((x, j) => (j === i && x.kind === 'c' ? { kind: 'c', c: { ...x.c, ...patch } } : x)) }))}
                onRemove={() => edit((g) => (g.items.length > 1 || !nested ? { ...g, items: g.items.filter((_, j) => j !== i) } : null))}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 text-[13px]">
        <button type="button" disabled={disabled} className="inline-flex items-center gap-1.5 font-medium text-accent-700 hover:underline disabled:opacity-40" onClick={() => edit((g) => ({ ...g, items: [...g.items, newCond()] }))}>
          <Plus className="size-3.5" /> Condition
        </button>
        <button type="button" disabled={disabled} className="inline-flex items-center gap-1.5 font-medium text-accent-700 hover:underline disabled:opacity-40" onClick={() => edit((g) => ({ ...g, items: [...g.items, { kind: 'g', g: { join: 'or', not: false, items: [newCond()] } }] }))}>
          <Plus className="size-3.5" /> Group
        </button>
        {nested && (
          <button type="button" className="ms-auto inline-flex items-center gap-1.5 text-zinc-500 hover:text-red-700" onClick={() => edit(() => null)}>
            <Trash2 className="size-3.5" /> Remove group
          </button>
        )}
      </div>
    </div>
  );
}

/** A single comparison: question, how to compare, and the value. */
function CondRow({ c, questions, onChange, onRemove }: { c: Cond; questions: Question[]; onChange(patch: Partial<Cond>): void; onRemove(): void }) {
  const q = questions.find((x) => x.key === c.key);
  const ops = opsFor(q?.type);
  const op = OPS[c.op] ?? OPS['=']!;
  const options = (q?.options ?? []).map((o) => ({ value: o.value, label: o.label }));
  return (
    <div className="flex items-center gap-1.5 border border-zinc-200 bg-snow p-2">
      <div className="grid min-w-0 flex-1 gap-1.5">
        <Listbox
          searchable
          label="Question"
          placeholder="Choose a question"
          value={c.key || null}
          options={questions.map((x) => ({ value: x.key, label: x.label || x.key, icon: TYPE_INFO[x.type].icon, text: `${x.label} ${x.key}` }))}
          onChange={(key) => onChange({ key, op: opsFor(questions.find((x) => x.key === key)?.type)[0]!, value: '' })}
        />
        <div className={cx('grid gap-1.5', op.needsValue ? 'grid-cols-[9.5rem_minmax(0,1fr)]' : 'grid-cols-1')}>
          <Listbox label="Comparison" value={ops.includes(c.op) ? c.op : ops[0]!} options={ops.map((o) => ({ value: o, label: OPS[o]!.label }))} onChange={(o) => onChange({ op: o, ...(o === 'in' || c.op === 'in' ? { value: '' } : {}) })} />
          {op.needsValue &&
            (c.op === 'in' ? (
              <Listbox label="Values" placeholder="Choose" value={null} values={c.value.split(',').filter(Boolean)} options={options} onChangeMany={(vs) => onChange({ value: vs.join(',') })} />
            ) : q && (q.type === 'select' || q.type === 'multiselect') ? (
              <Listbox label="Value" placeholder="Choose" value={c.value || null} options={options} onChange={(value) => onChange({ value })} />
            ) : q?.type === 'boolean' ? (
              <Listbox
                label="Value"
                value={c.value || 'true'}
                options={[
                  { value: 'true', label: 'Yes' },
                  { value: 'false', label: 'No' },
                ]}
                onChange={(value) => onChange({ value })}
              />
            ) : (
              <Input aria-label="Value" type={q?.type === 'integer' || q?.type === 'decimal' ? 'number' : q?.type === 'date' ? 'date' : 'text'} value={c.value} onChange={(e) => onChange({ value: e.target.value })} />
            ))}
        </div>
      </div>
      <button type="button" aria-label="Remove condition" className="p-1 text-zinc-500 hover:text-red-700" onClick={onRemove}>
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

/** Lists question keys usable in expressions, inserting `${key}` on click. */
/** Formulas are coloured by kind, as in a code editor: questions, operators, text, numbers and functions each have one colour. */
const QUESTION_CHIP = 'bg-sky-100 text-sky-800';
const knows = (def: FormDefinition, key: string) => def.sections.some((s) => s.questions.some((q) => q.key === key));

/** A formula with its parts coloured. */
function Highlighted({ def, src }: { def: FormDefinition; src: string }) {
  const re = /(\$\{[^}]*\})|('[^']*'|"[^"]*")|(\b(?:and|or|not|div|mod)\b)|(\b\d+(?:\.\d+)?\b)|([A-Za-z][A-Za-z0-9-]*(?=\())|([()])|(<=|>=|!=|=|<|>|\+|-|\*|\/|%)|((?<![\w.])\.(?![\w.]))/g;
  const out: ReactNode[] = [];
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const t = m[0];
    const k = m.index;
    if (m[1]) out.push(<span key={k} className={knows(def, t.slice(2, -1).trim()) ? QUESTION_CHIP : 'text-red-700 underline decoration-red-500 decoration-wavy'}>{t}</span>);
    else if (m[8]) out.push(<span key={k} className={QUESTION_CHIP}>{t}</span>);
    else if (m[2]) out.push(<span key={k} className="text-emerald-700">{t}</span>);
    else if (m[3] || m[7]) out.push(<span key={k} className="font-semibold text-violet-700">{t}</span>);
    else if (m[4]) out.push(<span key={k} className="text-amber-700">{t}</span>);
    else if (m[5]) out.push(<span key={k} className="font-semibold text-zinc-800">{t}</span>);
    else out.push(<span key={k} className="text-zinc-500">{t}</span>);
    last = re.lastIndex;
  }
  if (last < src.length) out.push(src.slice(last));
  return <>{out}</>;
}

/** A formula box that colours what you type: a transparent text area over the coloured copy of it. */
function FormulaInput({ def, value, onChange, placeholder, label }: { def: FormDefinition; value: string; onChange(v: string): void; placeholder?: string; label: string }) {
  const text = 'col-start-1 row-start-1 min-w-0 p-2.5 font-mono text-xs leading-5 whitespace-pre-wrap break-all';
  return (
    <div className="grid border border-zinc-300 bg-snow focus-within:border-accent-600 focus-within:ring-2 focus-within:ring-accent-600/20" dir="ltr">
      <pre aria-hidden className={cx(text, 'pointer-events-none m-0')}>
        {value ? <Highlighted def={def} src={value} /> : <span className="text-zinc-400">{placeholder}</span>}
        {'\n'}
      </pre>
      <textarea
        aria-label={label}
        rows={1}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        className={cx(text, 'resize-none overflow-hidden bg-transparent text-transparent caret-ink outline-none selection:bg-accent-200/60')}
      />
    </div>
  );
}

function KeyChips({ def, onPick, exclude, lead }: { def: FormDefinition; onPick(k: string): void; exclude?: string; lead?: { label: string; onPick(): void } }) {
  const keys = def.sections.flatMap((s) => s.questions).filter((q) => q.key !== exclude && q.type !== 'note');
  if (!keys.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {lead && (
        <button type="button" onClick={lead.onPick} className={cx('px-1.5 py-0.5 font-mono text-[10px] font-semibold hover:brightness-95', QUESTION_CHIP)}>
          {lead.label}
        </button>
      )}
      {keys.slice(0, 24).map((q) => (
        <button key={q.key} type="button" onClick={() => onPick(q.key)} className={cx('px-1.5 py-0.5 font-mono text-[10px] hover:brightness-95', QUESTION_CHIP)} title={q.label}>
          {q.key}
        </button>
      ))}
    </div>
  );
}

function ExprField({ label, intro, value, onChange, def, exclude, placeholder }: { label: string; intro: string; value: string | undefined; onChange(v: string | undefined): void; def: FormDefinition; exclude?: string; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Field label={label} intro={intro}>
        <FormulaInput def={def} label={label} value={value ?? ''} placeholder={placeholder} onChange={(v) => onChange(v || undefined)} />
      </Field>
      <KeyChips def={def} exclude={exclude} onPick={(k) => onChange(`${value ? `${value} ` : ''}\${${k}}`)} />
    </div>
  );
}

function IconBtn({ label, icon: I, onClick, danger, disabled }: { label: string; icon: LucideIcon; onClick(): void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cx('p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30', danger ? 'hover:text-red-700' : 'hover:text-ink')}>
      <I className="size-3.5" />
    </button>
  );
}

// ------------------------------------------------------------------ the tab

/** Questions: what can be added and an outline on the left, the form in the middle, the selected question on the right. */
export function BuildTab({ formKey, def, setDef, sel, setSel, subjectTypeKey, stages = [] }: { formKey: string; def: FormDefinition; setDef(d: FormDefinition): void; sel: Sel; setSel(s: Sel): void; subjectTypeKey: string | null; /** The workflow's approval steps, for parts approvers fill in. */ stages?: { id: string; name: string }[] }) {
  const projectTypes = useTypes();
  const paged = def.layout === 'steps';
  const noun = paged ? 'page' : 'section';
  const setSection = (si: number, patch: Partial<Section>) => setDef({ ...def, sections: def.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)) });
  const setQuestion = (si: number, qi: number, patch: Partial<Question>) =>
    setSection(si, { questions: def.sections[si]!.questions.map((q, i) => (i === qi ? ({ ...q, ...patch } as Question) : q)) });
  const freeKey = (stem: string) => {
    let key = stem;
    for (let n = 2; def.sections.some((s) => s.questions.some((q) => q.key === key)); n++) key = `${stem}_${n}`;
    return key;
  };
  const add = (type: QuestionType, sectionIndex?: number) => {
    const si = Math.min(sectionIndex ?? (sel ? sel.s : def.sections.length - 1), def.sections.length - 1);
    const qs = [...def.sections[si]!.questions];
    const at = sel?.kind === 'q' && sel.s === si ? sel.q + 1 : qs.length;
    const q: Question = {
      key: freeKey(type === 'note' ? 'note' : type === 'calculate' ? 'calc' : type === 'entity' ? 'entity' : type === 'image' ? 'photo' : type === 'file' ? 'file' : type === 'signature' ? 'signature' : type === 'qr' ? 'code' : 'question'),
      type,
      label: type === 'note' ? 'Read this first' : type === 'qr' ? 'Scan the code' : type === 'image' ? 'Take a photo' : type === 'file' ? 'Attach a file' : type === 'signature' ? 'Sign here' : type === 'entity' ? 'Choose the entity' : `New ${TYPE_INFO[type].label.toLowerCase()} question`,
      ...(type === 'entity' ? { entityType: (subjectTypeKey && subjectTypeKey !== PROJECT_SUBJECT ? subjectTypeKey : projectTypes.data?.[0]?.key) || undefined } : {}),
      ...(type === 'select' || type === 'multiselect'
        ? {
            options: [
              { value: 'a', label: 'Option A' },
              { value: 'b', label: 'Option B' },
            ],
          }
        : {}),
      ...(type === 'calculate' ? { calculation: '1 + 1' } : {}),
    };
    qs.splice(at, 0, q);
    setSection(si, { questions: qs });
    setSel({ kind: 'q', s: si, q: at });
  };
  /** Drag and drop: the question being dragged, and the place it would land (a section and an index in it). */
  const [drag, setDrag] = useState<{ s: number; q: number } | null>(null);
  const [over, setOver] = useState<{ s: number; at: number } | null>(null);
  const endDrag = () => (setDrag(null), setOver(null));
  const dropAt = (si: number, at: number) => {
    if (!drag) return;
    const from = drag;
    endDrag();
    const index = from.s === si && from.q < at ? at - 1 : at;
    if (from.s === si && from.q === index) return;
    const lists = def.sections.map((x) => [...x.questions]);
    const [moved] = lists[from.s]!.splice(from.q, 1);
    lists[si]!.splice(index, 0, moved!);
    setDef({ ...def, sections: def.sections.map((x, i) => ({ ...x, questions: lists[i]! })) });
    setSel({ kind: 'q', s: si, q: index });
  };
  /** Props that make something a place to drop: it records where the question would land. */
  const target = (si: number, at: number | ((e: React.DragEvent<HTMLElement>) => number)) => ({
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const place = typeof at === 'number' ? at : at(e);
      if (over?.s !== si || over.at !== place) setOver({ s: si, at: place });
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      dropAt(si, over?.s === si ? over.at : typeof at === 'number' ? at : at(e));
    },
  });

  const moveQ = (si: number, qi: number, d: -1 | 1) => {
    const qs = [...def.sections[si]!.questions];
    const j = qi + d;
    if (j < 0) {
      if (si === 0) return;
      const [q] = qs.splice(qi, 1);
      const prev = [...def.sections[si - 1]!.questions, q!];
      setDef({ ...def, sections: def.sections.map((s, i) => (i === si ? { ...s, questions: qs } : i === si - 1 ? { ...s, questions: prev } : s)) });
      setSel({ kind: 'q', s: si - 1, q: prev.length - 1 });
      return;
    }
    if (j >= qs.length) {
      if (si === def.sections.length - 1) return;
      const [q] = qs.splice(qi, 1);
      const next = [q!, ...def.sections[si + 1]!.questions];
      setDef({ ...def, sections: def.sections.map((s, i) => (i === si ? { ...s, questions: qs } : i === si + 1 ? { ...s, questions: next } : s)) });
      setSel({ kind: 'q', s: si + 1, q: 0 });
      return;
    }
    [qs[qi], qs[j]] = [qs[j]!, qs[qi]!];
    setSection(si, { questions: qs });
    setSel({ kind: 'q', s: si, q: j });
  };
  const moveS = (si: number, d: -1 | 1) => {
    const ss = [...def.sections];
    const j = si + d;
    if (j < 0 || j >= ss.length) return;
    [ss[si], ss[j]] = [ss[j]!, ss[si]!];
    setDef({ ...def, sections: ss });
    setSel({ kind: 's', s: j });
  };
  const addSection = () => {
    let key = `section_${def.sections.length + 1}`;
    for (let n = 2; def.sections.some((s) => s.key === key); n++) key = `section_${def.sections.length + n}`;
    setDef({ ...def, sections: [...def.sections, { key, title: paged ? `Page ${def.sections.length + 1}` : 'New section', questions: [] }] });
    setSel({ kind: 's', s: def.sections.length });
  };
  const select = (s: Sel) => {
    setSel(s);
    if (s) setTimeout(() => document.getElementById(s.kind === 'q' ? `q-${s.s}-${s.q}` : `section-${s.s}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)_23.5rem]">
      <Palette def={def} sel={sel} paged={paged} noun={noun} onAdd={(t) => add(t)} onAddSection={addSection} onSelect={select} />

      {/* The form */}
      <div className="min-h-0 min-w-0 space-y-3 overflow-y-auto p-5 sm:p-6">
        <div className="border border-zinc-200 bg-snow px-5 py-4">
          <input aria-label="Form title" value={def.title} onChange={(e) => setDef({ ...def, title: e.target.value })} className="w-full bg-transparent text-lg font-semibold tracking-tight outline-none" />
          <input
            aria-label="Form description"
            value={def.description}
            onChange={(e) => setDef({ ...def, description: e.target.value })}
            placeholder="Add a short description for the people filling this in"
            className="mt-0.5 w-full bg-transparent text-sm text-zinc-600 outline-none placeholder:text-zinc-400"
          />
        </div>
        {def.sections.map((s, si) => (
          <section key={si} id={`section-${si}`} className={cx('scroll-mt-4 border bg-snow', sel?.kind === 's' && sel.s === si ? 'border-accent-600 ring-1 ring-accent-600' : 'border-zinc-200')}>
            <header className={cx('group flex items-center gap-2.5 border-b border-zinc-100 px-4 py-2.5', drag && over?.s === si && over.at === 0 && 'bg-accent-50')} {...target(si, 0)}>
              <span className="bg-accent-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent-700 uppercase">{paged ? `Page ${si + 1} of ${def.sections.length}` : `Section ${si + 1}`}</span>
              <input
                aria-label="Section title"
                value={s.title}
                placeholder="Untitled"
                onFocus={() => setSel({ kind: 's', s: si })}
                onChange={(e) => setSection(si, { title: e.target.value })}
                className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:font-normal placeholder:text-zinc-400"
              />
              {s.repeat && <span className="inline-flex items-center gap-1 bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-800" title="Can be filled in several times">Repeats</span>}
              {s.relevant && (
                <span className="inline-flex items-center gap-1 bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700" title={`Shown when ${s.relevant}`}>
                  <GitBranch className="size-3" /> Conditional
                </span>
              )}
              <span className="flex opacity-60 transition group-hover:opacity-100">
                <IconBtn label="Move up" icon={ArrowUp} onClick={() => moveS(si, -1)} disabled={si === 0} />
                <IconBtn label="Move down" icon={ArrowDown} onClick={() => moveS(si, 1)} disabled={si === def.sections.length - 1} />
                <IconBtn label={s.hidden ? `Hidden: click to show this ${noun}` : `Hide this ${noun}`} icon={s.hidden ? EyeOff : Eye} onClick={() => setSection(si, { hidden: s.hidden ? undefined : true })} />
                <IconBtn label={`${paged ? 'Page' : 'Section'} logic`} icon={GitBranch} onClick={() => setSel({ kind: 's', s: si })} />
                {def.sections.length > 1 && (
                  <IconBtn
                    label={`Delete ${noun}`}
                    icon={Trash2}
                    danger
                    onClick={() => {
                      setDef({ ...def, sections: def.sections.filter((_, i) => i !== si) });
                      setSel(null);
                    }}
                  />
                )}
              </span>
            </header>
            <ol className="divide-y divide-zinc-100" {...target(si, s.questions.length)}>
              {s.questions.map((q, qi) => {
                const I = TYPE_INFO[q.type].icon;
                const on = sel?.kind === 'q' && sel.s === si && sel.q === qi;
                return (
                  <li
                    key={qi}
                    id={`q-${si}-${qi}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', q.key);
                      setDrag({ s: si, q: qi });
                    }}
                    onDragEnd={endDrag}
                    {...target(si, (e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      return e.clientY > r.top + r.height / 2 ? qi + 1 : qi;
                    })}
                    className={cx(
                      'group relative flex items-center gap-3 px-4 py-3 transition',
                      on ? 'bg-accent-50/60' : 'hover:bg-zinc-50',
                      drag?.s === si && drag.q === qi && 'opacity-40',
                      over?.s === si && over.at === qi && drag && 'shadow-[inset_0_2px_0_0_var(--brand-600)]',
                      over?.s === si && over.at === qi + 1 && qi === s.questions.length - 1 && drag && 'shadow-[inset_0_-2px_0_0_var(--brand-600)]',
                    )}
                  >
                    <GripVertical aria-hidden className="-ms-2 -me-1 size-4 shrink-0 cursor-grab text-zinc-300 transition group-hover:text-zinc-500" />
                    {on && <span className="absolute inset-y-0 start-0 w-[3px] bg-accent-600" />}
                    <button type="button" onClick={() => setSel({ kind: 'q', s: si, q: qi })} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                      <span className={cx('flex size-8 shrink-0 items-center justify-center', on ? 'bg-accent-600 text-on-accent' : 'bg-zinc-100 text-zinc-600')}>
                        <I className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{q.label || <em className="font-normal text-zinc-400">Untitled</em>}</span>
                        <span className="block truncate text-xs text-zinc-500">
                          {TYPE_INFO[q.type].label}
                          {q.options?.length ? ` · ${q.options.length} options` : ''}
                          {(q.type === 'integer' || q.type === 'decimal') && (q.min !== undefined || q.max !== undefined) ? ` · ${q.min ?? '…'} to ${q.max ?? '…'}` : ''}
                          {' · '}
                          <span className="font-mono">{q.key}</span>
                        </span>
                      </span>
                    </button>
                    <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                      {q.primary && <span className="bg-accent-50 px-1.5 py-0.5 text-[11px] font-medium text-accent-800">Main entity</span>}
                      {questionWidth(q, s.columns) !== 'full' && <span className="bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">{WIDTH_LABEL[questionWidth(q, s.columns)]}</span>}
                      {q.required && !q.primary && <span className="bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">Required</span>}
                      {q.relevant && <span className="bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800" title={`Shown when ${q.relevant}`}>Conditional</span>}
                      {q.constraint && <span className="bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">Checked</span>}
                      {q.type === 'calculate' && <span className="bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">Calculated</span>}
                      {q.bind && <span className="inline-flex items-center gap-1 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800"><Link2 className="size-3" /> {q.bind.element ? 'Indicator' : 'Saves to entity'}</span>}
                    </span>
                    <span className="flex shrink-0">
                      {q.type !== 'note' && q.type !== 'calculate' && !q.primary && (
                        <span className={cx('transition', q.hidden ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100')}>
                          <IconBtn
                            label={q.hidden ? 'Hidden from the form: click to show' : 'Hide from the form'}
                            icon={q.hidden ? EyeOff : Eye}
                            onClick={() => setQuestion(si, qi, { hidden: q.hidden ? undefined : true })}
                          />
                        </span>
                      )}
                      <span className="flex opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                      <IconBtn label="Move up" icon={ArrowUp} onClick={() => moveQ(si, qi, -1)} />
                      <IconBtn label="Move down" icon={ArrowDown} onClick={() => moveQ(si, qi, 1)} />
                      {!q.primary && <IconBtn
                        label="Duplicate"
                        icon={Copy}
                        onClick={() => {
                          const qs = [...s.questions];
                          qs.splice(qi + 1, 0, { ...structuredClone(q), key: freeKey(q.key) });
                          setSection(si, { questions: qs });
                          setSel({ kind: 'q', s: si, q: qi + 1 });
                        }}
                      />}
                      {!q.primary && <IconBtn
                        label="Delete question"
                        icon={Trash2}
                        danger
                        onClick={() => {
                          setSection(si, { questions: s.questions.filter((_, i) => i !== qi) });
                          setSel(null);
                        }}
                      />}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className={cx('border-t border-dashed border-zinc-200 px-3 py-2', drag && over?.s === si && over.at === s.questions.length && !s.questions.length && 'bg-accent-50')} {...target(si, s.questions.length)}>
              <AddQuestionMenu onPick={(t) => add(t, si)} label={s.questions.length ? 'Add a question here' : 'Add the first question'} />
            </div>
          </section>
        ))}
        <button type="button" onClick={addSection} className="flex w-full items-center justify-center gap-2 border border-dashed border-zinc-300 py-3 text-sm font-medium text-accent-700 transition hover:border-accent-600 hover:bg-accent-50">
          <Plus className="size-4" /> Add a {noun}
        </button>
      </div>

      {/* Inspector */}
      <aside className="hidden min-h-0 flex-col overflow-hidden border-s border-zinc-200 bg-snow xl:flex">
        {sel?.kind === 'q' && def.sections[sel.s]?.questions[sel.q] ? (
          <QuestionInspector key={`${sel.s}-${sel.q}`} formKey={formKey} columns={def.sections[sel.s]!.columns ?? 1} def={def} q={def.sections[sel.s]!.questions[sel.q]!} set={(patch) => setQuestion(sel.s, sel.q, patch)} subjectTypeKey={subjectTypeKey} />
        ) : sel?.kind === 's' && def.sections[sel.s] ? (
          <SectionInspector def={def} s={def.sections[sel.s]!} index={sel.s} paged={paged} stages={stages} set={(patch) => setSection(sel.s, patch)} />
        ) : (
          <div className="min-h-0 overflow-y-auto">
            <div className="px-6 py-10 text-center text-sm text-zinc-500">
              <Shapes className="mx-auto mb-3 size-6 text-zinc-300" />
              Select a question or {noun} to edit it.
            </div>
            <CreatesFields def={def} setDef={setDef} subjectTypeKey={subjectTypeKey} />
          </div>
        )}
      </aside>
    </div>
  );
}

/** Makes the form create a new entity under a place, with its code and name taken from answers. */
function CreatesFields({ def, setDef, subjectTypeKey }: { def: FormDefinition; setDef(d: FormDefinition): void; subjectTypeKey: string | null }) {
  const types = useTypes();
  const made = def.creates;
  const qs = def.sections.flatMap((x) => x.questions);
  const parents = [...(subjectTypeKey && subjectTypeKey !== PROJECT_SUBJECT ? [{ value: '$subject', label: 'The entity this form is about' }] : []), ...qs.filter((x) => x.type === 'entity').map((x) => ({ value: x.key, label: x.label || x.key }))];
  const texts = qs.filter((x) => (x.type === 'text' || x.type === 'textarea') && !x.discard).map((x) => ({ value: x.key, label: x.label || x.key }));
  const parentType = made ? (made.parent === '$subject' ? subjectTypeKey : qs.find((x) => x.key === made.parent)?.entityType) : undefined;
  const kinds = (types.data ?? []).filter((t) => !('system' in t && t.system) && (!parentType || (t as { parentTypes?: string[] }).parentTypes?.includes(parentType) !== false));
  const put = (patch: Partial<NonNullable<FormDefinition['creates']>>) => setDef({ ...def, creates: { type: '', parent: parents[0]?.value ?? '', code: '', name: '', ...made, ...patch } as NonNullable<FormDefinition['creates']> });
  return (
    <div className="space-y-4 border-t border-zinc-100 px-6 py-5 text-start">
      <ToggleRow label="Creates an entity" help="Each submission adds a new entity under a place chosen in the form" checked={!!made} onChange={(v) => setDef({ ...def, creates: v ? ({ type: '', parent: parents[0]?.value ?? '', code: '', name: '' } as NonNullable<FormDefinition['creates']>) : undefined })} />
      {made &&
        (parents.length === 0 ? (
          <p className="text-xs text-zinc-500">Add an entity question first: the new entity is placed under the place it chooses.</p>
        ) : (
          <>
            <Field label="Placed under" intro="The place the new entity belongs to">
              <Listbox label="Placed under" value={made.parent} options={parents} onChange={(parent) => put({ parent })} />
            </Field>
            <Field label="Kind of entity" intro="Must be allowed under that place">
              <Listbox label="Kind of entity" placeholder="Choose a type" value={made.type || null} options={kinds.map((t) => ({ value: t.key, label: t.name }))} onChange={(type) => put({ type })} />
            </Field>
            <Field label="Code" intro="A text question; use a generated code to make one automatically">
              <Listbox label="Code" placeholder="Choose a question" value={made.code || null} options={texts} onChange={(code) => put({ code })} />
            </Field>
            <Field label="Name" intro="A text question">
              <Listbox label="Name" placeholder="Choose a question" value={made.name || null} options={texts} onChange={(name) => put({ name })} />
            </Field>
            <p className="text-xs text-zinc-500">Questions can then save their answer to the new entity from their Data tab. It is created when the submission is final.</p>
          </>
        ))}
    </div>
  );
}

function Palette({ def, sel, paged, noun, onAdd, onAddSection, onSelect }: { def: FormDefinition; sel: Sel; paged: boolean; noun: string; onAdd(t: QuestionType): void; onAddSection(): void; onSelect(s: Sel): void }) {
  const [tab, setTab] = useState<'add' | 'outline'>('add');
  const [shut, setShut] = useState<Set<number>>(new Set());
  const count = def.sections.reduce((n, s) => n + s.questions.length, 0);
  return (
    <div className="hidden min-h-0 flex-col overflow-hidden border-e border-zinc-200 bg-zinc-50 lg:flex">
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-snow px-4 py-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center bg-accent-600 text-on-accent">
          <ClipboardList className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Form builder</div>
          <div className="text-xs text-zinc-500">
            {count} question{count === 1 ? '' : 's'} · {def.sections.length} {paged ? 'page' : 'section'}
            {def.sections.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={(v) => setTab(v as typeof tab)}
        tabs={[
          ['add', 'Questions', Shapes],
          ['outline', `Outline · ${count}`, ListTree],
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'add' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-1.5">
              {TYPE_GROUPS.flatMap((g) => g.types).map(([t, text]) => {
                const I = TYPE_INFO[t].icon;
                return (
                  <button key={t} type="button" title={text} onClick={() => onAdd(t)} className="flex aspect-square flex-col items-center justify-center gap-1 border border-zinc-200 bg-snow p-2.5 text-center hover:border-accent-600 hover:bg-accent-50">
                    <I className="size-5 shrink-0 text-accent-700" />
                    <span className="mt-1 text-[13px] leading-tight font-semibold text-ink">{TYPE_INFO[t].label}</span>
                    <span className="text-[11px] leading-snug text-zinc-500">{text}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={onAddSection} className="flex h-9 w-full items-center justify-center gap-2 border border-dashed border-zinc-300 bg-snow text-[13px] font-medium text-accent-700 hover:border-accent-600">
              <Plus className="size-4" /> Add a {noun}
            </button>
          </div>
        ) : (
          <ul className="text-[13px]">
            {def.sections.map((s, si) => {
              const open = !shut.has(si);
              return (
                <li key={si}>
                  <div className="flex items-center">
                    <button
                      type="button"
                      aria-label={open ? 'Collapse' : 'Expand'}
                      className="p-1.5 text-zinc-500"
                      onClick={() =>
                        setShut((x) => {
                          const n = new Set(x);
                          n.has(si) ? n.delete(si) : n.add(si);
                          return n;
                        })
                      }
                    >
                      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                    <button type="button" onClick={() => onSelect({ kind: 's', s: si })} className={cx('flex min-w-0 flex-1 items-center gap-2 py-1.5 text-start font-semibold', sel?.kind === 's' && sel.s === si && 'text-accent-800')}>
                      <span className="truncate">
                        {si + 1} · {s.title || 'Untitled'}
                      </span>
                      <span className="ms-auto pe-1 text-xs font-normal text-zinc-500">{s.questions.length}</span>
                    </button>
                  </div>
                  {open && (
                    <ul>
                      {s.questions.map((q, qi) => {
                        const I = TYPE_INFO[q.type].icon;
                        const on = sel?.kind === 'q' && sel.s === si && sel.q === qi;
                        return (
                          <li key={qi}>
                            <button type="button" onClick={() => onSelect({ kind: 'q', s: si, q: qi })} className={cx('flex w-full items-center gap-2 py-1.5 ps-8 pe-2 text-start', on ? 'bg-accent-50 font-medium text-accent-800' : 'text-zinc-600 hover:bg-zinc-100')}>
                              <I className="size-3.5 shrink-0 text-zinc-400" />
                              <span className="truncate">{q.label || q.key}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
            <li className="pt-3">
              <button type="button" onClick={onAddSection} className="flex h-8 w-full items-center justify-center gap-2 border border-dashed border-zinc-300 bg-snow text-[13px] font-medium text-accent-700 hover:border-accent-600">
                <Plus className="size-4" /> Add a {noun}
              </button>
              {paged && def.sections.length > 1 && <p className="mt-2 text-xs text-zinc-500">Each page is one step for the person filling the form.</p>}
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

/** "Add a question here": a dropdown of the kinds of question. */
function AddQuestionMenu({ onPick, label }: { onPick(t: QuestionType): void; label: string }) {
  return (
    <Listbox
      searchable
      label={label}
      placeholder={label}
      value={null}
      align="start"
      trigger={{
        className: 'inline-flex h-8 items-center gap-1.5 px-2 text-sm font-medium text-accent-700 hover:bg-accent-50',
        children: (
          <>
            <Plus className="size-4" /> {label}
          </>
        ),
      }}
      options={TYPE_GROUPS.flatMap((g) => g.types.map(([t, text]) => ({ value: t, label: TYPE_INFO[t].label, description: text, icon: TYPE_INFO[t].icon, text: `${TYPE_INFO[t].label} ${g.title} ${text}` })))}
      onChange={(t) => onPick(t as QuestionType)}
    />
  );
}

// ------------------------------------------------------------------ inspectors

function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange(v: T): void; tabs: [T, string, LucideIcon][] }) {
  return (
    <div role="tablist" className="flex shrink-0 border-b border-zinc-200">
      {tabs.map(([id, label, I]) => (
        <button key={id} role="tab" aria-selected={value === id} type="button" onClick={() => onChange(id)} className={cx('-mb-px flex flex-1 items-center justify-center gap-2 border-b-2 py-2.5 text-sm', value === id ? 'border-accent-600 font-semibold text-accent-800' : 'border-transparent text-zinc-600 hover:text-ink')}>
          <I className="size-4" /> {label}
        </button>
      ))}
    </div>
  );
}

/** How a question's width is named. */
const WIDTH_LABEL: Record<(typeof QUESTION_WIDTHS)[number], string> = { full: 'Full width', '1/2': 'Half', '1/3': 'One third', '2/3': 'Two thirds', '1/4': 'A quarter', '3/4': 'Three quarters' };

/** The kinds of question that have an empty answer box to put faint text in. */
const PLACEHOLDER_TYPES: QuestionType[] = ['text', 'textarea', 'integer', 'decimal', 'select', 'entity', 'qr', 'phone', 'email', 'url'];

/** The sizes of a code's groups, typed as "3, 4": what is typed stays as it is until the field is left, so a comma can be typed. */
function GroupSizes({ groups, onChange }: { groups: number[]; onChange(groups: number[]): void }) {
  const [text, setText] = useState(groups.join(', '));
  const parse = (t: string) => t.split(/[ ,]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12).slice(0, 8);
  return (
    <Input
      icon={Hash}
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const next = parse(e.target.value);
        if (next.length) onChange(next);
      }}
      onBlur={() => setText(groups.join(', '))}
    />
  );
}

/** Makes the answer a random code: a prefix, groups of random characters and what goes between them. */
function CodeFields({ q, set }: { q: Question; set(patch: Partial<Question>): void }) {
  const g = q.generate;
  const put = (patch: Partial<CodeGenerator>) => set({ generate: CodeGenerator.parse({ ...g, ...patch }) });
  return (
    <div className="space-y-3 border-t border-zinc-100 pt-4">
      <ToggleRow label="Make a random code" help="Filled in when the form opens, and not editable" checked={!!g} onChange={(v) => set({ generate: v ? CodeGenerator.parse({ groups: [3, 4], prefix: '' }) : undefined })} />
      {g && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prefix" intro="Fixed start, e.g. HR">
              <Input icon={Type} value={g.prefix} maxLength={20} onChange={(e) => put({ prefix: e.target.value })} />
            </Field>
            <Field label="Between groups" intro="e.g. - or _ ; blank for none">
              <Input icon={Minus} value={g.separator} maxLength={3} onChange={(e) => put({ separator: e.target.value })} />
            </Field>
          </div>
          <Field label="Group sizes" intro="Characters in each group, e.g. 3, 4">
            <GroupSizes groups={g.groups} onChange={(groups) => put({ groups })} />
          </Field>
          <Field label="Characters">
            <Listbox
              label="Characters"
              value={g.charset}
              options={[
                { value: 'alphanumeric', label: 'Letters and digits' },
                { value: 'clear', label: 'Letters and digits, without look-alikes (0, O, 1, I)' },
                { value: 'letters', label: 'Letters only' },
                { value: 'digits', label: 'Digits only' },
              ]}
              onChange={(charset) => put({ charset: charset as CodeGenerator['charset'] })}
            />
          </Field>
          <p className="text-xs text-zinc-500">Looks like {generateCode(g)}</p>
        </>
      )}
    </div>
  );
}

/** What the answer starts as, edited the way the answer itself is. */
function DefaultValueField({ q, set, formKey }: { q: Question; set(patch: Partial<Question>): void; formKey: string }) {
  const { tenantId, project } = useProject();
  const v = q.defaultValue;
  const put = (defaultValue: Question['defaultValue']) => set({ defaultValue });
  const options = (q.options ?? []).map((o) => ({ value: o.value, label: o.label }));
  let control: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
  switch (q.type) {
    case 'text':
    case 'textarea':
    case 'qr':
    case 'phone':
    case 'email':
    case 'url':
      control = <Input value={typeof v === 'string' ? v : ''} onChange={(e) => put(e.target.value || undefined)} />;
      break;
    case 'integer':
    case 'decimal':
    case 'rating':
      control = <Input type="number" value={typeof v === 'number' ? v : ''} onChange={(e) => put(e.target.value === '' ? undefined : Number(e.target.value))} />;
      break;
    case 'time':
      control = <Input type="time" value={typeof v === 'string' ? v : ''} onChange={(e) => put(e.target.value || undefined)} />;
      break;
    case 'date':
      control = <Input type="date" value={typeof v === 'string' ? v : ''} onChange={(e) => put(e.target.value || undefined)} />;
      break;
    case 'boolean':
      control = (
        <Listbox
          label="Default value"
          value={v === true ? 'true' : v === false ? 'false' : '__none'}
          options={[
            { value: '__none', label: 'No default' },
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ]}
          onChange={(x) => put(x === '__none' ? undefined : x === 'true')}
        />
      );
      break;
    case 'select':
      control = <Listbox label="Default value" placeholder="No default" value={typeof v === 'string' ? v : null} options={[{ value: '__none', label: 'No default' }, ...options]} onChange={(x) => put(x === '__none' ? undefined : x)} />;
      break;
    case 'multiselect':
      control = <Listbox label="Default value" placeholder="No default" value={null} values={Array.isArray(v) ? v : []} options={options} onChangeMany={(vs) => put(vs.length ? vs : undefined)} />;
      break;
    case 'signature':
    case 'image':
      // The picture is stored once, here, and kept as the question's value: a manager's signature or a stamp.
      if (q.multiple) return null;
      return (
        <Field label={q.type === 'signature' ? 'Signature' : 'Picture'} intro={q.hidden ? 'Kept with every submission, and used in documents and emails' : 'Filled in for everyone to start with; people can change it. Hide the question to keep it fixed'}>
          <FormEnv.Provider value={{ tenantId, project: project.key, formKey, subjectId: null, answers: {} }}>
            <div>{q.type === 'signature' ? <SignatureInput q={q} value={v ?? null} onChange={(x) => put(typeof x === 'string' ? x : undefined)} /> : <ImageInput q={q} value={v ?? null} onChange={(x) => put(typeof x === 'string' ? x : undefined)} />}</div>
          </FormEnv.Provider>
        </Field>
      );
    default:
      return null;
  }
  return (
    <Field label="Default value" intro="What the answer starts as; people can change it">
      {control}
    </Field>
  );
}

/** An on/off setting: the name and what it does on the left, the switch on the right. */
export function ToggleRow({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 text-sm leading-tight">
        <div className="font-medium text-zinc-700">{label}</div>
        <div className="mt-0.5 text-xs text-zinc-500">{help}</div>
      </div>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

/** "Visible to": everyone, project managers only, or a permission group and above. */
function AudienceField({ noun, value, onChange }: { noun: string; value: Audience | undefined; onChange(v: Audience | undefined): void }) {
  const groups = usePermissionGroups();
  return (
    <Field label="Visible to" intro={`Everyone else doesn’t see the ${noun}`}>
      <Listbox
        label="Visible to"
        searchable={(groups.data?.length ?? 0) > 8}
        value={value?.group ?? (value?.role === 'manager' ? '__managers' : '__any')}
        options={[
          { value: '__any', label: 'Everyone who fills it in', icon: Users },
          { value: '__managers', label: 'Project managers only', icon: Lock },
          ...(groups.data ?? []).map((g) => ({ value: g.id, label: `${'— '.repeat(g.depth)}${g.name} and above`, icon: Lock })),
        ]}
        onChange={(v) => onChange(v === '__any' ? undefined : v === '__managers' ? { role: 'manager' } : { group: v })}
      />
    </Field>
  );
}

function SectionInspector({ def, s, index, paged, stages, set }: { def: FormDefinition; s: Section; index: number; paged: boolean; stages: { id: string; name: string }[]; set(patch: Partial<Section>): void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-5 py-3.5">
        <span className="flex size-8 items-center justify-center bg-accent-600 text-on-accent">
          <Shapes className="size-4" />
        </span>
        <div>
          <div className="text-sm font-semibold">{paged ? `Page ${index + 1}` : `Section ${index + 1}`}</div>
          <div className="text-xs text-zinc-500">{s.questions.length} questions</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <Field label="Title" intro={paged ? 'Shown at the top of the page' : 'Shown above its questions'}>
          <Input icon={Type} value={s.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Questions per row" intro="The default width on a wide screen; each question can say otherwise. A phone always shows one">
          <div role="radiogroup" aria-label="Questions per row" className="inline-flex border border-zinc-300 text-sm">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={(s.columns ?? 1) === n} onClick={() => set({ columns: n === 1 ? undefined : n })} className={cx('min-w-12 px-3 py-1.5 font-medium', (s.columns ?? 1) === n ? 'bg-accent-600 text-on-accent' : 'bg-snow text-zinc-600 hover:bg-zinc-50')}>
                {n}
              </button>
            ))}
          </div>
        </Field>
        <div className="space-y-3">
          <ToggleRow label="Repeat" help={`People can fill this ${paged ? 'page' : 'section'} in several times, like one per household member`} checked={!!s.repeat} onChange={(v) => set({ repeat: v ? {} : undefined })} />
          {s.repeat && (
            <>
              <Field label="Name for each" intro="Used in “Add …” and on each block; Item when blank">
                <Input value={s.repeat.itemLabel ?? ''} placeholder="Item" onChange={(e) => set({ repeat: { ...s.repeat, itemLabel: e.target.value || undefined } })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="At least" intro="0 when blank">
                  <Input type="number" min={0} max={100} value={s.repeat.min ?? ''} onChange={(e) => set({ repeat: { ...s.repeat, min: e.target.value === '' ? undefined : Number(e.target.value) } })} />
                </Field>
                <Field label="At most" intro="100 when blank">
                  <Input type="number" min={1} max={100} value={s.repeat.max ?? ''} onChange={(e) => set({ repeat: { ...s.repeat, max: e.target.value === '' ? undefined : Number(e.target.value) } })} />
                </Field>
              </div>
              <p className="text-xs text-zinc-500">Questions in here can use each other and the rest of the form, but the rest of the form cannot use them. They can’t be saved to an entity.</p>
            </>
          )}
        </div>
        <ConditionBuilder def={def} value={s.relevant} onChange={(v) => set({ relevant: v })} noun={paged ? 'page' : 'section'} />
        <div className="space-y-3 border-t border-zinc-100 pt-4">
          <ToggleRow label="Hidden" help={`Its questions aren’t shown. Give them a formula or default value to fill them in`} checked={!!s.hidden} onChange={(v) => set({ hidden: v || undefined })} />
          <AudienceField noun={paged ? 'page' : 'section'} value={s.visibleTo} onChange={(visibleTo) => set({ visibleTo })} />
          <Field label="Filled in by" intro={s.fillAt ? 'Not in the applicant’s form: the approvers of this step fill it in when they approve' : 'The person filling in the form'}>
            <Select aria-label="Filled in by" value={s.fillAt ?? ''} onChange={(e) => set({ fillAt: e.target.value || undefined })}>
              <option value="">The applicant</option>
              {stages.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
              {s.fillAt && !stages.some((st) => st.id === s.fillAt) && <option value={s.fillAt}>{s.fillAt} (no longer in the workflow)</option>}
            </Select>
          </Field>
          {!stages.length && <p className="text-xs text-zinc-500">Add approval steps in the Workflow tab to have approvers fill in a part.</p>}
        </div>
      </div>
    </div>
  );
}

function QuestionInspector({ def, q, set, subjectTypeKey, columns, formKey }: { def: FormDefinition; q: Question; set(patch: Partial<Question>): void; subjectTypeKey: string | null; columns: number; formKey: string }) {
  const { tenantId, project } = useProject();
  const types = useTypes();
  const elements = useQuery({ queryKey: ['elements', tenantId, project.key], queryFn: () => api.elements(tenantId, project.key) });
  const subjectType = types.data?.find((t) => t.key === subjectTypeKey);
  const aboutProject = subjectTypeKey === PROJECT_SUBJECT;
  const placeQuestions = def.sections.flatMap((x) => x.questions).filter((x) => x.type === 'entity' && x.key !== q.key && !x.primary);
  const inRepeat = def.sections.some((x) => x.repeat && x.questions.some((y) => y.key === q.key));
  const canBind = !inRepeat && (!!subjectType || aboutProject || placeQuestions.length > 0 || !!def.creates) && q.type !== 'note' && q.type !== 'entity' && q.type !== 'image' && q.type !== 'file' && q.type !== 'signature';
  const [tab, setTab] = useState<'question' | 'logic' | 'data'>('question');
  const I = TYPE_INFO[q.type].icon;
  const hasLogic = !!(q.relevant || q.constraint);
  const keyError = !/^[a-z][a-z0-9_]*$/.test(q.key) || q.key.length > 63
    ? 'Use lowercase letters, digits and underscores, starting with a letter'
    : def.sections.flatMap((x) => x.questions).filter((x) => x.key === q.key).length > 1
      ? 'Another question already uses this key'
      : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-5 py-3.5">
        <span className="flex size-8 items-center justify-center bg-accent-600 text-on-accent">
          <I className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{q.label || 'Untitled'}</div>
          <div className="text-xs text-zinc-500">{TYPE_INFO[q.type].label}</div>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={(v) => setTab(v as typeof tab)}
        tabs={
          [
            ['question', 'Question', MessageSquare],
            ['logic', hasLogic ? 'Logic •' : 'Logic', GitBranch],
            ...(canBind ? [['data', q.bind ? 'Data •' : 'Data', Database]] : []),
          ] as [typeof tab, string, LucideIcon][]
        }
      />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {tab === 'question' && (
          <>
            <IconPicker label="Icon" intro="Shown before the question" value={q.icon} onChange={(icon) => set({ icon })} onClear={() => set({ icon: undefined })} />
            <div className="space-y-5">
              <Field label="Type" intro="What kind of answer">
                <Listbox
                  searchable
                  label="Type"
                  disabled={!!q.primary}
                  value={q.type}
                  options={QUESTION_TYPES.map((t) => ({ value: t, label: TYPE_INFO[t].label, icon: TYPE_INFO[t].icon }))}
                  onChange={(t) => set({ type: t })}
                />
              </Field>
              <Field label="Key" intro="Used in logic; must be unique" error={keyError}>
                <Input value={q.key} onChange={(e) => set({ key: e.target.value })} className="font-mono" />
              </Field>
            </div>
            <Field label="Question" required intro="What people read">
              <Textarea value={q.label} onChange={(e) => set({ label: e.target.value, ...(q.key.startsWith('question') ? { key: slug(e.target.value) } : {}) })} className="min-h-16" />
            </Field>
            <Field label="Help text" intro="A line under the question">
              <Input value={q.hint ?? ''} onChange={(e) => set({ hint: e.target.value || undefined })} />
            </Field>
            <Field label="Width" intro="On a wide screen. Questions fill each row left to right; a phone always shows one per row">
              <Listbox
                label="Width"
                value={q.width ?? '__default'}
                options={[{ value: '__default', label: `Same as the section (${WIDTH_LABEL[questionWidth({ type: q.type }, columns)].toLowerCase()})` }, ...QUESTION_WIDTHS.map((w) => ({ value: w, label: WIDTH_LABEL[w] }))]}
                onChange={(v) => set({ width: v === '__default' ? undefined : (v as (typeof QUESTION_WIDTHS)[number]) })}
              />
            </Field>
            {PLACEHOLDER_TYPES.includes(q.type) && (
              <Field label="Placeholder" intro="Faint text in the empty answer">
                <Input value={q.placeholder ?? ''} onChange={(e) => set({ placeholder: e.target.value || undefined })} />
              </Field>
            )}
            {q.type !== 'note' && q.type !== 'calculate' && !q.primary && <DefaultValueField q={q} set={set} formKey={formKey} />}
            {q.type !== 'note' && q.type !== 'calculate' && !q.primary && <ToggleRow label="Required" help="People must answer it before they can submit" checked={!!q.required} onChange={(v) => set({ required: v })} />}
            {(q.required || q.primary) && q.type !== 'note' && q.type !== 'calculate' && (
              <Field label="Message when empty" intro={`Leave blank for “${DEFAULT_REQUIRED_MESSAGE}”`}>
                <Input value={q.requiredMessage ?? ''} placeholder={DEFAULT_REQUIRED_MESSAGE} onChange={(e) => set({ requiredMessage: e.target.value || undefined })} />
              </Field>
            )}
            {q.type !== 'note' && q.type !== 'calculate' && !q.primary && (
              <ToggleRow label="Hidden" help="Not shown in the form. Its value comes from a formula or the default value" checked={!!q.hidden} onChange={(v) => set({ hidden: v || undefined })} />
            )}
            {q.hidden && q.type !== 'calculate' && !q.primary && (
              <ExprField label="Value" intro="A formula, e.g. if(${weight} > 50, 'heavy', 'light'). Or leave blank and set a default value" value={q.calculation} onChange={(v) => set({ calculation: v })} def={def} exclude={q.key} />
            )}
            {q.type !== 'note' && !q.primary && (
              <ToggleRow label="Don’t save the answer" help="Used while filling in (filters, formulas) but left out of the saved submission" checked={!!q.discard} onChange={(v) => set({ discard: v || undefined })} />
            )}
            {q.type === 'entity' && <PlaceFields def={def} q={q} set={set} subjectTypeKey={subjectTypeKey} />}
            {q.type === 'qr' && <p className="text-xs text-zinc-500">People scan with the camera where the browser allows it, or type the code.</p>}
            {q.type === 'file' && <p className="text-xs text-zinc-500">PDF, Word, Excel, PowerPoint, CSV or text files, up to 10 MB. They need a connection.</p>}
            {q.type === 'signature' && <p className="text-xs text-zinc-500">People sign with a finger, stylus or mouse. The signature is stored as a picture, so it needs a connection.</p>}
            {q.type === 'rating' && (
              <Field label="Number of stars" intro="3 to 10; 5 when blank">
                <Input type="number" min={3} max={10} value={q.max ?? ''} onChange={(e) => set({ max: e.target.value === '' ? undefined : Math.min(10, Math.max(3, Number(e.target.value))) })} />
              </Field>
            )}
            {(q.type === 'image' || q.type === 'file') && (
              <>
                <ToggleRow label={q.type === 'image' ? 'Allow several photos' : 'Allow several files'} help="People can add more than one" checked={!!q.multiple} onChange={(v) => set({ multiple: v || undefined, maxItems: v ? q.maxItems : undefined })} />
                {q.multiple && (
                  <Field label="Most they can add" intro="1 to 20; 10 when blank">
                    <Input type="number" min={1} max={20} value={q.maxItems ?? ''} onChange={(e) => set({ maxItems: e.target.value === '' ? undefined : Math.min(20, Math.max(1, Number(e.target.value))) })} />
                  </Field>
                )}
              </>
            )}
            {q.type === 'image' && <p className="text-xs text-zinc-500">Photos are taken with the camera or chosen from the device, and shrunk before they are sent. They need a connection.</p>}
            {(q.type === 'select' || q.type === 'multiselect') && <ChoicesEditor q={q} set={set} />}
            {(q.type === 'text' || q.type === 'textarea') && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Fewest characters" intro="Blank for no minimum">
                  <Input icon={ArrowDownToLine} type="number" min={0} value={q.minLength ?? ''} onChange={(e) => set({ minLength: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </Field>
                <Field label="Most characters" intro="Blank for no limit">
                  <Input icon={ArrowUpToLine} type="number" min={1} value={q.maxLength ?? ''} onChange={(e) => set({ maxLength: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </Field>
              </div>
            )}
            {q.type === 'textarea' && (
              <Field label="Lines tall" intro="2 to 30; the box grows as people type">
                <Input type="number" min={2} max={30} value={q.rows ?? ''} onChange={(e) => set({ rows: e.target.value === '' ? undefined : Math.min(30, Math.max(2, Number(e.target.value))) })} />
              </Field>
            )}
            {q.type === 'text' && <CodeFields q={q} set={set} />}
            {(q.type === 'integer' || q.type === 'decimal') && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Minimum" intro="Lowest allowed">
                  <Input icon={ArrowDown} type="number" value={q.min ?? ''} onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </Field>
                <Field label="Maximum" intro="Highest allowed">
                  <Input icon={ArrowUp} type="number" value={q.max ?? ''} onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </Field>
              </div>
            )}
          </>
        )}
        {tab === 'logic' && (
          <>
            {q.type !== 'note' && <AudienceField noun="question" value={q.visibleTo} onChange={(visibleTo) => set({ visibleTo })} />}
            <div className={cx(q.type !== 'note' && 'border-t border-zinc-100 pt-4')}>
              <ConditionBuilder def={def} value={q.relevant} onChange={(v) => set({ relevant: v })} exclude={q.key} noun="question" />
            </div>
            {q.type !== 'note' && q.type !== 'calculate' && (
              <div className="space-y-3 border-t border-zinc-100 pt-4">
                <ConditionBuilder
                  key={q.key}
                  def={def}
                  self={q}
                  value={q.constraint}
                  onChange={(v) => set({ constraint: v })}
                  title="Accept the answer only when"
                  help="Anything else is refused, with the message below"
                  empty="Any answer is accepted."
                />
                {q.constraint && (
                  <Field label="Message when it is not accepted" intro="Shown under the answer">
                    <Input icon={ShieldCheck} value={q.constraintMessage ?? ''} onChange={(e) => set({ constraintMessage: e.target.value || undefined })} />
                  </Field>
                )}
              </div>
            )}
            {q.type === 'calculate' && (
              <div className="border-t border-zinc-100 pt-4">
                <ExprField label="Calculation" intro="e.g. round(${weight} div (${height} * ${height}), 1)" value={q.calculation} onChange={(v) => set({ calculation: v })} def={def} exclude={q.key} />
              </div>
            )}
          </>
        )}
        {tab === 'data' && canBind && (
          <DataTab key={q.key} def={def} q={q} set={set} subjectType={subjectType} aboutProject={aboutProject} placeQuestions={placeQuestions} elements={elements.data ?? []} />
        )}
      </div>
    </div>
  );
}

const RELATION: Record<NonNullable<Question['filter']>['relation'] | 'any', string> = {
  any: 'Any entity of this type',
  children: 'Children of…',
  descendants: 'Anywhere under…',
  parent: 'The parent of…',
  ancestors: 'Anywhere above…',
};

/** A question that picks an entity: its type, and how it is limited by another entity. */
function PlaceFields({ def, q, set, subjectTypeKey }: { def: FormDefinition; q: Question; set(patch: Partial<Question>): void; subjectTypeKey: string | null }) {
  const types = useTypes();
  const about = !!subjectTypeKey && subjectTypeKey !== PROJECT_SUBJECT;
  const others = def.sections.flatMap((x) => x.questions).filter((x) => x.type === 'entity' && x.key !== q.key);
  const bases = [...(about ? [{ value: '$subject', label: 'The entity this form is about', icon: MapPinned }] : []), ...others.map((x) => ({ value: x.key, label: x.label || x.key, icon: MapPinned }))];
  const relation = q.filter?.relation ?? 'any';
  return (
    <div className="space-y-5 border-t border-zinc-100 pt-4">
      {q.primary ? (
        <p className="border-s-4 border-accent-600 bg-accent-50 px-3 py-2.5 text-xs text-accent-900">
          The entity this form is captured against. Every form has one, it is always required, and it can’t be removed. It chooses from {types.data?.find((t) => t.key === q.entityType)?.plural.toLowerCase() ?? 'its entity type'}.
        </p>
      ) : (
      <Field label="Entity type" required intro="What people choose from">
        <Listbox
          searchable
          label="Entity type"
          placeholder="Choose a type"
          value={q.entityType ?? null}
          options={(types.data ?? []).filter((t) => t.key !== PROJECT_SUBJECT).map((t) => ({ value: t.key, label: t.name, icon: iconOf(t.icon) }))}
          onChange={(entityType) => set({ entityType })}
        />
      </Field>
      )}
      <Field label="Which entities" intro="Offer all of them, or only those related to another entity">
        <Listbox
          label="Which entities"
          value={relation}
          options={Object.entries(RELATION).map(([value, label]) => ({ value: value as keyof typeof RELATION, label }))}
          onChange={(v) => set({ filter: v === 'any' ? undefined : { of: q.filter?.of ?? bases[0]?.value ?? '', relation: v as NonNullable<Question['filter']>['relation'] } })}
        />
      </Field>
      {q.filter && (
        <Field label="Related to" intro={bases.length ? 'The entity it is measured from' : 'Add another entity question, or make this a form about an entity'}>
          <Listbox label="Related to" placeholder="Choose" value={q.filter.of || null} options={bases} onChange={(of) => set({ filter: { ...q.filter!, of } })} />
        </Field>
      )}
    </div>
  );
}

/** Where an answer is saved: an attribute of a place, or an indicator value for it. */
function DataTab({
  def,
  q,
  set,
  subjectType,
  aboutProject,
  placeQuestions,
  elements,
}: {
  def: FormDefinition;
  q: Question;
  set(patch: Partial<Question>): void;
  subjectType: { name: string; attributes: { key: string; label: string }[] } | undefined;
  aboutProject: boolean;
  placeQuestions: Question[];
  elements: { key: string; ref: string; name: string; group: string; groupName: string }[];
}) {
  const types = useTypes();
  const here = subjectType || aboutProject;
  // The main entity question is "the entity this form is about", so a save aimed at it means the same.
  const saved = q.bind?.entity;
  // The choice is kept here too: with no attribute picked yet there is nothing saved to read it back from.
  const [picked, setPicked] = useState<string | null>(null);
  const known = (k: string | null | undefined) => !!k && (k === '$here' ? !!here : k === '$child' ? !!def.creates : placeQuestions.some((x) => x.key === k));
  const savedTarget = q.bind?.child ? '$child' : saved;
  const target = known(savedTarget) ? savedTarget! : known(picked) ? picked! : here ? '$here' : def.creates ? '$child' : (placeQuestions[0]?.key ?? '$here');
  const targetQuestion = placeQuestions.find((x) => x.key === target);
  const childType = def.creates ? types.data?.find((t) => t.key === def.creates!.type) : undefined;
  const attrs = target === '$child' ? (childType?.attributes ?? []) : target === '$here' ? (subjectType?.attributes ?? []) : (types.data?.find((t) => t.key === targetQuestion?.entityType)?.attributes ?? []);
  const targetName = target === '$child' ? (childType?.name ?? 'New entity') : target === '$here' ? (subjectType?.name ?? 'Entity') : (types.data?.find((t) => t.key === targetQuestion?.entityType)?.name ?? 'Entity');
  const bind = (patch: { attribute?: string | null; element?: string | null; entity?: string }) => {
    const to = patch.entity ?? target;
    const next = { ...q.bind, entity: to === '$here' || to === '$child' ? undefined : to, child: to === '$child' ? true : undefined, ...patch } as NonNullable<Question['bind']>;
    next.entity = to === '$here' || to === '$child' ? undefined : to;
    next.child = to === '$child' ? true : undefined;
    for (const k of ['attribute', 'element', 'entity', 'child'] as const) if (next[k] === null || next[k] === undefined) delete next[k];
    set({ bind: next.attribute || next.element ? next : undefined });
  };
  const [entityOn, setEntityOn] = useState(!!q.bind?.attribute);
  const [indicatorOn, setIndicatorOn] = useState(!!q.bind?.element);
  const [creating, setCreating] = useState(false);
  const canTarget = !!here || placeQuestions.length > 0 || !!def.creates;
  const turnEntity = (on: boolean) => {
    setEntityOn(on);
    if (on) return;
    const { attribute: _a, entity: _e, child: _c, ...rest } = q.bind ?? {};
    set({ bind: rest.element ? (rest as NonNullable<Question['bind']>) : undefined });
  };
  const turnIndicator = (on: boolean) => {
    setIndicatorOn(on);
    if (on) return;
    const { element: _el, ...rest } = q.bind ?? {};
    set({ bind: rest.attribute ? (rest as NonNullable<Question['bind']>) : undefined });
  };
  return (
    <>
      <p className="text-sm text-zinc-600">Where this answer goes besides the form’s own submissions. Use either, both, or neither. It is written once the submission is final.</p>
      <div className="space-y-4">
        <ToggleRow label="Save on an entity" help="Updates one of its attributes each time the form is sent" checked={entityOn} onChange={turnEntity} />
        {entityOn && (
          <div className="space-y-4">
            {!canTarget ? (
              <p className="text-xs text-zinc-500">This form has no entity to save to. Add an entity question first.</p>
            ) : (
              <>
                {(here ? 1 : 0) + placeQuestions.length + (def.creates ? 1 : 0) > 1 || !here ? (
                  <Field label="Save to" intro="Which entity receives the answer">
                    <Listbox
                      label="Save to"
                      value={target}
                      options={[...(def.creates ? [{ value: '$child', label: 'The new entity this form creates', description: childType?.name ?? 'Choose its kind first', icon: MapPinned }] : []), ...(here ? [{ value: '$here', label: 'The entity this form is about', description: subjectType?.name ?? 'This project', icon: MapPinned }] : []), ...placeQuestions.map((x) => ({ value: x.key, label: x.label || x.key, description: ['Chosen in this question', types.data?.find((t) => t.key === x.entityType)?.name].filter(Boolean).join(' · '), icon: MapPinned }))]}
                      onChange={(v) => (setPicked(v), bind({ entity: v, attribute: null }))}
                    />
                  </Field>
                ) : null}
                {attrs.length > 0 ? (
                  <Field label={`${targetName} attribute`} intro="The one this answer replaces">
                    <Listbox
                      searchable
                      label="Attribute"
                      placeholder="Choose an attribute"
                      value={q.bind?.attribute ?? null}
                      options={attrs.map((a) => ({ value: a.key, label: a.label }))}
                      onChange={(v) => bind({ attribute: v })}
                    />
                  </Field>
                ) : (
                  <p className="text-xs text-zinc-500">{targetName} has no attributes yet.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div className="space-y-4 border-t border-zinc-100 pt-4">
        <ToggleRow label="Record as an indicator" help="Stores the number against the reporting period" checked={indicatorOn} onChange={turnIndicator} />
        {indicatorOn && (
          <div className="space-y-2">
            {elements.length > 0 && (
              <Field label="Indicator" intro="Which one it counts toward">
                <Listbox
                  searchable
                  label="Indicator"
                  placeholder="Choose an indicator"
                  value={q.bind?.element ?? null}
                  options={elements.map((el) => ({ value: el.ref, label: el.name, description: `${el.key} · ${el.groupName}`, icon: Database }))}
                  onChange={(v) => bind({ element: v })}
                />
              </Field>
            )}
            {elements.length === 0 && <p className="text-xs text-zinc-500">This project has no indicators yet.</p>}
            <Button className="w-full" icon={Plus} onClick={() => setCreating(true)}>
              New indicator
            </Button>
            {creating && <NewIndicatorDialog q={q} taken={elements.map((e) => ({ group: e.group, key: e.key }))} onClose={() => setCreating(false)} onCreated={(ref) => (setCreating(false), bind({ element: ref }))} />}
          </div>
        )}
      </div>
      {!entityOn && !indicatorOn && <p className="text-xs text-zinc-500">As it is, this is an ordinary question: the answer stays with the submission only.</p>}
    </>
  );
}

/** Makes a new indicator (data element) from the question being designed, and links the question to it. */
function NewIndicatorDialog({ q, taken, onClose, onCreated }: { q: Question; taken: { group: string; key: string }[]; onClose(): void; onCreated(ref: string): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['data-groups', tenantId, project.key], queryFn: () => api.dataGroups(tenantId, project.key) });
  // What the question collects decides what a reading is.
  const valueType = q.type === 'boolean' ? 'boolean' : ['integer', 'decimal', 'rating', 'calculate'].includes(q.type) ? 'number' : 'text';
  const [f, setF] = useState<ElementDraft>({ group: DEFAULT_DATA_GROUP, key: freeKey(q.label, taken.filter((t) => t.group === DEFAULT_DATA_GROUP).map((t) => t.key)), name: q.label, description: '', valueType, unit: '', aggregation: valueType === 'text' ? 'count' : 'sum' });
  const save = useMutation({
    mutationFn: () => api.saveElement(tenantId, project.key, { ...f, name: f.name.trim() }),
    onSuccess: (data) => {
      qc.setQueryData(['elements', tenantId, project.key], data);
      onCreated(elementRef(f.group, f.key));
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="New indicator"
      description="What this question's answers are counted as, over time."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!f.name.trim() || !!keyProblem(f.key, taken.filter((t) => t.group === f.group).map((t) => t.key))} onClick={() => save.mutate()}>
            Create and link
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error} />
        <ElementForm value={f} onChange={setF} taken={taken} groups={groups.data ?? []} autoKey typeLocked lockedBecause="Set by the question, so the readings match what people answer." />
      </div>
    </Dialog>
  );
}

function ChoicesEditor({ q, set }: { q: Question; set(patch: Partial<Question>): void }) {
  const options = q.options ?? [];
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const update = (next: typeof options) => set({ options: next });
  const focus = (i: number) => setTimeout(() => refs.current[i]?.focus(), 0);
  const unique = (label: string, taken: string[]) => {
    let value = slug(label) || 'option';
    for (let n = 2; taken.includes(value); n++) value = `${slug(label)}_${n}`;
    return value;
  };
  return (
    <div>
      <div className="mb-1 text-[13px] font-medium text-zinc-700">Choices</div>
      <p className="mb-1.5 text-xs text-zinc-500">The label people read, and the value saved</p>
      <ol className="space-y-1.5">
        {options.map((o, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <Input
              ref={(el: HTMLInputElement | null) => void (refs.current[i] = el)}
              icon={q.type === 'select' ? CircleDot : ListChecks}
              aria-label={`Choice ${i + 1} label`}
              placeholder="Label"
              value={o.label}
              className="h-8 min-w-0 flex-1"
              onChange={(e) => {
                const label = e.target.value;
                const auto = o.value === slug(o.label) || /^option_\d+$/.test(o.value) || o.value.length === 1;
                update(options.map((x, j) => (j === i ? { label, value: auto ? unique(label, options.filter((_, k) => k !== i).map((z) => z.value)) : x.value } : x)));
              }}
              onPaste={(e) => {
                const lines = e.clipboardData.getData('text').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
                if (lines.length < 2) return;
                e.preventDefault();
                const taken = options.map((x) => x.value);
                const added = lines.map((label) => {
                  const value = unique(label, taken);
                  taken.push(value);
                  return { label, value };
                });
                update([...options.slice(0, i), ...added, ...options.slice(i + 1)]);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const value = unique('option', options.map((x) => x.value));
                  update([...options.slice(0, i + 1), { value, label: '' }, ...options.slice(i + 1)]);
                  focus(i + 1);
                } else if (e.key === 'Backspace' && !o.label && options.length > 2) {
                  e.preventDefault();
                  update(options.filter((_, j) => j !== i));
                  focus(Math.max(0, i - 1));
                }
              }}
            />
            <Input aria-label={`Choice ${i + 1} value`} value={o.value} onChange={(e) => update(options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className={cx('h-8 w-28', mono, 'text-xs')} />
            <IconBtn label="Remove choice" icon={Trash2} danger onClick={() => update(options.filter((_, j) => j !== i))} disabled={options.length <= 2} />
          </li>
        ))}
      </ol>
      <div className="mt-2 flex items-center gap-4 text-[13px]">
        <button
          type="button"
          onClick={() => {
            update([...options, { value: unique('option', options.map((x) => x.value)), label: '' }]);
            focus(options.length);
          }}
          className="inline-flex items-center gap-1.5 font-medium text-accent-700 hover:underline"
        >
          <Plus className="size-3.5" /> Add a choice
        </button>
        <span className="text-zinc-500">or paste a list into any label</span>
      </div>
    </div>
  );
}
