import { z } from 'zod';
import { Key } from './common.js';

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

export const FormDefinition = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).default(''),
  sections: z.array(Section).min(1).max(50),
  /** Period the observations are recorded for (aligned to the collection date). */
  period: z.enum(['none', 'day', 'week', 'month']).default('none'),
});
export type FormDefinition = z.infer<typeof FormDefinition>;
export type FormDefinitionInput = z.input<typeof FormDefinition>;

export const FormInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  subjectType: Key.nullable().default(null),
  definition: FormDefinition,
});
export type FormInput = z.input<typeof FormInput>;

export const FormDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  subjectType: z.object({ key: z.string(), name: z.string() }).nullable(),
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

export const SubmissionDto = z.object({
  id: z.string(),
  formId: z.string(),
  formName: z.string(),
  version: z.number().int(),
  entity: z.object({ id: z.string(), name: z.string() }).nullable(),
  answers: z.record(z.string(), z.unknown()),
  submittedBy: z.string().nullable(),
  collectedAt: z.string(),
  submittedAt: z.string(),
});
export type SubmissionDto = z.infer<typeof SubmissionDto>;
