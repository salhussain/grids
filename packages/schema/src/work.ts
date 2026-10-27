import { z } from 'zod';
import { Key } from './common.js';

// ---------------------------------------------------------------- work: tickets, tasks, visits, maintenance

export const WORK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const WorkPriority = z.enum(WORK_PRIORITIES);
export type WorkPriority = z.infer<typeof WorkPriority>;
export const WORK_PRIORITY_LABEL: Record<WorkPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

/** Where a state sits in a piece of work's life: waiting to be picked up, being worked on, or finished. */
export const WORK_STATE_KINDS = ['open', 'active', 'done'] as const;
export const WorkState = z.object({
  key: Key,
  label: z.string().trim().min(1).max(40),
  kind: z.enum(WORK_STATE_KINDS),
});
export type WorkState = z.infer<typeof WorkState>;
export const DEFAULT_WORK_STATES: WorkState[] = [
  { key: 'new', label: 'New', kind: 'open' },
  { key: 'in_progress', label: 'In progress', kind: 'active' },
  { key: 'waiting', label: 'Waiting', kind: 'active' },
  { key: 'resolved', label: 'Resolved', kind: 'done' },
  { key: 'closed', label: 'Closed', kind: 'done' },
];

/** How long, in hours, a type allows for a first reply and for finishing, for each priority. A priority left out has no deadline. */
const Hours = z.partialRecord(WorkPriority, z.number().min(0.25).max(24 * 365));
export const WorkSla = z.object({ respondHours: Hours.default({}), resolveHours: Hours.default({}) });
export type WorkSla = z.infer<typeof WorkSla>;

export const WorkTypeInput = z.object({
  key: Key,
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(''),
  icon: z.string().trim().max(40).default('ticket'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0f62fe'),
  /** The letters before the number: TKT-12. */
  prefix: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,5}$/, 'One to six letters or digits, starting with a letter').default('W'),
  states: z
    .array(WorkState)
    .min(2)
    .max(10)
    .default(DEFAULT_WORK_STATES)
    .superRefine((states, ctx) => {
      if (new Set(states.map((s) => s.key)).size !== states.length) ctx.addIssue({ code: 'custom', message: 'Two states share a key' });
      if (!states.some((s) => s.kind === 'open')) ctx.addIssue({ code: 'custom', message: 'Needs a state for new work (kind "open")' });
      if (!states.some((s) => s.kind === 'done')) ctx.addIssue({ code: 'custom', message: 'Needs a state for finished work (kind "done")' });
    }),
  sla: WorkSla.default({ respondHours: {}, resolveHours: {} }),
});
export type WorkTypeInput = z.input<typeof WorkTypeInput>;

export const WorkTypeDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  color: z.string(),
  prefix: z.string(),
  states: z.array(WorkState),
  sla: WorkSla,
  /** Items not yet finished. */
  openCount: z.number().int(),
});
export type WorkTypeDto = z.infer<typeof WorkTypeDto>;

export const WorkItemInput = z.object({
  type: Key,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(8000).default(''),
  priority: WorkPriority.default('normal'),
  assigneeId: z.uuid().nullable().default(null),
  entityId: z.uuid().nullable().default(null),
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export type WorkItemInput = z.input<typeof WorkItemInput>;

/** Changes to an item; only what is sent changes. */
export const WorkItemUpdate = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(8000).optional(),
  state: Key.optional(),
  priority: WorkPriority.optional(),
  assigneeId: z.uuid().nullable().optional(),
  entityId: z.uuid().nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type WorkItemUpdate = z.input<typeof WorkItemUpdate>;

export const WorkComment = z.object({
  body: z.string().trim().min(1).max(8000),
  /** Kept among the team: not shown to the person who asked. */
  internal: z.boolean().default(false),
});
export type WorkComment = z.input<typeof WorkComment>;

export const WORK_SORTS = ['updated', 'created', 'due', 'priority'] as const;
export const WorkQuery = z.object({
  type: Key.optional(),
  /** A state's key, or `open` (not finished) or `done` (finished). */
  state: z.string().max(40).optional(),
  /** `me`, `none` (unassigned), or a person's id. */
  assignee: z.union([z.literal('me'), z.literal('none'), z.uuid()]).optional(),
  /** `me`: what I asked for. */
  requester: z.literal('me').optional(),
  entityId: z.uuid().optional(),
  priority: WorkPriority.optional(),
  q: z.string().trim().max(100).optional(),
  /** Past its due date or its deadline, and not finished. */
  overdue: z.stringbool().optional(),
  sort: z.enum(WORK_SORTS).default('updated'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
export type WorkQuery = z.infer<typeof WorkQuery>;

const Person = z.object({ id: z.string(), name: z.string() });
export const WorkItemDto = z.object({
  id: z.string(),
  number: z.number().int(),
  /** TKT-12 */
  ref: z.string(),
  type: z.object({ key: z.string(), name: z.string(), icon: z.string(), color: z.string() }),
  title: z.string(),
  description: z.string(),
  state: WorkState,
  priority: WorkPriority,
  assignee: Person.nullable(),
  requester: z.object({ id: z.string().nullable(), name: z.string().nullable() }),
  entity: z.object({ id: z.string(), code: z.string(), name: z.string() }).nullable(),
  submissionId: z.string().nullable(),
  dueAt: z.string().nullable(),
  respondBy: z.string().nullable(),
  resolveBy: z.string().nullable(),
  firstResponseAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  /** Past its due date, and not finished. */
  overdue: z.boolean(),
  /** Past a service deadline (first reply or finishing), and not met. */
  breached: z.boolean(),
  source: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  commentCount: z.number().int(),
});
export type WorkItemDto = z.infer<typeof WorkItemDto>;

export const WorkEventDto = z.object({
  id: z.string(),
  kind: z.string(),
  actor: Person.nullable(),
  body: z.string(),
  internal: z.boolean(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type WorkEventDto = z.infer<typeof WorkEventDto>;
export const WorkDetailDto = WorkItemDto.extend({ events: z.array(WorkEventDto) });
export type WorkDetailDto = z.infer<typeof WorkDetailDto>;

export const WorkPageDto = z.object({ items: z.array(WorkItemDto), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() });
export type WorkPageDto = z.infer<typeof WorkPageDto>;

/** Work assigned to the caller, from every project. */
export const WorkMineDto = z.array(WorkItemDto.extend({ project: z.object({ key: z.string(), name: z.string(), color: z.string() }) }));
export type WorkMineDto = z.infer<typeof WorkMineDto>;

/** What a form does with each submission: opens a piece of work for it. */
export const FormWork = z.object({
  /** The work type's key; none leaves the form as it is. */
  type: Key.nullable().default(null),
  /** May use `${question}`. Blank: the form's name. */
  title: z.string().trim().max(200).default(''),
  description: z.string().trim().max(2000).default(''),
  priority: WorkPriority.default('normal'),
  /** A question whose answer (low, normal, high or urgent) sets the priority; otherwise `priority` is used. */
  priorityFrom: Key.nullable().default(null),
  assigneeId: z.uuid().nullable().default(null),
  /** Due this many hours after it arrives. */
  dueInHours: z.number().int().min(1).max(24 * 365).nullable().default(null),
});
export type FormWork = z.infer<typeof FormWork>;
export const DEFAULT_FORM_WORK: FormWork = { type: null, title: '', description: '', priority: 'normal', priorityFrom: null, assigneeId: null, dueInHours: null };

// ---------------------------------------------------------------- recurring work

/** Work that comes round again: by the calendar, by use (an odometer, hours run), or both. */
export const WorkScheduleInput = z
  .object({
    key: Key,
    name: z.string().trim().min(1).max(80),
    /** The work type to open, e.g. "maintenance". */
    type: Key,
    /** The title of each piece of work; ${name} and ${code} are the place or thing it is for. */
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).default(''),
    priority: WorkPriority.default('normal'),
    assigneeId: z.string().uuid().nullable().default(null),
    /** One place or thing... */
    entityId: z.string().uuid().nullable().default(null),
    /** ...or every one of a type. */
    entityType: Key.nullable().default(null),
    everyDays: z.number().int().min(1).max(3650).nullable().default(null),
    meterAttribute: Key.nullable().default(null),
    meterEvery: z.number().positive().nullable().default(null),
    leadDays: z.number().int().min(0).max(365).default(0),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (!v.entityId && !v.entityType) ctx.addIssue({ code: 'custom', path: ['entityType'], message: 'Say what this is for: one thing, or every thing of a type' });
    if (v.entityId && v.entityType) ctx.addIssue({ code: 'custom', path: ['entityType'], message: 'Choose one thing or a type, not both' });
    if (!v.everyDays && !(v.meterAttribute && v.meterEvery)) ctx.addIssue({ code: 'custom', path: ['everyDays'], message: 'Say how often: in days, or by use' });
    if (!!v.meterAttribute !== !!v.meterEvery) ctx.addIssue({ code: 'custom', path: ['meterEvery'], message: 'A meter needs an attribute and an interval' });
  });
export type WorkScheduleInput = z.input<typeof WorkScheduleInput>;

export const WorkScheduleDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  type: z.string(),
  title: z.string(),
  description: z.string(),
  priority: WorkPriority,
  assigneeId: z.string().nullable(),
  entityId: z.string().nullable(),
  entityName: z.string().nullable(),
  entityType: z.string().nullable(),
  everyDays: z.number().nullable(),
  meterAttribute: z.string().nullable(),
  meterEvery: z.number().nullable(),
  leadDays: z.number(),
  active: z.boolean(),
  /** How many places or things it is tracking, and the soonest date one falls due. */
  targets: z.number().int(),
  nextDueAt: z.string().nullable(),
});
export type WorkScheduleDto = z.infer<typeof WorkScheduleDto>;
