import { sql } from 'kysely';
import { isPrivateHost } from '@grids/forms';
import { NotifyRecipients } from '@grids/schema';
import type { ServiceContext } from './context.js';
import type { DocumentService } from './documents.js';
import { matchesRule, type FormService } from './forms.js';
import type { ProjectService } from './projects.js';
import type { WorkScheduleService } from './work-schedules.js';

const LEASE_MS = 5 * 60_000;
const BATCH = 25;
const MAX_ATTEMPTS = 5;
const WEBHOOK_TIMEOUT_MS = 10_000;
/** The most an email carries in attachments. */
const ATTACHMENT_BUDGET = 15 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Every string answered to a question: at the top of the form, or in each row of a repeating section. */
const collect = (answers: Record<string, unknown>, key: string): string[] => {
  const flat = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(flat) : typeof v === 'string' ? [v.trim()] : []);
  return [
    ...flat(answers[key]),
    ...Object.values(answers).flatMap((v) => (Array.isArray(v) ? v.flatMap((row) => (row && typeof row === 'object' && !Array.isArray(row) ? flat((row as Record<string, unknown>)[key]) : [])) : [])),
  ];
};

/** 1 min, 2 min, 4 min … capped at 30 min. */
const backoffMs = (attempt: number) => Math.min(30 * 60_000, 60_000 * 2 ** (attempt - 1));

type Claimed = { id: string; project_id: string; submission_id: string; node_id: string; kind: 'email' | 'webhook' | 'timer'; attempts: number; payload: Record<string, unknown> };

export interface TickResult {
  emails: number;
  webhooks: number;
  timers: number;
  failed: number;
  retried: number;
}

/**
 * Executes the form workflow outbox: emails, webhooks and timers (approval SLAs, wait nodes).
 * Rows are claimed with a lease (FOR UPDATE SKIP LOCKED), so several API instances can tick
 * side by side, and a crashed run is retried once its lease lapses. Each tenant is scanned in
 * its own RLS scope.
 */
export class WorkflowRunner {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
    private readonly forms: FormService,
    private readonly documents: DocumentService,
    private readonly deps: { fetch?: typeof fetch; schedules?: WorkScheduleService } = {},
  ) {}

  /** Ticks on an interval until `stop()`. */
  start(everyMs = 15_000, log: (msg: string, extra?: object) => void = () => undefined) {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.tick()
        .then((r) => r.emails + r.webhooks + r.timers + r.failed + r.retried && log('workflow tasks', r))
        .catch((e: Error) => log('workflow tick failed', { error: e.message }))
        .finally(() => (this.running = false));
    }, everyMs);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** One pass over every active tenant. */
  async tick(): Promise<TickResult> {
    const total: TickResult = { emails: 0, webhooks: 0, timers: 0, failed: 0, retried: 0 };
    const tenants = await this.ctx.db.selectFrom('tenant').select('id').where('status', '=', 'active').execute();
    for (const t of tenants) {
      try {
        const r = await this.tickTenant(t.id);
        for (const k of Object.keys(total) as (keyof TickResult)[]) total[k] += r[k];
      } catch {
        // A tenant whose cell is unreachable must not stall the others.
      }
    }
    return total;
  }

  async tickTenant(tenantId: string): Promise<TickResult> {
    const out: TickResult = { emails: 0, webhooks: 0, timers: 0, failed: 0, retried: 0 };
    const now = this.ctx.now();
    // Recurring work that has fallen due is opened on the same beat.
    await this.deps.schedules?.run(tenantId).catch(() => undefined);
    const claimed = await this.projects.cellTx(tenantId, async (tx) => {
      const rows = await sql<Claimed>`
        update workflow_task set locked_until = ${new Date(now.getTime() + LEASE_MS)}, attempts = attempts + 1
        where id in (
          select id from workflow_task
          where status = 'pending' and due_at <= ${now} and (locked_until is null or locked_until < ${now})
          order by due_at
          limit ${BATCH}
          for update skip locked
        )
        returning id, project_id, submission_id, node_id, kind, attempts, payload
      `.execute(tx);
      return rows.rows;
    });
    for (const task of claimed) {
      try {
        const detail = await this.run(tenantId, task);
        await this.finish(tenantId, task.id, detail === 'cancelled' ? 'cancelled' : 'done');
        if (task.kind === 'email') out.emails++;
        else if (task.kind === 'webhook') out.webhooks++;
        else if (detail === 'fired') out.timers++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (task.attempts >= MAX_ATTEMPTS) {
          await this.finish(tenantId, task.id, 'failed', message);
          out.failed++;
        } else {
          await this.projects.cellTx(tenantId, (tx) =>
            tx
              .updateTable('workflow_task')
              .set({ locked_until: null, last_error: message, due_at: new Date(this.ctx.now().getTime() + backoffMs(task.attempts)) })
              .where('id', '=', task.id)
              .execute(),
          );
          out.retried++;
        }
      }
    }
    return out;
  }

  private finish(tenantId: string, id: string, status: 'done' | 'failed' | 'cancelled', error?: string) {
    return this.projects.cellTx(tenantId, (tx) =>
      tx
        .updateTable('workflow_task')
        .set({ status, done_at: this.ctx.now(), locked_until: null, ...(error && { last_error: error }) })
        .where('id', '=', id)
        .execute(),
    );
  }

  private async run(tenantId: string, task: Claimed): Promise<'sent' | 'fired' | 'cancelled'> {
    if (task.kind === 'timer') return (await this.forms.runTimer(tenantId, task)) === 'fired' ? 'fired' : 'cancelled';
    if (task.kind === 'webhook') {
      await this.webhook(task.payload as { url: string; method: 'POST' | 'PUT'; headers: Record<string, string>; body: unknown });
      return 'sent';
    }
    await this.email(tenantId, task);
    return 'sent';
  }

  private async webhook(p: { url: string; method: 'POST' | 'PUT'; headers: Record<string, string>; body: unknown }) {
    if (isPrivateHost(p.url)) throw new Error('Webhook target is not a public address');
    const res = await (this.deps.fetch ?? fetch)(p.url, {
      method: p.method,
      headers: { 'content-type': 'application/json', ...p.headers },
      body: JSON.stringify(p.body),
      redirect: 'error',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Webhook answered ${res.status}`);
  }

  private async email(tenantId: string, task: Claimed) {
    const p = task.payload as { subject: string; text: string; html?: string; to: NotifyRecipients; attachments?: string[]; attachQuestions?: string[]; documents?: { id: string; format: 'pdf' | 'docx' | 'xlsx' }[] };
    const to = NotifyRecipients.parse(p.to);
    // What people answered, for the addresses and files that come from the form's own questions.
    const wantsAnswers = to.questions.length > 0 || !!p.attachQuestions?.length;
    const answers = wantsAnswers
      ? ((await this.projects.cellTx(tenantId, (tx) => tx.selectFrom('submission').select('answers').where('id', '=', task.submission_id).executeTakeFirst()))?.answers as Record<string, unknown> | undefined) ?? {}
      : {};
    const fromForm = to.questions.flatMap((k) => collect(answers, k)).filter((v) => EMAIL.test(v)).map((v) => v.toLowerCase());
    const addresses = [...new Set([...(await this.recipients(tenantId, task, to)), ...fromForm])].slice(0, 50);
    if (!addresses.length) return; // nobody to tell (e.g. no approvers have an email): nothing to retry
    const stored = await this.attachments(tenantId, task.project_id, [...(p.attachments ?? []), ...(p.attachQuestions ?? []).flatMap((k) => collect(answers, k))]);
    // Documents are made now, from the submission as it stands (an approval notice says Approved).
    const made = await Promise.all((p.documents ?? []).map((d) => this.documents.renderStored(tenantId, task.submission_id, d.id, d.format, (t) => {
        if (t.visibility === 'internal') throw new Error(`The document "${t.name}" is internal and cannot be emailed`);
      })));
    const files = [...stored, ...made.map((d) => ({ filename: d.filename, content: d.content, contentType: d.contentType }))];
    const sent = await Promise.all(
      addresses.map((address) => this.ctx.email.send('form_workflow', tenantId, { to: address, subject: p.subject, text: p.text, ...(p.html && { html: p.html }), ...(files.length && { attachments: files }) })),
    );
    // Delivery failures are in the email log; retry only when nothing at all went out.
    if (!sent.some(Boolean)) throw new Error('No email could be delivered');
  }

  /** The files an email carries: uploaded for this project, and together small enough to send. */
  private async attachments(tenantId: string, projectId: string, ids: string[]) {
    const wanted = [...new Set(ids.filter((id) => UUID.test(id)))];
    if (!wanted.length) return [];
    const rows = await this.projects.cellTx(tenantId, (tx) =>
      tx.selectFrom('form_attachment').select(['id', 'name', 'content_type', 'content']).where('project_id', '=', projectId).where('id', 'in', wanted).execute(),
    );
    const out: { filename: string; content: Buffer; contentType: string }[] = [];
    let total = 0;
    for (const r of rows) {
      if (total + r.content.length > ATTACHMENT_BUDGET) continue;
      total += r.content.length;
      out.push({ filename: r.name, content: r.content, contentType: r.content_type });
    }
    return out;
  }

  /** The submitter, named addresses, and everyone who can approve under the rule (members and managers). */
  private async recipients(tenantId: string, task: Claimed, to: NotifyRecipients): Promise<string[]> {
    const ids = new Set<string>();
    const typedEmails: string[] = [];
    if (to.approvers || to.submitter) {
      const found = await this.projects.cellTx(tenantId, async (tx) => {
        const author = to.submitter ? await tx.selectFrom('submission').select(['submitted_by', 'submitter']).where('id', '=', task.submission_id).executeTakeFirst() : undefined;
        const members = to.approvers ? await tx.selectFrom('project_member').select(['user_id', 'role', 'permission_groups']).where('project_id', '=', task.project_id).execute() : [];
        const matching: string[] = [];
        for (const m of members) {
          if (m.role === 'manager') {
            matching.push(m.user_id);
            continue;
          }
          const groups = await this.projects.groupsOf(tx, task.project_id, m.permission_groups);
          if (matchesRule(to.approvers!, { role: m.role, groups }, m.user_id)) matching.push(m.user_id);
        }
        return { author: author?.submitted_by ?? null, typed: author?.submitter ?? null, matching };
      });
      if (found.author) ids.add(found.author);
      // Someone who came through a link has no account: the email they gave (and confirmed) is their address.
      if (!found.author && found.typed && EMAIL.test(found.typed)) typedEmails.push(found.typed.toLowerCase());
      for (const id of found.matching) ids.add(id);
      for (const id of to.approvers?.users ?? []) ids.add(id);
    }
    const users = ids.size ? await this.ctx.db.selectFrom('user_identity').select('email').where('id', 'in', [...ids]).execute() : [];
    return [...new Set([...users.map((u) => u.email).filter((e): e is string => !!e), ...to.emails, ...typedEmails])];
  }
}
