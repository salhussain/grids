import nodemailer from 'nodemailer';
import { translator } from '@grids/i18n';
import type { AccountRow } from './accounts.js';

export interface Mailer {
  send(account: Pick<AccountRow, 'email' | 'given_name' | 'locale'>, template: 'verify' | 'reset' | 'setup', vars: Record<string, string>): Promise<void>;
}

/** Localised transactional email in the account's language (English fallback). */
export class SmtpMailer implements Mailer {
  private readonly transport;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(account: Pick<AccountRow, 'email' | 'given_name' | 'locale'>, template: 'verify' | 'reset' | 'setup', vars: Record<string, string>) {
    const t = translator(account.locale ?? 'en');
    const all = { email: account.email, ...vars };
    const text = [t('email.greeting', { name: account.given_name ?? account.email }), '', t(`email.${template}.body`, all), '', t('email.signoff')].join('\n');
    await this.transport.sendMail({ from: this.from, to: account.email, subject: t(`email.${template}.subject`, all), text });
  }
}
