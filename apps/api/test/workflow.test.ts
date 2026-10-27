import { withTenant } from '@grids/db';
import { uuidv7 } from '@grids/schema';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// Graph workflows on forms: branching, approvals, email, webhooks, entity writes and SLA timers.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let ed: string;
let key: string;
let facility: { id: string };
let form: { key: string; name: string; draft: unknown; groupId: string | null };
const hooks: { url: string; body: any }[] = [];
let hookStatus = 200;

beforeAll(async () => {
  h = await startHarness({
    fetch: (async (url: string, init: RequestInit) => {
      hooks.push({ url, body: JSON.parse(String(init.body)) });
      return new Response('', { status: hookStatus });
    }) as unknown as typeof fetch,
  });
  tenantId = await h.activeTenant('Island Health', 'business');
  admin = await h.join(tenantId, 'admin@ih.org', { role: 'org_admin' });
  ed = await h.join(tenantId, 'ed@ih.org');
  const project = (await h.call(admin, 'POST', `/tenants/${tenantId}/projects`, { name: 'Surveillance', template: 'health-surveillance' })).body;
  key = project.key;
  await api(admin).put(`/${key}/members`, { userId: await h.userId(tenantId, 'ed@ih.org') });
  facility = (await api(ed).get(`/${key}/entities?type=facility&pageSize=5`)).body.items[0];
  form = (await api(admin).get(`/${key}/forms`)).body.find((f: { key: string }) => f.key === 'weekly_report');
}, 180_000);
afterAll(async () => h?.stop());

const api = (who: string) => {
  const base = `/tenants/${tenantId}/projects`;
  return {
    get: (url = '') => h.call(who, 'GET', `${base}${url}`),
    post: (url: string, body?: unknown) => h.call(who, 'POST', `${base}${url}`, body),
    put: (url: string, body?: unknown) => h.call(who, 'PUT', `${base}${url}`, body),
  };
};

const node = (id: string, type: string, extra: object = {}) => ({ id, type, ...extra });
const edge = (from: string, to: string, handle = 'next') => ({ id: `${from}:${handle}`, from, to, handle });

const graph = {
  nodes: [
    node('start', 'start'),
    node('ack', 'notify', { subject: 'Received ${deaths} deaths', body: 'Thanks.', to: { submitter: true, emails: ['qa@ih.org'] } }),
    node('big', 'branch', { condition: '${deaths} > 0' }),
    node('review', 'approval', { name: 'Clinical review', approvers: { role: 'manager' }, slaHours: 24 }),
    node('esc', 'notify', { subject: 'Review overdue', to: { emails: ['boss@ih.org'] } }),
    node('review2', 'approval', { name: 'Escalated review', approvers: { role: 'manager' } }),
    node('hook', 'webhook', { url: 'https://hooks.example.com/forms' }),
    node('save', 'entity'),
    node('ok', 'end', { outcome: 'approved', name: 'Verified' }),
    node('no', 'end', { outcome: 'rejected', name: 'Declined' }),
  ],
  edges: [
    edge('start', 'ack'),
    edge('ack', 'big'),
    edge('big', 'review', 'true'),
    edge('big', 'save', 'false'),
    edge('review', 'hook', 'approved'),
    edge('review', 'no', 'rejected'),
    edge('review', 'esc', 'timeout'),
    edge('esc', 'review2'),
    edge('review2', 'hook', 'approved'),
    edge('review2', 'no', 'rejected'),
    edge('hook', 'save'),
    edge('save', 'ok'),
  ],
};

const saveForm = (g: unknown) =>
  api(admin).put(`/${key}/forms/weekly_report`, {
    key: form.key,
    name: form.name,
    subjectType: 'facility',
    definition: form.draft,
    groupId: form.groupId,
    settings: { workflow: { enabled: true, graph: g } },
  });

const answers = (deaths: number, ili: number) => ({ malaria: 1, ili, diarrhoea: 0, measles: 0, deaths, outbreak: false, stockout: 0 });
const submit = (deaths: number, ili: number) =>
  api(ed).post(`/${key}/forms/weekly_report/submissions`, { id: uuidv7(), version: 1, entityId: facility.id, collectedAt: '2026-08-05T10:00:00Z', answers: answers(deaths, ili) });
const series = async () => (await api(admin).get(`/${key}/entities/${facility.id}/series?element=ili_cases`)).body.map((x: { value: number }) => x.value);
const review = (id: string, body: unknown) => api(admin).post(`/${key}/submissions/${id}/review`, body);
const tick = () => h.services.workflow.tickTenant(tenantId);
const makeDue = (submissionId: string, kind: string) =>
  withTenant(h.dbs.cellApp, tenantId, (tx) =>
    sql`update workflow_task set due_at = now() - interval '1 minute' where submission_id = ${submissionId} and kind = ${kind} and status = 'pending'`.execute(tx),
  );

describe('graph workflows', () => {
  it('rejects graphs that cannot run', async () => {
    const missing = { ...graph, edges: graph.edges.filter((e) => e.id !== 'big:false') };
    expect((await saveForm(missing)).status).toBe(400);
    const local = { ...graph, nodes: graph.nodes.map((n) => (n.id === 'hook' ? { ...n, url: 'http://localhost:9/x' } : n)) };
    expect((await saveForm(local)).status).toBe(400);
    const loop = { ...graph, edges: [...graph.edges.filter((e) => e.id !== 'review2:rejected'), edge('review2', 'review', 'rejected')] };
    expect((await saveForm(loop)).status).toBe(400);
    expect((await saveForm(graph)).status).toBe(200);
  });

  it('runs straight through when the branch skips the approval, writing the entity and emailing', async () => {
    const sub = await submit(0, 555);
    expect(sub.status).toBe(201);
    expect(sub.body).toMatchObject({ status: 'complete', nodeId: null, stages: [], outcome: null }); // the branch skipped every approval
    expect(await series()).toContain(555); // the entity node wrote it immediately
    const r = await tick();
    expect(r.emails).toBe(1);
    expect(h.mailer.to('ed@ih.org').at(-1)).toMatchObject({ subject: 'Received 0 deaths', text: 'Thanks.' });
    expect(h.mailer.to('qa@ih.org').at(-1)?.subject).toBe('Received 0 deaths');
  });

  it('parks on the approval, holds the entity write, then fires the webhook after approval', async () => {
    const sub = await submit(3, 777);
    expect(sub.body).toMatchObject({ status: 'in_review', nodeId: 'review', stageName: 'Clinical review', stages: ['Clinical review'], stage: 0, outcome: null, canReview: false }); // the escalation path is not a stage
    expect(await series()).not.toContain(777);
    await tick();
    expect(hooks).toHaveLength(0);

    const done = (await review(sub.body.id, { decision: 'approve' })).body;
    expect(done).toMatchObject({ status: 'approved', outcome: 'Verified' });
    expect(await series()).toContain(777);
    const r = await tick();
    expect(r.webhooks).toBe(1);
    expect(hooks[0]).toMatchObject({ url: 'https://hooks.example.com/forms', body: { form: 'weekly_report', node: 'hook', status: 'approved', submission: sub.body.id } });
  });

  it('escalates through the timeout outlet when the SLA lapses', async () => {
    const sub = await submit(2, 888);
    await tick();
    const id = sub.body.id;
    await makeDue(id, 'timer');
    expect((await tick()).timers).toBe(1);
    expect((await tick()).emails).toBe(1); // the "overdue" notice to the boss, queued by the escalation
    expect(h.mailer.to('boss@ih.org').at(-1)?.subject).toBe('Review overdue');
    const now = (await api(admin).get(`/${key}/submissions/${id}`)).body;
    expect(now).toMatchObject({ status: 'in_review', nodeId: 'review2', stageName: 'Escalated review' });
    expect(now.reviews.map((x: { decision: string }) => x.decision)).toEqual(['submitted', 'timed_out']);
    expect((await review(id, { decision: 'approve' })).body.status).toBe('approved');
  });

  it('ignores a timer once the submission has been decided', async () => {
    const sub = await submit(2, 999);
    await review(sub.body.id, { decision: 'reject', comment: 'Duplicate' });
    await makeDue(sub.body.id, 'timer'); // cancelled on decision, so nothing is due
    const r = await tick();
    expect(r.timers).toBe(0);
    expect((await api(admin).get(`/${key}/submissions/${sub.body.id}`)).body).toMatchObject({ status: 'rejected', outcome: 'Declined' });
  });

  it('retries failed webhooks with backoff, then delivers', async () => {
    hooks.length = 0;
    const sub = await submit(1, 321);
    hookStatus = 500;
    await review(sub.body.id, { decision: 'approve' });
    const failed = await tick();
    expect(failed).toMatchObject({ webhooks: 0, retried: 1 });
    hookStatus = 200;
    expect((await tick()).webhooks).toBe(0); // backing off
    await makeDue(sub.body.id, 'webhook');
    expect((await tick()).webhooks).toBe(1);
    expect(hooks.length).toBe(2);
  });

  it('a returned submission can be corrected and restarts from the beginning', async () => {
    const sub = await submit(4, 444);
    expect((await review(sub.body.id, { decision: 'return', comment: 'Recheck' })).body).toMatchObject({ status: 'returned', nodeId: 'review', canResubmit: false });
    const again = await api(ed).put(`/${key}/submissions/${sub.body.id}`, { answers: answers(0, 444), comment: 'Fixed' });
    expect(again.body).toMatchObject({ status: 'complete', nodeId: null }); // deaths 0 now skips the approval
    expect(await series()).toContain(444);
  });
});

describe('forms about the project itself', () => {
  const projectForm = (settings: object = { fillRole: 'editor' }) => ({
    key: 'site_visit',
    name: 'Site visit',
    subjectType: 'this_project',
    definition: { title: 'Site visit', sections: [{ key: 'main', title: '', questions: [{ key: 'visits', type: 'integer', label: 'Visits', bind: { element: 'ili_cases' } }] }] },
    settings,
  });

  it('hides the project entity everywhere and reserves its type', async () => {
    const detail = (await api(admin).get(`/${key}`)).body;
    const types = (await api(admin).get(`/${key}/types`)).body;
    expect(types.map((t: { key: string }) => t.key)).not.toContain('this_project');
    const entities = (await api(admin).get(`/${key}/entities?pageSize=50`)).body;
    expect(entities.items.every((e: { type: { key: string } }) => e.type.key !== 'this_project')).toBe(true);
    expect(detail.counts.entities).toBe(entities.total);
    const reserved = await api(admin).post(`/${key}/types`, { key: 'this_project', name: 'X', plural: 'Xs' });
    expect(reserved.status).toBe(400);
  });

  it('is submitted without choosing an entity, even by someone scoped to one subtree', async () => {
    const saved = await api(admin).post(`/${key}/forms`, projectForm());
    expect(saved.status).toBeLessThan(300);
    expect((await api(admin).post(`/${key}/forms/site_visit/publish`)).status).toBe(200);
    const sub = await api(ed).post(`/${key}/forms/site_visit/submissions`, { id: uuidv7(), version: 1, entityId: null, collectedAt: '2026-08-05T10:00:00Z', answers: { visits: 3 } });
    expect(sub.status).toBe(201);
    expect(sub.body).toMatchObject({ status: 'complete', answers: { visits: 3 } });
    expect(sub.body.entity).toMatchObject({ name: 'Surveillance' });
    const list = (await api(ed).get(`/${key}/forms/site_visit/submissions`)).body;
    expect(list.total).toBe(1);
    const forms = (await api(admin).get(`/${key}/forms`)).body;
    expect(forms.find((f: { key: string }) => f.key === 'site_visit').subjectType).toMatchObject({ key: 'this_project' });
  });

  it('rejects attribute bindings (the project has none)', async () => {
    const bad = projectForm();
    (bad.definition.sections[0]!.questions[0] as { bind: object }).bind = { attribute: 'beds' };
    expect((await api(admin).put(`/${key}/forms/site_visit`, bad)).status).toBe(400);
  });
});

describe('parts of a form that approvers fill in', () => {
  const simple = {
    nodes: [node('start', 'start'), node('review', 'approval', { name: 'Registration', approvers: { role: 'manager' } }), node('ok', 'end', { outcome: 'approved' }), node('no', 'end', { outcome: 'rejected' })],
    edges: [edge('start', 'review'), edge('review', 'ok', 'approved'), edge('review', 'no', 'rejected')],
  };
  const withPart = (fillAt: string) => {
    const def = form.draft as { sections: object[] };
    return {
      ...def,
      sections: [
        { key: 'where', title: 'Where', questions: [{ key: 'place', type: 'entity', label: 'Facility', entityType: 'facility', primary: true, required: true }] },
        ...def.sections,
        { key: 'registration', title: 'Registration', fillAt, questions: [{ key: 'reg_no', type: 'text', label: 'Registration no.', required: true }] },
      ],
    };
  };
  const save = (definition: unknown) =>
    api(admin).put(`/${key}/forms/weekly_report`, { key: form.key, name: form.name, subjectType: 'facility', definition, groupId: form.groupId, settings: { workflow: { enabled: true, graph: simple } } });
  let version = 1;
  const send = (extra: object = {}) =>
    api(ed).post(`/${key}/forms/weekly_report/submissions`, { id: uuidv7(), version, entityId: facility.id, collectedAt: '2026-08-05T10:00:00Z', answers: { ...answers(0, 1), place: facility.id, ...extra } });

  it('must belong to a step of the workflow', async () => {
    expect((await save(withPart('nowhere'))).status).toBe(400);
    expect((await save(withPart('review'))).status).toBe(200);
    // Submissions go by the published version.
    expect((await api(admin).post(`/${key}/forms/weekly_report/publish`)).status).toBe(200);
    version = (await api(admin).get(`/${key}/forms`)).body.find((f: { key: string }) => f.key === 'weekly_report').currentVersion;
  });

  it('are not asked of the applicant, but of the approver when approving', async () => {
    // The applicant is not asked for it, and cannot slip an answer in.
    const sub = await send({ reg_no: 'MINE' });
    expect(sub.status).toBe(201);
    expect(sub.body.answers.reg_no).toBeUndefined();
    expect(sub.body).toMatchObject({ status: 'in_review', nodeId: 'review' });

    // Approving needs the part filled in; nothing is decided without it.
    const missing = await review(sub.body.id, { decision: 'approve' });
    expect(missing.status).toBe(422);
    expect(JSON.stringify(missing.body.errors)).toContain('reg_no');
    expect((await api(admin).get(`/${key}/submissions/${sub.body.id}`)).body.status).toBe('in_review');

    const done = await review(sub.body.id, { decision: 'approve', answers: { reg_no: 'REG-1' } });
    expect(done.body).toMatchObject({ status: 'approved', answers: { reg_no: 'REG-1' } });

    // Sending back or rejecting does not ask for it.
    const other = await send();
    expect((await review(other.body.id, { decision: 'reject', comment: 'No' })).body.status).toBe('rejected');
  });
});
