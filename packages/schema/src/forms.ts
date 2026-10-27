import { z } from 'zod';
import { ElementRef, Key } from './common.js';
import { ProjectRole } from './projects.js';
import { DEFAULT_FORM_WORK, FormWork } from './work.js';
import { DEFAULT_FORM_PAYMENT, FormPayment } from './platform/payments.js';

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);

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
  /** A time of day, `HH:MM`. */
  'time',
  'geopoint',
  /** Short text that must look like a phone number, an email address or a web address. */
  'phone',
  'email',
  'url',
  /** A whole number from 1 to `max` (5 when not set), shown as stars. */
  'rating',
  /** A code read from a QR code or barcode (or typed). */
  'qr',
  /** A photo, taken with the camera or uploaded. The answer is the id of the stored picture. */
  'image',
  /** A document (PDF, Office file, CSV or text). The answer is the id of the stored file. */
  'file',
  /** A signature drawn on the screen. The answer is the id of the stored picture. */
  'signature',
  /** A place of one entity type, picked from the project. The answer is the entity's id. */
  'entity',
  'note',
  'calculate',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Fractions of a row a question can take, on a wide screen (a 12-part grid underneath). */
export const QUESTION_WIDTHS = ['full', '1/2', '1/3', '2/3', '1/4', '3/4'] as const;
export type QuestionWidth = (typeof QUESTION_WIDTHS)[number];
/** What a section's `columns` means for the questions that do not say: 1 → full, 2 → half, 3 → a third, 4 → a quarter. */
export const widthOfColumns = (columns: number | undefined): QuestionWidth => (columns === 2 ? '1/2' : columns === 3 ? '1/3' : columns === 4 ? '1/4' : 'full');
/** The width a question ends up with. */
export const questionWidth = (q: { type: string; width?: QuestionWidth | undefined }, columns: number | undefined): QuestionWidth => q.width ?? (q.type === 'note' ? 'full' : widthOfColumns(columns));

const Expr = z.string().trim().max(1000);
export const Choice = z.object({ value: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(200) });

/** Who a question or section is for: at least this project role and/or in this permission group. */
export const Audience = z.object({ role: ProjectRole.optional(), group: z.uuid().optional() });
export type Audience = z.infer<typeof Audience>;

/** A random code made when the form opens: the prefix and groups of random characters, joined by the separator (`HR`, 3, 4 and `-` give HR-K7M-2QX9). */
export const CodeGenerator = z.object({
  prefix: z.string().trim().max(20).default(''),
  /** The size of each group of random characters. */
  groups: z.array(z.number().int().min(1).max(12)).min(1).max(8).default([6]),
  separator: z.string().max(3).default('-'),
  charset: z.enum(['alphanumeric', 'letters', 'digits', 'clear']).default('alphanumeric'),
});
export type CodeGenerator = z.infer<typeof CodeGenerator>;

export const Question = z.object({
  key: Key,
  type: z.enum(QUESTION_TYPES),
  label: z.string().trim().max(300),
  hint: z.string().trim().max(500).optional(),
  /** Faint text inside the empty answer box (and the empty choice of a list). */
  placeholder: z.string().trim().max(200).optional(),
  /** What the answer starts as when the form opens; the person can change it. For a hidden question it is the fixed value. */
  defaultValue: z.union([z.string().max(1000), z.number(), z.boolean(), z.array(z.string().max(80)).max(200)]).optional(),
  required: z.boolean().optional(),
  /** Shown when a required question is left empty; the form's own wording ("This is a required field") when absent. */
  requiredMessage: z.string().trim().max(200).optional(),
  options: z.array(Choice).max(200).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  /** Text and long text: the fewest and most characters allowed. */
  minLength: z.number().int().min(0).max(10000).optional(),
  maxLength: z.number().int().min(1).max(10000).optional(),
  /** Long text: how many lines tall the box is. */
  rows: z.number().int().min(2).max(30).optional(),
  /** Text: the answer is a random code made when the form opens, and cannot be typed over. */
  generate: CodeGenerator.optional(),
  /** Photos and files: allow several. The answer is then a list of ids, at most `maxItems` (10 when absent). */
  multiple: z.boolean().optional(),
  maxItems: z.number().int().min(1).max(20).optional(),
  /** On a wide screen, how much of the row the question takes; questions flow into rows. Absent: the section's default (a note takes the full row). */
  width: z.enum(QUESTION_WIDTHS).optional(),
  /** A small picture before the question (the name of one of the app's icons). */
  icon: z.string().trim().max(40).optional(),
  /** Shown only when true. */
  relevant: Expr.optional(),
  /** Must be true for the answer to be accepted (`.` = this answer). */
  constraint: Expr.optional(),
  constraintMessage: z.string().max(200).optional(),
  /** For `calculate` questions, and defaults. */
  calculation: Expr.optional(),
  /** Part of the form but never shown; the value comes from `calculation`, and the person filling in is not asked for it. */
  hidden: z.boolean().optional(),
  /** Shown only to people with at least this project role and/or in this permission group; for everyone else the question is not there. */
  visibleTo: Audience.optional(),
  /** Used while filling in (shown, filters, calculations) but not kept with the submission, e.g. a district picked only to narrow the facility list. */
  discard: z.boolean().optional(),
  /** `entity` questions: the type of place to choose from. */
  entityType: Key.optional(),
  /** `entity` questions: only offer places related to the form's main place (`$subject`) or to the answer of another entity question. */
  filter: z.object({ of: z.string().min(1).max(80), relation: z.enum(['children', 'descendants', 'parent', 'ancestors']) }).optional(),
  /** `entity` questions: this answer is the place the whole submission is about (instead of choosing it above the form). */
  primary: z.boolean().optional(),
  /**
   * Writes the answer onto an entity, or as an observation. The entity is the form's subject unless
   * `entity` names an entity question: then it is the place chosen there. With `child`, it is the new
   * entity the form creates (see `creates` on the form).
   */
  bind: z
    .object({ attribute: Key.optional(), element: ElementRef.optional(), entity: Key.optional(), child: z.boolean().optional() })
    .optional(),
});
export type Question = z.infer<typeof Question>;

export const Section = z.object({
  key: Key,
  title: z.string().trim().max(200),
  relevant: Expr.optional(),
  /** The default width of the section's questions on a wide screen: 1 = full row, 2 = half, 3 = a third, 4 = a quarter (each question can say otherwise). Narrow screens always show one per row. */
  columns: z.number().int().min(1).max(4).optional(),
  /**
   * The section can be filled in several times (one block per household member, medicine, visit…). The answer
   * is a list of rows under the section's key. Questions inside see their own row and the form's other answers;
   * the rest of the form cannot see inside the rows.
   */
  repeat: z.object({ min: z.number().int().min(0).max(100).optional(), max: z.number().int().min(1).max(100).optional(), itemLabel: z.string().trim().max(80).optional() }).optional(),
  /** Never shown: all its questions are hidden (give them calculations to fill them in). */
  hidden: z.boolean().optional(),
  /** Shown only to people with at least this project role and/or in this permission group; for everyone else the section is not there. */
  visibleTo: Audience.optional(),
  /**
   * The id of an approval step: the section is then not part of the form the applicant fills in, but a part its
   * approvers fill in while they decide at that step (e.g. the registration details the Registering Officer adds).
   * Afterwards it is read like any other answer.
   */
  fillAt: z.string().max(80).optional(),
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
  /** The icon beside the form in menus (the name of one of the app's icons). */
  icon: z.string().trim().max(40).optional(),
  description: z.string().trim().max(1000).default(''),
  sections: z.array(Section).min(1).max(50),
  /** Period the observations are recorded for (aligned to the collection date). */
  period: z.enum(['none', 'day', 'week', 'week_sun', 'month', 'year']).default('none'),
  /**
   * How the form is presented: `single` – one scrolling page; `steps` – each
   * section is a page with a progress stepper; `focus` – one question at a time.
   */
  layout: z.enum(FORM_LAYOUTS).default('single'),
  /** Makes a new entity under the place chosen in `parent` (an entity question, or `$subject` for the form's own). Its code and name are answers; questions with `bind.child` fill its attributes. */
  creates: z.object({ type: Key, parent: z.string().min(1).max(63), code: Key, name: Key }).optional(),
  /** Shown after a successful submission. */
  thankYou: z.string().trim().max(500).default(''),
  /** How the form looks to the people filling it. */
  look: z
    .object({
      /** Overrides the project's colour on this form. */
      accent: Hex.nullable().default(null),
      density: z.enum(['compact', 'roomy']).default('roomy'),
      /** How rounded the form's boxes, fields and buttons are. */
      corners: z.enum(['square', 'soft', 'round']).default('square'),
      /** A picture behind the heading (the id of an uploaded form picture). */
      headerImage: z.uuid().nullable().default(null),
    })
    .default({ accent: null, density: 'roomy', corners: 'square', headerImage: null }),
  /** Behaviour of multi-step forms. */
  flow: z
    .object({
      progress: z.boolean().default(true),
      back: z.boolean().default(true),
      /** A page listing the answers before they are sent. */
      review: z.boolean().default(false),
    })
    .default({ progress: true, back: true, review: false }),
  /**
   * Translations by language. Keys: `title`, `description`, `thankYou`,
   * `section.<key>`, `<question>.label`, `<question>.hint`,
   * `<question>.placeholder`, `<question>.requiredMessage`, `<question>.constraintMessage`, `<question>.option.<value>`. Missing keys
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
      if (q.placeholder) out.push([`${q.key}.placeholder`, q.placeholder]);
      if (q.requiredMessage) out.push([`${q.key}.requiredMessage`, q.requiredMessage]);
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
        ...(q.placeholder && { placeholder: t(`${q.key}.placeholder`, q.placeholder) }),
        ...(q.requiredMessage && { requiredMessage: t(`${q.key}.requiredMessage`, q.requiredMessage) }),
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
  group: z.uuid().nullable().default(null),
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
  /** The colour of the status badge while a submission waits here. */
  color: Hex.nullable().default(null),
});
export type WorkflowStage = z.infer<typeof WorkflowStage>;

// ---------------------------------------------------------------- workflow graph

const NodeId = z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/, 'Lowercase letters, digits, "-" and "_"');
const Position = z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 });
const nodeBase = { id: NodeId, name: z.string().trim().max(80).default(''), position: Position };

/** Who an email goes to: the submitter, whoever can approve at this point, or named people. */
export const DOCUMENT_FORMATS = ['pdf', 'docx', 'xlsx'] as const;
export const DocumentFormat = z.enum(DOCUMENT_FORMATS);
export type DocumentFormat = z.infer<typeof DocumentFormat>;

/**
 * Details of the submission itself that an email, a document or a webhook header can use like an answer:
 * `${_submitted_at}`. They start with an underscore, so they never clash with a question's key.
 */
export const SUBMISSION_FIELDS = [
  { key: '_submitted_at', label: 'Time submitted' },
  { key: '_submitted_by', label: 'Submitted by (name)' },
  { key: '_submitted_by_email', label: 'Submitted by (email)' },
  { key: '_collected_at', label: 'Time collected' },
  { key: '_decided_at', label: 'Time decided' },
  { key: '_status', label: 'Status' },
  { key: '_submission_id', label: 'Submission reference' },
  { key: '_form_name', label: 'Form name' },
  { key: '_project_name', label: 'Project name' },
  { key: '_today', label: 'Today’s date' },
  { key: '_printed_at', label: 'Date and time printed' },
] as const;
export const SUBMISSION_FIELD_KEYS: ReadonlySet<string> = new Set(SUBMISSION_FIELDS.map((f) => f.key));

export const NotifyRecipients = z.object({
  submitter: z.boolean().default(false),
  approvers: ApproverRule.nullable().default(null),
  emails: z.array(z.email()).max(20).default([]),
  /** Email questions of the form: the addresses people entered there receive it too. */
  questions: z.array(Key).max(10).default([]),
});
export type NotifyRecipients = z.infer<typeof NotifyRecipients>;

export const WorkflowNode = z.discriminatedUnion('type', [
  z.object({ ...nodeBase, type: z.literal('start') }),
  z.object({
    ...nodeBase,
    type: z.literal('approval'),
    /** Instructions shown to reviewers. */
    description: z.string().trim().max(300).default(''),
    approvers: ApproverRule.default({ role: 'manager', group: null, users: [] }),
    allowReturn: z.boolean().default(true),
    /** The colour of the status badge while a submission waits here; none = the standard blue. */
    color: Hex.nullable().default(null),
    /** Fires the `timeout` outlet after this many hours without a decision. */
    slaHours: z.number().int().min(1).max(24 * 90).nullable().default(null),
  }),
  /** Exclusive if/else on the answers: follows `true` or `false`. */
  z.object({ ...nodeBase, type: z.literal('branch'), condition: Expr }),
  z.object({
    ...nodeBase,
    type: z.literal('notify'),
    to: NotifyRecipients.default({ submitter: true, approvers: null, emails: [], questions: [] }),
    subject: z.string().trim().min(1).max(200),
    /** The message: plain text with a little Markdown formatting (see `mdToHtml`). `${question}` references are filled from the answers. */
    body: z.string().trim().max(5000).default(''),
    /** Files attached to every email this step sends (ids of files uploaded for the form). */
    attachments: z.array(z.object({ id: z.uuid(), name: z.string().max(255) })).max(5).default([]),
    /** File, photo and signature questions: what people uploaded there is attached too. */
    attachQuestions: z.array(Key).max(10).default([]),
    /** Documents (templates of the form) made from the submission and attached, as a PDF or a Word file. */
    documents: z.array(z.object({ id: Key, format: DocumentFormat })).max(5).default([]),
  }),
  z.object({
    ...nodeBase,
    type: z.literal('webhook'),
    url: z.url(),
    method: z.enum(['POST', 'PUT']).default('POST'),
    headers: z.record(z.string(), z.string()).default({}),
  }),
  /** Writes the answers bound to entity attributes/observations (`bind` on the questions) at this point. */
  z.object({ ...nodeBase, type: z.literal('entity') }),
  z.object({
    ...nodeBase,
    type: z.literal('wait'),
    hours: z.number().int().min(1).max(24 * 90),
  }),
  z.object({ ...nodeBase, type: z.literal('end'), outcome: z.enum(['approved', 'rejected']) }),
]);
export type WorkflowNode = z.infer<typeof WorkflowNode>;

/** The outlet an edge leaves a node by: a decision, a branch result, a timeout, or plain `next`. */
export const WorkflowHandle = z.enum(['next', 'approved', 'rejected', 'returned', 'timeout', 'true', 'false']);
export type WorkflowHandle = z.infer<typeof WorkflowHandle>;

export const WorkflowEdge = z.object({
  id: z.string().min(1).max(60),
  from: NodeId,
  to: NodeId,
  handle: WorkflowHandle.default('next'),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdge>;

export const WorkflowGraph = z.object({
  nodes: z.array(WorkflowNode).max(60),
  edges: z.array(WorkflowEdge).max(150),
});
export type WorkflowGraph = z.infer<typeof WorkflowGraph>;

/** A date and time on a wall clock, without a zone: `2026-11-30T17:00`. */
const WallTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

// ---------------------------------------------------------------- documents

/**
 * A document made from a submission: a letter, notice or certificate with the answers placed in it, as a PDF
 * or a Word file. The body is the same small Markdown subset as an email message (headings, bold, italic,
 * lists, links) plus tables, and can repeat a block or a table row for each row of a repeating section.
 */
/** A stored picture (the id of an uploaded file of the form), or none. */
const Picture = z.uuid().nullable().default(null);
const Align = z.enum(['left', 'center', 'right']);

/** How a document looks apart from its words: a logo, a watermark, and a picture behind the page. */
export const DocumentDesign = z.object({
  logo: z
    .object({
      image: Picture,
      align: Align.default('left'),
      /** On the first page only, or at the top of every page. */
      pages: z.enum(['first', 'all']).default('first'),
      /** How wide it is on the paper, in millimetres. */
      width: z.number().int().min(10).max(150).default(40),
    })
    .default({ image: null, align: 'left', pages: 'first', width: 40 }),
  watermark: z
    .object({
      kind: z.enum(['none', 'text', 'image']).default('none'),
      text: z.string().trim().max(60).default(''),
      image: Picture,
      /** How strong it is, in percent: low enough to read the page over it. */
      opacity: z.number().int().min(3).max(60).default(12),
      /** Tilt of the text in degrees (text only). */
      angle: z.number().int().min(-90).max(90).default(-35),
    })
    .default({ kind: 'none', text: '', image: null, opacity: 12, angle: -35 }),
  /** A picture behind every page (a letterhead, or a pre-printed form to fill in). */
  background: z.object({ image: Picture, pages: z.array(Picture).max(10).default([]) }).default({ image: null, pages: [] }),
});
export type DocumentDesign = z.infer<typeof DocumentDesign>;
export const DEFAULT_DESIGN: DocumentDesign = {
  logo: { image: null, align: 'left', pages: 'first', width: 40 },
  watermark: { kind: 'none', text: '', image: null, opacity: 12, angle: -35 },
  background: { image: null, pages: [] },
};

/** An answer placed at a spot on the page, as percentages of the page's width and height. */
export const PlacedField = z.object({
  id: z.string().min(1).max(40),
  /** A question's key, or a detail of the submission such as `_submitted_by`. */
  key: z.string().min(1).max(80),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(5).max(100).default(40),
  size: z.number().int().min(6).max(72).default(12),
  align: Align.default('left'),
  bold: z.boolean().default(false),
  /** Which page of a multi-page document it is on. */
  page: z.number().int().min(1).max(10).default(1),
});
export type PlacedField = z.infer<typeof PlacedField>;

/** Who a document is for: `internal` – managers and the permissions it names, never sent; `email` – may also be attached to workflow emails; `public` – also open to anyone who can see the submission. */
export const DOCUMENT_VISIBILITIES = ['internal', 'email', 'public'] as const;
export const DocumentVisibility = z.enum(DOCUMENT_VISIBILITIES);
export type DocumentVisibility = z.infer<typeof DocumentVisibility>;

export const DocumentTemplate = z.object({
  id: Key,
  /** Documents made before this setting existed stay open to everyone who can see the submission. */
  visibility: DocumentVisibility.default('public'),
  /** For an internal or emailable document: the permission groups (and any above them) who may also use it, besides managers. None = managers only. */
  groups: z.array(z.uuid()).max(20).default([]),
  /** The file types it can be made as. Custom documents are PDF only (the built-in Submission record also offers Word and Excel). */
  formats: z.array(DocumentFormat).min(1).max(3).default(['pdf']),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).default(''),
  paper: z.enum(['a4', 'letter']).default('a4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  /** A line at the top and at the bottom of every page; may use `${question}` too. */
  header: z.string().trim().max(300).default(''),
  footer: z.string().trim().max(300).default(''),
  body: z.string().max(30000).default(''),
  design: DocumentDesign.default(DEFAULT_DESIGN),
  /** `flow`: the text above, laid out from the top. `placed`: only the answers in `fields`, each where it was put (for a pre-printed page). */
  mode: z.enum(['flow', 'placed']).default('flow'),
  fields: z.array(PlacedField).max(100).default([]),
  /** How many pages a document of placed answers has; each can have its own background (`design.background.pages`). */
  pages: z.number().int().min(1).max(10).default(1),
});
export type DocumentTemplate = z.infer<typeof DocumentTemplate>;

/**
 * The document every form has without anyone writing it: all its questions and their answers, made from the
 * form itself, so it follows the form as questions are added, moved and removed. The id is reserved.
 */
export const SUBMISSION_RECORD_ID = 'submission';
/** What the footer of a submission record can carry (page numbers are a separate switch). */
export const RECORD_FOOTER_ITEMS = ['submission_id', 'submitted_at', 'submitted_by', 'printed_at', 'project', 'form'] as const;
export const RecordFooterItem = z.enum(RECORD_FOOTER_ITEMS);
export type RecordFooterItem = z.infer<typeof RecordFooterItem>;
export const RECORD_FOOTER_LABEL: Record<RecordFooterItem, string> = {
  submission_id: 'Submission number',
  submitted_at: 'Date and time sent',
  submitted_by: 'Sent by',
  printed_at: 'Date and time printed',
  project: 'Project name',
  form: 'Form name',
};
export const RecordOptions = z.object({
  /** `table`: a Question and Answer table per section. `form`: the way the form appears, each question with its answer in order. */
  layout: z.enum(['table', 'form']).default('table'),
  /** The accent colour on the title and the section headings, and a light shade behind answers. */
  colors: z.boolean().default(false),
  /** A title block at the top: the form's name and its introduction. */
  header: z.boolean().default(true),
  /** The project's name, in a line above the title. */
  project: z.boolean().default(true),
  /** A line at the top of every page: the form's name. */
  pageHeader: z.boolean().default(true),
  /** A line at the bottom of every page, made of `footerItems`. */
  pageFooter: z.boolean().default(true),
  footerItems: z.array(RecordFooterItem).max(6).default(['submission_id']),
  /** "Page 1 of 3" at the right of the footer. */
  pageNumbers: z.boolean().default(true),
  /** The form's notes and each question's help text, in the order the form has them. */
  notes: z.boolean().default(false),
  /** A heading above each section's questions. */
  group: z.boolean().default(true),
  /** A line under the title: who sent it, when, and where it stands. */
  details: z.boolean().default(true),
  /** Questions without an answer, shown as "No answer"; otherwise they are left out. */
  blank: z.boolean().default(false),
  design: DocumentDesign.default(DEFAULT_DESIGN),
});
export type RecordOptions = z.infer<typeof RecordOptions>;
export const SUBMISSION_RECORD: DocumentTemplate = {
  id: SUBMISSION_RECORD_ID,
  visibility: 'public',
  groups: [],
  formats: ['pdf', 'docx', 'xlsx'],
  name: 'Submission record',
  description: 'Every question and its answer, for any submission',
  paper: 'a4',
  orientation: 'portrait',
  header: '${_form_name}',
  footer: '${_submission_id}',
  body: '',
  design: DEFAULT_DESIGN,
  mode: 'flow',
  fields: [],
  pages: 1,
};
/** The form's own documents with the default record first (what people choose from). */
export const withRecord = (documents: readonly DocumentTemplate[]): DocumentTemplate[] => [SUBMISSION_RECORD, ...documents];

/** Answers for a sample document, as typed in the builder (the template is the one being edited, saved or not). */
export const DocumentSampleInput = z.object({
  template: DocumentTemplate,
  format: DocumentFormat,
  answers: z.record(z.string(), z.unknown()),
  /** For the default record: how it is being set up (saved or not). */
  record: RecordOptions.optional(),
});
export type DocumentSampleInput = z.input<typeof DocumentSampleInput>;

/** The documents being edited, saved on their own, with the one that changed (for its history). */
export const DocumentDraftInput = z.object({
  documents: z.array(DocumentTemplate).max(20),
  record: RecordOptions,
  documentId: z.string().min(1).max(63),
  action: z.enum(['saved', 'restored']).default('saved'),
});
export type DocumentDraftInput = z.input<typeof DocumentDraftInput>;

/** What the submissions page of a form shows and lets people do. */
export const SUBMISSION_COLUMNS = ['entity', 'status', 'submittedBy', 'submitted'] as const;
export const SUBMISSION_ACTIONS = ['view', 'edit', 'history', 'download', 'duplicate', 'link', 'remove'] as const;
export type SubmissionAction = (typeof SUBMISSION_ACTIONS)[number];
const RowAction = (on: boolean) => z.object({ on: z.boolean().default(on), groups: z.array(z.uuid()).max(20).default([]) }).default({ on, groups: [] });
export const SubmissionsPage = z.object({
  /** In the order shown: a built-in column, or the key of a question. */
  columns: z
    .array(z.object({ key: z.string().min(1).max(80), show: z.boolean().default(true), search: z.boolean().default(false) }))
    .max(20)
    .default([
      { key: 'entity', show: true, search: true },
      { key: 'status', show: true, search: false },
      { key: 'submittedBy', show: true, search: true },
      { key: 'submitted', show: true, search: false },
    ]),
  filters: z
    .object({
      status: z.boolean().default(true),
      date: z.boolean().default(true),
      submittedBy: z.boolean().default(true),
      place: z.boolean().default(false),
      /** Questions people can filter by. */
      answers: z.array(z.string().min(1).max(80)).max(5).default([]),
    })
    .default({ status: true, date: true, submittedBy: true, place: false, answers: [] }),
  tabs: z.object({ all: z.boolean().default(true), pending: z.boolean().default(true), mine: z.boolean().default(false) }).default({ all: true, pending: true, mine: false }),
  order: z.enum(['newest', 'oldest']).default('newest'),
  pageSize: z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]).default(25),
  /** Icons and menu items on each row. `groups`: who may use it besides the usual people (managers always can); none = the usual rule. */
  actions: z
    .object({
      view: RowAction(true),
      edit: RowAction(true),
      history: RowAction(true),
      download: RowAction(true),
      duplicate: RowAction(false),
      link: RowAction(true),
      remove: RowAction(false),
    })
    .default({
      view: { on: true, groups: [] },
      edit: { on: true, groups: [] },
      history: { on: true, groups: [] },
      download: { on: true, groups: [] },
      duplicate: { on: false, groups: [] },
      link: { on: true, groups: [] },
      remove: { on: false, groups: [] },
    }),
});
export type SubmissionsPage = z.infer<typeof SubmissionsPage>;

export const FormSettings = z.object({
  /** Who may fill the form in: members of this permission (or one above it); null = any project member. */
  fillGroup: z.uuid().nullable().default(null),
  /**
   * Whose answers a filler can read afterwards: `scope` – everything for the places they work in (the
   * default); `own` – only what they sent themselves. Approvers and project managers always see them.
   */
  seeAnswers: z.enum(['scope', 'own']).default('scope'),
  workflow: z
    .object({
      enabled: z.boolean().default(false),
      stages: z.array(WorkflowStage).max(10).default([]),
      /** The graph workflow. When absent, `stages` run as a linear chain (see `graphFromStages`). */
      graph: WorkflowGraph.optional(),
    })
    .default({ enabled: false, stages: [] }),
  /** When the form can be filled in. Times are wall-clock in `timezone` (so they follow daylight saving). */
  availability: z
    .object({
      opensAt: WallTime.nullable().default(null),
      closesAt: WallTime.nullable().default(null),
      timezone: z.string().trim().max(64).default('UTC'),
      /** Shown before it opens / after it closes; blank uses a standard sentence. */
      beforeMessage: z.string().trim().max(500).default(''),
      afterMessage: z.string().trim().max(500).default(''),
    })
    .default({ opensAt: null, closesAt: null, timezone: 'UTC', beforeMessage: '', afterMessage: '' }),
  /** How much can be sent. Blank (null) means no limit. */
  limits: z
    .object({
      /** All submissions together. */
      maxSubmissions: z.number().int().min(1).max(10_000_000).nullable().default(null),
      /** Per person. */
      perPerson: z.number().int().min(1).max(10_000).nullable().default(null),
      /** Shown when a limit is reached; blank uses a standard sentence. */
      fullMessage: z.string().trim().max(500).default(''),
    })
    .default({ maxSubmissions: null, perPerson: null, fullMessage: '' }),
  /** Documents that can be made from a submission (a notice, a letter, a certificate…). These are the published ones; the builder edits `documentDraft`. */
  documents: z.array(DocumentTemplate).max(20).default([]),
  /** Changes to the documents and the default record, kept apart until they are published. Null: nothing waiting. */
  documentDraft: z.object({ documents: z.array(DocumentTemplate).max(20), record: RecordOptions }).nullable().default(null),
  /** Opens a piece of work (a ticket, a task) for each submission. */
  work: FormWork.default(DEFAULT_FORM_WORK),
  /** How the default Submission record is made. */
  record: RecordOptions.default({ layout: 'table', colors: false, header: true, project: true, pageHeader: true, pageFooter: true, footerItems: ['submission_id'], pageNumbers: true, notes: false, group: true, details: true, blank: false, design: DEFAULT_DESIGN }),
  /** Letting people without an account fill the form in through a link. Off unless switched on. */
  publicAccess: z
    .object({
      /** The master switch: with it off every link of the form is paused. */
      enabled: z.boolean().default(false),
      /** Asks the person for their name or email, so the answers can be told apart. */
      askName: z.boolean().default(true),
      /** Only invites work: each person has a link of their own, used once. The open link is off. */
      inviteOnly: z.boolean().default(false),
      /** The person gives an email address and enters a one-time code sent to it before the answers are accepted. */
      verifyEmail: z.boolean().default(false),
      /** A small puzzle the person's browser solves before sending, to keep bots out. */
      captcha: z.boolean().default(true),
      /** The most one network address can send through the form's links in an hour. */
      perIpPerHour: z.number().int().min(1).max(1000).default(20),
    })
    .default({ enabled: false, askName: true, verifyEmail: false, inviteOnly: false, captcha: true, perIpPerHour: 20 }),
  /** A fee the person pays before the form is sent (taken through the organisation's payment provider). */
  payment: FormPayment.default(DEFAULT_FORM_PAYMENT),
  /** What the form's submissions page shows and which actions it offers. */
  submissionsPage: SubmissionsPage.default(SubmissionsPage.parse({})),
});
export type FormSettings = z.infer<typeof FormSettings>;
export type FormSettingsInput = z.input<typeof FormSettings>;

/** Subject type of a form captured against the project itself (a hidden system entity type). */
export const PROJECT_SUBJECT = 'this_project';

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const AttachmentDto = z.object({ id: z.string(), name: z.string(), contentType: z.string(), size: z.number().int() });
export type AttachmentDto = z.infer<typeof AttachmentDto>;

/** One published version of a form, as it was when published. */
/** One saved or published state of a document, for its history. `snapshot` is the template (or, for the default record, its options). */
export const DocumentRevisionDto = z.object({
  id: z.number().int(),
  documentId: z.string(),
  action: z.enum(['saved', 'published', 'restored']),
  actorName: z.string().nullable(),
  createdAt: z.string(),
  snapshot: z.unknown(),
});
export type DocumentRevisionDto = z.infer<typeof DocumentRevisionDto>;

export const FormVersionDto = z.object({
  version: z.number().int(),
  publishedAt: z.string(),
  publishedBy: z.string().nullable(),
  definition: FormDefinition,
});
export type FormVersionDto = z.infer<typeof FormVersionDto>;

export const FormInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  /** Every form is captured against an entity of this type. */
  subjectType: Key,
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
  /** Whether it can be filled in right now, and the sentence to show when it cannot. */
  availability: z.object({
    state: z.enum(['open', 'not_yet', 'closed', 'full', 'limit']),
    message: z.string().nullable(),
    opensAt: z.string().nullable(),
    closesAt: z.string().nullable(),
  }),
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
  /** The answers to the sections of this step (`fillAt`), checked when approving. */
  answers: z.record(z.string(), z.unknown()).default({}),
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
  decision: z.enum(['submitted', 'resubmitted', 'approved', 'rejected', 'returned', 'timed_out']),
  comment: z.string(),
  actor: z.string().nullable(),
  at: z.string(),
});
export type ReviewDto = z.infer<typeof ReviewDto>;

/** Someone opening a submission, as the activity log recorded it. */
export const SubmissionViewDto = z.object({
  actor: z.string().nullable(),
  at: z.string(),
  /** Opened it, or downloaded a file of it (then `detail` names the file). */
  kind: z.enum(['opened', 'downloaded']).default('opened'),
  detail: z.string().default(''),
});
export type SubmissionViewDto = z.infer<typeof SubmissionViewDto>;

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
  /** The colour set for that stage (null = the standard one). */
  stageColor: z.string().nullable().default(null),
  /** The workflow node the submission is parked on (or finished at). */
  nodeId: z.string().nullable(),
  /** The name its form’s author gave the end it reached (e.g. Verified); null = the plain Approved / Rejected. */
  outcome: z.string().nullable(),
  /** Stage names in order, for progress display (empty without a workflow). */
  stages: z.array(z.string()),
  reviews: z.array(ReviewDto),
  /** Who has opened it, newest first. Only managers and the people who can review it are told. */
  views: z.array(SubmissionViewDto).default([]),
  canReview: z.boolean(),
  canResubmit: z.boolean(),
  version: z.number().int(),
  entity: z.object({ id: z.string(), code: z.string(), name: z.string() }).nullable(),
  answers: z.record(z.string(), z.unknown()),
  submittedBy: z.string().nullable(),
  submittedById: z.string().nullable(),
  /** Came in through a link, by someone without an account; `submittedBy` is then what they typed. */
  viaLink: z.boolean(),
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
  icon: z.string().nullable(),
});
export type MenuForm = z.infer<typeof MenuForm>;

export const FormsMenuDto = z.object({ groups: z.array(FormGroupDto), forms: z.array(MenuForm) });
export type FormsMenuDto = z.infer<typeof FormsMenuDto>;

/** The caller's review queue and their own submissions that are in a workflow. */
export const InboxDto = z.object({ toReview: z.array(SubmissionDto), mine: z.array(SubmissionDto) });
export type InboxDto = z.infer<typeof InboxDto>;

// ---------------------------------------------------------------- links for people without an account

/** Question types that cannot be answered without an account (they read or store things in the project). */
/** Question types people without an account cannot answer. None now: pictures, files and places work through a link too. */
export const NOT_PUBLIC_TYPES: readonly string[] = [];

/** A place a public form's entity question offers. */
export const PublicPlaceDto = z.object({ id: z.string(), code: z.string(), name: z.string(), parent: z.string().nullable() });
export type PublicPlaceDto = z.infer<typeof PublicPlaceDto>;

export const FormLinkKind = z.enum(['shared', 'invite']);

/** One link, for the form's managers. `path` is what follows `/f/` in the address. */
export const FormLinkDto = z.object({
  id: z.string(),
  kind: FormLinkKind,
  path: z.string(),
  label: z.string(),
  email: z.string().nullable(),
  entity: z.object({ id: z.string(), code: z.string(), name: z.string() }).nullable(),
  uses: z.number().int(),
  maxUses: z.number().int().nullable(),
  /** When this invite opens and closes, if it has dates of its own (wall-clock in the form's time zone). */
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  /** The language it opens the form in (a locale code); null leaves it to the person. */
  language: z.string().nullable(),
  revoked: z.boolean(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type FormLinkDto = z.infer<typeof FormLinkDto>;

/** The language a link opens in: a locale code, or none for the person's own choice. */
const LinkLanguage = z.string().regex(/^[a-z]{2,3}$/).nullable().default(null);

export const FormLinkInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shared'), entityId: z.uuid().nullable().default(null), language: LinkLanguage }),
  z.object({
    kind: z.literal('invite'),
    entityId: z.uuid().nullable().default(null),
    language: LinkLanguage,
    /** One link for each. */
    invites: z.array(z.object({ label: z.string().trim().max(120).default(''), email: z.email().max(200).nullable().default(null) })).min(1).max(200),
    /**
     * Dates of their own (wall-clock `YYYY-MM-DDTHH:mm` in the form's time zone) and how many times each link works. Setting any
     * of these (a date, or more than one use) means the form's own dates and total limit do not apply to these invites, so
     * someone can be let in to test before the form opens.
     */
    opensAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().default(null),
    closesAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().default(null),
    maxUses: z.number().int().min(1).max(1000).default(1),
    /** Email each person their link. */
    sendEmail: z.boolean().default(false),
  }),
]);
export type FormLinkInput = z.input<typeof FormLinkInput>;

/** Changes to an invite already made: how many times it can be used, and its own dates. Only what is sent changes. */
export const FormLinkUpdate = z.object({
  maxUses: z.number().int().min(1).max(1000).optional(),
  opensAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().optional(),
  closesAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().optional(),
});
export type FormLinkUpdate = z.input<typeof FormLinkUpdate>;

/** What someone who opened a link sees: the published form and whether it is open. */
export const PublicFormDto = z.object({
  name: z.string(),
  projectName: z.string(),
  kind: FormLinkKind,
  version: z.number().int(),
  definition: FormDefinition,
  /** The language the link opens the form in; null: the person's browser, else the form's own. */
  language: z.string().nullable(),
  availability: z.object({ state: z.enum(['open', 'not_yet', 'closed', 'full', 'limit']), message: z.string().nullable() }),
  askName: z.boolean(),
  /** The person must confirm an email address with a one-time code. */
  verifyEmail: z.boolean(),
  captcha: z.boolean(),
  /** What the person pays before sending, when the form asks for it and the organisation can take payments. */
  payment: z.object({ amount: z.number().int(), currency: z.string(), description: z.string() }).nullable().default(null),
});
export type PublicFormDto = z.infer<typeof PublicFormDto>;

/** A proof-of-work puzzle: find the number whose hash (with the salt) is the challenge. */
export const CaptchaChallenge = z.object({ salt: z.string(), challenge: z.string(), signature: z.string(), maxNumber: z.number().int() });
export type CaptchaChallenge = z.infer<typeof CaptchaChallenge>;

/** Asks for a one-time code to be emailed. */
export const EmailCodeRequest = z.object({ email: z.email().max(200) });
export const EmailCodeSent = z.object({ expiresInMinutes: z.number().int() });
export type EmailCodeSent = z.infer<typeof EmailCodeSent>;

export const PublicSubmissionInput = z.object({
  id: z.uuid(),
  version: z.number().int(),
  answers: z.record(z.string(), z.unknown()),
  collectedAt: z.iso.datetime({ offset: true }),
  /** The person's own name or email, if the form asked. */
  submitter: z.string().trim().max(200).nullable().default(null),
  /** The address and the one-time code emailed to it, when the form checks addresses. */
  emailCode: z.object({ email: z.email().max(200), code: z.string().regex(/^\d{6}$/) }).nullable().default(null),
  captcha: z.object({ salt: z.string(), challenge: z.string(), signature: z.string(), number: z.number().int() }).nullable().default(null),
  /** The payment the form asked for, once it has gone through. */
  paymentId: z.uuid().nullable().default(null),
});
export type PublicSubmissionInput = z.input<typeof PublicSubmissionInput>;
