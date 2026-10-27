import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// An organisation's email design: previewed and test-sent as drafted, saved with the theme, and applied to what it sends.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let member: string;

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Mail Org', 'business');
  admin = await h.join(tenantId, 'admin@mail.org', { role: 'org_admin' });
  member = await h.join(tenantId, 'member@mail.org');
}, 120_000);
afterAll(async () => h?.stop());

const design = {
  fromName: 'Mail Org Team',
  replyTo: 'help@mail.org',
  header: 'colour',
  accentColor: '#c2410c',
  pageColor: '#eeeeee',
  signature: 'Warm regards,\nMail Org',
  footer: '1 Harbour Road',
  links: [{ label: 'Help', url: 'https://mail.org/help' }],
  messages: { invitation: { subjectPrefix: '[Mail Org]', intro: 'We are glad to have you.', outro: '' } },
};

describe('email design', () => {
  it('is previewed as drafted, for people who can manage branding only', async () => {
    const r = await h.call(admin, 'POST', `/tenants/${tenantId}/email/preview`, { settings: design });
    expect(r.status).toBe(200);
    expect(r.body.html).toContain('background:#c2410c');
    expect(r.body.html).toContain('background:#eeeeee');
    expect(r.body.html).toContain('1 Harbour Road');
    expect(r.body.text).toContain('Help: https://mail.org/help');
    const inv = await h.call(admin, 'POST', `/tenants/${tenantId}/email/preview`, { settings: design, message: 'invitation' });
    expect(inv.body.subject).toBe('[Mail Org] Invitation to join');
    expect(inv.body.html).toContain('We are glad to have you.');
    expect((await h.call(member, 'POST', `/tenants/${tenantId}/email/preview`, { settings: design })).status).toBe(403);
    expect((await h.call(admin, 'POST', `/tenants/${tenantId}/email/preview`, { settings: { ...design, links: [{ label: 'x', url: 'javascript:alert(1)' }] } })).status).toBe(400);
  });

  it('is test-sent to the person asking, in the design as drafted', async () => {
    const r = await h.call(admin, 'POST', `/tenants/${tenantId}/email/test`, { settings: design });
    expect(r.body).toEqual({ sent: true, to: 'admin@mail.org' });
    const mail = h.mailer.to('admin@mail.org').at(-1)!;
    expect(mail.fromName).toBe('Mail Org Team');
    expect(mail.replyTo).toBe('help@mail.org');
    expect(mail.framed).toContain('background:#c2410c');
  });

  it('is saved with the theme and applied to what the organisation sends', async () => {
    const ws = (await h.call(admin, 'GET', `/tenants/${tenantId}/workspace`)).body;
    expect((await h.call(admin, 'PUT', `/tenants/${tenantId}/theme`, { ...ws.theme, email: design })).status).toBe(200);
    expect((await h.call(admin, 'GET', `/tenants/${tenantId}/workspace`)).body.theme.email).toMatchObject({ fromName: 'Mail Org Team', header: 'colour' });
    await h.services.email.send('invitation', tenantId, { to: 'new@mail.org', subject: 'Join us', text: 'Open the link.' });
    const sent = h.mailer.to('new@mail.org')[0]!;
    expect(sent.subject).toBe('[Mail Org] Join us');
    expect(sent.framed).toContain('We are glad to have you.');
    expect(sent.framed).toContain('Warm regards,');
    expect(sent.fromName).toBe('Mail Org Team');
    // Another kind of message keeps its own subject.
    await h.services.email.send('payment_receipt', tenantId, { to: 'new@mail.org', subject: 'Receipt', text: 'Paid.' });
    expect(h.mailer.to('new@mail.org')[1]!.subject).toBe('Receipt');
  });
});
