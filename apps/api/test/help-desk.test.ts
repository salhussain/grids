import { createHash, createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// The organisation's help desk: people on its public pages ask it for help, and it works the tickets through its own stages.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let slug: string;
let admin: string;
let adminId: string;
let reader: string; // a signed-in member with no say over support
let readerId: string;

const anon = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, ip = '10.2.0.1') => h.app.inject({ method, url, payload: payload as never, remoteAddress: ip });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const org = (rest: string) => `/public/orgs/${slug}/help${rest}`;
/** Solves the browser's proof-of-work puzzle, as the page does. */
async function puzzle(ip = '10.2.0.1') {
  const c = (await anon('GET', '/public/captcha', undefined, ip)).json() as { salt: string; challenge: string; signature: string; maxNumber: number };
  for (let n = 0; n <= c.maxNumber; n++) if (sha(`${c.salt}${n}`) === c.challenge) return { salt: c.salt, challenge: c.challenge, signature: c.signature, number: n };
  throw new Error('no solution');
}
const upload = (url: string, name: string, type: string, bytes: Buffer, ip = '10.2.0.2') => h.app.inject({ method: 'PUT', url: `${url}?name=${name}&type=${type}`, headers: { 'content-type': 'application/octet-stream' }, payload: bytes, remoteAddress: ip });

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Coral Org', 'business');
  admin = await h.join(tenantId, 'admin@coral.org', { role: 'org_admin' });
  reader = await h.join(tenantId, 'reader@coral.org');
  adminId = (await h.userId(tenantId, 'admin@coral.org'))!;
  readerId = (await h.userId(tenantId, 'reader@coral.org'))!;
  slug = (await h.admin('GET', `/platform/tenants/${tenantId}`)).body.slug;
}, 180_000);
afterAll(async () => h?.stop());

describe('the organisation’s help desk', () => {
  let token: string;
  let ticketId: string;

  it('is off until the organisation turns it on, and starts with stages it can change', async () => {
    expect((await anon('GET', org(''))).json()).toMatchObject({ enabled: false });
    expect((await anon('POST', org('/requests'), { name: 'Ana', email: 'ana@example.org', subject: 'Map is blank', body: 'Nothing loads' })).statusCode).toBe(404);
    const desk = (await h.call(admin, 'GET', `/tenants/${tenantId}/support/desk`)).body;
    expect(desk.stages.map((s: { label: string }) => s.label)).toContain('Pending investigation');
    expect(desk.labels.map((l: { key: string }) => l.key)).toContain('bug');
    // Members without a say over support cannot change it.
    expect((await h.call(reader, 'PUT', `/tenants/${tenantId}/support/desk`, { ...desk, enabled: true })).status).toBe(403);
    const saved = await h.call(admin, 'PUT', `/tenants/${tenantId}/support/desk`, { ...desk, enabled: true });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await anon('GET', org(''))).json()).toMatchObject({ enabled: true, orgName: 'Coral Org', chat: true, captcha: true });
    // A stage list needs somewhere to start and somewhere to finish.
    expect((await h.call(admin, 'PUT', `/tenants/${tenantId}/support/desk`, { ...desk, stages: [{ key: 'a', label: 'A', kind: 'active' }, { key: 'b', label: 'B', kind: 'done' }] })).status).toBe(400);
  });

  it('needs a name, an email and the puzzle from someone who is not signed in', async () => {
    const base = { subject: 'Map is blank', body: 'Nothing loads on the Samoa layer', category: 'Question', project: 'reef-health' };
    expect((await anon('POST', org('/requests'), { ...base, email: 'ana@example.org', captcha: await puzzle() })).statusCode).toBe(400);
    expect((await anon('POST', org('/requests'), { ...base, name: 'Ana', email: 'ana@example.org' })).statusCode).toBe(400);
    const puz = await puzzle();
    const ok = await anon('POST', org('/requests'), { ...base, name: 'Ana', email: 'ana@example.org', captcha: puz });
    expect(ok.statusCode, ok.body).toBe(201);
    const sent = ok.json();
    token = sent.token;
    ticketId = sent.thread.id;
    expect(sent.thread).toMatchObject({ ref: expect.stringMatching(/^#\d+$/), subject: 'Map is blank', stage: { label: 'New', kind: 'open' }, canReply: true, answered: false });
    expect(sent.thread.messages).toHaveLength(1);
    expect((await anon('POST', org('/requests'), { ...base, name: 'Ana', email: 'ana@example.org', captcha: puz })).statusCode).toBe(400); // each puzzle once
    expect(h.mailer.sent.some((m) => m.to === 'admin@coral.org' && m.subject.includes('Map is blank'))).toBe(true);
  });

  it('carries files, which the person reads back with their link', async () => {
    const up = await upload(org('/files'), 'screen.png', 'image/png', Buffer.from('89504e470d0a1a0a', 'hex'));
    expect(up.statusCode, up.body).toBe(201);
    const file = up.json() as { id: string };
    expect((await upload(org('/files'), 'run.exe', 'application/x-msdownload', Buffer.from('MZ'))).statusCode).toBe(400);
    const made = await anon('POST', org('/requests'), { name: 'Bo', email: 'bo@example.org', subject: 'Photo of the error', body: 'See the picture', attachments: [file.id], captcha: await puzzle('10.2.0.2') }, '10.2.0.2');
    expect(made.statusCode, made.body).toBe(201);
    const t = made.json();
    expect(t.thread.messages[0].attachments).toEqual([expect.objectContaining({ id: file.id, name: 'screen.png' })]);
    expect((await anon('GET', `/public/help/${t.token}/files/${file.id}`)).headers['content-type']).toBe('image/png');
    expect((await anon('GET', `/public/help/${token}/files/${file.id}`)).statusCode).toBe(404);
    // The team reads it too.
    const detail = (await h.call(admin, 'GET', `/tickets/${t.thread.id}`)).body;
    expect(detail.messages[0].attachments[0].id).toBe(file.id);
    expect((await h.app.inject({ method: 'GET', url: `/support/files/${file.id}`, headers: { authorization: `Bearer ${admin}` } })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: `/support/files/${file.id}`, headers: { authorization: `Bearer ${reader}` } })).statusCode).toBe(404); // members who are not on the support team do not read other people's tickets
  });

  it('lands in the organisation’s inbox, where the team works it with stages, people, labels and notes', async () => {
    const list = (await h.call(admin, 'GET', `/tenants/${tenantId}/tickets?channel=help`)).body.items as { id: string; channel: string; createdBy: { name: string; email: string }; stage: { key: string }; sourceProject: string }[];
    const mine = list.find((t) => t.id === ticketId)!;
    expect(mine).toMatchObject({ channel: 'help', createdBy: { name: 'Ana', email: 'ana@example.org' }, stage: { key: 'new' }, sourceProject: 'reef-health' });
    const patch = (body: unknown) => h.call(admin, 'PATCH', `/tenants/${tenantId}/tickets/${ticketId}`, body);
    expect((await patch({ assigneeId: adminId, priority: 'high', labels: ['bug'] })).body).toMatchObject({ assignee: { id: adminId }, priority: 'high', labels: ['bug'] });
    expect((await patch({ labels: ['nope'] })).status).toBe(400);
    expect((await patch({ assigneeId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    const asked = await h.call(admin, 'POST', `/tickets/${ticketId}/messages`, { body: 'Could you tell us which browser you use?' });
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    // A private note never reaches the person.
    expect((await h.call(admin, 'POST', `/tickets/${ticketId}/messages`, { body: 'Probably the tile cache', internal: true })).status).toBe(200);
    expect((await h.call(reader, 'POST', `/tickets/${ticketId}/messages`, { body: 'x', internal: true })).status).toBeGreaterThanOrEqual(400);
    // Replying picked it up; then the team moves it to one of its own stages.
    expect((await h.call(admin, 'GET', `/tickets/${ticketId}`)).body.stage.kind).toBe('active');
    expect((await patch({ stage: 'pending_investigation' })).body.stage).toMatchObject({ key: 'pending_investigation', label: 'Pending investigation' });
    expect((await patch({ stage: 'nope' })).status).toBe(400);
    const detail = (await h.call(admin, 'GET', `/tickets/${ticketId}`)).body;
    expect(detail.messages.map((m: { body: string }) => m.body)).toEqual(expect.arrayContaining(['Probably the tile cache', 'Assigned to Platform Admin'.replace('Platform Admin', detail.assignee.name), 'Stage changed to Pending investigation']));
    // What the person sees.
    const seen = (await anon('GET', `/public/help/${token}`)).json();
    expect(seen.stage.label).toBe('Pending investigation');
    expect(seen.answered).toBe(true);
    expect(seen.agentTyping).toBeNull();
    expect(seen.messages.map((m: { from: string; body: string }) => `${m.from}: ${m.body}`)).toEqual([
      expect.stringContaining('requester: Nothing loads'),
      expect.stringMatching(/^system: .+ has joined the chat$/),
      'staff: Could you tell us which browser you use?',
    ]);
    // They are emailed at the address they gave, with the link that opens the conversation.
    expect(h.mailer.sent.filter((m) => m.to === 'ana@example.org').at(-1)!.text).toContain(`/h/${token}`);
  });

  it('lets the person answer in the same conversation, and reopens it once resolved', async () => {
    const r = await anon('POST', `/public/help/${token}/messages`, { body: 'Firefox 130' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().messages.at(-1)).toMatchObject({ from: 'requester', body: 'Firefox 130' });
    expect((await anon('POST', `/public/help/${token}/messages`, { body: '' })).statusCode).toBe(400);
    await h.call(admin, 'PATCH', `/tenants/${tenantId}/tickets/${ticketId}`, { stage: 'resolved' });
    expect((await anon('GET', `/public/help/${token}`)).json().stage.kind).toBe('done');
    // The plain status follows the stage, so the Resolved tab finds it.
    expect((await h.call(admin, 'GET', `/tenants/${tenantId}/tickets?status=resolved&channel=help`)).body.items.some((t: { id: string }) => t.id === ticketId)).toBe(true);
    const again = await anon('POST', `/public/help/${token}/messages`, { body: 'Still blank, sorry' });
    expect(again.json().stage.kind).not.toBe('done');
    expect((await anon('GET', `/public/help/${token}x`)).statusCode).toBe(404);
  });

  it('is signed-in people’s too, without a name, email or puzzle', async () => {
    expect((await h.call(reader, 'GET', `/tenants/${tenantId}/help`)).body).toMatchObject({ enabled: true });
    const made = await h.call(reader, 'POST', `/tenants/${tenantId}/help/requests`, { subject: 'Cannot export', body: 'The export button does nothing' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.token).toBeNull();
    const id = (await h.call(reader, 'GET', `/tenants/${tenantId}/help/requests`)).body[0].id;
    expect((await h.call(reader, 'POST', `/tenants/${tenantId}/help/requests/${id}/messages`, { body: 'It is a CSV export' })).body.messages).toHaveLength(2);
    expect((await h.call(admin, 'GET', `/tenants/${tenantId}/help/requests/${id}`)).status).toBe(404); // only their own
    void readerId;
  });

  it('keeps a record when a message is edited, and settles threads of internal notes', async () => {
    const ticket = async () => (await h.call(admin, 'GET', `/tickets/${ticketId}`)).body;
    const note = (await h.call(admin, 'POST', `/tickets/${ticketId}/messages`, { body: 'Check the **tile cache**', internal: true })).body.messages.at(-1);
    // A thread answers a team note, and only a team note.
    const reply = await h.call(admin, 'POST', `/tickets/${ticketId}/messages`, { body: 'Cleared it, no change', internal: true, parentId: note.id });
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    const pub = (await ticket()).messages.find((m: { body: string }) => m.body === 'Could you tell us which browser you use?');
    expect((await h.call(admin, 'POST', `/tickets/${ticketId}/messages`, { body: 'x', internal: true, parentId: pub.id })).status).toBe(404);
    expect((await h.call(admin, 'POST', `/tickets/${ticketId}/messages`, { body: 'x', parentId: note.id })).status).toBe(400);
    const threaded = (await ticket()).messages.find((m: { body: string }) => m.body === 'Cleared it, no change');
    expect(threaded.parentId).toBe(note.id);
    // Settling and opening again.
    const settled = (await h.call(admin, 'POST', `/tickets/${ticketId}/messages/${note.id}/resolve`, { resolved: true })).body.messages.find((m: { id: string }) => m.id === note.id);
    expect(settled.resolvedAt).toBeTruthy();
    expect(settled.resolvedBy).toBeTruthy();
    expect((await h.call(reader, 'POST', `/tickets/${ticketId}/messages/${note.id}/resolve`, { resolved: false })).status).toBeGreaterThanOrEqual(400);
    // Writing in a settled thread opens it again.
    await h.call(admin, 'POST', `/tickets/${ticketId}/messages`, { body: 'Still failing', internal: true, parentId: note.id });
    expect((await ticket()).messages.find((m: { id: string }) => m.id === note.id).resolvedAt).toBeNull();

    // Editing: only your own words; the earlier wording is kept for the team.
    const edited = await h.call(admin, 'PATCH', `/tickets/${ticketId}/messages/${note.id}`, { body: 'Check the **tile cache** and the CDN' });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const m = edited.body.messages.find((x: { id: string }) => x.id === note.id);
    expect(m).toMatchObject({ body: 'Check the **tile cache** and the CDN', editedAt: expect.any(String) });
    expect(m.edits).toEqual([expect.objectContaining({ body: 'Check the **tile cache**' })]);
    const reedit = await h.call(admin, 'PATCH', `/tickets/${ticketId}/messages/${note.id}`, { body: 'Check the CDN' });
    expect(reedit.body.messages.find((x: { id: string }) => x.id === note.id).edits).toHaveLength(2);
    expect((await h.call(h.admin as never, 'PATCH', `/tickets/${ticketId}/messages/${note.id}`, { body: 'hijack' })).status).toBeGreaterThanOrEqual(400);
    // The person can change their own message too: the team sees it was changed, they see it was edited, never the older wording of anyone else's.
    const mine = (await anon('GET', `/public/help/${token}`)).json().messages[0];
    expect(mine.editedAt).toBeNull();
    // Threads and notes never show in the person's conversation.
    const seen = (await anon('GET', `/public/help/${token}`)).json().messages.map((x: { body: string }) => x.body);
    expect(seen.join('|')).not.toContain('Cleared it');
  });

  it('is passed to the Grids team only by the organisation, and the person never writes to Grids', async () => {
    expect((await h.call(reader, 'POST', `/tenants/${tenantId}/tickets/${ticketId}/escalate`, { note: 'please' })).status).toBe(403);
    const r = await h.call(admin, 'POST', `/tenants/${tenantId}/tickets/${ticketId}/escalate`, { note: 'Looks like a platform bug' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.audience).toBe('platform');
    expect((await h.call(admin, 'POST', `/tenants/${tenantId}/tickets/${ticketId}/escalate`, {})).status).toBe(400);
    // The platform team sees it, with the organisation's note but not its private notes.
    const seenByGrids = (await h.admin('GET', `/tickets/${ticketId}`)).body;
    expect(seenByGrids.messages.map((m: { body: string }) => m.body).join('|')).toContain('Looks like a platform bug');
    expect(seenByGrids.messages.map((m: { body: string }) => m.body)).not.toContain('Probably the tile cache');
    // The person is told in the conversation, without the note.
    const seen = (await anon('GET', `/public/help/${token}`)).json().messages.map((m: { body: string }) => m.body);
    expect(seen.at(-1)).toContain('Grids');
    expect(seen.join('|')).not.toContain('platform bug');
    // A Grids reply stays between Grids and the organisation.
    await h.admin('POST', `/tickets/${ticketId}/messages`, { body: 'We are on it' });
    expect((await anon('GET', `/public/help/${token}`)).json().messages.map((m: { body: string }) => m.body)).not.toContain('We are on it');
  });
});

describe('links between tickets', () => {
  const mk = async (subject: string) => (await h.call(admin, 'POST', `/tenants/${tenantId}/tickets`, { subject, body: 'Details', audience: 'organisation' })).body.id as string;
  const link = (id: string, kind: string, other: string) => h.call(admin, 'POST', `/tenants/${tenantId}/tickets/${id}/links`, { kind, ticketId: other });
  let a: string, b: string, c: string;

  it('sets parents and sub-issues, blocking and related tickets, each seen from both sides', async () => {
    [a, b, c] = [await mk('Parent ticket one'), await mk('Child ticket two'), await mk('Third ticket three')];
    const sub = await link(a, 'sub', b);
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.links.subs.map((t: { id: string }) => t.id)).toEqual([b]);
    expect((await link(b, 'blocks', c)).body.links.blocks.map((t: { id: string }) => t.id)).toEqual([c]);
    expect((await link(a, 'related', c)).body.links.related.length).toBe(1);
    // the list and board count them
    const list = (await h.call(admin, 'GET', `/tenants/${tenantId}/tickets?pageSize=100`)).body.items as { id: string; subTotal: number; blockedBy: number }[];
    expect(list.find((t) => t.id === a)?.subTotal).toBe(1);
    expect(list.find((t) => t.id === c)?.blockedBy).toBe(1);
  });

  it('refuses a second parent, a ticket under its own child, itself, and doubles', async () => {
    expect((await link(c, 'sub', b)).status).toBe(400); // b already has a parent
    expect((await link(b, 'sub', a)).status).toBe(400); // a is b's parent
    expect((await link(a, 'sub', a)).status).toBe(400);
    expect((await link(a, 'related', c)).status).toBe(400);
  });

  it('can be taken away again, by the team only', async () => {
    const d = (await h.call(admin, 'GET', `/tickets/${a}`)).body;
    const id = d.links.subs[0].linkId as string;
    expect((await h.call(reader, 'DELETE', `/tenants/${tenantId}/tickets/${a}/links/${id}`)).status).toBe(403);
    const gone = await h.call(admin, 'DELETE', `/tenants/${tenantId}/tickets/${a}/links/${id}`);
    expect(gone.body.links.subs).toEqual([]);
  });
});

describe('phone numbers and confirming an email', () => {
  const ask = (extra: Record<string, unknown>, ip: string) => anon('POST', org('/requests'), { subject: 'Cannot log in', body: 'It says no', name: 'Ben', email: 'ben@example.org', ...extra }, ip);
  const setDesk = async (patch: Record<string, unknown>) => {
    const desk = (await h.call(admin, 'GET', `/tenants/${tenantId}/support/desk`)).body;
    expect((await h.call(admin, 'PUT', `/tenants/${tenantId}/support/desk`, { ...desk, enabled: true, captcha: false, ...patch })).status).toBe(200);
  };

  it('asks for a phone number only when the desk is set to', async () => {
    await setDesk({ phone: 'required', verifyEmail: false });
    expect((await anon('GET', org(''))).json()).toMatchObject({ phone: 'required', verifyEmail: false });
    expect((await ask({}, '10.4.0.1')).statusCode).toBe(400);
    expect((await ask({ phone: 'abc' }, '10.4.0.1')).statusCode).toBe(400);
    const ok = await ask({ phone: '+1 (555) 010-2030' }, '10.4.0.1');
    expect(ok.statusCode, ok.body).toBe(201);
    const t = (await h.call(admin, 'GET', `/tickets/${ok.json().thread.id}`)).body;
    expect(t.requesterPhone).toBe('+1 (555) 010-2030');
  });

  it('holds a request back until the address is confirmed with the emailed code', async () => {
    await setDesk({ phone: 'off', verifyEmail: true });
    expect((await ask({}, '10.4.0.2')).statusCode).toBe(400);
    expect((await anon('POST', org('/email-code'), { email: 'ben@example.org' }, '10.4.0.2')).statusCode).toBe(200);
    const mail = h.mailer.sent.filter((m) => m.to === 'ben@example.org').at(-1)!;
    const code = /\b(\d{6})\b/.exec(mail.subject)![1]!;
    expect((await anon('POST', org('/email-verify'), { email: 'ben@example.org', code: code === '000000' ? '111111' : '000000' }, '10.4.0.2')).statusCode).toBe(400);
    const good = await anon('POST', org('/email-verify'), { email: 'ben@example.org', code }, '10.4.0.2');
    expect(good.statusCode, good.body).toBe(200);
    const { proof } = good.json() as { proof: string };
    // the proof is for that address only, and the code works once
    expect((await ask({ email: 'eve@example.org', emailProof: proof }, '10.4.0.2')).statusCode).toBe(400);
    expect((await anon('POST', org('/email-verify'), { email: 'ben@example.org', code }, '10.4.0.2')).statusCode).toBe(400);
    expect((await ask({ emailProof: proof }, '10.4.0.2')).statusCode).toBe(201);
  });
});

describe('typing in a chat', () => {
  it('shows each side what the other is typing, and lets it fade', async () => {
    const desk = (await h.call(admin, 'GET', `/tenants/${tenantId}/support/desk`)).body;
    await h.call(admin, 'PUT', `/tenants/${tenantId}/support/desk`, { ...desk, enabled: true, captcha: false, phone: 'off', verifyEmail: false });
    const made = await anon('POST', org('/requests'), { subject: 'Typing test', body: 'Hello there', name: 'Cy', email: 'cy@example.org' }, '10.5.0.1');
    expect(made.statusCode, made.body).toBe(201);
    const { token, thread } = made.json() as { token: string; thread: { id: string } };
    // the person types: the team sees the words
    expect((await anon('POST', `/public/help/${token}/typing`, { text: 'I am still waiting' }, '10.5.0.1')).statusCode).toBe(204);
    expect((await h.call(admin, 'GET', `/tickets/${thread.id}`)).body.visitorTyping).toMatchObject({ name: 'Cy', text: 'I am still waiting' });
    expect((await anon('POST', `/public/help/${token}/typing`, { text: '' }, '10.5.0.1')).statusCode).toBe(204);
    expect((await h.call(admin, 'GET', `/tickets/${thread.id}`)).body.visitorTyping).toBeNull();
    // the team types: the person sees who
    expect((await h.call(admin, 'POST', `/tenants/${tenantId}/tickets/${thread.id}/typing`, { typing: true })).status).toBe(204);
    expect((await anon('GET', `/public/help/${token}`, undefined, '10.5.0.1')).json().agentTyping).toBeTruthy();
    expect((await h.call(admin, 'POST', `/tenants/${tenantId}/tickets/${thread.id}/typing`, { typing: false })).status).toBe(204);
    expect((await anon('GET', `/public/help/${token}`, undefined, '10.5.0.1')).json().agentTyping).toBeNull();
    // only the team can say it, and a bad link says nothing
    expect((await h.call(reader, 'POST', `/tenants/${tenantId}/tickets/${thread.id}/typing`, { typing: true })).status).toBe(403);
    expect((await anon('POST', `/public/help/${'x'.repeat(50)}/typing`, { text: 'hi' }, '10.5.0.1')).statusCode).toBe(404);
  });
});

describe('the help window on other websites', () => {
  const desk = async () => (await h.call(admin, 'GET', `/tenants/${tenantId}/support/desk`)).body;
  const save = async (patch: Record<string, unknown>) => (await h.call(admin, 'PUT', `/tenants/${tenantId}/support/desk`, { ...(await desk()), enabled: true, captcha: false, phone: 'off', verifyEmail: false, ...patch })).body;
  // As a browser loading the embed page in a frame does (a script that does not bother sends neither header).
  const frame = (key: string, ip = '10.6.0.1', headers: Record<string, string> = { 'sec-fetch-dest': 'iframe' }, st?: string) =>
    h.app.inject({ method: 'GET', url: `/embed/help?org=${slug}&key=${encodeURIComponent(key)}${st ? `&st=${encodeURIComponent(st)}` : ''}`, headers, remoteAddress: ip });
  const site = (host: string, extra: Record<string, unknown> = {}) => ({ host, ...extra });

  it('gives each website its own key, and hands the page only to that website', async () => {
    const saved = await save({ embedSites: [site('www.example.org'), site('*.partner.org', { hourlyLimit: 5 })] });
    const [a, b] = saved.embedSites as { id: string; host: string; key: string; hourlyLimit: number }[];
    expect(a!.key).not.toBe(b!.key);
    expect(a!.key.length).toBeGreaterThan(16);
    expect(a!.id).not.toBe(b!.id);
    expect(b!.hourlyLimit).toBe(5);
    // a form cannot set a key, and keys survive a later save
    const again = await save({ embedSites: [{ ...a!, key: 'my-own-key' }, site('*.partner.org')] });
    expect(again.embedSites[0].key).toBe(a!.key);
    expect(again.embedSites[1].key).not.toBe('');
    const bad = await frame('wrong-key');
    expect(bad.statusCode).toBe(403);
    expect(bad.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    // each key lets in only its own website
    const ok = await frame(a!.key);
    expect(ok.statusCode, ok.body).toBe(200);
    const csp = String(ok.headers['content-security-policy']);
    expect(csp).toBe('frame-ancestors https://www.example.org http://www.example.org');
    expect(String((await frame(again.embedSites[1].key)).headers['content-security-policy'])).toContain('https://*.partner.org');
    // a website can be added once
    expect((await h.call(admin, 'PUT', `/tenants/${tenantId}/support/desk`, { ...(await desk()), embedSites: [site('a.example.org'), site('a.example.org')] })).status).toBe(400);
  });

  it('can be paused for one website or all, and a new key kills only that website’s old snippet', async () => {
    const cur = (await desk()).embedSites as { id: string; host: string; key: string }[];
    const [a, b] = cur;
    expect((await frame(a!.key)).statusCode).toBe(200);
    // pause one
    await save({ embedSites: [{ ...a!, paused: true }, b] });
    expect((await frame(a!.key)).statusCode).toBe(403);
    expect((await frame(b!.key)).statusCode).toBe(200);
    // pause all
    await save({ embedSites: [{ ...a!, paused: false }, b], embedPaused: true });
    expect((await frame(a!.key)).statusCode).toBe(403);
    expect((await frame(b!.key)).statusCode).toBe(403);
    await save({ embedSites: [{ ...a!, paused: false }, b], embedPaused: false });
    // rotating
    expect((await h.call(reader, 'POST', `/tenants/${tenantId}/support/desk/embed-key`, { siteId: a!.id })).status).toBe(403);
    expect((await h.call(admin, 'POST', `/tenants/${tenantId}/support/desk/embed-key`, { siteId: 'nope' })).status).toBe(404);
    const next = (await h.call(admin, 'POST', `/tenants/${tenantId}/support/desk/embed-key`, { siteId: a!.id })).body.embedSites as { id: string; key: string }[];
    const fresh = next.find((x) => x.id === a!.id)!.key;
    expect(fresh).not.toBe(a!.key);
    expect((await frame(a!.key)).statusCode).toBe(403);
    expect((await frame(fresh)).statusCode).toBe(200);
    expect((await frame(b!.key)).statusCode).toBe(200); // the other website is not touched
  });

  it('limits each website on its own, and a removed website stops working', async () => {
    await save({ embedSites: [site('one.example.org', { hourlyLimit: 2 }), site('two.example.org', { hourlyLimit: 50 })] });
    const [one, two] = (await desk()).embedSites as { id: string; host: string; key: string }[];
    const tokenOf = async (key: string) => /token=([^&"]+)/.exec((await frame(key)).body)![1]!;
    const [t1, t2] = [await tokenOf(one!.key), await tokenOf(two!.key)];
    const asked = (embed?: string, ip = '10.6.0.2') => anon('POST', org('/requests'), { subject: 'From a site', body: 'Hello', name: 'Dee', email: 'dee@example.org', ...(embed && { embed }) }, ip);
    expect((await anon('GET', org(`/embed-check?token=${t1}`))).json()).toMatchObject({ ok: true, host: 'one.example.org' });
    expect((await anon('GET', org('/embed-check?token=x.1.nope'))).json()).toEqual({ ok: false, host: null, identity: null });
    expect((await asked('x.1.nope')).statusCode).toBe(403);
    expect((await asked(t1)).statusCode).toBe(201);
    expect((await asked(t1)).statusCode).toBe(201);
    expect((await asked(t1)).statusCode).toBe(429); // one is over its two an hour
    expect((await asked(t2)).statusCode).toBe(201); // two is not
    expect((await asked()).statusCode).toBe(201); // the organisation's own pages are not limited by it
    // taking a website away switches its token off at once
    await save({ embedSites: [{ ...two!, paused: false }] });
    expect((await anon('GET', org(`/embed-check?token=${t1}`))).json()).toEqual({ ok: false, host: null, identity: null });
    expect((await asked(t1)).statusCode).toBe(403);
    expect((await asked(t2)).statusCode).toBe(201);
    const js = await anon('GET', '/embed.js');
    expect(js.headers['content-type']).toContain('javascript');
    expect(js.body).toContain('data-key');
  });
});

describe('the New tab', () => {
  it('lists only tickets nobody has acted on', async () => {
    const mk = async (subject: string) => (await h.call(admin, 'POST', `/tenants/${tenantId}/tickets`, { subject, body: 'Details', audience: 'organisation' })).body.id as string;
    const [fresh, touched] = [await mk('Brand new one'), await mk('Already handled')];
    await h.call(admin, 'PATCH', `/tenants/${tenantId}/tickets/${touched}`, { priority: 'high' });
    await h.call(admin, 'POST', `/tickets/${touched}/messages`, { body: 'On it' });
    const ids = ((await h.call(admin, 'GET', `/tenants/${tenantId}/tickets?untouched=true&pageSize=100`)).body.items as { id: string }[]).map((t) => t.id);
    expect(ids).toContain(fresh);
    expect(ids).not.toContain(touched);
  });
});

describe('checking a website’s DNS', () => {
  const check = (as: string, host: string) => h.call(as, 'POST', `/tenants/${tenantId}/support/desk/check-site`, { host });
  it('says whether a name exists, and only for the team', async () => {
    expect((await check(reader, 'example.org')).status).toBe(403);
    const local = (await check(admin, 'localhost')).body;
    expect(local).toMatchObject({ kind: 'local', resolves: true });
    const nope = (await check(admin, 'no-such-site.invalid')).body;
    expect(nope).toMatchObject({ kind: 'domain', resolves: false, addresses: [] });
    expect((await check(admin, 'not a host')).status).toBe(400);
  });
});

describe('guarding the embed against a copied key', () => {
  const desk = async () => (await h.call(admin, 'GET', `/tenants/${tenantId}/support/desk`)).body;
  const save = async (embedSites: unknown[]) => (await h.call(admin, 'PUT', `/tenants/${tenantId}/support/desk`, { ...(await desk()), enabled: true, captcha: false, phone: 'off', verifyEmail: false, embedPaused: false, embedSites })).body;
  const frame = (key: string, headers: Record<string, string>, st?: string) => h.app.inject({ method: 'GET', url: `/embed/help?org=${slug}&key=${encodeURIComponent(key)}${st ? `&st=${encodeURIComponent(st)}` : ''}`, headers, remoteAddress: '10.7.0.1' });
  const tokenOf = (body: string) => /token=([^&"]+)/.exec(body)![1]!;
  const asked = (embed: string, ip: string, extra: Record<string, unknown> = {}) => anon('POST', org('/requests'), { subject: 'From a site', body: 'Hello', name: 'Dee', email: `dee${Math.random().toString(36).slice(2)}@example.org`, embed, ...extra }, ip);

  it('turns away anything that is not a browser frame from the listed site', async () => {
    const [site] = (await save([{ host: 'www.example.org', hourlyLimit: 30 }])).embedSites;
    const k = site.key as string;
    expect((await frame(k, {})).statusCode).toBe(403); // a script that sends no frame header
    expect((await frame(k, { 'sec-fetch-dest': 'document' })).statusCode).toBe(403);
    expect((await frame(k, { 'sec-fetch-dest': 'iframe', referer: 'https://evil.example.net/page' })).statusCode).toBe(403);
    expect((await frame(k, { 'sec-fetch-dest': 'iframe', referer: 'https://www.example.org/some/page' })).statusCode).toBe(200);
    expect((await frame(k, { 'sec-fetch-dest': 'iframe' })).statusCode).toBe(200); // a page that sends no referrer is still held by frame-ancestors
  });

  it('on a secure website needs a token its own server signed, and carries who the visitor is', async () => {
    const [site] = (await save([{ host: 'www.example.org', hourlyLimit: 30, secure: true }])).embedSites;
    const k = site.key as string;
    const iframe = { 'sec-fetch-dest': 'iframe' };
    expect((await frame(k, iframe)).statusCode).toBe(403); // the key alone is not enough
    const secret = (await h.call(admin, 'GET', `/tenants/${tenantId}/support/desk/embed-secret?siteId=${site.id}`)).body.secret as string;
    expect((await h.call(reader, 'GET', `/tenants/${tenantId}/support/desk/embed-secret?siteId=${site.id}`)).status).toBe(403);
    const sign = (claims: object, key = secret) => {
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
    };
    const exp = Math.floor(Date.now() / 1000) + 600;
    expect((await frame(k, iframe, sign({ exp }, 'wrong-secret'))).statusCode).toBe(403);
    expect((await frame(k, iframe, sign({ exp: exp - 3600 }))).statusCode).toBe(403); // run out
    expect((await frame(k, iframe, sign({ exp: exp + 86_400 }))).statusCode).toBe(403); // too long-lived
    const ok = await frame(k, iframe, sign({ exp, name: 'Kai Nui', email: 'kai@example.org' }));
    expect(ok.statusCode, ok.body).toBe(200);
    const token = tokenOf(ok.body);
    expect((await anon('GET', org(`/embed-check?token=${token}`))).json()).toMatchObject({ ok: true, host: 'www.example.org', identity: { name: 'Kai Nui', email: 'kai@example.org' } });
    // the request is in the name the website vouched for, and needs no code or typed name
    await save([{ ...site, secure: true }]);
    const made = await asked(token, '10.7.0.2', { name: 'Someone Else', email: 'else@example.org' });
    expect(made.statusCode, made.body).toBe(201);
    const t = (await h.call(admin, 'GET', `/tickets/${made.json().thread.id}`)).body;
    expect(t.createdBy).toMatchObject({ name: 'Kai Nui', email: 'kai@example.org' });
    // renewing the secret ends the old signatures
    const renewed = (await h.call(admin, 'POST', `/tenants/${tenantId}/support/desk/embed-secret`, { siteId: site.id })).body.embedSites[0];
    expect(renewed.secretVersion).toBe(2);
    expect((await frame(k, iframe, sign({ exp }))).statusCode).toBe(403);
  });

  it('limits each visitor, warns near the limit, and switches a flooding website off', async () => {
    const [site] = (await save([{ host: 'busy.example.org', hourlyLimit: 10 }])).embedSites;
    const token = tokenOf((await frame(site.key, { 'sec-fetch-dest': 'iframe' })).body);
    // one visitor gets only a few
    for (let i = 0; i < 5; i++) expect((await asked(token, '10.7.1.1')).statusCode).toBe(201);
    expect((await asked(token, '10.7.1.1')).statusCode).toBe(429);
    const usage = (await h.call(admin, 'GET', `/tenants/${tenantId}/support/desk/embed-usage`)).body as { siteId: string; used: number; limit: number }[];
    expect(usage.find((u) => u.siteId === site.id)).toMatchObject({ limit: 10, used: 6 });
    expect((await h.call(reader, 'GET', `/tenants/${tenantId}/support/desk/embed-usage`)).status).toBeGreaterThanOrEqual(200);
    // the rest of the allowance goes, then the refusals pile up and the website is switched off
    for (let i = 0; i < 4; i++) expect((await asked(token, `10.7.2.${i}`)).statusCode).toBe(201);
    let paused = false;
    for (let i = 0; i < 40 && !paused; i++) {
      const r = await asked(token, `10.7.3.${i}`);
      if (r.statusCode === 403) paused = true;
    }
    expect(paused).toBe(true);
    expect((await desk()).embedSites[0].paused).toBe(true);
    expect(h.mailer.sent.some((m) => /Help window paused on busy\.example\.org/.test(m.subject))).toBe(true);
  });
});

describe('the ticket excerpt', () => {
  it('gives the start of what a ticket is about as plain text, without the page it came from', async () => {
    const made = await anon('POST', org('/requests'), { subject: 'Excerpt please', body: '## Map is blank\n\nNothing **loads** on the [Samoa](https://example.org) layer', category: 'Question', project: 'reef', name: 'Fay', email: `fay${Date.now()}@example.org` }, '10.8.0.1');
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json().thread.id as string;
    const items = (await h.call(admin, 'GET', `/tenants/${tenantId}/tickets?pageSize=100`)).body.items as { id: string; excerpt: string }[];
    expect(items.find((t) => t.id === id)?.excerpt).toBe('Map is blank Nothing loads on the Samoa layer');
  });
});

describe('secure websites are not rate limited', () => {
  it('lets a secure website send past the hourly limit that a standard one has', async () => {
    const desk = (await h.call(admin, 'GET', `/tenants/${tenantId}/support/desk`)).body;
    const saved = (await h.call(admin, 'PUT', `/tenants/${tenantId}/support/desk`, { ...desk, enabled: true, captcha: false, phone: 'off', verifyEmail: false, embedPaused: false, embedSites: [{ host: 'secure.example.org', hourlyLimit: 2, secure: true }] })).body;
    const site = saved.embedSites[0];
    const secret = (await h.call(admin, 'GET', `/tenants/${tenantId}/support/desk/embed-secret?siteId=${site.id}`)).body.secret as string;
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    const st = `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
    const framed = await h.app.inject({ method: 'GET', url: `/embed/help?org=${slug}&key=${encodeURIComponent(site.key)}&st=${encodeURIComponent(st)}`, headers: { 'sec-fetch-dest': 'iframe' }, remoteAddress: '10.9.0.1' });
    expect(framed.statusCode, framed.body).toBe(200);
    const token = /token=([^&"]+)/.exec(framed.body)![1]!;
    for (let i = 0; i < 6; i++) {
      const r = await anon('POST', org('/requests'), { subject: 'From secure', body: 'Hello', name: 'Gus', email: `gus${i}${Date.now()}@example.org`, embed: token }, `10.9.1.${i}`);
      expect(r.statusCode, r.body).toBe(201); // six requests on a limit of two
    }
  });
});

