import { sql } from 'kysely';
import { fireEvent, upsertEntities, writeObservations } from '@grids/data';
import {
  advance,
  approvalNodes,
  availabilityProblems,
  fillState,
  publicProblems,
  plannedApprovals,
  begin,
  approvalsOf,
  formState,
  graphFromStages,
  graphOf,
  fillFrom,
  interpolate,
  lintDefinition,
  lintDocument,
  forFiller,
  forStage,
  lintWorkflow,
  mdToHtml,
  mdToText,
  periodStart,
  questionsOf,
  stageAnswerKeys,
  validate,
  WorkflowError,
  type WorkflowEvent,
  type WorkflowStep,
} from '@grids/forms';
import {
  FormDefinition,
  type Audience,
  type Question,
  FormSettings,
  PROJECT_SUBJECT,
  roleAtLeast,
  uuidv7,
  type ApproverRule,
  type WorkflowGraph,
  type FormDto,
  type FormVersionDto,
  type AttachmentDto,
  ATTACHMENT_MAX_BYTES,
  type FormGroupDto,
  type FormsMenuDto,
  type InboxDto,
  type Page,
  type ReviewDto,
  type SubmissionDto,
  type SubmissionStatus,
  SUBMISSION_RECORD_ID,
} from '@grids/schema';
import type { z } from 'zod';
import type { FormGroupInput, FormInput, ResubmitInput, ReviewInput, SubmissionInput, SubmissionViewDto } from '@grids/schema';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../errors.js';
import { changes } from './changes.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { openWorkFromSubmission } from './work.js';
import { workspacePolicy } from './policy.js';
import { within, type Scope } from './scope.js';
import { canSee, dataCall, type ProjectAccess, type ProjectService } from './projects.js';
import { iso, isoOrNull, isUniqueViolation } from './util.js';
import type { UsageService } from './usage.js';

type Tx = Parameters<Parameters<ProjectService['cellTx']>[1]>[0];

const settingsOf = (raw: unknown): FormSettings => FormSettings.parse(raw ?? {});

/** Whether the caller may fill a form in: a project member holding the form's permission (any member when it sets none). */
export const canFill = (a: Pick<ProjectAccess, 'member' | 'groups'>, settings: FormSettings) => a.member && canSee(a, settings.fillGroup);

/** Whether the caller reads every answer they have access to, or only their own (managers and approvers always read all). */
const seesAll = (settings: FormSettings, a: Pick<ProjectAccess, 'role' | 'groups'>, userId: string) =>
  settings.seeAnswers === 'scope' || a.role === 'manager' || approvalsOf(settings).some((n) => matchesRule(n.approvers, a, userId));

/** Whether the caller may use a document: anyone for a public one; otherwise managers, and people holding one of the permissions it names (or one above). */
export const mayUseDocument = (a: Pick<ProjectAccess, 'role' | 'groups'>, d: { visibility: string; groups: string[] }) =>
  d.visibility === 'public' || roleAtLeast(a.role, 'manager') || d.groups.some((g) => canSee(a, g));

export const matchesRule = (rule: ApproverRule, a: Pick<ProjectAccess, 'role' | 'groups'>, userId: string) =>
  rule.users.includes(userId) ||
  ((!!rule.role || !!rule.group) && (!rule.role || roleAtLeast(a.role, rule.role)) && (!rule.group || canSee(a, rule.group)));

/** The node a submission is parked on; rows from before graph workflows only carry the stage index. */
const parkedNode = (g: WorkflowGraph, s: { node_id: string | null; stage: number | null }) =>
  s.node_id ?? (s.stage !== null ? (approvalNodes(g)[s.stage]?.id ?? null) : null);

/** Project managers may act on any approval; others must match the node's approver rule. Authors never review their own work. */
export function canApprove(settings: FormSettings, nodeId: string | null, a: Pick<ProjectAccess, 'role' | 'groups'>, userId: string, author: string | null) {
  if (author === userId) return false;
  const node = graphOf(settings)?.nodes.find((n) => n.id === nodeId);
  if (node?.type !== 'approval') return false;
  return a.role === 'manager' || matchesRule(node.approvers, a, userId);
}

/** What can be attached to a submission: pictures and signatures, and ordinary documents. Nothing a browser would run. */
export const ATTACHMENT_TYPES = /^(image\/(jpeg|png|webp|gif)|application\/pdf|text\/(plain|csv)|application\/(msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)))$/;

const canSeeAudience = (a: Pick<ProjectAccess, 'role' | 'groups'>, who: Audience | undefined) =>
  !who || ((!who.role || roleAtLeast(a.role, who.role)) && canSee(a, who.group));
/** The form as this person sees it: sections and questions limited to other roles or permissions are left out. */
const forViewer = (def: FormDefinition, a: Pick<ProjectAccess, 'role' | 'groups'>): FormDefinition =>
  def.sections.some((s) => s.visibleTo) || questionsOf(def).some((q) => q.visibleTo)
    ? { ...def, sections: def.sections.filter((s) => canSeeAudience(a, s.visibleTo)).map((s) => ({ ...s, questions: s.questions.filter((q) => canSeeAudience(a, q.visibleTo)) })) }
    : def;

const valuesOf = (def: FormDefinition, answers: Record<string, unknown>) => formState(def, answers).values;

/** Runs the engine; a graph that cannot run (it is linted on save) is reported as a form problem. */
function engine<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof WorkflowError) throw badRequest('This form\'s workflow cannot run', e.message);
    throw e;
  }
}

/** The project's own entity has this path: it is outside every member's part of the entity tree, and open to all. */
const PROJECT_WIDE = '';
const inPart = (roots: Scope, path: string | null) => !roots || path === PROJECT_WIDE || within(roots, path);

const subFrom = (tx: Tx) =>
  tx
    .selectFrom('submission as s')
    .innerJoin('form as f', 'f.id', 's.form_id')
    .innerJoin('project as p', 'p.id', 's.project_id')
    .leftJoin('entity as e', 'e.id', 's.entity_id')
    .leftJoin('entity_type as et', 'et.id', 'e.type_id');
const subRows = (q: ReturnType<typeof subFrom>) =>
  q.select([
    's.id',
    's.form_id',
    's.project_id',
    'f.key as form_key',
    'f.name as form_name',
    'f.settings',
    'p.key as project_key',
    'p.name as project_name',
    's.form_version',
    'e.id as entity_id',
    'e.code as entity_code',
    'e.name as entity_name',
    sql<string | null>`case when et.system then '' else e.path::text end`.as('entity_path'),
    's.answers',
    's.submitted_by',
    's.collected_at',
    's.submitted_at',
    's.status',
    's.stage',
    's.node_id',
    's.outcome_node',
    's.decided_at',
    's.link_id',
    's.submitter',
  ]);
type SubRow = Awaited<ReturnType<ReturnType<typeof subRows>['execute']>>[number];

/** Everything a workflow step needs to know about the submission it acts on. */
interface WorkflowRun {
  tenantId: string;
  projectId: string;
  formKey: string;
  formName: string;
  def: FormDefinition;
  typeKey: string | null;
  entity: Subject | undefined;
  answers: Record<string, unknown>;
  collectedAt: Date;
  submissionId: string;
  submittedBy: string | null;
  actorId: string | null;
}

/** Validation failure with per-question messages (422). */
export class SubmissionInvalid extends HttpError {
  constructor(readonly fields: Record<string, string>) {
    super(
      422,
      'Some answers need attention',
      undefined,
      Object.entries(fields).map(([path, message]) => ({ path, message })),
    );
  }
}

/** Forms (M6, ADR 0006): drafts, immutable published versions, append-only submissions. */
export class FormService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
  ) {}

  /** Whether a form can be filled in now, for the `FormDto`. */
  private availabilityOf(settings: FormSettings, total: number, mine: number): FormDto['availability'] {
    const r = fillState(settings, this.ctx.now(), { total, mine });
    return { state: r.state, message: r.message, opensAt: isoOrNull(r.opensAt), closesAt: isoOrNull(r.closesAt) };
  }

  async list(actor: Actor, tenantId: string, project: string): Promise<FormDto[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, async (tx) => {
      const rows = await tx
        .selectFrom('form as f')
        .leftJoin('entity_type as t', 't.id', 'f.subject_type_id')
        .leftJoin('form_version as v', (j) => j.onRef('v.form_id', '=', 'f.id').onRef('v.version', '=', 'f.current_version'))
        .select([
          'f.id',
          'f.key',
          'f.name',
          'f.description',
          'f.draft',
          'f.current_version',
          'f.group_id',
          'f.settings',
          'f.updated_at',
          't.key as type_key',
          't.name as type_name',
          'v.definition as published',
          (eb) => eb.selectFrom('submission as s').select((e2) => e2.fn.countAll<string>().as('n')).whereRef('s.form_id', '=', 'f.id').as('n'),
          (eb) => eb.selectFrom('submission as s').select((e2) => e2.fn.max('s.submitted_at').as('m')).whereRef('s.form_id', '=', 'f.id').as('last'),
          (eb) => eb.selectFrom('submission as s').select((e2) => e2.fn.countAll<string>().as('c')).whereRef('s.form_id', '=', 'f.id').where('s.submitted_by', '=', actor.id).as('mine'),
        ])
        .where('f.project_id', '=', a.project.id)
        .where('f.archived_at', 'is', null)
        .orderBy('f.name')
        .execute();
      // A form is visible to people in its permission group or any group above it (managers see all).
      return rows.filter((f) => canSee(a, settingsOf(f.settings).fillGroup)).map((f) => {
        const settings = settingsOf(f.settings);
        return {
        id: f.id,
        key: f.key,
        name: f.name,
        description: f.description,
        subjectType: f.type_key ? { key: f.type_key, name: f.type_name! } : null,
        groupId: f.group_id,
        // Drafts and documents meant for staff are the managers' business.
        settings: roleAtLeast(a.role, 'manager') ? settings : { ...settings, documents: settings.documents.filter((d) => mayUseDocument(a, d)), documentDraft: null },
        canFill: canFill(a, settings),
        availability: this.availabilityOf(settings, Number(f.n ?? 0), Number(f.mine ?? 0)),
        draft: forViewer(FormDefinition.parse(f.draft), a),
        currentVersion: f.current_version,
        published: f.published ? forViewer(FormDefinition.parse(f.published), a) : null,
        // Compared as the schema reads them, so a stored copy missing a default is not a change.
        hasUnpublishedChanges: !f.published || JSON.stringify(FormDefinition.parse(f.published)) !== JSON.stringify(FormDefinition.parse(f.draft)),
        submissionCount: Number(f.n ?? 0),
        lastSubmissionAt: isoOrNull(f.last as Date | null),
        updatedAt: iso(f.updated_at),
        };
      });
    });
  }

  /** Set where the services are put together: the plan's limits on forms and submissions. */
  usage?: UsageService;

  async save(actor: Actor, tenantId: string, project: string, input: z.output<typeof FormInput>, existingKey?: string): Promise<FormDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    try {
      await this.projects.cellTx(tenantId, async (tx) => {
        let subjectTypeId: string | null = null;
        if (input.subjectType) {
          const t = await tx.selectFrom('entity_type').select('id').where('project_id', '=', a.project.id).where('key', '=', input.subjectType).executeTakeFirst();
          if (!t) throw badRequest(`Unknown entity type "${input.subjectType}"`);
          subjectTypeId = t.id;
        }
        await this.checkBindings(tx, a.project.id, input.definition, input.subjectType);
        await this.checkSettings(tx, a.project.id, input.definition, input.settings);
        // The group must be one of this project's (or an older organisation-wide one).
        if (
          input.groupId &&
          !(await tx
            .selectFrom('form_group')
            .select('id')
            .where('id', '=', input.groupId)
            .where((eb) => eb.or([eb('project_id', '=', a.project.id), eb('project_id', 'is', null)]))
            .executeTakeFirst())
        )
          throw badRequest('Unknown form group');
        const values = {
          key: input.key,
          name: input.name,
          description: input.description,
          subject_type_id: subjectTypeId,
          group_id: input.groupId,
          settings: JSON.stringify(input.settings),
          draft: JSON.stringify(input.definition),
          updated_at: this.ctx.now(),
        };
        if (existingKey) {
          const r = await tx.updateTable('form').set(values).where('project_id', '=', a.project.id).where('key', '=', existingKey).executeTakeFirst();
          if (!r.numUpdatedRows) throw notFound('Form');
        } else {
          await this.usage?.assertIn(tx, tenantId, 'forms');
          await tx.insertInto('form').values({ id: uuidv7(), tenant_id: tenantId, project_id: a.project.id, ...values }).execute();
        }
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Key taken', `A form with key "${input.key}" already exists.`);
      throw e;
    }
    return this.list(actor, tenantId, project);
  }

  /** Permission groups must exist, approvers be named, and the workflow graph (or stage chain) be runnable. */
  async checkSettings(tx: Tx, projectId: string, def: FormDefinition, settings: FormSettings) {
    await this.projects.assertGroup(tx, projectId, settings.fillGroup);
    for (const d of settings.documents) for (const g of d.groups) await this.projects.assertGroup(tx, projectId, g);
    for (const act of Object.values(settings.submissionsPage.actions)) for (const g of act.groups) await this.projects.assertGroup(tx, projectId, g);
    if (settings.publicAccess.enabled || settings.publicAccess.inviteOnly) {
      const blocked = publicProblems(def);
      if (blocked.length) throw badRequest('This form cannot be made public', blocked.join('; '));
    }
    if (settings.work.type) {
      const t = await tx.selectFrom('work_type').select('id').where('project_id', '=', projectId).where('key', '=', settings.work.type).executeTakeFirst();
      if (!t) throw badRequest(`This form opens work of the type "${settings.work.type}", which the project does not have`);
    }
    const timing = availabilityProblems(settings);
    if (timing.length) throw badRequest('The availability has problems', timing.join('; '));
    // "submission" is the default record every form has; it cannot be taken for a document of the form's own.
    const docIds = new Set<string>([SUBMISSION_RECORD_ID]);
    for (const d of settings.documents) {
      if (d.id === SUBMISSION_RECORD_ID) throw badRequest(`The key "${SUBMISSION_RECORD_ID}" is kept for the default Submission record`);
      if (docIds.has(d.id)) throw badRequest(`Two documents share the key "${d.id}"`);
      docIds.add(d.id);
    }
    const docProblems = settings.documents.flatMap((d) => lintDocument(d, def));
    if (docProblems.length) throw badRequest('The documents have problems', docProblems.join('; '));
    if (settings.documentDraft) {
      const drafted = settings.documentDraft.documents;
      const dup = drafted.find((d, i) => d.id === SUBMISSION_RECORD_ID || drafted.findIndex((x) => x.id === d.id) !== i);
      if (dup) throw badRequest(`The key "${dup.id}" is taken`);
    }
    const wf = settings.workflow;
    const stageSections = def.sections.filter((s) => s.fillAt);
    if (!wf.enabled) {
      if (stageSections.length) throw badRequest('The workflow has problems', `"${stageSections[0]!.title || stageSections[0]!.key}" is filled in by an approval step, but the workflow is off`);
      return;
    }
    const graph = wf.graph ?? graphFromStages(wf.stages);
    if (!wf.graph && !wf.stages.length) throw badRequest('Add at least one approval stage, or turn the workflow off');
    if (!wf.graph) {
      const seen = new Set<string>();
      for (const st of wf.stages) {
        if (seen.has(st.key)) throw badRequest(`Duplicate stage key "${st.key}"`);
        seen.add(st.key);
      }
    }
    const problems = lintWorkflow(graph, def);
    for (const s of stageSections) if (!graph.nodes.some((n) => n.type === 'approval' && n.id === s.fillAt)) problems.push(`"${s.title || s.key}" is filled in at the step "${s.fillAt}", which the workflow does not have`);
    for (const n of graph.nodes)
      if (n.type === 'notify')
        for (const d of n.documents) {
          if (!docIds.has(d.id)) problems.push(`"${n.name || n.id}" attaches the document "${d.id}", which the form does not have`);
          else if (settings.documents.find((x) => x.id === d.id)?.visibility === 'internal') problems.push(`"${n.name || n.id}" attaches the document "${d.id}", which is internal: make it emailable first`);
        }
    if (problems.length) throw badRequest('The workflow has problems', problems.join('; '));
    for (const n of graph.nodes) {
      if (n.type === 'approval') await this.projects.assertGroup(tx, projectId, n.approvers.group);
      if (n.type === 'notify') await this.projects.assertGroup(tx, projectId, n.to.approvers?.group);
    }
  }

  /** Bound attributes and data elements must exist (attributes need a subject type, or a place question). */
  private async checkBindings(tx: Tx, projectId: string, def: FormDefinition, subjectType: string | null) {
    const qs = questionsOf(def);
    const types = new Map((await tx.selectFrom('entity_type').select(['key', 'attributes']).where('project_id', '=', projectId).execute()).map((t) => [t.key, new Set((t.attributes as { key: string }[]).map((x) => x.key))]));
    for (const q of qs.filter((x) => x.type === 'entity'))
      if (q.entityType && !types.has(q.entityType)) throw badRequest(`"${q.key}" chooses from "${q.entityType}", which is not a type in this project`);
    const main = qs.find((q) => q.primary);
    if (main && (!subjectType || subjectType === PROJECT_SUBJECT || main.entityType !== subjectType))
      throw badRequest(`"${main.key}" can be the main entity only when it chooses the type this form is about`);
    const here = qs.filter((q) => q.bind && !q.bind.entity && !q.bind.child);
    const there = qs.filter((q) => q.bind?.entity);
    const made = def.creates;
    const childBound = qs.filter((q) => q.bind?.child);
    if (childBound.length && !made) throw badRequest('Answers are saved to a new entity, but the form does not create one');
    if (made) {
      const child = (await tx.selectFrom('entity_type').select(['attributes', 'parent_types']).where('project_id', '=', projectId).where('key', '=', made.type).executeTakeFirst());
      if (!child) throw badRequest(`The form creates a "${made.type}", which is not a type in this project`);
      const parentType = made.parent === '$subject' ? subjectType : qs.find((q) => q.key === made.parent && q.type === 'entity')?.entityType;
      if (!parentType) throw badRequest(made.parent === '$subject' ? 'The form creates an entity under its own entity, but is not about one' : `"${made.parent}" is not an entity question`);
      if (!child.parent_types.includes(parentType)) throw badRequest(`A ${made.type} can't be placed under a ${parentType}`);
      for (const k of [made.code, made.name]) if (!qs.some((q) => q.key === k && (q.type === 'text' || q.type === 'textarea') && !q.discard)) throw badRequest(`"${k}" must be a text question that is kept with the submission`);
      const own = new Set((child.attributes as { key: string }[]).map((x) => x.key));
      const bad = childBound.filter((q) => q.bind!.attribute && !own.has(q.bind!.attribute));
      if (bad.length) throw badRequest(`Unknown attribute(s) of ${made.type}: ${bad.map((q) => q.bind!.attribute).join(', ')}`);
    }
    const attrBound = here.filter((q) => q.bind!.attribute);
    const elemBound = qs.filter((q) => q.bind?.element);
    if ((here.length) && !subjectType) throw badRequest('Bindings need a subject entity type');
    if (attrBound.length) {
      const keys = types.get(subjectType!) ?? new Set<string>();
      const bad = attrBound.filter((q) => !keys.has(q.bind!.attribute!));
      if (bad.length) throw badRequest(`Unknown attribute(s): ${bad.map((q) => q.bind!.attribute).join(', ')}`);
    }
    for (const q of there.filter((x) => x.bind!.attribute)) {
      const target = qs.find((x) => x.key === q.bind!.entity);
      if (!(types.get(target?.entityType ?? '')?.has(q.bind!.attribute!) ?? false)) throw badRequest(`"${q.key}" saves to attribute "${q.bind!.attribute}", which "${target?.entityType ?? q.bind!.entity}" does not have`);
    }
    if (elemBound.length) {
      const keys = new Set((await tx.selectFrom('data_element').select('ref').where('project_id', '=', projectId).execute()).map((x) => x.ref));
      const bad = elemBound.filter((q) => !keys.has(q.bind!.element!));
      if (bad.length) throw badRequest(`Unknown data element(s): ${bad.map((q) => q.bind!.element).join(', ')}`);
    }
  }

  /** Freezes the draft as the next immutable version. */
  async publish(actor: Actor, tenantId: string, project: string, key: string): Promise<FormDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    let delta: ReturnType<typeof changes> = [];
    const version = await this.projects.cellTx(tenantId, async (tx) => {
      const f = await tx
        .selectFrom('form as f')
        .leftJoin('entity_type as t', 't.id', 'f.subject_type_id')
        .select(['f.id', 'f.draft', 'f.current_version', 't.system as type_system', 't.key as type_key'])
        .where('f.project_id', '=', a.project.id)
        .where('f.key', '=', key)
        .executeTakeFirst();
      if (!f) throw notFound('Form');
      const def = FormDefinition.parse(f.draft);
      const problems = lintDefinition(def);
      // A form about an entity says which one in a question of its own.
      if (f.type_key && !f.type_system && !questionsOf(def).some((q) => q.primary)) problems.push(`Add the question that says which ${f.type_key} the form is about`);
      if (problems.length) throw badRequest('The form has problems', problems.join('; '));
      const next = (f.current_version ?? 0) + 1;
      // What the last version asked, to show what this one adds, drops and rewords.
      const prev = f.current_version ? await tx.selectFrom('form_version').select('definition').where('form_id', '=', f.id).where('version', '=', f.current_version).executeTakeFirst() : undefined;
      const labels = (d: FormDefinition | null) => new Map((d?.sections.flatMap((x) => x.questions) ?? []).filter((q) => q.type !== 'note').map((q) => [q.key, q.label || q.key]));
      const was = labels(prev?.definition ? FormDefinition.parse(prev.definition) : null);
      const now = labels(def);
      delta = changes([
        ['Version', f.current_version, next],
        ['Questions', prev ? was.size : null, now.size],
        ['Added', null, [...now].filter(([k]) => !was.has(k)).map(([, l]) => l)],
        ['Removed', [...was].filter(([k]) => !now.has(k)).map(([, l]) => l), null],
        ['Reworded', [...now].filter(([k, l]) => was.has(k) && was.get(k) !== l).map(([k]) => was.get(k)), [...now].filter(([k, l]) => was.has(k) && was.get(k) !== l).map(([, l]) => l)],
      ]);
      await tx.insertInto('form_version').values({ form_id: f.id, tenant_id: tenantId, version: next, definition: JSON.stringify(def), published_by: actor.id }).execute();
      await tx.updateTable('form').set({ current_version: next, updated_at: this.ctx.now() }).where('id', '=', f.id).execute();
      return next;
    });
    await audit(this.ctx, actor.id, tenantId, 'form.published', { project: a.project.key, form: key, version, changes: delta });
    return this.list(actor, tenantId, project);
  }

  /** Every published version, newest first. */
  async versions(actor: Actor, tenantId: string, project: string, key: string): Promise<FormVersionDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const rows = await this.projects.cellTx(tenantId, (tx) =>
      tx
        .selectFrom('form_version as v')
        .innerJoin('form as f', 'f.id', 'v.form_id')
        .select(['v.version', 'v.definition', 'v.published_at', 'v.published_by'])
        .where('f.project_id', '=', a.project.id)
        .where('f.key', '=', key)
        .orderBy('v.version', 'desc')
        .limit(100)
        .execute(),
    );
    const ids = [...new Set(rows.flatMap((r) => (r.published_by ? [r.published_by] : [])))];
    const people = ids.length ? await this.ctx.db.selectFrom('user_identity').select(['id', 'display_name', 'email']).where('id', 'in', ids).execute() : [];
    const nameOf = new Map(people.map((p) => [p.id, p.display_name ?? p.email]));
    return rows.map((r) => ({
      version: r.version,
      publishedAt: r.published_at.toISOString(),
      publishedBy: r.published_by ? (nameOf.get(r.published_by) ?? null) : null,
      definition: FormDefinition.parse(r.definition),
    }));
  }

  async archive(actor: Actor, tenantId: string, project: string, key: string): Promise<FormDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, (tx) =>
      tx.updateTable('form').set({ archived_at: this.ctx.now() }).where('project_id', '=', a.project.id).where('key', '=', key).execute(),
    );
    return this.list(actor, tenantId, project);
  }

  /**
   * Records a submission against a published version. Answers are validated with
   * the same runtime the browser uses; bound questions update the subject entity's
   * attributes and write observations for the form's period. Re-sending the same
   * submission id is a no-op (offline retries).
   */
  async submit(actor: Actor, tenantId: string, project: string, key: string, input: z.output<typeof SubmissionInput>): Promise<SubmissionDto> {
    const a = await this.projects.access(actor, tenantId, project);
    const id = await dataCall(() =>
      this.projects.cellTx(tenantId, async (tx) => {
        const f = await tx
          .selectFrom('form as f')
          .leftJoin('entity_type as t', 't.id', 'f.subject_type_id')
          .select(['f.id', 'f.name', 'f.subject_type_id', 'f.settings', 't.key as type_key', 't.system as type_system'])
          .where('f.project_id', '=', a.project.id)
          .where('f.key', '=', key)
          .where('f.archived_at', 'is', null)
          .executeTakeFirst();
        if (!f) throw notFound('Form');
        const settings = settingsOf(f.settings);
        if (!canFill(a, settings)) throw forbidden('You are not allowed to fill in this form.');
        const existing = await tx.selectFrom('submission').select(['id', 'form_id']).where('id', '=', input.id).executeTakeFirst();
        if (existing) {
          if (existing.form_id !== f.id) throw conflict('Submission id in use');
          return existing.id; // idempotent retry
        }
        // When the form is open, and the limits. (A retry of something already saved passed these when it was first sent.)
        const lim = settings.limits;
        const counts = { total: 0, mine: 0 };
        if (lim.maxSubmissions !== null) counts.total = Number((await tx.selectFrom('submission').select((e) => e.fn.countAll<string>().as('n')).where('form_id', '=', f.id).executeTakeFirstOrThrow()).n);
        if (lim.perPerson !== null) counts.mine = Number((await tx.selectFrom('submission').select((e) => e.fn.countAll<string>().as('n')).where('form_id', '=', f.id).where('submitted_by', '=', actor.id).executeTakeFirstOrThrow()).n);
        const open = fillState(settings, this.ctx.now(), counts);
        if (open.state !== 'open') throw new HttpError(403, open.message ?? 'This form is not open.');
        const v = await tx.selectFrom('form_version').select('definition').where('form_id', '=', f.id).where('version', '=', input.version).executeTakeFirst();
        if (!v) throw badRequest(`Version ${input.version} of this form is not published`);
        const def = FormDefinition.parse(v.definition);

        // The place the form is about is chosen above it, or by a question marked as the main place.
        const main = questionsOf(def).find((q) => q.primary);
        const subjectId = input.entityId ?? (main && typeof input.answers[main.key] === 'string' ? (input.answers[main.key] as string) : null);
        let entity: Subject | undefined;
        if (f.subject_type_id) {
          // A form about the project itself needs no choice: the subject is the project's own entity.
          if (!f.type_system && !subjectId) throw badRequest('Choose what this submission is about');
          entity = await tx
            .selectFrom('entity')
            .select(['id', 'code', 'name', sql<string>`path::text`.as('path')])
            // A form about an organisation type may also be about its shared entities.
            .where(sql<boolean>`type_id in (select s.id from entity_type s where s.id = ${f.subject_type_id} or (s.project_id is null and s.org_type_id = (select org_type_id from entity_type where id = ${f.subject_type_id})))`)
            .$if(!f.type_system, (q) => q.where('id', '=', subjectId!))
            .executeTakeFirst();
          if (!entity) throw badRequest('That entity is not a valid subject for this form');
          if (f.type_system) entity = { ...entity, path: PROJECT_WIDE };
          else if (!inPart(a.roots, entity.path)) throw forbidden('That entity is outside your part of the project.');
        }

        // The parts approvers fill in at a step are not the applicant's to answer.
        const result = validate(forFiller(forViewer(def, a)), input.answers);
        if (!result.ok) throw new SubmissionInvalid(result.errors);
        await this.checkReferences(tx, a, def, result.all, entity);
        await this.storeSubmission(tx, {
          tenantId,
          projectId: a.project.id,
          form: { id: f.id, key, name: f.name, typeKey: f.type_key },
          def,
          settings,
          entity,
          version: input.version,
          answers: result.clean,
          checked: result.all,
          collectedAt: new Date(input.collectedAt),
          submissionId: input.id,
          submittedBy: actor.id,
          location: input.location,
        });
        return input.id;
      }),
    );
    return this.submission(actor, tenantId, project, id);
  }

  /**
   * Stores a submission and sets its workflow going (or, with no workflow, writes what it binds to entities). The same
   * for someone signed in and for someone who came through a link: only who sent it, and the link, differ.
   */
  async storeSubmission(
    tx: Tx,
    s: {
      tenantId: string;
      projectId: string;
      form: { id: string; key: string; name: string; typeKey: string | null };
      def: FormDefinition;
      settings: FormSettings;
      entity: Subject | undefined;
      version: number;
      /** The answers that are kept. */
      answers: Record<string, unknown>;
      /** Every checked answer, including ones not kept, for the workflow's decisions. */
      checked: Record<string, unknown>;
      collectedAt: Date;
      submissionId: string;
      submittedBy: string | null;
      location: { lat: number; lon: number } | null;
      /** Set when it came through a link: which one, and the name or email the person gave. */
      link?: { id: string; submitter: string | null };
    },
  ) {
    const graph = graphOf(s.settings);
    const step = graph ? engine(() => begin(graph, valuesOf(s.def, s.checked))) : null;
    const st = this.stateOf(graph, step, 'start');
    await this.usage?.assertIn(tx, s.tenantId, 'submissions_per_month');
    await tx
      .insertInto('submission')
      .values({
        id: s.submissionId,
        tenant_id: s.tenantId,
        project_id: s.projectId,
        form_id: s.form.id,
        form_version: s.version,
        entity_id: s.entity?.id ?? null,
        answers: JSON.stringify(s.answers),
        submitted_by: s.submittedBy,
        collected_at: s.collectedAt,
        location: s.location ? sql`ST_SetSRID(ST_MakePoint(${s.location.lon}, ${s.location.lat}), 4326)` : null,
        status: st.status,
        stage: st.stage,
        node_id: st.node_id,
        outcome_node: st.outcome_node,
        decided_at: st.decided_at,
        ...(s.link && { link_id: s.link.id, submitter: s.link.submitter }),
      })
      .execute();
    // A form can ask for work to be opened for each submission: a ticket from a request, a task from a visit.
    await openWorkFromSubmission(this.ctx, tx, { tenantId: s.tenantId, projectId: s.projectId, formName: s.form.name, work: s.settings.work, answers: s.answers, submissionId: s.submissionId, entityId: s.entity?.id ?? null, requesterId: s.submittedBy, requesterName: s.link?.submitter ?? null, source: s.link ? 'public' : 'form' });
    await fireEvent(tx, { tenantId: s.tenantId, projectId: s.projectId, event: 'submission.created', ref: s.form.key, actorId: s.submittedBy, detail: { submission: s.submissionId, entity: s.entity?.id ?? null, ...(s.link && { link: s.link.id }) } });
    // The activity log: who sent what, from where (the address comes with the request).
    const pk = await tx.selectFrom('project').select('key').where('id', '=', s.projectId).executeTakeFirst();
    await audit(this.ctx, s.submittedBy, s.tenantId, 'submission.created', { project: pk?.key, form: s.form.key, submission: s.submissionId, ...(s.entity && { entity: s.entity.name }), ...(s.link ? { via: 'link', submitter: s.link.submitter } : { via: 'app' }) }).catch(() => undefined);
    const wf = { tenantId: s.tenantId, projectId: s.projectId, formKey: s.form.key, formName: s.form.name, def: s.def, typeKey: s.form.typeKey, entity: s.entity, answers: s.answers, collectedAt: s.collectedAt, submissionId: s.submissionId, submittedBy: s.submittedBy, actorId: s.submittedBy };
    if (graph && step) {
      if (step.status === 'in_review') await this.logReview(tx, wf, graph, step.node, 'submitted', '', s.submittedBy);
      await this.runEffects(tx, wf, graph, step, st.status);
    } else await this.applyBindings(tx, wf);
  }

  /** Writes bound answers onto the subject entity (or the place chosen in a place question) and as observations, once a submission is final. */
  private async applyBindings(
    tx: Tx,
    s: { tenantId: string; projectId: string; def: FormDefinition; typeKey: string | null; entity: Subject | undefined; answers: Record<string, unknown>; collectedAt: Date; submissionId: string; actorId: string | null },
  ) {
    const qs = questionsOf(s.def).filter((q) => q.key in s.answers);
    const at = periodStart(s.def.period, s.collectedAt);
    const entity = s.entity;
    if (entity) {
      const attrs = Object.fromEntries(qs.filter((q) => q.bind?.attribute && !q.bind.entity && !q.bind.child).map((q) => [q.bind!.attribute!, s.answers[q.key]]));
      if (Object.keys(attrs).length)
        await upsertEntities(tx, {
          tenantId: s.tenantId,
          projectId: s.projectId,
          typeKey: s.typeKey!,
          rows: [{ code: entity.code, name: entity.name, attributes: attrs }],
          source: 'form',
          sourceRef: s.submissionId,
          actorId: s.actorId,
        });
      const items = qs.filter((q) => q.bind?.element && !q.bind.entity && !q.bind.child).map((q) => ({ entityId: entity.id, element: q.bind!.element!, at, value: s.answers[q.key] }));
      if (items.length) await writeObservations(tx, { tenantId: s.tenantId, projectId: s.projectId, items, source: 'form', sourceRef: s.submissionId });
    }
    await this.createChild(tx, s, qs, at);
    // Answers saved to a place chosen in another question.
    const elsewhere = qs.filter((q) => q.bind?.entity && typeof s.answers[q.bind.entity] === 'string');
    if (!elsewhere.length) return;
    const ids = [...new Set(elsewhere.map((q) => s.answers[q.bind!.entity!] as string))];
    const places = await tx
      .selectFrom('entity as e')
      .innerJoin('entity_type as t', 't.id', 'e.type_id')
      .select(['e.id', 'e.code', 'e.name', 't.key as type_key'])
      .where('e.id', 'in', ids)
      .where('e.project_id', '=', s.projectId) // entities shared by the organisation are read, not rewritten, by forms
      .execute();
    for (const place of places) {
      const mine = elsewhere.filter((q) => s.answers[q.bind!.entity!] === place.id);
      const attrs = Object.fromEntries(mine.filter((q) => q.bind!.attribute).map((q) => [q.bind!.attribute!, s.answers[q.key]]));
      if (Object.keys(attrs).length)
        await upsertEntities(tx, { tenantId: s.tenantId, projectId: s.projectId, typeKey: place.type_key, rows: [{ code: place.code, name: place.name, attributes: attrs }], source: 'form', sourceRef: s.submissionId, actorId: s.actorId });
      const items = mine.filter((q) => q.bind!.element).map((q) => ({ entityId: place.id, element: q.bind!.element!, at, value: s.answers[q.key] }));
      if (items.length) await writeObservations(tx, { tenantId: s.tenantId, projectId: s.projectId, items, source: 'form', sourceRef: s.submissionId });
    }
  }

  /** Creates the entity the form makes under the chosen place, and saves the answers bound to it. */
  private async createChild(
    tx: Tx,
    s: { tenantId: string; projectId: string; def: FormDefinition; entity: Subject | undefined; answers: Record<string, unknown>; submissionId: string; actorId: string | null },
    qs: Question[],
    at: Date,
  ) {
    const made = s.def.creates;
    if (!made) return;
    const parentId = made.parent === '$subject' ? s.entity?.id : s.answers[made.parent];
    const code = String(s.answers[made.code] ?? '').trim();
    const name = String(s.answers[made.name] ?? '').trim() || code;
    if (typeof parentId !== 'string' || !code) throw badRequest('Choose where the new entity goes and give it a code');
    const clash = await tx.selectFrom('entity as e').innerJoin('entity_type as t', 't.id', 'e.type_id').select('e.id').where('e.project_id', '=', s.projectId).where('t.key', '=', made.type).where('e.code', '=', code).executeTakeFirst();
    if (clash) throw conflict(`There is already a ${made.type} with the code "${code}"`);
    const mine = qs.filter((q) => q.bind?.child);
    const attrs = Object.fromEntries(mine.filter((q) => q.bind!.attribute).map((q) => [q.bind!.attribute!, s.answers[q.key]]));
    const made_ = await upsertEntities(tx, { tenantId: s.tenantId, projectId: s.projectId, typeKey: made.type, rows: [{ code, name, parentId, attributes: attrs }], source: 'form', sourceRef: s.submissionId, actorId: s.actorId });
    const id = made_.ids.get(code);
    const items = mine.filter((q) => q.bind!.element).map((q) => ({ entityId: id!, element: q.bind!.element!, at, value: s.answers[q.key] }));
    if (id && items.length) await writeObservations(tx, { tenantId: s.tenantId, projectId: s.projectId, items, source: 'form', sourceRef: s.submissionId });
  }

  /**
   * Checks the answers that point at other things: each place must be of the asked type, in the
   * person's part of the project and related as the question says; each picture must be one uploaded here.
   */
  async checkReferences(tx: Tx, a: Pick<ProjectAccess, 'roots'> & { project: { id: string } }, def: FormDefinition, answers: Record<string, unknown>, subject: Subject | undefined) {
    // The top of the form, and each row of each repeating section, are checked as separate scopes.
    type Scope = { qs: Question[]; a: Record<string, unknown>; prefix: string; outer: Record<string, unknown> };
    const scopes: Scope[] = [{ qs: def.sections.filter((x) => !x.repeat).flatMap((x) => x.questions), a: answers, prefix: '', outer: {} }];
    for (const sec of def.sections.filter((x) => x.repeat)) {
      const rows = Array.isArray(answers[sec.key]) ? (answers[sec.key] as Record<string, unknown>[]) : [];
      rows.forEach((row, i) => scopes.push({ qs: sec.questions, a: row, prefix: `${sec.key}.${i}.`, outer: answers }));
    }
    const FILE_TYPES = ['image', 'file', 'signature'];
    const fileIds = (q: Question, v: unknown): string[] => (FILE_TYPES.includes(q.type) ? (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string') : []);
    const ids = [...new Set(scopes.flatMap((sc) => sc.qs.filter((q) => q.type === 'entity' && typeof sc.a[q.key] === 'string').map((q) => sc.a[q.key] as string)))];
    const images = [...new Set(scopes.flatMap((sc) => sc.qs.flatMap((q) => fileIds(q, sc.a[q.key]))))];
    const errors: Record<string, string> = {};
    if (ids.length) {
      const rows = await tx
        .selectFrom('entity as e')
        .innerJoin('entity_type as t', 't.id', 'e.type_id')
        .select(['e.id', 't.key as type_key', sql<string>`e.path::text`.as('path')])
        .where('e.id', 'in', ids)
        .where(sql<boolean>`(e.project_id = ${a.project.id} or e.project_id is null)`)
        .execute();
      const byId = new Map(rows.map((r) => [r.id, r]));
      const depth = (p: string) => p.split('.').length;
      const under = (child: string, parent: string) => child.startsWith(`${parent}.`);
      for (const sc of scopes) {
        for (const q of sc.qs) {
          const id = q.type === 'entity' ? (sc.a[q.key] as string | undefined) : undefined;
          if (!id) continue;
          const at = sc.prefix + q.key;
          const e = byId.get(id);
          if (!e || e.type_key !== q.entityType || !inPart(a.roots, e.path)) {
            errors[at] = 'Choose one of the entities offered';
            continue;
          }
          if (!q.filter) continue;
          const dep = q.filter.of;
          const base = dep === '$subject' ? subject?.path : byId.get(String(sc.a[dep] ?? sc.outer[dep] ?? ''))?.path;
          if (!base || base === PROJECT_WIDE) {
            if (dep !== '$subject') errors[at] = 'Choose the entity this depends on first';
            continue;
          }
          const ok =
            q.filter.relation === 'descendants' ? under(e.path, base) :
            q.filter.relation === 'children' ? under(e.path, base) && depth(e.path) === depth(base) + 1 :
            q.filter.relation === 'ancestors' ? under(base, e.path) :
            under(base, e.path) && depth(base) === depth(e.path) + 1;
          if (!ok) errors[at] = 'That entity is not related as this question needs';
        }
      }
    }
    if (images.length) {
      const have = new Set((await tx.selectFrom('form_attachment').select('id').where('project_id', '=', a.project.id).where('id', 'in', images).execute()).map((r) => r.id));
      for (const sc of scopes) for (const q of sc.qs) if (fileIds(q, sc.a[q.key]).some((id) => !have.has(id))) errors[sc.prefix + q.key] = 'Add the picture again';
    }
    if (Object.keys(errors).length) throw new SubmissionInvalid(errors);
  }

  /** A picture attached while filling a form. */
  async uploadAttachment(actor: Actor, tenantId: string, project: string, key: string, file: { name: string; contentType: string; content: Buffer }): Promise<AttachmentDto> {
    const a = await this.projects.access(actor, tenantId, project);
    if (!ATTACHMENT_TYPES.test(file.contentType)) throw badRequest('Only pictures (JPEG, PNG, WebP, GIF), PDF, Word, Excel, PowerPoint, CSV or text files can be attached');
    if (!file.content.length) throw badRequest('The picture is empty');
    if (file.content.length > ATTACHMENT_MAX_BYTES) throw badRequest(`Pictures are limited to ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB`);
    await this.usage?.assertStorage(tenantId, file.content.length);
    return this.projects.cellTx(tenantId, async (tx) => {
      const f = await tx.selectFrom('form').select('settings').where('project_id', '=', a.project.id).where('key', '=', key).where('archived_at', 'is', null).executeTakeFirst();
      if (!f || !canFill(a, settingsOf(f.settings))) throw notFound('Form');
      const name = [...file.name].filter((ch) => ch >= ' ' && ch !== '/' && ch !== '\\').join('').slice(0, 200) || 'picture';
      const id = uuidv7();
      await tx.insertInto('form_attachment').values({ id, tenant_id: tenantId, project_id: a.project.id, form_key: key, name, content_type: file.contentType, size: file.content.length, content: file.content, uploaded_by: actor.id }).execute();
      return { id, name, contentType: file.contentType, size: file.content.length };
    });
  }

  /** A stored picture, for people who can see the form it belongs to. */
  async attachment(actor: Actor, tenantId: string, project: string, id: string): Promise<{ name: string; contentType: string; content: Buffer }> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, async (tx) => {
      const r = await tx.selectFrom('form_attachment').select(['name', 'content_type', 'content', 'form_key']).where('project_id', '=', a.project.id).where('id', '=', id).executeTakeFirst();
      if (!r) throw notFound('Picture');
      const f = await tx.selectFrom('form').select('settings').where('project_id', '=', a.project.id).where('key', '=', r.form_key).executeTakeFirst();
      if (f && !canSee(a, settingsOf(f.settings).fillGroup)) throw notFound('Picture');
      return { name: r.name, contentType: r.content_type, content: r.content };
    });
  }

  /** The submission columns a workflow step leaves behind. Rejection keeps the node it was rejected at. */
  private stateOf(graph: WorkflowGraph | null, step: WorkflowStep | null, mode: 'start' | 'decision') {
    if (!graph || !step) return { status: 'complete' as const, node_id: null, stage: null, decided_at: null, outcome_node: null, patch: { status: 'complete' as const, outcome_node: null } };
    // Reaching the end without anyone having to decide (nothing applied) is `complete`, not `approved`.
    const status = step.status === 'approved' && mode === 'start' ? ('complete' as const) : step.status;
    const idx = approvalNodes(graph).findIndex((n) => n.id === step.node);
    const decided_at = status === 'approved' || status === 'rejected' ? this.ctx.now() : null;
    const node_id = status === 'complete' ? null : step.node;
    const stage = idx >= 0 && (status === 'in_review' || status === 'returned') ? idx : null;
    // The end reached, so the form's own name for it can be shown.
    const outcome_node = status === 'approved' || status === 'rejected' ? step.node : null;
    const patch = status === 'rejected' && mode === 'decision' ? { status, decided_at, outcome_node } : { status, node_id, stage, decided_at, outcome_node };
    return { status, node_id, stage, decided_at, outcome_node, patch };
  }

  private async logReview(
    tx: Tx,
    c: { tenantId: string; submissionId: string },
    graph: WorkflowGraph | null,
    nodeId: string | null,
    decision: ReviewDto['decision'],
    comment: string,
    actorId: string | null = null,
  ) {
    const node = graph?.nodes.find((n) => n.id === nodeId);
    const idx = graph && nodeId ? approvalNodes(graph).findIndex((n) => n.id === nodeId) : -1;
    await tx
      .insertInto('submission_review')
      .values({ tenant_id: c.tenantId, submission_id: c.submissionId, stage: idx >= 0 ? idx : null, stage_name: node ? node.name || node.id : null, node_id: node?.id ?? null, decision, comment, actor_id: actorId })
      .execute();
  }

  private async cancelTimers(tx: Tx, submissionId: string, except?: string) {
    let q = tx.updateTable('workflow_task').set({ status: 'cancelled', done_at: this.ctx.now() }).where('submission_id', '=', submissionId).where('kind', '=', 'timer').where('status', '=', 'pending');
    if (except) q = q.where('id', '<>', except);
    await q.execute();
  }

  /**
   * Carries out what a workflow step passed through: entity writes happen now, in the
   * same transaction as the decision; email, webhooks and timers go to the outbox for the runner.
   * Forms without an entity node write their bound answers once the submission is final.
   */
  /** The submission's own details, to use like answers in messages, headers and documents (see `SUBMISSION_FIELDS`). */
  async submissionFields(tx: Tx, c: { submissionId: string; formName: string; submittedBy: string | null }, status: SubmissionStatus): Promise<Record<string, string>> {
    const row = await tx
      .selectFrom('submission as s')
      .innerJoin('form as f', 'f.id', 's.form_id')
      .innerJoin('project as p', 'p.id', 's.project_id')
      .select(['s.submitted_at', 's.collected_at', 's.decided_at', 's.submitter', 'p.name as project_name', 'f.settings'])
      .where('s.id', '=', c.submissionId)
      .executeTakeFirst();
    const zone = row ? settingsOf(row.settings).availability.timezone : 'UTC';
    const when = (d: Date | null | undefined, time = true) => {
      if (!d) return '';
      try {
        return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', ...(time && { timeStyle: 'short' }), timeZone: zone }).format(d);
      } catch {
        return d.toISOString();
      }
    };
    const who = c.submittedBy ? await this.ctx.db.selectFrom('user_identity').select(['display_name', 'email']).where('id', '=', c.submittedBy).executeTakeFirst() : undefined;
    const typed = row?.submitter ?? '';
    const label: Record<SubmissionStatus, string> = { complete: 'Received', in_review: 'In review', approved: 'Approved', rejected: 'Rejected', returned: 'Sent back for changes' };
    return {
      _submitted_at: when(row?.submitted_at),
      _submitted_by: who?.display_name ?? who?.email ?? typed,
      _submitted_by_email: who?.email ?? (typed.includes('@') ? typed : ''),
      _collected_at: when(row?.collected_at),
      _decided_at: when(row?.decided_at),
      _status: label[status],
      _submission_id: c.submissionId,
      _form_name: c.formName,
      _project_name: row?.project_name ?? '',
      _today: when(this.ctx.now(), false),
      _printed_at: when(this.ctx.now()),
    };
  }

  private async runEffects(tx: Tx, c: WorkflowRun, graph: WorkflowGraph, step: WorkflowStep, status: SubmissionStatus) {
    const bind = () => this.applyBindings(tx, { ...c, actorId: c.submittedBy ?? c.actorId });
    const task = (node: string, kind: 'email' | 'webhook' | 'timer', payload: Record<string, unknown>, dueAt?: Date) =>
      tx
        .insertInto('workflow_task')
        .values({ id: uuidv7(), tenant_id: c.tenantId, project_id: c.projectId, submission_id: c.submissionId, node_id: node, kind, payload: JSON.stringify(payload), ...(dueAt && { due_at: dueAt.toISOString() }) })
        .execute();
    // Messages and webhooks can use the submission's own details (when, by whom…) as well as the answers.
    const needsDetails = step.effects.some((e) => e.kind === 'notify' || e.kind === 'webhook');
    const values = { ...valuesOf(c.def, c.answers), ...(needsDetails ? await this.submissionFields(tx, c, status) : {}) };
    for (const e of step.effects) {
      if (e.kind === 'entity') await bind();
      else if (e.kind === 'notify')
        await task(e.node.id, 'email', {
          subject: interpolate(e.node.subject, values),
          text: mdToText(e.node.body, fillFrom(values)) || `${c.formName}: ${interpolate(e.node.subject, values)}`,
          html: e.node.body ? mdToHtml(e.node.body, fillFrom(values)) : '',
          to: e.node.to,
          attachments: e.node.attachments.map((a) => a.id),
          attachQuestions: e.node.attachQuestions,
          documents: e.node.documents,
        });
      else if (e.kind === 'webhook')
        await task(e.node.id, 'webhook', {
          url: e.node.url,
          method: e.node.method,
          // Values may name answers (`Bearer ${token}`); a line break in an answer must not become a second header.
          headers: Object.fromEntries(Object.entries(e.node.headers).map(([k, v]) => [k, interpolate(v, values).replace(/[\r\n]+/g, ' ')])),
          body: { event: 'form.workflow', form: c.formKey, node: e.node.id, status, submission: c.submissionId, entity: c.entity?.id ?? null, answers: c.answers },
        });
      else await task(e.node, 'timer', { reason: e.reason }, new Date(this.ctx.now().getTime() + e.hours * 3_600_000));
    }
    if (!graph.nodes.some((n) => n.type === 'entity') && (status === 'approved' || status === 'complete')) await bind();
    const ev = { tenantId: c.tenantId, projectId: c.projectId, ref: c.formKey, actorId: c.actorId, detail: { submission: c.submissionId, entity: c.entity?.id ?? null } };
    if (status === 'approved') await fireEvent(tx, { ...ev, event: 'submission.approved' });
    else if (status === 'rejected') await fireEvent(tx, { ...ev, event: 'submission.rejected' });
    else if (status === 'returned') await fireEvent(tx, { ...ev, event: 'submission.returned' });
  }

  /** Loads what a workflow step needs about a submission, locking it. */
  private async loadForDecision(tx: Tx, projectId: string, id: string) {
    const s = await tx
      .selectFrom('submission as s')
      .innerJoin('form as f', 'f.id', 's.form_id')
      .innerJoin('form_version as v', (j) => j.onRef('v.form_id', '=', 's.form_id').onRef('v.version', '=', 's.form_version'))
      .leftJoin('entity_type as t', 't.id', 'f.subject_type_id')
      .leftJoin('entity as e', 'e.id', 's.entity_id')
      .select([
        's.id',
        's.status',
        's.stage',
        's.node_id',
        's.answers',
        's.submitted_by',
        's.collected_at',
        'f.key as form_key',
        'f.name as form_name',
        'f.settings',
        'v.definition',
        't.key as type_key',
        'e.id as entity_id',
        'e.code as entity_code',
        'e.name as entity_name',
        sql<string | null>`case when t.system then '' else e.path::text end`.as('entity_path'),
      ])
      .where('s.id', '=', id)
      .where('s.project_id', '=', projectId)
      .forUpdate('s')
      .executeTakeFirst();
    if (!s) throw notFound('Submission');
    const entity: Subject | undefined = s.entity_id ? { id: s.entity_id, code: s.entity_code!, name: s.entity_name!, path: s.entity_path ?? '' } : undefined;
    return { ...s, settings: settingsOf(s.settings), def: FormDefinition.parse(s.definition), entity, answers: s.answers as Record<string, unknown> };
  }

  /**
   * Approves, rejects or returns a submission at its current stage. Approval moves it
   * to the next stage that applies; after the last one the answers take effect.
   */
  async review(actor: Actor, tenantId: string, project: string, id: string, input: z.output<typeof ReviewInput>): Promise<SubmissionDto> {
    const a = await this.projects.access(actor, tenantId, project);
    let from: string | null = null;
    let to: string | null = null;
    const outcome = await dataCall(() =>
      this.projects.cellTx(tenantId, async (tx) => {
        const s = await this.loadForDecision(tx, a.project.id, id);
        if (!inPart(a.roots, s.entity?.path ?? null) && s.entity) throw notFound('Submission');
        const graph = graphOf(s.settings);
        const nodeId = graph ? parkedNode(graph, s) : null;
        const node = graph?.nodes.find((n) => n.id === nodeId);
        if (!graph || s.status !== 'in_review' || node?.type !== 'approval') throw conflict('Already decided', 'This submission is not waiting for review.');
        if (!canApprove(s.settings, nodeId, a, actor.id, s.submitted_by))
          throw forbidden(s.submitted_by === actor.id ? 'You cannot review your own submission.' : 'You are not an approver for this stage.');
        if (input.decision === 'return' && !node.allowReturn) throw badRequest('This stage cannot send submissions back');
        if (input.decision !== 'approve' && !input.comment) throw badRequest('Add a comment', 'Explain why, so the author knows what to do next.');
        const decision = ({ approve: 'approved', reject: 'rejected', return: 'returned' } as const)[input.decision];
        // Approving also means filling in this step's own part of the form.
        if (input.decision === 'approve' && s.def.sections.some((x) => x.fillAt === node.id)) {
          const mine = validate(forViewer(forStage(s.def, node.id), a), input.answers);
          if (!mine.ok) throw new SubmissionInvalid(mine.errors);
          s.answers = { ...(s.answers as Record<string, unknown>), ...mine.clean };
          await tx.updateTable('submission').set({ answers: JSON.stringify(s.answers) }).where('id', '=', id).execute();
        }
        await this.logReview(tx, { tenantId, submissionId: id }, graph, node.id, decision, input.comment, actor.id);
        await this.cancelTimers(tx, id);
        const event: WorkflowEvent = decision;
        const step = engine(() => advance(graph, node.id, event, valuesOf(s.def, s.answers)));
        const st = this.stateOf(graph, step, 'decision');
        await tx.updateTable('submission').set(st.patch).where('id', '=', id).execute();
        await this.runEffects(
          tx,
          { tenantId, projectId: a.project.id, formKey: s.form_key, formName: s.form_name, def: s.def, typeKey: s.type_key, entity: s.entity, answers: s.answers, collectedAt: s.collected_at, submissionId: id, submittedBy: s.submitted_by, actorId: actor.id },
          graph,
          step,
          st.status,
        );
        from = s.status;
        to = st.status;
        return step.status === 'in_review' ? 'advanced' : decision;
      }),
    );
    await audit(this.ctx, actor.id, tenantId, 'submission.reviewed', { project: a.project.key, submission: id, decision: outcome, changes: changes([['Status', from, to], ['Comment', null, input.comment]]) });
    return this.submission(actor, tenantId, project, id);
  }

  /** The author re-sends a returned submission with corrected answers; its workflow starts over. */
  async resubmit(actor: Actor, tenantId: string, project: string, id: string, input: z.output<typeof ResubmitInput>): Promise<SubmissionDto> {
    const a = await this.projects.access(actor, tenantId, project);
    await dataCall(() =>
      this.projects.cellTx(tenantId, async (tx) => {
        const s = await this.loadForDecision(tx, a.project.id, id);
        if (s.submitted_by !== actor.id) throw forbidden('Only the author can resubmit.');
        if (s.status !== 'returned') throw conflict('Not returned', 'Only submissions sent back for changes can be resubmitted.');
        const result = validate(forFiller(forViewer(s.def, a)), input.answers);
        if (!result.ok) throw new SubmissionInvalid(result.errors);
        // What approvers already filled in stays, though the applicant's answers are replaced.
        const kept = Object.fromEntries(stageAnswerKeys(s.def).filter((k) => k in (s.answers as Record<string, unknown>)).map((k) => [k, (s.answers as Record<string, unknown>)[k]]));
        result.clean = { ...kept, ...result.clean };
        result.all = { ...kept, ...result.all };
        await this.checkReferences(tx, a, s.def, result.all, s.entity);
        const graph = graphOf(s.settings);
        await this.cancelTimers(tx, id);
        const step = graph ? engine(() => begin(graph, valuesOf(s.def, result.all))) : null;
        const st = this.stateOf(graph, step, 'start');
        await tx
          .updateTable('submission')
          .set({ answers: JSON.stringify(result.clean), status: st.status, stage: st.stage, node_id: st.node_id, outcome_node: st.outcome_node, decided_at: st.decided_at })
          .where('id', '=', id)
          .execute();
        const wf = {
          tenantId,
          projectId: a.project.id,
          formKey: s.form_key,
          formName: s.form_name,
          def: s.def,
          typeKey: s.type_key,
          entity: s.entity,
          answers: result.clean,
          collectedAt: s.collected_at,
          submissionId: id,
          submittedBy: s.submitted_by,
          actorId: actor.id,
        };
        if (graph && step) {
          await this.logReview(tx, wf, graph, step.status === 'in_review' ? step.node : null, 'resubmitted', input.comment, actor.id);
          await this.runEffects(tx, wf, graph, step, st.status);
        } else {
          await this.logReview(tx, wf, null, null, 'resubmitted', input.comment, actor.id);
          await this.applyBindings(tx, wf);
        }
      }),
    );
    return this.submission(actor, tenantId, project, id);
  }

  /**
   * A workflow timer came due: an approval's SLA (follow its `timeout` outlet, or just remind its
   * approvers) or a `wait` node (carry on). Stale timers (the submission has moved on) do nothing.
   */
  async runTimer(tenantId: string, task: { id: string; project_id: string; submission_id: string; node_id: string; payload: unknown }): Promise<'fired' | 'stale'> {
    return dataCall(() =>
      this.projects.cellTx(tenantId, async (tx) => {
        const s = await this.loadForDecision(tx, task.project_id, task.submission_id);
        const graph = graphOf(s.settings);
        const node = graph?.nodes.find((n) => n.id === task.node_id);
        if (!graph || !node || s.status !== 'in_review' || parkedNode(graph, s) !== task.node_id) return 'stale' as const;
        const run: WorkflowRun = {
          tenantId,
          projectId: task.project_id,
          formKey: s.form_key,
          formName: s.form_name,
          def: s.def,
          typeKey: s.type_key,
          entity: s.entity,
          answers: s.answers,
          collectedAt: s.collected_at,
          submissionId: task.submission_id,
          submittedBy: s.submitted_by,
          actorId: s.submitted_by,
        };
        if (node.type === 'approval' && !graph.edges.some((e) => e.from === node.id && e.handle === 'timeout')) {
          // No escalation drawn: remind the approvers instead.
          await tx
            .insertInto('workflow_task')
            .values({
              id: uuidv7(),
              tenant_id: tenantId,
              project_id: task.project_id,
              submission_id: task.submission_id,
              node_id: node.id,
              kind: 'email',
              payload: JSON.stringify({
                subject: `Waiting for your review: ${s.form_name}`,
                text: `A submission of "${s.form_name}" has been waiting for review at "${node.name || node.id}" for ${node.slaHours ?? ''} hours.\n\nOpen the review inbox: ${this.ctx.workspaceUrl}/forms/inbox`,
                to: { submitter: false, approvers: node.approvers, emails: [], questions: [] },
              }),
            })
            .execute();
          return 'fired' as const;
        }
        if (node.type === 'approval') await this.logReview(tx, run, graph, node.id, 'timed_out', `No decision within ${node.slaHours} hours`);
        await this.cancelTimers(tx, task.submission_id, task.id);
        const step = engine(() => advance(graph, node.id, 'timeout', valuesOf(s.def, s.answers)));
        const st = this.stateOf(graph, step, 'decision');
        await tx.updateTable('submission').set(st.patch).where('id', '=', task.submission_id).execute();
        await this.runEffects(tx, run, graph, step, st.status);
        return 'fired' as const;
      }),
    );
  }

  async submissions(
    actor: Actor,
    tenantId: string,
    project: string,
    key: string,
    page: { page: number; pageSize: number; entityId?: string; status?: SubmissionStatus; mine?: boolean },
  ): Promise<Page<SubmissionDto>> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, async (tx) => {
      const form = await tx.selectFrom('form').select('settings').where('project_id', '=', a.project.id).where('key', '=', key).executeTakeFirst();
      const settings = form ? settingsOf(form.settings) : null;
      if (!form || !settings || !canSee(a, settings.fillGroup)) throw notFound('Form');
      let q = subFrom(tx).where('f.project_id', '=', a.project.id).where('f.key', '=', key);
      if (page.entityId) q = q.where('s.entity_id', '=', page.entityId);
      if (page.status) q = q.where('s.status', '=', page.status);
      if (a.roots) q = q.where(sql<boolean>`(et.system or e.path <@ any(${a.roots}::ltree[]))`);
      if (page.mine || !seesAll(settings, a, actor.id)) q = q.where('s.submitted_by', '=', actor.id);
      const [items, total] = await Promise.all([
        subRows(q)
          .orderBy('s.submitted_at', 'desc')
          .limit(page.pageSize)
          .offset((page.page - 1) * page.pageSize)
          .execute(),
        q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
      ]);
      const names = await this.projects.userNames(items.map((i) => i.submitted_by));
      return {
        items: items.map((s) => this.toSubmission(s, names, a, actor.id)),
        total: Number(total.n),
        page: page.page,
        pageSize: page.pageSize,
      };
    });
  }

  async submission(actor: Actor, tenantId: string, project: string, id: string): Promise<SubmissionDto> {
    const a = await this.projects.access(actor, tenantId, project);
    const { s, reviews } = await this.projects.cellTx(tenantId, async (tx) => {
      const s = await subRows(subFrom(tx).where('s.id', '=', id).where('s.project_id', '=', a.project.id)).executeTakeFirst();
      return { s, reviews: s ? await this.reviewsOf(tx, [s.id]) : new Map() };
    });
    if (!s || (s.entity_id && !inPart(a.roots, s.entity_path)) || !canSee(a, settingsOf(s.settings).fillGroup)) throw notFound('Submission');
    if (!seesAll(settingsOf(s.settings), a, actor.id) && s.submitted_by !== actor.id) throw notFound('Submission');
    const names = await this.projects.userNames([s.submitted_by, ...[...reviews.values()].flat().map((r) => r.actor_id)]);
    const dto = this.toSubmission(s, names, a, actor.id, reviews.get(s.id));
    await this.recordView(actor.id, tenantId, a.project.key, s.form_key, id);
    // Managers and the people who review it are told who has opened it.
    if (a.role === 'manager' || dto.canReview) dto.views = await this.viewsOf(tenantId, id);
    return dto;
  }

  /** Notes that someone opened a submission (once in ten minutes for the same person). */
  private async recordView(actorId: string, tenantId: string, project: string, form: string, submission: string) {
    try {
      const recent = await this.ctx.db
        .selectFrom('platform_audit_log')
        .select('id')
        .where('action', '=', 'submission.viewed')
        .where('actor_id', '=', actorId)
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`details->>'submission' = ${submission}`)
        .where('at', '>', new Date(this.ctx.now().getTime() - 10 * 60_000))
        .limit(1)
        .executeTakeFirst();
      if (!recent) await audit(this.ctx, actorId, tenantId, 'submission.viewed', { project, form, submission });
    } catch {
      /* the log being unavailable never stops someone reading */
    }
  }

  /** Notes that someone downloaded a file of a submission. */
  async recordDownload(actorId: string, tenantId: string, project: string, form: string, submission: string, file: string) {
    await audit(this.ctx, actorId, tenantId, 'submission.downloaded', { project, form, submission, file }).catch(() => undefined);
  }

  private async viewsOf(tenantId: string, submission: string): Promise<SubmissionViewDto[]> {
    const rows = await this.ctx.db
      .selectFrom('platform_audit_log')
      .select(['actor_id', 'at', 'action', 'details'])
      .where('action', 'in', ['submission.viewed', 'submission.downloaded'])
      .where('tenant_id', '=', tenantId)
      .where(sql<boolean>`details->>'submission' = ${submission}`)
      .orderBy('at', 'desc')
      .limit(200)
      .execute();
    const names = await this.projects.userNames(rows.map((r) => r.actor_id));
    return rows.map((r) => ({
      actor: r.actor_id ? (names.get(r.actor_id) ?? null) : null,
      at: iso(r.at),
      kind: r.action === 'submission.downloaded' ? ('downloaded' as const) : ('opened' as const),
      detail: r.action === 'submission.downloaded' ? String((r.details as { file?: string }).file ?? '') : '',
    }));
  }

  private async reviewsOf(tx: Tx, ids: string[]) {
    const out = new Map<string, { stage: number | null; stage_name: string | null; decision: ReviewDto['decision']; comment: string; actor_id: string | null; at: Date }[]>();
    if (!ids.length) return out;
    const rows = await tx
      .selectFrom('submission_review')
      .select(['submission_id', 'stage', 'stage_name', 'decision', 'comment', 'actor_id', 'at'])
      .where('submission_id', 'in', ids)
      .orderBy('id')
      .execute();
    for (const r of rows) out.set(r.submission_id, [...(out.get(r.submission_id) ?? []), r]);
    return out;
  }

  private toSubmission(
    s: SubRow,
    names: Map<string, string | null>,
    a: Pick<ProjectAccess, 'role' | 'groups'>,
    userId: string,
    reviews: { stage: number | null; stage_name: string | null; decision: ReviewDto['decision']; comment: string; actor_id: string | null; at: Date }[] = [],
  ): SubmissionDto {
    const settings = settingsOf(s.settings);
    const graph = graphOf(settings);
    // The steps this submission goes through (those whose condition doesn't apply to its answers are skipped).
    const nodeId = graph ? parkedNode(graph, s) : null;
    const planned = graph ? plannedApprovals(graph, s.answers as Record<string, never>) : [];
    // A step reached off the usual path (an escalation, say) joins the track while it is there.
    const here = graph?.nodes.find((n) => n.id === nodeId && n.type === 'approval');
    const approvals = here && here.type === 'approval' && !planned.some((n) => n.id === here.id) ? [...planned, here] : planned;
    const parked = approvals.find((n) => n.id === nodeId);
    const ended = graph?.nodes.find((n) => n.id === s.outcome_node);
    return {
      id: s.id,
      formId: s.form_id,
      formKey: s.form_key,
      formName: s.form_name,
      project: { key: s.project_key, name: s.project_name },
      status: s.status,
      stage: parked ? approvals.indexOf(parked) : null,
      stageName: parked ? parked.name || parked.id : null,
      stageColor: parked && parked.type === 'approval' ? parked.color : null,
      nodeId,
      outcome: ended?.name || null,
      stages: approvals.map((n) => n.name || n.id),
      reviews: reviews.map((r) => ({
        stage: r.stage,
        stageName: r.stage_name,
        decision: r.decision,
        comment: r.comment,
        // The person who sent it (or the name given on a link) is who "submitted", even when the entry was made without an id.
        actor: r.actor_id
          ? (names.get(r.actor_id) ?? null)
          : r.decision === 'submitted' || r.decision === 'resubmitted'
            ? s.submitted_by
              ? (names.get(s.submitted_by) ?? null)
              : s.link_id
                ? s.submitter || null
                : null
            : null,
        at: iso(r.at),
      })),
      views: [],
      canReview: s.status === 'in_review' && !!parked && canApprove(settings, nodeId, a, userId, s.submitted_by),
      canResubmit: s.status === 'returned' && s.submitted_by === userId,
      version: s.form_version,
      entity: s.entity_id ? { id: s.entity_id, code: s.entity_code!, name: s.entity_name! } : null,
      answers: s.answers as Record<string, unknown>,
      submittedBy: s.submitted_by ? (names.get(s.submitted_by) ?? null) : s.link_id ? s.submitter || 'Link' : null,
      submittedById: s.submitted_by,
      viaLink: !!s.link_id,
      collectedAt: iso(s.collected_at),
      submittedAt: iso(s.submitted_at),
      decidedAt: isoOrNull(s.decided_at),
    };
  }

  // ---------- across projects: the Forms menu and the review inbox ----------

  /** Project access per project id, skipping projects the caller cannot see. */
  private async accessMap(actor: Actor, tenantId: string, projectIds: Iterable<string>) {
    const out = new Map<string, ProjectAccess>();
    for (const id of new Set(projectIds)) {
      try {
        out.set(id, await this.projects.access(actor, tenantId, id));
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
      }
    }
    return out;
  }

  private async member(actor: Actor, tenantId: string) {
    const policy = await workspacePolicy(this.ctx, actor, tenantId);
    if (!policy) throw forbidden('You are not a member of this organisation.');
    return policy;
  }

  /** The organisation's form groups, and the published forms the caller can fill in. */
  async menu(actor: Actor, tenantId: string): Promise<FormsMenuDto> {
    await this.member(actor, tenantId);
    const { groups, rows } = await this.projects.cellTx(tenantId, async (tx) => ({
      groups: await this.groupRows(tx),
      rows: await tx
        .selectFrom('form as f')
        .innerJoin('project as p', 'p.id', 'f.project_id')
        .innerJoin('form_version as v', (j) => j.onRef('v.form_id', '=', 'f.id').onRef('v.version', '=', 'f.current_version'))
        .select(['f.key', 'f.name', 'f.description', 'f.group_id', 'f.settings', 'p.id as project_id', 'p.key as project_key', 'p.name as project_name', 'v.definition'])
        .where('f.archived_at', 'is', null)
        .where('p.archived_at', 'is', null)
        .orderBy('f.name')
        .execute(),
    }));
    const access = await this.accessMap(actor, tenantId, rows.map((r) => r.project_id));
    const forms = rows.flatMap((r) => {
      const a = access.get(r.project_id);
      const settings = settingsOf(r.settings);
      if (!a || !canFill(a, settings)) return [];
      const def = FormDefinition.parse(r.definition);
      return [
        {
          project: { id: r.project_id, key: r.project_key, name: r.project_name },
          key: r.key,
          name: r.name,
          description: r.description,
          groupId: r.group_id,
          layout: def.layout,
          questionCount: questionsOf(def).filter((q) => q.type !== 'note' && q.type !== 'calculate').length,
          hasWorkflow: approvalNodes(graphOf(settings) ?? { nodes: [], edges: [] }).length > 0,
          icon: def.icon ?? null,
        },
      ];
    });
    return { groups, forms };
  }

  /** Submissions waiting on the caller, and the caller's own submissions that went through review. */
  async inbox(actor: Actor, tenantId: string): Promise<InboxDto> {
    await this.member(actor, tenantId);
    const { pending, mine, reviews } = await this.projects.cellTx(tenantId, async (tx) => {
      const pending = await subRows(subFrom(tx).where('s.status', '=', 'in_review').where('p.archived_at', 'is', null)).orderBy('s.submitted_at').limit(500).execute();
      const mine = await subRows(subFrom(tx).where('s.submitted_by', '=', actor.id).where('s.status', '<>', 'complete'))
        .orderBy('s.submitted_at', 'desc')
        .limit(50)
        .execute();
      return { pending, mine, reviews: await this.reviewsOf(tx, [...new Set([...pending, ...mine].map((s) => s.id))]) };
    });
    const access = await this.accessMap(actor, tenantId, [...pending, ...mine].map((s) => s.project_id));
    const names = await this.projects.userNames([...pending, ...mine].map((s) => s.submitted_by).concat([...reviews.values()].flat().map((r) => r.actor_id)));
    const dto = (s: SubRow) => this.toSubmission(s, names, access.get(s.project_id)!, actor.id, reviews.get(s.id));
    return {
      toReview: pending.filter((s) => access.has(s.project_id) && inPart(access.get(s.project_id)!.roots, s.entity_path) && dto(s).canReview).map(dto),
      mine: mine.filter((s) => access.has(s.project_id)).map(dto),
    };
  }

  // ---------- form groups (organisation-wide menu) ----------

  private async groupRows(tx: Tx, projectId?: string): Promise<FormGroupDto[]> {
    let q = tx
      .selectFrom('form_group as g')
      .select([
        'g.id',
        'g.project_id',
        'g.parent_id',
        'g.name',
        'g.icon',
        'g.sort',
        (eb) => eb.selectFrom('form as f').select((e2) => e2.fn.countAll<string>().as('n')).whereRef('f.group_id', '=', 'g.id').where('f.archived_at', 'is', null).as('n'),
      ])
      .orderBy('g.sort')
      .orderBy('g.name');
    if (projectId) q = q.where('g.project_id', '=', projectId);
    const rows = await q.execute();
    return rows.map((g) => ({ id: g.id, projectId: g.project_id, parentId: g.parent_id, name: g.name, icon: g.icon, sort: g.sort, formCount: Number(g.n ?? 0) }));
  }

  async groups(actor: Actor, tenantId: string): Promise<FormGroupDto[]> {
    await this.member(actor, tenantId);
    return this.projects.cellTx(tenantId, (tx) => this.groupRows(tx));
  }

  private async manager(actor: Actor, tenantId: string) {
    const policy = await this.member(actor, tenantId);
    if (!(policy.role === 'org_admin' || policy.has('projects.manage'))) throw forbidden('Managing form groups requires the projects.manage permission.');
  }

  async saveGroup(actor: Actor, tenantId: string, input: z.output<typeof FormGroupInput>, id?: string): Promise<FormGroupDto[]> {
    await this.manager(actor, tenantId);
    await this.projects.cellTx(tenantId, async (tx) => {
      if (input.parentId) {
        // Walk up from the new parent: it must exist and must not be this group or below it.
        let cur: string | null = input.parentId;
        for (let depth = 0; cur; depth++) {
          if (cur === id) throw badRequest('A group cannot be placed inside itself');
          if (depth > 20) throw badRequest('Groups are nested too deeply');
          const row: { parent_id: string | null } | undefined = await tx.selectFrom('form_group').select('parent_id').where('id', '=', cur).executeTakeFirst();
          if (!row) throw badRequest('Unknown parent group');
          cur = row.parent_id;
        }
      }
      const values = { name: input.name, parent_id: input.parentId, icon: input.icon, sort: input.sort };
      if (id) {
        const r = await tx.updateTable('form_group').set(values).where('id', '=', id).executeTakeFirst();
        if (!r.numUpdatedRows) throw notFound('Form group');
      } else await tx.insertInto('form_group').values({ id: uuidv7(), tenant_id: tenantId, ...values }).execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'form_group.saved', { id: id ?? null, name: input.name });
    return this.groups(actor, tenantId);
  }

  // ---------- form groups within a project ----------

  async projectGroups(actor: Actor, tenantId: string, project: string): Promise<FormGroupDto[]> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, (tx) => this.groupRows(tx, a.project.id));
  }

  async saveProjectGroup(actor: Actor, tenantId: string, project: string, input: z.output<typeof FormGroupInput>, id?: string): Promise<FormGroupDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, async (tx) => {
      const mine = await this.groupRows(tx, a.project.id);
      if (id && !mine.some((g) => g.id === id)) throw notFound('Form group');
      if (input.parentId) {
        if (!mine.some((g) => g.id === input.parentId)) throw badRequest('Unknown parent group');
        for (let p: string | null = input.parentId; p; p = mine.find((g) => g.id === p)?.parentId ?? null)
          if (p === id) throw badRequest('A group cannot be placed inside itself');
      }
      const values = { name: input.name, parent_id: input.parentId, icon: input.icon, sort: input.sort };
      if (id) await tx.updateTable('form_group').set(values).where('id', '=', id).execute();
      else await tx.insertInto('form_group').values({ id: uuidv7(), tenant_id: tenantId, project_id: a.project.id, ...values }).execute();
    });
    await audit(this.ctx, actor.id, tenantId, 'form_group.saved', { project: a.project.key, id: id ?? null, name: input.name });
    return this.projectGroups(actor, tenantId, project);
  }

  async deleteProjectGroup(actor: Actor, tenantId: string, project: string, id: string): Promise<FormGroupDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, async (tx) => {
      if (await tx.selectFrom('form_group').select('id').where('parent_id', '=', id).executeTakeFirst())
        throw conflict('Group has sub-groups', 'Move or delete its sub-groups first.');
      const r = await tx.deleteFrom('form_group').where('id', '=', id).where('project_id', '=', a.project.id).executeTakeFirst();
      if (!r.numDeletedRows) throw notFound('Form group');
    });
    return this.projectGroups(actor, tenantId, project);
  }

  async deleteGroup(actor: Actor, tenantId: string, id: string): Promise<FormGroupDto[]> {
    await this.manager(actor, tenantId);
    await this.projects.cellTx(tenantId, async (tx) => {
      if (await tx.selectFrom('form_group').select('id').where('parent_id', '=', id).executeTakeFirst())
        throw conflict('Group has sub-groups', 'Move or delete its sub-groups first.');
      const r = await tx.deleteFrom('form_group').where('id', '=', id).executeTakeFirst();
      if (!r.numDeletedRows) throw notFound('Form group');
    });
    await audit(this.ctx, actor.id, tenantId, 'form_group.deleted', { id });
    return this.groups(actor, tenantId);
  }
}

type Subject = { id: string; code: string; name: string; path: string };
