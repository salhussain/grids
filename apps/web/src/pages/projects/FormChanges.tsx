import type { FormDefinition } from '@grids/schema';
import { Button, Dialog, confirmDialog } from '@grids/ui';
import { Minus, PencilLine, Plus, Undo2 } from 'lucide-react';

export type Entry = { kind: 'added' | 'removed' | 'changed'; where: string; what: string };

const NAMES: Record<string, string> = {
  label: 'Label',
  hint: 'Help text',
  placeholder: 'Placeholder',
  required: 'Required',
  type: 'Type',
  options: 'Choices',
  defaultValue: 'Starting answer',
  relevant: 'Show condition',
  title: 'Title',
  description: 'Description',
  layout: 'Layout',
  period: 'Period',
  thankYou: 'Thank-you message',
  look: 'Look',
  columns: 'Columns',
  hidden: 'Hidden',
  repeat: 'Repeating',
  width: 'Width',
  icon: 'Icon',
};
const nameOf = (k: string) =>
  NAMES[k] ??
  k
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const show = (v: unknown): string | null =>
  v === undefined || v === null || v === ''
    ? 'empty'
    : typeof v === 'string'
      ? `“${v.length > 60 ? `${v.slice(0, 57)}…` : v}”`
      : typeof v === 'number' || typeof v === 'boolean'
        ? String(v)
        : null;

/** The properties of an object that differ, as "Label: “A” → “B”" (long values only say they changed). */
function propChanges(
  now: Record<string, unknown>,
  before: Record<string, unknown>,
  skip: string[],
): string[] {
  const keys = new Set([...Object.keys(now), ...Object.keys(before)]);
  const out: string[] = [];
  for (const k of keys) {
    if (skip.includes(k) || same(now[k], before[k])) continue;
    const a = show(before[k]);
    const b = show(now[k]);
    out.push(a !== null && b !== null ? `${nameOf(k)}: ${a} → ${b}` : `${nameOf(k)} changed`);
  }
  return out;
}

/** What differs between the draft and the published version, in plain words. */
export function diffDefinition(now: FormDefinition, before: FormDefinition): Entry[] {
  const out: Entry[] = [];
  for (const line of propChanges(now as never, before as never, ['sections']))
    out.push({ kind: 'changed', where: 'The form', what: line });
  const orderOf = (d: FormDefinition) => d.sections.map((x) => x.key).join('|');
  if (orderOf(now) !== orderOf(before) && now.sections.length === before.sections.length)
    out.push({ kind: 'changed', where: 'Sections', what: 'The order of the sections' });
  for (const sec of now.sections) {
    const was = before.sections.find((x) => x.key === sec.key);
    if (!was) continue;
    const a = sec.questions.map((x) => x.key);
    const b = was.questions.map((x) => x.key);
    const common = a.filter((k) => b.includes(k));
    if (common.join('|') !== b.filter((k) => a.includes(k)).join('|'))
      out.push({
        kind: 'changed',
        where: `Section “${sec.title || sec.key}”`,
        what: 'The order of the questions',
      });
  }
  const secNow = new Map(now.sections.map((s) => [s.key, s]));
  const secBefore = new Map(before.sections.map((s) => [s.key, s]));
  for (const s of now.sections)
    if (!secBefore.has(s.key))
      out.push({ kind: 'added', where: 'Sections', what: `Section “${s.title || s.key}”` });
  for (const s of before.sections)
    if (!secNow.has(s.key))
      out.push({ kind: 'removed', where: 'Sections', what: `Section “${s.title || s.key}”` });
  for (const s of now.sections) {
    const o = secBefore.get(s.key);
    if (!o) continue;
    for (const line of propChanges(s as never, o as never, ['questions', 'key']))
      out.push({ kind: 'changed', where: `Section “${s.title || s.key}”`, what: line });
  }
  const qNow = new Map(
    now.sections.flatMap((s) => s.questions.map((q) => [q.key, { q, s }] as const)),
  );
  const qBefore = new Map(
    before.sections.flatMap((s) => s.questions.map((q) => [q.key, { q, s }] as const)),
  );
  for (const [k, { q, s }] of qNow)
    if (!qBefore.has(k))
      out.push({
        kind: 'added',
        where: `Section “${s.title || s.key}”`,
        what: `Question “${q.label || k}”`,
      });
  for (const [k, { q, s }] of qBefore)
    if (!qNow.has(k))
      out.push({
        kind: 'removed',
        where: `Section “${s.title || s.key}”`,
        what: `Question “${q.label || k}”`,
      });
  for (const [k, { q, s }] of qNow) {
    const o = qBefore.get(k);
    if (!o) continue;
    const where = `Section “${s.title || s.key}” › “${q.label || k}”`;
    if (o.s.key !== s.key)
      out.push({ kind: 'changed', where, what: `Moved from “${o.s.title || o.s.key}”` });
    for (const line of propChanges(q as never, o.q as never, ['key']))
      out.push({ kind: 'changed', where, what: line });
  }
  // Whatever else made the two differ is still reported, so the badge is never unexplained.
  if (!out.length && JSON.stringify(now) !== JSON.stringify(before))
    out.push({ kind: 'changed', where: 'The form', what: 'Other changes to the questions' });
  return out;
}

const SETTING_NAMES: Record<string, string> = {
  fillGroup: 'Who can fill it in',
  seeAnswers: 'Who sees the answers',
  workflow: 'Workflow',
  availability: 'Availability',
  limits: 'Limits',
  documents: 'Documents',
  documentDraft: 'Document changes waiting',
  work: 'Work opened for each submission',
  record: 'Submission record',
  publicAccess: 'Public access',
  submissionsPage: 'Submissions page',
};
const nice = (k: string) => SETTING_NAMES[k] ?? nameOf(k);

/** What differs between two sets of form settings, one line for each setting that changed. */
export function diffSettings(now: unknown, before: unknown, path: string[] = []): Entry[] {
  const a = (now ?? null) as Record<string, unknown> | null;
  const b = (before ?? null) as Record<string, unknown> | null;
  const plain = (v: unknown) => v === null || typeof v !== 'object';
  if (plain(a) || plain(b) || Array.isArray(a) || Array.isArray(b)) {
    if (same(a, b)) return [];
    const where = path.length ? path.map(nice).join(' › ') : 'Settings';
    if (Array.isArray(a) && Array.isArray(b))
      return [
        {
          kind: 'changed',
          where: path.slice(0, 1).map(nice).join(''),
          what: `${path.slice(1).map(nice).join(' › ') || nice(path[0] ?? '')}: ${b.length} → ${a.length} items`,
        },
      ];
    const x = show(b);
    const y = show(a);
    return [
      {
        kind: 'changed',
        where: path.slice(0, 1).map(nice).join('') || 'Settings',
        what:
          x !== null && y !== null
            ? `${path.slice(1).map(nice).join(' › ') || where}: ${x} → ${y}`
            : `${path.slice(1).map(nice).join(' › ') || where} changed`,
      },
    ];
  }
  const keys = new Set([...Object.keys(a!), ...Object.keys(b!)]);
  return [...keys].flatMap((k) =>
    same(a![k], b![k]) ? [] : diffSettings(a![k], b![k], [...path, k]),
  );
}

const ICON = { added: Plus, removed: Minus, changed: PencilLine };
const TONE = { added: 'text-emerald-700', removed: 'text-red-700', changed: 'text-amber-700' };

/** The changes made to a form since it was last published. */
export function ChangesDialog({
  now,
  published,
  version,
  settings,
  onDiscard,
  onClose,
}: {
  now: FormDefinition;
  published: FormDefinition | null;
  version: number | null;
  /** Settings and details as they are being edited, and as last saved. */
  settings: Entry[];
  onDiscard(): void;
  onClose(): void;
}) {
  const list = published ? diffDefinition(now, published) : [];
  const rows = (entries: Entry[]) => (
    <ul className="divide-y divide-zinc-100 border border-zinc-200">
      {entries.map((e, i) => {
        const Icon = ICON[e.kind];
        return (
          <li key={i} className="flex items-start gap-3 px-4 py-2.5">
            <Icon className={`mt-0.5 size-4 shrink-0 ${TONE[e.kind]}`} aria-label={e.kind} />
            <div className="min-w-0 text-sm">
              <div>{e.what}</div>
              <div className="truncate text-xs text-zinc-500">
                {e.kind === 'added' ? 'Added' : e.kind === 'removed' ? 'Removed' : 'Changed'} ·{' '}
                {e.where}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Unpublished changes"
      description={
        version
          ? `Compared with version ${version}, the one people see now.`
          : 'Compared with the published version.'
      }
      footer={
        list.length > 0 ? (
          <Button
            variant="danger"
            icon={Undo2}
            onClick={async () => {
              if (
                await confirmDialog(
                  `Discard ${list.length} ${list.length === 1 ? 'change' : 'changes'} to the questions and wording? The draft goes back to ${version ? `version ${version}` : 'the published version'}, and these edits are lost. Settings are not affected.`,
                  { confirmLabel: 'Discard changes', danger: true },
                )
              ) {
                onDiscard();
                onClose();
              }
            }}
          >
            Discard changes
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-5">
        {list.length > 0 && (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
              Questions and wording
            </h3>
            {rows(list)}
          </section>
        )}
        {settings.length > 0 && (
          <section>
            <h3 className="mb-1 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
              Settings and details
            </h3>
            <p className="mb-2 text-xs text-zinc-500">
              Not part of a published version. They apply as soon as they are saved, which happens a
              moment after you stop editing.
            </p>
            {rows(settings)}
          </section>
        )}
        {!list.length && !settings.length && (
          <p className="py-6 text-center text-sm text-zinc-500">
            Nothing differs from the published version.
          </p>
        )}
      </div>
    </Dialog>
  );
}
