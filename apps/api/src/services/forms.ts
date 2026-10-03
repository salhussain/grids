import { sql } from 'kysely';
import { fireEvent, upsertEntities, writeObservations } from '@grids/data';
import { evalExpr, formState, lintDefinition, periodStart, questionsOf, references, truthy, validate } from '@grids/forms';
import {
  FormDefinition,
  FormSettings,
  roleAtLeast,
  uuidv7,
  type ApproverRule,
  type FormDto,
  type FormGroupDto,
  type FormsMenuDto,
  type InboxDto,
  type Page,
  type ReviewDto,
  type SubmissionDto,
  type SubmissionStatus,
} from '@grids/schema';
import type { z } from 'zod';
import type { FormGroupInput, FormInput, ResubmitInput, ReviewInput, SubmissionInput } from '@grids/schema';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { workspacePolicy } from './policy.js';
import { canSee, dataCall, type ProjectAccess, type ProjectService } from './projects.js';
import { iso, isoOrNull, isUniqueViolation } from './util.js';

type Tx = Parameters<Parameters<ProjectService['cellTx']>[1]>[0];

const settingsOf = (raw: unknown): FormSettings => FormSettings.parse(raw ?? {});

/** Whether the caller may fill a form in: the minimum role, and the permission group when one is set. */
export const canFill = (a: Pick<ProjectAccess, 'role' | 'groups'>, settings: FormSettings) =>
  roleAtLeast(a.role, settings.fillRole) && canSee(a, settings.fillGroup);

const matchesRule = (rule: ApproverRule, a: Pick<ProjectAccess, 'role' | 'groups'>, userId: string) =>
  rule.users.includes(userId) ||
  ((!!rule.role || !!rule.group) && (!rule.role || roleAtLeast(a.role, rule.role)) && (!rule.group || canSee(a, rule.group)));

/** Project managers may act on any stage; others must match the stage's approver rule. Authors never review their own work unless allowed. */
export function canApprove(settings: FormSettings, stage: number, a: Pick<ProjectAccess, 'role' | 'groups'>, userId: string, author: string | null) {
  if (author === userId && !settings.workflow.allowSelfApproval) return false;
  if (a.role === 'manager') return true;
  const st = settings.workflow.stages[stage];
  return !!st && matchesRule(st.approvers, a, userId);
}

/** Indexes of the workflow stages that apply to these answers (a condition that cannot be evaluated applies). */
export function applicableStages(settings: FormSettings, def: FormDefinition, answers: Record<string, unknown>): number[] {
  if (!settings.workflow.enabled) return [];
  const { values } = formState(def, answers);
  return settings.workflow.stages.flatMap((st, i) => {
    if (!st.condition) return [i];
    try {
      return truthy(evalExpr(st.condition, values)) ? [i] : [];
    } catch {
      return [i];
    }
  });
}

const inPart = (rootPath: string | null, path: string | null) => !rootPath || (!!path && (path === rootPath || path.startsWith(`${rootPath}.`)));

const subFrom = (tx: Tx) =>
  tx
    .selectFrom('submission as s')
    .innerJoin('form as f', 'f.id', 's.form_id')
    .innerJoin('project as p', 'p.id', 's.project_id')
    .leftJoin('entity as e', 'e.id', 's.entity_id');
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
    'e.name as entity_name',
    sql<string | null>`e.path::text`.as('entity_path'),
    's.answers',
    's.submitted_by',
    's.collected_at',
    's.submitted_at',
    's.status',
    's.stage',
    's.decided_at',
  ]);
type SubRow = Awaited<ReturnType<ReturnType<typeof subRows>['execute']>>[number];

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
        ])
        .where('f.project_id', '=', a.project.id)
        .where('f.archived_at', 'is', null)
        .orderBy('f.name')
        .execute();
      return rows.map((f) => {
        const settings = settingsOf(f.settings);
        return {
        id: f.id,
        key: f.key,
        name: f.name,
        description: f.description,
        subjectType: f.type_key ? { key: f.type_key, name: f.type_name! } : null,
        groupId: f.group_id,
        settings,
        canFill: canFill(a, settings),
        draft: FormDefinition.parse(f.draft),
        currentVersion: f.current_version,
        published: f.published ? FormDefinition.parse(f.published) : null,
        hasUnpublishedChanges: !f.published || JSON.stringify(f.published) !== JSON.stringify(f.draft),
        submissionCount: Number(f.n ?? 0),
        lastSubmissionAt: isoOrNull(f.last as Date | null),
        updatedAt: iso(f.updated_at),
        };
      });
    });
  }

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
        if (input.groupId && !(await tx.selectFrom('form_group').select('id').where('id', '=', input.groupId).executeTakeFirst()))
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
        } else await tx.insertInto('form').values({ id: uuidv7(), tenant_id: tenantId, project_id: a.project.id, ...values }).execute();
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Key taken', `A form with key "${input.key}" already exists.`);
      throw e;
    }
    return this.list(actor, tenantId, project);
  }

  /** Permission groups must exist, stage keys be unique and conditions only reference questions. */
  private async checkSettings(tx: Tx, projectId: string, def: FormDefinition, settings: FormSettings) {
    await this.projects.assertGroup(tx, projectId, settings.fillGroup);
    const keys = new Set(questionsOf(def).map((q) => q.key));
    const seen = new Set<string>();
    for (const st of settings.workflow.stages) {
      if (seen.has(st.key)) throw badRequest(`Duplicate stage key "${st.key}"`);
      seen.add(st.key);
      await this.projects.assertGroup(tx, projectId, st.approvers.group);
      if (!st.approvers.role && !st.approvers.group && !st.approvers.users.length)
        throw badRequest(`Stage "${st.name}" needs approvers`, 'Choose a role, a permission group or specific people.');
      if (st.condition) {
        let refs: string[];
        try {
          refs = references(st.condition);
        } catch (e) {
          throw badRequest(`Stage "${st.name}" condition: ${(e as Error).message}`);
        }
        const bad = refs.filter((r) => !keys.has(r));
        if (bad.length) throw badRequest(`Stage "${st.name}" condition: unknown question \${${bad[0]}}`);
      }
    }
    if (settings.workflow.enabled && !settings.workflow.stages.length) throw badRequest('Add at least one approval stage, or turn the workflow off');
  }

  /** Bound attributes and data elements must exist (attributes need a subject type). */
  private async checkBindings(tx: Tx, projectId: string, def: FormDefinition, subjectType: string | null) {
    const qs = questionsOf(def);
    const attrBound = qs.filter((q) => q.bind?.attribute);
    const elemBound = qs.filter((q) => q.bind?.element);
    if ((attrBound.length || elemBound.length) && !subjectType) throw badRequest('Bindings need a subject entity type');
    if (attrBound.length) {
      const t = await tx.selectFrom('entity_type').select('attributes').where('project_id', '=', projectId).where('key', '=', subjectType!).executeTakeFirstOrThrow();
      const keys = new Set((t.attributes as { key: string }[]).map((x) => x.key));
      const bad = attrBound.filter((q) => !keys.has(q.bind!.attribute!));
      if (bad.length) throw badRequest(`Unknown attribute(s): ${bad.map((q) => q.bind!.attribute).join(', ')}`);
    }
    if (elemBound.length) {
      const keys = new Set((await tx.selectFrom('data_element').select('key').where('project_id', '=', projectId).execute()).map((x) => x.key));
      const bad = elemBound.filter((q) => !keys.has(q.bind!.element!));
      if (bad.length) throw badRequest(`Unknown data element(s): ${bad.map((q) => q.bind!.element).join(', ')}`);
    }
  }

  /** Freezes the draft as the next immutable version. */
  async publish(actor: Actor, tenantId: string, project: string, key: string): Promise<FormDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const version = await this.projects.cellTx(tenantId, async (tx) => {
      const f = await tx.selectFrom('form').select(['id', 'draft', 'current_version']).where('project_id', '=', a.project.id).where('key', '=', key).executeTakeFirst();
      if (!f) throw notFound('Form');
      const def = FormDefinition.parse(f.draft);
      const problems = lintDefinition(def);
      if (problems.length) throw badRequest('The form has problems', problems.join('; '));
      const next = (f.current_version ?? 0) + 1;
      await tx.insertInto('form_version').values({ form_id: f.id, tenant_id: tenantId, version: next, definition: JSON.stringify(def), published_by: actor.id }).execute();
      await tx.updateTable('form').set({ current_version: next, updated_at: this.ctx.now() }).where('id', '=', f.id).execute();
      return next;
    });
    await audit(this.ctx, actor.id, tenantId, 'form.published', { project: a.project.key, form: key, version });
    return this.list(actor, tenantId, project);
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
          .select(['f.id', 'f.subject_type_id', 'f.settings', 't.key as type_key'])
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
        const v = await tx.selectFrom('form_version').select('definition').where('form_id', '=', f.id).where('version', '=', input.version).executeTakeFirst();
        if (!v) throw badRequest(`Version ${input.version} of this form is not published`);
        const def = FormDefinition.parse(v.definition);

        let entity: Subject | undefined;
        if (f.subject_type_id) {
          if (!input.entityId) throw badRequest('Choose what this submission is about');
          entity = await tx
            .selectFrom('entity')
            .select(['id', 'code', 'name', sql<string>`path::text`.as('path')])
            .where('id', '=', input.entityId)
            .where('type_id', '=', f.subject_type_id)
            .executeTakeFirst();
          if (!entity) throw badRequest('That entity is not a valid subject for this form');
          if (!inPart(a.rootPath, entity.path)) throw forbidden('That entity is outside your part of the project.');
        }

        const result = validate(def, input.answers);
        if (!result.ok) throw new SubmissionInvalid(result.errors);
        const collectedAt = new Date(input.collectedAt);
        const stages = applicableStages(settings, def, result.clean);
        await tx
          .insertInto('submission')
          .values({
            id: input.id,
            tenant_id: tenantId,
            project_id: a.project.id,
            form_id: f.id,
            form_version: input.version,
            entity_id: entity?.id ?? null,
            answers: JSON.stringify(result.clean),
            submitted_by: actor.id,
            collected_at: collectedAt,
            location: input.location ? sql`ST_SetSRID(ST_MakePoint(${input.location.lon}, ${input.location.lat}), 4326)` : null,
            status: stages.length ? 'in_review' : 'complete',
            stage: stages[0] ?? null,
          })
          .execute();
        await fireEvent(tx, { tenantId, projectId: a.project.id, event: 'submission.created', ref: key, actorId: actor.id, detail: { submission: input.id, entity: entity?.id ?? null } });
        if (stages.length) {
          const st = settings.workflow.stages[stages[0]!]!;
          await tx.insertInto('submission_review').values({ tenant_id: tenantId, submission_id: input.id, stage: stages[0]!, stage_name: st.name, decision: 'submitted', actor_id: actor.id }).execute();
        } else
          await this.applyBindings(tx, {
            tenantId,
            projectId: a.project.id,
            def,
            typeKey: f.type_key,
            entity,
            answers: result.clean,
            collectedAt,
            submissionId: input.id,
            actorId: actor.id,
          });
        return input.id;
      }),
    );
    return this.submission(actor, tenantId, project, id);
  }

  /** Writes bound answers onto the subject entity and as observations — once a submission is final. */
  private async applyBindings(
    tx: Tx,
    s: { tenantId: string; projectId: string; def: FormDefinition; typeKey: string | null; entity: Subject | undefined; answers: Record<string, unknown>; collectedAt: Date; submissionId: string; actorId: string },
  ) {
    const entity = s.entity;
    if (!entity) return;
    const qs = questionsOf(s.def).filter((q) => q.key in s.answers);
    const attrs = Object.fromEntries(qs.filter((q) => q.bind?.attribute).map((q) => [q.bind!.attribute!, s.answers[q.key]]));
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
    const at = periodStart(s.def.period, s.collectedAt);
    const items = qs.filter((q) => q.bind?.element).map((q) => ({ entityId: entity.id, element: q.bind!.element!, at, value: s.answers[q.key] }));
    if (items.length) await writeObservations(tx, { tenantId: s.tenantId, projectId: s.projectId, items, source: 'form', sourceRef: s.submissionId });
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
        's.answers',
        's.submitted_by',
        's.collected_at',
        'f.key as form_key',
        'f.settings',
        'v.definition',
        't.key as type_key',
        'e.id as entity_id',
        'e.code as entity_code',
        'e.name as entity_name',
        sql<string | null>`e.path::text`.as('entity_path'),
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
    const outcome = await dataCall(() =>
      this.projects.cellTx(tenantId, async (tx) => {
        const s = await this.loadForDecision(tx, a.project.id, id);
        if (!inPart(a.rootPath, s.entity?.path ?? null) && s.entity) throw notFound('Submission');
        if (s.status !== 'in_review' || s.stage === null) throw conflict('Already decided', 'This submission is not waiting for review.');
        if (!canApprove(s.settings, s.stage, a, actor.id, s.submitted_by))
          throw forbidden(s.submitted_by === actor.id ? 'You cannot review your own submission.' : 'You are not an approver for this stage.');
        const stage = s.settings.workflow.stages[s.stage];
        if (input.decision === 'return' && stage && !stage.allowReturn) throw badRequest('This stage cannot send submissions back');
        if (input.decision !== 'approve' && !input.comment) throw badRequest('Add a comment', 'Explain why, so the author knows what to do next.');
        const decision = ({ approve: 'approved', reject: 'rejected', return: 'returned' } as const)[input.decision];
        await tx
          .insertInto('submission_review')
          .values({ tenant_id: tenantId, submission_id: id, stage: s.stage, stage_name: stage?.name ?? null, decision, comment: input.comment, actor_id: actor.id })
          .execute();
        const now = this.ctx.now();
        const ev = { tenantId, projectId: a.project.id, ref: s.form_key, actorId: actor.id, detail: { submission: id, entity: s.entity?.id ?? null } };
        if (input.decision === 'reject') {
          await tx.updateTable('submission').set({ status: 'rejected', decided_at: now }).where('id', '=', id).execute();
          await fireEvent(tx, { ...ev, event: 'submission.rejected' });
          return decision;
        }
        if (input.decision === 'return') {
          await tx.updateTable('submission').set({ status: 'returned' }).where('id', '=', id).execute();
          return decision;
        }
        const next = applicableStages(s.settings, s.def, s.answers).find((i) => i > s.stage!);
        if (next !== undefined) {
          await tx.updateTable('submission').set({ stage: next }).where('id', '=', id).execute();
          return 'advanced';
        }
        await tx.updateTable('submission').set({ status: 'approved', stage: null, decided_at: now }).where('id', '=', id).execute();
        await this.applyBindings(tx, {
          tenantId,
          projectId: a.project.id,
          def: s.def,
          typeKey: s.type_key,
          entity: s.entity,
          answers: s.answers,
          collectedAt: s.collected_at,
          submissionId: id,
          actorId: s.submitted_by ?? actor.id,
        });
        await fireEvent(tx, { ...ev, event: 'submission.approved' });
        return decision;
      }),
    );
    await audit(this.ctx, actor.id, tenantId, 'submission.reviewed', { project: a.project.key, submission: id, decision: outcome });
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
        const result = validate(s.def, input.answers);
        if (!result.ok) throw new SubmissionInvalid(result.errors);
        const stages = applicableStages(s.settings, s.def, result.clean);
        await tx
          .updateTable('submission')
          .set({ answers: JSON.stringify(result.clean), status: stages.length ? 'in_review' : 'complete', stage: stages[0] ?? null })
          .where('id', '=', id)
          .execute();
        await tx
          .insertInto('submission_review')
          .values({
            tenant_id: tenantId,
            submission_id: id,
            stage: stages[0] ?? null,
            stage_name: stages.length ? s.settings.workflow.stages[stages[0]!]!.name : null,
            decision: 'resubmitted',
            comment: input.comment,
            actor_id: actor.id,
          })
          .execute();
        if (!stages.length)
          await this.applyBindings(tx, {
            tenantId,
            projectId: a.project.id,
            def: s.def,
            typeKey: s.type_key,
            entity: s.entity,
            answers: result.clean,
            collectedAt: s.collected_at,
            submissionId: id,
            actorId: actor.id,
          });
      }),
    );
    return this.submission(actor, tenantId, project, id);
  }

  async submissions(
    actor: Actor,
    tenantId: string,
    project: string,
    key: string,
    page: { page: number; pageSize: number; entityId?: string; status?: SubmissionStatus },
  ): Promise<Page<SubmissionDto>> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, async (tx) => {
      let q = subFrom(tx).where('f.project_id', '=', a.project.id).where('f.key', '=', key);
      if (page.entityId) q = q.where('s.entity_id', '=', page.entityId);
      if (page.status) q = q.where('s.status', '=', page.status);
      if (a.rootPath) q = q.where(sql<boolean>`e.path <@ ${a.rootPath}::ltree`);
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
    if (!s || (s.entity_id && !inPart(a.rootPath, s.entity_path))) throw notFound('Submission');
    const names = await this.projects.userNames([s.submitted_by, ...[...reviews.values()].flat().map((r) => r.actor_id)]);
    return this.toSubmission(s, names, a, actor.id, reviews.get(s.id));
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
    const stages = settings.workflow.enabled ? settings.workflow.stages.map((x) => x.name) : [];
    return {
      id: s.id,
      formId: s.form_id,
      formKey: s.form_key,
      formName: s.form_name,
      project: { key: s.project_key, name: s.project_name },
      status: s.status,
      stage: s.stage,
      stageName: s.stage !== null ? (settings.workflow.stages[s.stage]?.name ?? null) : null,
      stages,
      reviews: reviews.map((r) => ({
        stage: r.stage,
        stageName: r.stage_name,
        decision: r.decision,
        comment: r.comment,
        actor: r.actor_id ? (names.get(r.actor_id) ?? null) : null,
        at: iso(r.at),
      })),
      canReview: s.status === 'in_review' && s.stage !== null && canApprove(settings, s.stage, a, userId, s.submitted_by),
      canResubmit: s.status === 'returned' && s.submitted_by === userId,
      version: s.form_version,
      entity: s.entity_id ? { id: s.entity_id, name: s.entity_name! } : null,
      answers: s.answers as Record<string, unknown>,
      submittedBy: s.submitted_by ? (names.get(s.submitted_by) ?? null) : null,
      submittedById: s.submitted_by,
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
          project: { key: r.project_key, name: r.project_name },
          key: r.key,
          name: r.name,
          description: r.description,
          groupId: r.group_id,
          layout: def.layout,
          questionCount: questionsOf(def).filter((q) => q.type !== 'note' && q.type !== 'calculate').length,
          hasWorkflow: settings.workflow.enabled && settings.workflow.stages.length > 0,
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
      toReview: pending.filter((s) => access.has(s.project_id) && inPart(access.get(s.project_id)!.rootPath, s.entity_path) && dto(s).canReview).map(dto),
      mine: mine.filter((s) => access.has(s.project_id)).map(dto),
    };
  }

  // ---------- form groups (organisation-wide menu) ----------

  private async groupRows(tx: Tx): Promise<FormGroupDto[]> {
    const rows = await tx
      .selectFrom('form_group as g')
      .select([
        'g.id',
        'g.parent_id',
        'g.name',
        'g.icon',
        'g.sort',
        (eb) => eb.selectFrom('form as f').select((e2) => e2.fn.countAll<string>().as('n')).whereRef('f.group_id', '=', 'g.id').where('f.archived_at', 'is', null).as('n'),
      ])
      .orderBy('g.sort')
      .orderBy('g.name')
      .execute();
    return rows.map((g) => ({ id: g.id, parentId: g.parent_id, name: g.name, icon: g.icon, sort: g.sort, formCount: Number(g.n ?? 0) }));
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
