import { buildDocument, buildRecord, imagesIn, lintDocument, type DocData } from '@grids/forms';
import { DocumentTemplate as DocumentTemplateSchema, FormDefinition, FormSettings, RecordOptions, roleAtLeast, SUBMISSION_FIELDS, SUBMISSION_RECORD, SUBMISSION_RECORD_ID, type DocumentFormat, type DocumentSampleInput, type DocumentRevisionDto, type DocumentTemplate } from '@grids/schema';
import type { z } from 'zod';
import { badRequest, forbidden, notFound } from '../errors.js';
import { audit } from './context.js';
import type { Actor, ServiceContext } from './context.js';
import { toDocx, toPdf, toXlsx, type Images } from './document-writers.js';
import { mayUseDocument, type FormService } from './forms.js';
import type { ProjectService } from './projects.js';

export interface MadeDocument {
  filename: string;
  contentType: string;
  content: Buffer;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
const TYPES: Record<DocumentFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Documents made from submissions: a template of the form, filled with one submission's answers, as a PDF or Word file. */
export class DocumentService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
    private readonly forms: FormService,
  ) {}

  private async make(template: DocumentTemplate, def: FormDefinition, data: DocData, format: DocumentFormat, images?: { tenantId: string; projectId: string }, record?: RecordOptions): Promise<MadeDocument> {
    // The default record is made from the form itself; any other document from its own text.
    const built = template.id === SUBMISSION_RECORD_ID ? buildRecord(def, { ...data, accent: data.accent ?? def.look?.accent ?? undefined }, record ?? RecordOptions.parse({})) : buildDocument(template, def, data);
    // The pictures it shows (a signature, a photo): from this project's stored files.
    const wanted = images ? imagesIn(built) : [];
    const pictures: Images = new Map();
    if (images && wanted.length) {
      const rows = await this.projects.cellTx(images.tenantId, (tx) => tx.selectFrom('form_attachment').select(['id', 'content', 'content_type']).where('project_id', '=', images.projectId).where('id', 'in', wanted).execute());
      for (const r of rows) pictures.set(r.id, { content: r.content, contentType: r.content_type });
    }
    const content = format === 'pdf' ? await toPdf(built, template, pictures) : format === 'docx' ? await toDocx(built, template, pictures) : await toXlsx(built, template);
    return { filename: `${slug(template.name)}.${format}`, contentType: TYPES[format], content };
  }

  /** The names behind the entity answers (top of the form and rows of repeating sections). */
  private async namesOf(tx: Parameters<Parameters<ProjectService['cellTx']>[1]>[0], def: FormDefinition, answers: Record<string, unknown>): Promise<Record<string, string>> {
    const ids = new Set<string>();
    for (const s of def.sections) {
      const rows = s.repeat ? (Array.isArray(answers[s.key]) ? (answers[s.key] as Record<string, unknown>[]) : []) : [answers];
      for (const row of rows) for (const q of s.questions) if (q.type === 'entity' && typeof row[q.key] === 'string') ids.add(row[q.key] as string);
    }
    if (!ids.size) return {};
    const rows = await tx.selectFrom('entity').select(['id', 'name']).where('id', 'in', [...ids]).execute();
    return Object.fromEntries(rows.map((r) => [r.id, r.name]));
  }

  /**
   * The document for a stored submission. Whoever asks must already have been allowed to see the submission:
   * this reads it without a person in mind, so it can also run from the workflow (an email's attachment).
   */
  async renderStored(tenantId: string, submissionId: string, docId: string, format: DocumentFormat, allow?: (t: DocumentTemplate) => void): Promise<MadeDocument> {
    const loaded = await this.projects.cellTx(tenantId, async (tx) => {
      const s = await tx
        .selectFrom('submission as s')
        .innerJoin('form as f', 'f.id', 's.form_id')
        .leftJoin('form_version as v', (j) => j.onRef('v.form_id', '=', 's.form_id').onRef('v.version', '=', 's.form_version'))
        .innerJoin('project as p', 'p.id', 's.project_id')
        .select(['s.answers', 's.status', 's.submitted_by', 's.project_id', 'p.color as project_color', 'f.name as form_name', 'f.settings', 'f.draft', 'v.definition'])
        .where('s.id', '=', submissionId)
        .executeTakeFirst();
      if (!s) throw notFound('Submission');
      const settings = FormSettings.parse(s.settings ?? {});
      const template = docId === SUBMISSION_RECORD_ID ? SUBMISSION_RECORD : settings.documents.find((d) => d.id === docId);
      if (!template) throw notFound('Document');
      allow?.(template);
      const def = FormDefinition.parse(s.definition ?? s.draft);
      const answers = s.answers as Record<string, unknown>;
      const details = await this.forms.submissionFields(tx, { submissionId, formName: s.form_name, submittedBy: s.submitted_by }, s.status);
      return { template, record: settings.record, def, projectId: s.project_id, data: { values: answers, details, names: await this.namesOf(tx, def, answers), timezone: settings.availability.timezone, accent: def.look?.accent ?? s.project_color } satisfies DocData };
    });
    return this.make(loaded.template, loaded.def, loaded.data, format, { tenantId, projectId: loaded.projectId }, loaded.record);
  }

  /** A document of a submission the person may see (the same check as opening it). */
  async forSubmission(actor: Actor, tenantId: string, project: string, formKey: string, submissionId: string, docId: string, format: DocumentFormat): Promise<MadeDocument> {
    const sub = await this.forms.submission(actor, tenantId, project, submissionId);
    if (sub.formKey !== formKey) throw notFound('Submission');
    const a = await this.projects.access(actor, tenantId, project);
    // Internal and emailable documents are for managers and the permissions they name; public ones are open to anyone who can see the submission.
    const made = await this.renderStored(tenantId, submissionId, docId, format, (t) => {
      if (!mayUseDocument(a, t)) throw forbidden('This document is not available to you.');
      if (!t.formats.includes(format)) throw badRequest(`This document can only be made as ${t.formats.map((f) => f.toUpperCase()).join(', ')}.`);
    });
    // The activity of the submission lists who downloaded what.
    await this.forms.recordDownload(actor.id, tenantId, a.project.key, formKey, submissionId, made.filename);
    return made;
  }

  /** A trial document from the template being edited (saved or not) and sample answers, for the form's managers. */
  async sample(actor: Actor, tenantId: string, project: string, formKey: string, input: z.output<typeof DocumentSampleInput>): Promise<MadeDocument> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const def = await this.projects.cellTx(tenantId, async (tx) => {
      const f = await tx.selectFrom('form').select('draft').where('project_id', '=', a.project.id).where('key', '=', formKey).where('archived_at', 'is', null).executeTakeFirst();
      if (!f) throw notFound('Form');
      return FormDefinition.parse(f.draft);
    });
    const sample = Object.fromEntries(SUBMISSION_FIELDS.map((f) => [f.key, f.key === '_form_name' ? def.title : f.key === '_project_name' ? a.project.name : f.key === '_status' ? 'Approved' : f.key === '_submission_id' ? '0190c1a0-0000-7000-8000-000000000001' : `(${f.label.toLowerCase()})`]));
    return this.make(input.template, def, { values: input.answers, details: sample, accent: def.look?.accent ?? a.project.color }, input.format, { tenantId, projectId: a.project.id }, input.record);
  }

  // ------------------------------------------------------------------ drafts and history

  private async formOf(tx: Parameters<Parameters<ProjectService['cellTx']>[1]>[0], projectId: string, key: string) {
    const f = await tx.selectFrom('form').select(['id', 'settings', 'draft']).where('project_id', '=', projectId).where('key', '=', key).where('archived_at', 'is', null).executeTakeFirst();
    if (!f) throw notFound('Form');
    return { id: f.id, settings: FormSettings.parse(f.settings ?? {}), def: FormDefinition.parse(f.draft) };
  }

  private check(def: FormDefinition, documents: DocumentTemplate[]) {
    const seen = new Set<string>([SUBMISSION_RECORD_ID]);
    for (const d of documents) {
      if (seen.has(d.id)) throw badRequest(`The key "${d.id}" is taken`);
      seen.add(d.id);
    }
    const problems = documents.flatMap((d) => lintDocument(d, def));
    if (problems.length) throw badRequest('The documents have problems', problems.join('; '));
  }

  /** Keeps the documents being edited apart from the published ones, and records the one that was saved. */
  async saveDraft(actor: Actor, tenantId: string, project: string, formKey: string, input: { documents: DocumentTemplate[]; record: RecordOptions; documentId: string; action: 'saved' | 'restored' }) {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const documents = input.documents.map((d) => DocumentTemplateSchema.parse(d));
    await this.projects.cellTx(tenantId, async (tx) => {
      const f = await this.formOf(tx, a.project.id, formKey);
      this.check(f.def, documents);
      const settings = { ...f.settings, documentDraft: { documents, record: input.record } };
      await tx.updateTable('form').set({ settings: JSON.stringify(settings), updated_at: this.ctx.now() }).where('id', '=', f.id).execute();
      const snapshot = input.documentId === SUBMISSION_RECORD_ID ? input.record : documents.find((d) => d.id === input.documentId);
      if (snapshot) await tx.insertInto('form_document_revision').values({ tenant_id: tenantId, form_id: f.id, document_id: input.documentId, action: input.action, snapshot: JSON.stringify(snapshot), actor_id: actor.id }).execute();
    });
  }

  /** Makes the drafted documents the ones the form uses, and records each that changed. */
  async publish(actor: Actor, tenantId: string, project: string, formKey: string, only?: string) {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, async (tx) => {
      const f = await this.formOf(tx, a.project.id, formKey);
      const d = f.settings.documentDraft;
      if (!d) throw badRequest('There is nothing to publish');
      this.check(f.def, d.documents);
      // One document, or all of them: what goes live is the draft's version of each chosen document.
      const live = only ? this.merge(f.settings.documents, f.settings.record, d, only) : { documents: d.documents, record: d.record };
      const stillDraft = JSON.stringify(live.documents) !== JSON.stringify(d.documents) || JSON.stringify(live.record) !== JSON.stringify(d.record);
      const next = { ...f.settings, documents: live.documents, record: live.record, documentDraft: stillDraft ? d : null };
      await this.forms.checkSettings(tx, a.project.id, f.def, FormSettings.parse(next));
      const before = new Map(f.settings.documents.map((x) => [x.id, JSON.stringify(x)]));
      const changed: { id: string; snapshot: unknown }[] = live.documents.filter((x) => before.get(x.id) !== JSON.stringify(x)).map((x) => ({ id: x.id, snapshot: x }));
      if (JSON.stringify(live.record) !== JSON.stringify(f.settings.record)) changed.push({ id: SUBMISSION_RECORD_ID, snapshot: live.record });
      await tx.updateTable('form').set({ settings: JSON.stringify(next), updated_at: this.ctx.now() }).where('id', '=', f.id).execute();
      for (const c of changed) await tx.insertInto('form_document_revision').values({ tenant_id: tenantId, form_id: f.id, document_id: c.id, action: 'published', snapshot: JSON.stringify(c.snapshot), actor_id: actor.id }).execute();
      await audit(this.ctx, actor.id, tenantId, 'form.documents_published', { project: a.project.key, form: formKey, documents: changed.map((c) => c.id) });
    });
  }

  /**
   * `from`'s version of one document (or of the default record) applied to `into`: added, replaced in place, or
   * removed if `from` no longer has it. Everything else stays as `into` has it.
   */
  private merge(documents: DocumentTemplate[], record: RecordOptions, from: { documents: DocumentTemplate[]; record: RecordOptions }, id: string) {
    if (id === SUBMISSION_RECORD_ID) return { documents, record: from.record };
    const mine = from.documents.find((x) => x.id === id);
    const has = documents.some((x) => x.id === id);
    const next = mine ? (has ? documents.map((x) => (x.id === id ? mine : x)) : [...documents, mine]) : documents.filter((x) => x.id !== id);
    return { documents: next, record };
  }

  /** Drops the changes that were never published: of one document, or of all. */
  async discard(actor: Actor, tenantId: string, project: string, formKey: string, only?: string) {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    await this.projects.cellTx(tenantId, async (tx) => {
      const f = await this.formOf(tx, a.project.id, formKey);
      const d = f.settings.documentDraft;
      let documentDraft: typeof d = null;
      if (only && d) {
        // Put the published version of that document back into the draft.
        const back = this.merge(d.documents, d.record, { documents: f.settings.documents, record: f.settings.record }, only);
        const same = JSON.stringify(back.documents) === JSON.stringify(f.settings.documents) && JSON.stringify(back.record) === JSON.stringify(f.settings.record);
        documentDraft = same ? null : back;
      }
      await tx.updateTable('form').set({ settings: JSON.stringify({ ...f.settings, documentDraft }), updated_at: this.ctx.now() }).where('id', '=', f.id).execute();
    });
  }

  /** Who saved or published a document, when, and what it looked like then (newest first). */
  async revisions(actor: Actor, tenantId: string, project: string, formKey: string, docId: string): Promise<DocumentRevisionDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const rows = await this.projects.cellTx(tenantId, async (tx) => {
      const f = await this.formOf(tx, a.project.id, formKey);
      return tx.selectFrom('form_document_revision').select(['id', 'document_id', 'action', 'snapshot', 'actor_id', 'created_at']).where('form_id', '=', f.id).where('document_id', '=', docId).orderBy('id', 'desc').limit(100).execute();
    });
    const ids = [...new Set(rows.flatMap((r) => (r.actor_id ? [r.actor_id] : [])))];
    const people = ids.length ? await this.ctx.db.selectFrom('user_identity').select(['id', 'display_name', 'email']).where('id', 'in', ids).execute() : [];
    const nameOf = new Map(people.map((p) => [p.id, p.display_name ?? p.email]));
    return rows.map((r) => ({ id: Number(r.id), documentId: r.document_id, action: r.action as DocumentRevisionDto['action'], actorName: r.actor_id ? (nameOf.get(r.actor_id) ?? null) : null, createdAt: r.created_at.toISOString(), snapshot: r.snapshot }));
  }
}
