import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// Work: tickets, tasks and the like. Who can open, take, change and say things about them.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let ana: string;
let ben: string;
let outsider: string;
let anaId: string;
let benId: string;
let key: string;

const api = (who: string) => {
  const base = `/tenants/${tenantId}/projects/${key}/work`;
  return {
    get: (url = '') => h.call(who, 'GET', `${base}${url}`),
    post: (url: string, body?: unknown) => h.call(who, 'POST', `${base}${url}`, body),
    put: (url: string, body?: unknown) => h.call(who, 'PUT', `${base}${url}`, body),
    patch: (url: string, body?: unknown) => h.call(who, 'PATCH', `${base}${url}`, body),
    del: (url: string) => h.call(who, 'DELETE', `${base}${url}`),
  };
};

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Island Desk', 'business');
  admin = await h.join(tenantId, 'admin@id.org', { role: 'org_admin' });
  ana = await h.join(tenantId, 'ana@id.org');
  ben = await h.join(tenantId, 'ben@id.org');
  outsider = await h.join(tenantId, 'out@id.org');
  key = (await h.call(admin, 'POST', `/tenants/${tenantId}/projects`, { name: 'Helpdesk' })).body.key;
  anaId = await h.userId(tenantId, 'ana@id.org');
  benId = await h.userId(tenantId, 'ben@id.org');
  for (const id of [anaId, benId]) await h.call(admin, 'PUT', `/tenants/${tenantId}/projects/${key}/members`, { userId: id });
}, 180_000);
afterAll(async () => h?.stop());

const ticketType = { key: 'ticket', name: 'Ticket', prefix: 'tkt', sla: { respondHours: { urgent: 1, normal: 8 }, resolveHours: { urgent: 4, normal: 72 } } };

describe('types', () => {
  it('are set up by managers, with sensible states and an upper-case prefix', async () => {
    expect((await api(ana).post('/types', ticketType)).status).toBe(403);
    const made = await api(admin).post('/types', ticketType);
    expect(made.status).toBe(200);
    expect(made.body[0]).toMatchObject({ key: 'ticket', prefix: 'TKT', openCount: 0 });
    expect(made.body[0].states.map((s: { key: string }) => s.key)).toEqual(['new', 'in_progress', 'waiting', 'resolved', 'closed']);
    expect((await api(admin).post('/types', ticketType)).status).toBe(409);
  });

  it('need a state for new work and one for finished work', async () => {
    const bad = await api(admin).post('/types', { key: 'odd', name: 'Odd', states: [{ key: 'a', label: 'A', kind: 'active' }, { key: 'b', label: 'B', kind: 'active' }] });
    expect(bad.status).toBe(400);
  });
});

describe('work', () => {
  let id: string;

  it('is opened by a project member, numbered, and given its service deadlines', async () => {
    const r = await api(ana).post('', { type: 'ticket', title: 'Printer is jammed', description: 'Paper everywhere', priority: 'urgent' });
    expect(r.status).toBe(201);
    id = r.body.id;
    expect(r.body).toMatchObject({ ref: 'TKT-1', number: 1, title: 'Printer is jammed', priority: 'urgent', state: { key: 'new', kind: 'open' }, assignee: null, overdue: false, breached: false });
    expect(r.body.requester.id).toBe(anaId);
    expect(r.body.events.map((e: { kind: string }) => e.kind)).toEqual(['created']);
    const hours = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
    expect(hours(r.body.createdAt, r.body.respondBy)).toBeCloseTo(1, 1);
    expect(hours(r.body.createdAt, r.body.resolveBy)).toBeCloseTo(4, 1);
    expect((await api(ana).post('', { type: 'ticket', title: 'Second' })).body.ref).toBe('TKT-2');
  });

  it('cannot be opened by someone outside the project', async () => {
    // A person who is not in the project cannot even tell that it exists.
    expect((await api(outsider).post('', { type: 'ticket', title: 'Hi' })).status).toBe(404);
    expect((await api(outsider).get()).status).toBe(404);
  });

  it('is given to someone by a manager, but members only take it themselves', async () => {
    expect((await api(ana).patch(`/${id}`, { assigneeId: benId })).status).toBe(403);
    const taken = await api(ana).patch(`/${id}`, { assigneeId: anaId });
    expect(taken.status).toBe(200);
    expect(taken.body.assignee).toMatchObject({ id: anaId });
    const given = await api(admin).patch(`/${id}`, { assigneeId: benId });
    expect(given.body.assignee).toMatchObject({ id: benId });
    expect((await api(admin).patch(`/${id}`, { assigneeId: (await h.userId(tenantId, 'out@id.org')) })).status).toBe(400); // not in the project
  });

  it('shows up for the person it is assigned to, across projects', async () => {
    const mine = await h.call(ben, 'GET', `/tenants/${tenantId}/work/mine`);
    expect(mine.status).toBe(200);
    expect(mine.body.map((w: { ref: string }) => w.ref)).toEqual(['TKT-1']);
    expect(mine.body[0].project.key).toBe(key);
  });

  it('moves through its states, which stamps when it was taken up and finished', async () => {
    expect((await api(ana).patch(`/${id}`, { state: 'nonsense' })).status).toBe(400);
    const start = await api(ben).patch(`/${id}`, { state: 'in_progress' });
    expect(start.body.state).toMatchObject({ key: 'in_progress', kind: 'active' });
    expect(start.body.firstResponseAt).not.toBeNull();
    expect(start.body.resolvedAt).toBeNull();
    const done = await api(ben).patch(`/${id}`, { state: 'resolved' });
    expect(done.body.resolvedAt).not.toBeNull();
    const reopened = await api(ben).patch(`/${id}`, { state: 'new' });
    expect(reopened.body.resolvedAt).toBeNull();
    expect(reopened.body.events.filter((e: { kind: string }) => e.kind === 'state')).toHaveLength(3);
  });

  it('keeps a conversation, with notes the person who asked does not see marked internal', async () => {
    const a = await api(ben).post(`/${id}/comments`, { body: 'Looking at it now' });
    expect(a.status).toBe(200);
    const b = await api(ben).post(`/${id}/comments`, { body: 'Probably the roller', internal: true });
    const comments = b.body.events.filter((e: { kind: string }) => e.kind === 'comment');
    expect(comments.map((c: { body: string; internal: boolean }) => [c.body, c.internal])).toEqual([['Looking at it now', false], ['Probably the roller', true]]);
    expect(b.body.commentCount).toBe(2);
  });

  it('can be changed only by managers, or whoever it is assigned to or came from', async () => {
    const other = (await api(ana).post('', { type: 'ticket', title: 'Mine' })).body.id;
    expect((await api(ben).patch(`/${other}`, { title: 'Hijacked' })).status).toBe(403);
    expect((await api(ana).patch(`/${other}`, { title: 'Still mine', priority: 'high' })).body).toMatchObject({ title: 'Still mine', priority: 'high' });
    expect((await api(admin).patch(`/${other}`, { dueAt: '2020-01-01T00:00:00Z' })).body.overdue).toBe(true);
  });

  it('is found by filters: mine, unassigned, overdue, open or finished, and words or its number', async () => {
    const ids = async (qs: string) => ((await api(admin).get(qs)).body.items as { ref: string }[]).map((i) => i.ref).sort();
    expect(await ids('')).toEqual(['TKT-1', 'TKT-2', 'TKT-3']);
    expect(await ids(`?assignee=${benId}`)).toEqual(['TKT-1']);
    expect(await ids('?assignee=none')).toEqual(['TKT-2', 'TKT-3']);
    expect(await ids('?overdue=true')).toEqual(['TKT-3']);
    expect(await ids('?q=printer')).toEqual(['TKT-1']);
    expect(await ids('?q=tkt-2')).toEqual(['TKT-2']);
    expect(await ids('?priority=high')).toEqual(['TKT-3']);
    await api(admin).patch(`/${(await api(admin).get('?q=tkt-2')).body.items[0].id}`, { state: 'closed' });
    expect(await ids('?state=done')).toEqual(['TKT-2']);
    expect(await ids('?state=open')).toEqual(['TKT-1', 'TKT-3']);
    expect((await api(ana).get('?requester=me')).body.total).toBe(3);
  });
});

describe('types in use', () => {
  it('cannot lose a state that work is in, or be deleted while it has work', async () => {
    const states = [{ key: 'new', label: 'New', kind: 'open' }, { key: 'resolved', label: 'Resolved', kind: 'done' }];
    const r = await api(admin).put('/types/ticket', { ...ticketType, states });
    expect(r.status).toBe(400); // TKT-2 is still in "closed"
    expect((await api(admin).put('/types/ticket', { ...ticketType, name: 'Support ticket' })).body[0].name).toBe('Support ticket');
    expect((await api(admin).del('/types/ticket')).status).toBe(409);
  });
});

describe('reporting', () => {
  const run = (spec: Record<string, unknown>) => h.call(admin, 'POST', `/tenants/${tenantId}/projects/${key}/query`, spec);

  it('counts, splits and times work for dashboards', async () => {
    const total = await run({ kind: 'work', measure: 'count', type: 'ticket' });
    expect(total.status).toBe(200);
    expect(total.body.kind).toBe('kpi');
    expect(total.body.rows[0].value).toBe(3);
    expect((await run({ kind: 'work', measure: 'count', state: 'done' })).body.rows[0].value).toBe(1);
    const byState = await run({ kind: 'work', measure: 'count', by: 'state' });
    expect(byState.body.kind).toBe('breakdown');
    expect(byState.body.rows.reduce((n: number, r: { value: number }) => n + r.value, 0)).toBe(3);
    const daily = await run({ kind: 'work', measure: 'count', by: 'day' });
    expect(daily.body.kind).toBe('series');
    expect(daily.body.rows.reduce((n: number, r: { value: number }) => n + r.value, 0)).toBe(3);
  });
});

describe('recurring work', () => {
  const base = () => `/tenants/${tenantId}/projects/${key}`;
  const sched = (body: unknown, who = admin) => h.call(who, 'POST', `${base()}/work/schedules`, body);
  let truck: string;

  it('is set up by managers, for a thing or every thing of a type, and needs a rhythm', async () => {
    await h.call(admin, 'POST', `${base()}/types`, { key: 'vehicle', name: 'Vehicle', plural: 'Vehicles', attributes: [{ key: 'odometer', label: 'Odometer', type: 'number' }] });
    truck = (await h.call(admin, 'POST', `${base()}/entities`, { typeKey: 'vehicle', code: 'V1', name: 'Truck 1', attributes: { odometer: 1000 } })).body.id;
    await api(admin).post('/types', { key: 'maintenance', name: 'Maintenance', prefix: 'MNT' });
    const body = { key: 'service', name: 'Service', type: 'maintenance', title: 'Service ${name}', entityType: 'vehicle', everyDays: 1, leadDays: 1 };
    expect((await sched(body, ana)).status).toBe(403);
    expect((await sched({ ...body, everyDays: null })).status).toBe(400);
    expect((await sched({ ...body, entityType: null })).status).toBe(400);
    const made = await sched(body);
    expect(made.status).toBe(200);
    expect(made.body[0]).toMatchObject({ key: 'service', type: 'maintenance', entityType: 'vehicle', everyDays: 1, targets: 0 });
    expect((await sched(body)).status).toBe(409);
  });

  it('opens work when it falls due, once, and again after the work is finished', async () => {
    const run = () => h.services.workSchedules.run(tenantId);
    expect(await run()).toBe(0); // first pass starts the clock
    expect(await run()).toBe(1); // due within the lead time
    expect(await run()).toBe(0); // already open
    const items = (await api(admin).get('?type=maintenance')).body.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Service Truck 1', ref: expect.stringMatching(/^MNT-/), source: 'schedule' });
    await api(admin).patch(`/${items[0].id}`, { state: 'resolved' });
    expect(await run()).toBe(1); // re-armed from the finish date; the 1-day lead makes it due at once
    expect(await run()).toBe(0);
    expect((await api(admin).get('?type=maintenance')).body.total).toBe(2);
  });

  it('opens work by use, when a meter has run far enough', async () => {
    await sched({ key: 'oil', name: 'Oil change', type: 'maintenance', title: 'Oil ${code}', entityId: truck, meterAttribute: 'odometer', meterEvery: 500 });
    const run = () => h.services.workSchedules.run(tenantId);
    await run();
    expect((await api(admin).get('?q=Oil')).body.total).toBe(0);
    await h.call(admin, 'PATCH', `${base()}/entities/${truck}`, { attributes: { odometer: 1600 }, version: 1 });
    await run();
    expect((await api(admin).get('?q=Oil')).body.items.map((i: { title: string }) => i.title)).toEqual(['Oil V1']);
  });
});
