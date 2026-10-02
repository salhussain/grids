import { sql } from 'kysely';
import { upsertEntities, writeObservations } from '@grids/data';
import { lintDefinition, periodStart, questionsOf, validate } from '@grids/forms';
import { FormDefinition, uuidv7, type FormDto, type Page, type SubmissionDto } from '@grids/schema';
import type { z } from 'zod';
import type { FormInput, SubmissionInput } from '@grids/schema';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../errors.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { dataCall, type ProjectService } from './projects.js';
import { iso, isoOrNull, isUniqueViolation } from './util.js';

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
      return rows.map((f) => ({
        id: f.id,
        key: f.key,
        name: f.name,
        description: f.description,
        subjectType: f.type_key ? { key: f.type_key, name: f.type_name! } : null,
        draft: FormDefinition.parse(f.draft),
        currentVersion: f.current_version,
        published: f.published ? FormDefinition.parse(f.published) : null,
        hasUnpublishedChanges: !f.published || JSON.stringify(f.published) !== JSON.stringify(f.draft),
        submissionCount: Number(f.n ?? 0),
        lastSubmissionAt: isoOrNull(f.last as Date | null),
        updatedAt: iso(f.updated_at),
      }));
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
        const values = {
          key: input.key,
          name: input.name,
          description: input.description,
          subject_type_id: subjectTypeId,
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

  /** Bound attributes and data elements must exist (attributes need a subject type). */
  private async checkBindings(tx: Parameters<Parameters<ProjectService['cellTx']>[1]>[0], projectId: string, def: FormDefinition, subjectType: string | null) {
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
    const a = await this.projects.access(actor, tenantId, project, 'editor');
    const id = await dataCall(() =>
      this.projects.cellTx(tenantId, async (tx) => {
        const f = await tx
          .selectFrom('form as f')
          .leftJoin('entity_type as t', 't.id', 'f.subject_type_id')
          .select(['f.id', 'f.subject_type_id', 't.key as type_key'])
          .where('f.project_id', '=', a.project.id)
          .where('f.key', '=', key)
          .where('f.archived_at', 'is', null)
          .executeTakeFirst();
        if (!f) throw notFound('Form');
        const existing = await tx.selectFrom('submission').select(['id', 'form_id']).where('id', '=', input.id).executeTakeFirst();
        if (existing) {
          if (existing.form_id !== f.id) throw conflict('Submission id in use');
          return existing.id; // idempotent retry
        }
        const v = await tx.selectFrom('form_version').select('definition').where('form_id', '=', f.id).where('version', '=', input.version).executeTakeFirst();
        if (!v) throw badRequest(`Version ${input.version} of this form is not published`);
        const def = FormDefinition.parse(v.definition);

        let entity: { id: string; code: string; name: string; path: string } | undefined;
        if (f.subject_type_id) {
          if (!input.entityId) throw badRequest('Choose what this submission is about');
          entity = await tx
            .selectFrom('entity')
            .select(['id', 'code', 'name', sql<string>`path::text`.as('path')])
            .where('id', '=', input.entityId)
            .where('type_id', '=', f.subject_type_id)
            .executeTakeFirst();
          if (!entity) throw badRequest('That entity is not a valid subject for this form');
          if (a.rootPath && !(entity.path === a.rootPath || entity.path.startsWith(`${a.rootPath}.`)))
            throw forbidden('That entity is outside your part of the project.');
        }

        const result = validate(def, input.answers);
        if (!result.ok) throw new SubmissionInvalid(result.errors);
        const collectedAt = new Date(input.collectedAt);
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
          })
          .execute();

        if (entity) {
          const qs = questionsOf(def).filter((q) => q.key in result.clean);
          const attrs = Object.fromEntries(qs.filter((q) => q.bind?.attribute).map((q) => [q.bind!.attribute!, result.clean[q.key]]));
          if (Object.keys(attrs).length)
            await upsertEntities(tx, {
              tenantId,
              projectId: a.project.id,
              typeKey: f.type_key!,
              rows: [{ code: entity.code, name: entity.name, attributes: attrs }],
              source: 'form',
              sourceRef: input.id,
              actorId: actor.id,
            });
          const at = periodStart(def.period, collectedAt);
          const items = qs
            .filter((q) => q.bind?.element)
            .map((q) => ({ entityId: entity!.id, element: q.bind!.element!, at, value: result.clean[q.key] }));
          if (items.length) await writeObservations(tx, { tenantId, projectId: a.project.id, items, source: 'form', sourceRef: input.id });
        }
        return input.id;
      }),
    );
    return this.submission(actor, tenantId, project, id);
  }

  async submissions(actor: Actor, tenantId: string, project: string, key: string, page: { page: number; pageSize: number; entityId?: string }): Promise<Page<SubmissionDto>> {
    const a = await this.projects.access(actor, tenantId, project);
    return this.projects.cellTx(tenantId, async (tx) => {
      let q = tx
        .selectFrom('submission as s')
        .innerJoin('form as f', 'f.id', 's.form_id')
        .leftJoin('entity as e', 'e.id', 's.entity_id')
        .where('f.project_id', '=', a.project.id)
        .where('f.key', '=', key);
      if (page.entityId) q = q.where('s.entity_id', '=', page.entityId);
      if (a.rootPath) q = q.where(sql<boolean>`e.path <@ ${a.rootPath}::ltree`);
      const [items, total] = await Promise.all([
        q
          .select(['s.id', 's.form_id', 'f.name as form_name', 's.form_version', 'e.id as entity_id', 'e.name as entity_name', 's.answers', 's.submitted_by', 's.collected_at', 's.submitted_at'])
          .orderBy('s.submitted_at', 'desc')
          .limit(page.pageSize)
          .offset((page.page - 1) * page.pageSize)
          .execute(),
        q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
      ]);
      const names = await this.projects.userNames(items.map((i) => i.submitted_by));
      return {
        items: items.map((s) => this.toSubmission(s, names)),
        total: Number(total.n),
        page: page.page,
        pageSize: page.pageSize,
      };
    });
  }

  async submission(actor: Actor, tenantId: string, project: string, id: string): Promise<SubmissionDto> {
    const a = await this.projects.access(actor, tenantId, project);
    const s = await this.projects.cellTx(tenantId, (tx) =>
      tx
        .selectFrom('submission as s')
        .innerJoin('form as f', 'f.id', 's.form_id')
        .leftJoin('entity as e', 'e.id', 's.entity_id')
        .select(['s.id', 's.form_id', 'f.name as form_name', 's.form_version', 'e.id as entity_id', 'e.name as entity_name', 's.answers', 's.submitted_by', 's.collected_at', 's.submitted_at'])
        .where('s.id', '=', id)
        .where('s.project_id', '=', a.project.id)
        .executeTakeFirst(),
    );
    if (!s) throw notFound('Submission');
    return this.toSubmission(s, await this.projects.userNames([s.submitted_by]));
  }

  private toSubmission(
    s: { id: string; form_id: string; form_name: string; form_version: number; entity_id: string | null; entity_name: string | null; answers: unknown; submitted_by: string | null; collected_at: Date; submitted_at: Date },
    names: Map<string, string | null>,
  ): SubmissionDto {
    return {
      id: s.id,
      formId: s.form_id,
      formName: s.form_name,
      version: s.form_version,
      entity: s.entity_id ? { id: s.entity_id, name: s.entity_name! } : null,
      answers: s.answers as Record<string, unknown>,
      submittedBy: s.submitted_by ? (names.get(s.submitted_by) ?? null) : null,
      collectedAt: iso(s.collected_at),
      submittedAt: iso(s.submitted_at),
    };
  }
}
