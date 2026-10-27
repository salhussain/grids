import { createHash } from 'node:crypto';
import { uuidv7 } from '@grids/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// People without an account filling a form in through a link.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let key: string;
let facility: { id: string };
let form: { key: string; name: string; draft: unknown; groupId: string | null };

const api = (who: string) => {
  const base = `/tenants/${tenantId}/projects`;
  return {
    get: (url = '') => h.call(who, 'GET', `${base}${url}`),
    post: (url: string, body?: unknown) => h.call(who, 'POST', `${base}${url}`, body),
    put: (url: string, body?: unknown) => h.call(who, 'PUT', `${base}${url}`, body),
    del: (url: string) => h.call(who, 'DELETE', `${base}${url}`),
  };
};

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Island Links', 'business');
  admin = await h.join(tenantId, 'admin@il.org', { role: 'org_admin' });
  key = (await h.call(admin, 'POST', `/tenants/${tenantId}/projects`, { name: 'Surveillance', template: 'health-surveillance' })).body.key;
  facility = (await api(admin).get(`/${key}/entities?type=facility&pageSize=5`)).body.items[0];
  form = (await api(admin).get(`/${key}/forms`)).body.find((f: { key: string }) => f.key === 'weekly_report');
}, 180_000);
afterAll(async () => h?.stop());

const publicAccess = (p: object = {}) => ({ publicAccess: { enabled: true, askName: true, captcha: false, perIpPerHour: 100, ...p } });
const save = (settings: object) => api(admin).put(`/${key}/forms/weekly_report`, { key: form.key, name: form.name, subjectType: 'facility', definition: form.draft, groupId: form.groupId, settings });
const links = async () => (await api(admin).get(`/${key}/forms/weekly_report/links`)).body as { id: string; kind: string; path: string; uses: number; revoked: boolean }[];
const shared = async () => (await links()).find((l) => l.kind === 'shared' && !l.revoked)!;
const answers = { malaria: 1, ili: 2, diarrhoea: 0, measles: 0, deaths: 0, outbreak: false, stockout: 0 };
const anon = (method: 'GET' | 'POST', url: string, payload?: unknown, ip = '10.0.0.1') => h.app.inject({ method, url, payload: payload as never, remoteAddress: ip });
const send = (path: string, extra: object = {}, ip?: string) =>
  anon('POST', `/public/forms/${path}/submissions`, { id: uuidv7(), version: 1, answers, collectedAt: new Date().toISOString(), submitter: 'Test person', ...extra }, ip);
const solve = (c: { salt: string; challenge: string; signature: string; maxNumber: number }) => {
  for (let n = 0; n <= c.maxNumber; n++) if (createHash('sha256').update(`${c.salt}${n}`).digest('hex') === c.challenge) return { salt: c.salt, challenge: c.challenge, signature: c.signature, number: n };
  throw new Error('no solution');
};

describe('links', () => {
  it('open nothing while public access is off', async () => {
    const r = await api(admin).post(`/${key}/forms/weekly_report/links`, { kind: 'shared', entityId: facility.id });
    expect(r.status).toBe(200);
    expect((await anon('GET', `/public/forms/${(await shared()).path}`)).statusCode).toBe(404);
  });

  it('read as dead when they name a tenant or a token that does not exist', async () => {
    expect((await anon('GET', `/public/forms/${uuidv7()}.${'a'.repeat(32)}`)).statusCode).toBe(404);
    expect((await anon('GET', `/public/forms/${tenantId}.${'a'.repeat(32)}`)).statusCode).toBe(404);
    expect((await send(`${tenantId}.${'a'.repeat(32)}`)).statusCode).toBe(404);
  });

  it('need to say which place a form about a place is for', async () => {
    expect((await api(admin).post(`/${key}/forms/weekly_report/links`, { kind: 'shared' })).status).toBe(400);
  });

  it('show the form and take answers once public access is on, without writing anywhere else', async () => {
    expect((await save(publicAccess())).status).toBe(200);
    const link = await shared();
    const p = await anon('GET', `/public/forms/${link.path}`);
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ name: form.name, kind: 'shared', version: 1, captcha: false, availability: { state: 'open' } });
    const r = await send(link.path);
    expect(r.statusCode).toBe(200);
    const mine = (await api(admin).get(`/${key}/forms/weekly_report/submissions`)).body.items[0];
    expect(mine).toMatchObject({ viaLink: true, submittedBy: 'Test person', status: 'complete' });
    expect(mine.entity.id).toBe(facility.id);
  });

  it('refuse answers that do not pass the form’s own checks', async () => {
    const r = await send((await shared()).path, { answers: { malaria: 'lots' } });
    expect(r.statusCode).toBe(422);
  });

  it('single-use invites work once', async () => {
    const made = await api(admin).post(`/${key}/forms/weekly_report/links`, { kind: 'invite', entityId: facility.id, invites: [{ label: 'Ana', email: 'ana@example.org' }, { label: 'Ben' }] });
    expect(made.body.filter((l: { kind: string }) => l.kind === 'invite')).toHaveLength(2);
    const [a, b] = (await links()).filter((l) => l.kind === 'invite');
    expect((await send(a!.path)).statusCode).toBe(200);
    const again = await send(a!.path);
    expect(again.statusCode).toBe(403);
    expect(again.json().title).toContain('already been used');
    expect((await anon('GET', `/public/forms/${a!.path}`)).json().availability.state).toBe('limit');
    expect((await links()).find((l) => l.id !== a!.id && l.kind === 'invite')!.uses).toBe(0); // using one leaves the others alone
    const second = await send(b!.path);
    expect(second.statusCode, JSON.stringify(second.json())).toBe(200);
  });

  it('stop working when revoked, and a new shared link replaces the old one', async () => {
    const old = await shared();
    await api(admin).post(`/${key}/forms/weekly_report/links`, { kind: 'shared', entityId: facility.id });
    expect((await anon('GET', `/public/forms/${old.path}`)).statusCode).toBe(404);
    const now = await shared();
    expect(now.path).not.toBe(old.path);
    expect((await api(admin).del(`/${key}/forms/weekly_report/links/${now.id}`)).status).toBe(200);
    expect((await send(now.path)).statusCode).toBe(404);
  });

  it('follow the form’s opening times and limits', async () => {
    await api(admin).post(`/${key}/forms/weekly_report/links`, { kind: 'shared', entityId: facility.id });
    const link = await shared();
    expect((await save({ ...publicAccess(), availability: { opensAt: '2020-01-01T09:00', closesAt: '2020-02-01T09:00', timezone: 'UTC', beforeMessage: '', afterMessage: 'Too late.' } })).status).toBe(200);
    const closed = await send(link.path);
    expect(closed.statusCode).toBe(403);
    expect(closed.json().title).toBe('Too late.');
    expect((await save(publicAccess())).status).toBe(200);
  });
});

describe('language', () => {
  it('opens in the language a link names, and otherwise leaves it to the person', async () => {
    expect((await save(publicAccess())).status).toBe(200);
    const made = await api(admin).post(`/${key}/forms/weekly_report/links`, { kind: 'invite', entityId: facility.id, language: 'ar', invites: [{ label: 'Lina', email: 'lina@example.org' }] });
    expect(made.status).toBe(200);
    const mine = (await links()).find((l) => (l as { label?: string }).label === 'Lina') as unknown as { path: string; language: string | null };
    expect(mine.language).toBe('ar');
    expect((await anon('GET', `/public/forms/${mine.path}`)).json().language).toBe('ar');
    await api(admin).post(`/${key}/forms/weekly_report/links`, { kind: 'shared', entityId: facility.id });
    expect((await anon('GET', `/public/forms/${(await shared()).path}`)).json().language).toBeNull();
    expect((await api(admin).post(`/${key}/forms/weekly_report/links`, { kind: 'shared', entityId: facility.id, language: 'Arabic' })).status).toBe(400);
  });
});

describe('protection', () => {
  it('asks for the puzzle, and takes each answer to it once', async () => {
    expect((await save(publicAccess({ captcha: true }))).status).toBe(200);
    const link = await shared();
    expect((await send(link.path)).statusCode).toBe(400);
    const c = (await anon('GET', '/public/captcha')).json();
    const solved = solve(c);
    expect((await send(link.path, { captcha: solved })).statusCode).toBe(200);
    expect((await send(link.path, { captcha: solved })).statusCode).toBe(400);
    expect((await send(link.path, { captcha: { ...solve((await anon('GET', '/public/captcha')).json()), number: 1 } })).statusCode).toBe(400);
  });

  it('limits how often one address can send', async () => {
    expect((await save(publicAccess({ perIpPerHour: 2 }))).status).toBe(200);
    const link = await shared();
    const ip = '10.9.9.9';
    expect((await send(link.path, {}, ip)).statusCode).toBe(200);
    expect((await send(link.path, {}, ip)).statusCode).toBe(200);
    expect((await send(link.path, {}, ip)).statusCode).toBe(429);
  });

  it('cannot be switched on for a form that asks for pictures or files', async () => {
    const def = JSON.parse(JSON.stringify(form.draft));
    def.sections[0].questions.push({ key: 'photo', type: 'image', label: 'A photo' });
    const r = await api(admin).put(`/${key}/forms/weekly_report`, { key: form.key, name: form.name, subjectType: 'facility', definition: def, groupId: form.groupId, settings: publicAccess() });
    expect(r.status).toBe(400);
  });
});
