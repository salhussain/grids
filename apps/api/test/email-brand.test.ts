import { EmailSettings } from '@grids/schema';
import { describe, expect, it } from 'vitest';
import { brandedMail } from '../src/services/email.js';

const base = { to: 'a@b.org', subject: 's', text: 'Hello <b>there</b>' };
const design = (over: object = {}) => EmailSettings.parse({ header: 'colour', footer: 'Acme, 1 Main St', replyTo: 'help@acme.org', ...over });
const brand = (over: object = {}, logo: string | null = null, color = '#198038') => ({ name: 'Acme <Health>', color, logo, settings: design(over) });

describe('branded email', () => {
  it('frames the body with the colour header, footer and reply address, escaping names', () => {
    const m = brandedMail(base, brand());
    expect(m.framed).toContain('background:#198038');
    expect(m.framed).toContain('Acme &lt;Health&gt;');
    expect(m.framed).toContain('Acme, 1 Main St');
    expect(m.framed).toContain('Hello &lt;b&gt;there&lt;/b&gt;');
    expect(m.text).toContain('--\nAcme, 1 Main St');
    expect(m.replyTo).toBe('help@acme.org');
  });

  it('attaches the logo inline and ignores a bad colour', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const m = brandedMail(base, brand({ header: 'logo' }, png, 'red;x'));
    expect(m.framed).toContain('cid:brand-logo');
    expect(m.framed).not.toContain('red;x');
    expect(m.attachments?.[0]?.cid).toBe('brand-logo');
    // A preview carries the picture in the page instead.
    expect(brandedMail(base, brand({ header: 'logo' }, png), { inlineLogo: true }).framed).toContain(png);
  });

  it('applies the design: page, card, accent, font, width, header choice, signature and links', () => {
    const m = brandedMail(base, brand({ header: 'none', pageColor: '#eeeeee', accentColor: '#ff0000', textColor: '#111111', font: 'serif', width: 480, card: false, signature: 'Warm regards,\nThe team', links: [{ label: 'Help', url: 'https://acme.org/help' }] }));
    expect(m.framed).toContain('background:#eeeeee');
    expect(m.framed).toContain('Georgia');
    expect(m.framed).toContain('max-width:480px');
    expect(m.framed).not.toContain('background:#198038'); // no header bar
    expect(m.framed).toContain('Warm regards,');
    expect(m.framed).toContain('href="https://acme.org/help"');
    expect(m.text).toContain('Help: https://acme.org/help');
    expect(m.framed).not.toContain('border:1px solid #e4e4e7'); // not on a card
  });

  it('adds the words and subject mark an organisation chose for one kind of message', () => {
    const b = brand({ messages: { invitation: { subjectPrefix: '[Acme]', intro: 'Hello from <us>', outro: 'See you soon' } } });
    const m = brandedMail({ ...base, subject: 'You are invited' }, b, { template: 'invitation' });
    expect(m.subject).toBe('[Acme] You are invited');
    expect(m.framed).toContain('Hello from &lt;us&gt;');
    expect(m.text.startsWith('Hello from <us>')).toBe(true);
    // Another kind of message is left alone.
    const other = brandedMail({ ...base, subject: 'Receipt' }, b, { template: 'payment_receipt' });
    expect(other.subject).toBe('Receipt');
    expect(other.framed).not.toContain('See you soon');
  });

  it('sends under the organisation\'s sender name, defaulting to its own name', () => {
    expect(brandedMail(base, brand({ fromName: 'Acme Health' })).fromName).toBe('Acme Health');
    expect(brandedMail(base, brand()).fromName).toBe('Acme <Health>');
  });
});
