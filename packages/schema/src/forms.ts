import { z } from 'zod';
import { Key } from './common.js';
import { ProjectRole } from './projects.js';

// ---------------------------------------------------------------- forms (M6, ADR 0006)
// Declarative definitions; expressions use the @grids/forms language
// (e.g. `${age} >= 18 and selected(${symptoms}, 'fever')`).

export const QUESTION_TYPES = [
  'text',
  'textarea',
  'integer',
  'decimal',
  'select',
  'multiselect',
  'boolean',
  'date',
  'datetime',
  'geopoint',
  'note',
  'calculate',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

const Expr = z.string().trim().max(1000);
export const Choice = z.object({ value: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(200) });

export const Question = z.object({
  key: Key,
  type: z.enum(QUESTION_TYPES),
  label: z.string().trim().max(300),
  hint: z.string().trim().max(500).optional(),
  required: z.boolean().optional(),
  options: z.array(Choice).max(200).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  /** Shown only when true. */
  relevant: Expr.optional(),
  /** Must be true for the answer to be accepted (`.` = this answer). */
  constraint: Expr.optional(),
  constraintMessage: z.string().max(200).optional(),
  /** For `calculate` questions, and defaults. */
  calculation: Expr.optional(),
  /** Writes the answer onto the subject entity, or as an observation. */
  bind: z
    .object({ attribute: Key.optional(), element: Key.optional() })
    .optional(),
});
export type Question = z.infer<typeof Question>;

export const Section = z.object({
  key: Key,
  title: z.string().trim().max(200),
  relevant: Expr.optional(),
  questions: z.array(Question).max(200),
});
export type Section = z.infer<typeof Section>;

export const FORM_LAYOUTS = ['single', 'steps', 'focus'] as const;
export type FormLayout = (typeof FORM_LAYOUTS)[number];
export const FORM_LAYOUT_INFO: Record<FormLayout, { label: string; description: string }> = {
  single: { label: 'One page', description: 'Every section on one scrolling page — quick, short forms.' },
  steps: { label: 'Multi-step', description: 'Each section becomes a page with a progress stepper; pages are checked before moving on.' },
  focus: { label: 'One at a time', description: 'A single question per screen — great on phones and for long surveys.' },
};

export const FormDefinition = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).default(''),
  sections: z.array(Section).min(1).max(50),
  /** Period the observations are recorded for (aligned to the collection date). */
  period: z.enum(['none', 'day', 'week', 'month']).default('none'),
  /**
   * How the form is presented: `single` – one scrolling page; `steps` – each
   * section is a page with a progress stepper; `focus` – one question at a time.
   */
  layout: z.enum(FORM_LAYOUTS).default('single'),
  /** Shown after a successful submission. */
  thankYou: z.string().trim().max(500).default(''),
  /**
   * Translations by language. Keys: `title`, `description`, `thankYou`,
   * `section.<key>`, `<question>.label`, `<question>.hint`,
   * `<question>.constraintMessage`, `<question>.option.<value>`. Missing keys
   * fall back to the form's own text.
   */
  translations: z.record(z.string().regex(/^[a-z]{2,3}$/), z.record(z.string().max(200), z.string().max(2000))).default({}),
});
export type FormDefinition = z.infer<typeof FormDefinition>;

/** The translatable texts of a form, keyed as in `translations`, with the source text. */
export function formTexts(def: FormDefinition): [string, string][] {
  const out: [string, string][] = [['title', def.title]];
  if (def.description) out.push(['description', def.description]);
  if (def.thankYou) out.push(['thankYou', def.thankYou]);
  for (const s of def.sections) {
    if (s.title) out.push([`section.${s.key}`, s.title]);
    for (const q of s.questions) {
      if (q.label) out.push([`${q.key}.label`, q.label]);
      if (q.hint) out.push([`${q.key}.hint`, q.hint]);
      if (q.constraintMessage) out.push([`${q.key}.constraintMessage`, q.constraintMessage]);
      for (const o of q.options ?? []) out.push([`${q.key}.option.${o.value}`, o.label]);
    }
  }
  return out;
}

/** The form in another language: translated texts replace the originals where present. */
export function localizeForm(def: FormDefinition, locale: string | null | undefined): FormDefinition {
  const tr = locale ? def.translations[locale] : undefined;
  if (!tr || !Object.keys(tr).length) return def;
  const t = (key: string, fallback: string) => tr[key]?.trim() || fallback;
  return {
    ...def,
    title: t('title', def.title),
    description: t('description', def.description),
    thankYou: t('thankYou', def.thankYou),
    sections: def.sections.map((s) => ({
      ...s,
      title: t(`section.${s.key}`, s.title),
      questions: s.questions.map((q) => ({
        ...q,
        label: t(`${q.key}.label`, q.label),
        ...(q.hint && { hint: t(`${q.key}.hint`, q.hint) }),
        ...(q.constraintMessage && { constraintMessage: t(`${q.key}.constraintMessage`, q.constraintMessage) }),
        ...(q.options && { options: q.options.map((o) => ({ ...o, label: t(`${q.key}.option.${o.value}`, o.label) })) }),
      })),
    })),
  };
}
export type FormDefinitionInput = z.input<typeof FormDefinition>;

// ---------------------------------------------------------------- access & approval workflow

/** Who matches: anyone named in `users`, or anyone with at least `role` who is in `group` (either may be omitted). */
export const ApproverRule = z.object({
  role: ProjectRole.nullable().default(null),
  group: Key.nullable().default(null),
  users: z.array(z.uuid()).max(50).default([]),
});
export type ApproverRule = z.infer<typeof ApproverRule>;

export const WorkflowStage = z.object({
  key: Key,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(''),
  approvers: ApproverRule.default({ role: 'manager', group: null, users: [] }),
  /** The stage only applies when this expression over the answers is true (e.g. `${cases} > 10`). */
  condition: Expr.default(''),
  /** Reviewers may send the submission back to its author for changes. */
  allowReturn: z.boolean().default(true),
});
export type WorkflowStage = z.infer<typeof WorkflowStage>;

export const FormSettings = z.object({
  /** Who may fill the form in: at least this project role… */
  fillRole: ProjectRole.default('editor'),
  /** …and, when set, a member of this permission group (or one above it). */
  fillGroup: Key.nullable().default(null),
  workflow: z
    .object({
      enabled: z.boolean().default(false),
      stages: z.array(WorkflowStage).max(10).default([]),
      /** Lets the author approve their own submission (off: segregation of duties). */
      allowSelfApproval: z.boolean().default(false),
    })
    .default({ enabled: false, stages: [], allowSelfApproval: false }),
});
export type FormSettings = z.infer<typeof FormSettings>;
export type FormSettingsInput = z.input<typeof FormSettings>;

export const FormInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  subjectType: Key.nullable().default(null),
  /** Where the form appears in the organisation's Forms menu. */
  groupId: z.uuid().nullable().default(null),
  settings: FormSettings.default(FormSettings.parse({})),
  definition: FormDefinition,
});
export type FormInput = z.input<typeof FormInput>;

export const FormDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  subjectType: z.object({ key: z.string(), name: z.string() }).nullable(),
  groupId: z.string().nullable(),
  settings: FormSettings,
  /** Whether the caller may fill it in. */
  canFill: z.boolean(),
  draft: FormDefinition,
  currentVersion: z.number().int().nullable(),
  published: FormDefinition.nullable(),
  hasUnpublishedChanges: z.boolean(),
  submissionCount: z.number().int(),
  lastSubmissionAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type FormDto = z.infer<typeof FormDto>;

export const SubmissionInput = z.object({
  /** Client-generated UUIDv7: resubmitting the same id is a no-op (offline retries). */
  id: z.uuid(),
  version: z.number().int(),
  entityId: z.uuid().nullable().default(null),
  answers: z.record(z.string(), z.unknown()),
  collectedAt: z.iso.datetime({ offset: true }),
  location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).nullable().default(null),
});
export type SubmissionInput = z.input<typeof SubmissionInput>;

export const SUBMISSION_STATUSES = ['complete', 'in_review', 'approved', 'rejected', 'returned'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export const REVIEW_DECISIONS = ['approve', 'reject', 'return'] as const;

export const ReviewInput = z.object({
  decision: z.enum(REVIEW_DECISIONS),
  comment: z.string().trim().max(2000).default(''),
});
export type ReviewInput = z.input<typeof ReviewInput>;

/** Answers re-sent by the author after a submission was returned for changes. */
export const ResubmitInput = z.object({
  answers: z.record(z.string(), z.unknown()),
  comment: z.string().trim().max(2000).default(''),
});
export type ResubmitInput = z.input<typeof ResubmitInput>;

export const ReviewDto = z.object({
  stage: z.number().int().nullable(),
  stageName: z.string().nullable(),
  decision: z.enum(['submitted', 'resubmitted', 'approved', 'rejected', 'returned']),
  comment: z.string(),
  actor: z.string().nullable(),
  at: z.string(),
});
export type ReviewDto = z.infer<typeof ReviewDto>;

export const SubmissionDto = z.object({
  id: z.string(),
  formId: z.string(),
  formKey: z.string(),
  formName: z.string(),
  project: z.object({ key: z.string(), name: z.string() }),
  status: z.enum(SUBMISSION_STATUSES),
  /** Index of the current approval stage while in review. */
  stage: z.number().int().nullable(),
  stageName: z.string().nullable(),
  /** Stage names in order, for progress display (empty without a workflow). */
  stages: z.array(z.string()),
  reviews: z.array(ReviewDto),
  canReview: z.boolean(),
  canResubmit: z.boolean(),
  version: z.number().int(),
  entity: z.object({ id: z.string(), name: z.string() }).nullable(),
  answers: z.record(z.string(), z.unknown()),
  submittedBy: z.string().nullable(),
  submittedById: z.string().nullable(),
  collectedAt: z.string(),
  submittedAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type SubmissionDto = z.infer<typeof SubmissionDto>;

// ---------------------------------------------------------------- the Forms menu

export const FormGroupInput = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.uuid().nullable().default(null),
  icon: z.string().trim().max(40).default('folder'),
  sort: z.number().int().default(0),
});
export type FormGroupInput = z.input<typeof FormGroupInput>;

export const FormGroupDto = z.object({
  id: z.string(),
  /** The project the group belongs to (null = an older organisation-wide group). */
  projectId: z.string().nullable(),
  parentId: z.string().nullable(),
  name: z.string(),
  icon: z.string(),
  sort: z.number().int(),
  formCount: z.number().int(),
});
export type FormGroupDto = z.infer<typeof FormGroupDto>;

export const MenuForm = z.object({
  project: z.object({ id: z.string(), key: z.string(), name: z.string() }),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  groupId: z.string().nullable(),
  layout: z.enum(FORM_LAYOUTS),
  questionCount: z.number().int(),
  hasWorkflow: z.boolean(),
});
export type MenuForm = z.infer<typeof MenuForm>;

export const FormsMenuDto = z.object({ groups: z.array(FormGroupDto), forms: z.array(MenuForm) });
export type FormsMenuDto = z.infer<typeof FormsMenuDto>;

/** The caller's review queue and their own submissions that are in a workflow. */
export const InboxDto = z.object({ toReview: z.array(SubmissionDto), mine: z.array(SubmissionDto) });
export type InboxDto = z.infer<typeof InboxDto>;
