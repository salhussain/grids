import nodemailer from 'nodemailer';
import { translator } from '@grids/i18n';
import type { AccountRow } from './accounts.js';

export interface Mailer {
  send(account: Pick<AccountRow, 'email' | 'given_name' | 'locale'>, template: 'verify' | 'reset' | 'setup', vars: Record<string, string>): Promise<void>;
}

type Recipient = Pick<AccountRow, 'email' | 'given_name' | 'locale'>;
type Template = 'verify' | 'reset' | 'setup';

/** Renders a localised email in the account's language (English fallback). */
export function render(account: Recipient, template: Template, vars: Record<string, string>) {
  const t = translator(account.locale ?? 'en');
  const all = { email: account.email, ...vars };
  const text = [t('email.greeting', { name: account.given_name ?? account.email }), '', t(`email.${template}.body`, all), '', t('email.signoff')].join('\n');
  return { subject: t(`email.${template}.subject`, all), text };
}

/**
 * Sends through the platform API (the single outbound mail path), so identity
 * emails share its SMTP settings and appear in the console's Email log.
 */
export class PlatformMailer implements Mailer {
  constructor(
    private readonly apiUrl: string,
    private readonly serviceToken: string,
  ) {}
  async send(account: Recipient, template: Template, vars: Record<string, string>) {
    const { subject, text } = render(account, template, vars);
    const res = await fetch(new URL('/internal/mail', this.apiUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${this.serviceToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ template: `identity.${template}`, to: account.email, subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Mail relay failed: ${res.status}`);
  }
}

/** Direct SMTP (when the identity service runs without the platform API). */
export class SmtpMailer implements Mailer {
  private readonly transport;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(account: Recipient, template: Template, vars: Record<string, string>) {
    const { subject, text } = render(account, template, vars);
    await this.transport.sendMail({ from: this.from, to: account.email, subject, text });
  }
}
