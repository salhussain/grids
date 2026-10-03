import type { Kysely } from 'kysely';
import nodemailer, { type Transporter } from 'nodemailer';
import type { PlatformDB } from '@grids/db';
import { uuidv7 } from '@grids/schema';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

/** Transport seam: SMTP in dev/prod, an in-memory fake in tests. */
export interface Mailer {
  send(mail: OutgoingEmail): Promise<{ messageId: string }>;
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(mail: OutgoingEmail) {
    const info = await this.transport.sendMail({ from: this.from, ...mail, html: toHtml(mail) });
    return { messageId: info.messageId };
  }
}

/** Sends transactional email and records every attempt in the email log. */
export class EmailService {
  constructor(
    private readonly db: Kysely<PlatformDB>,
    private readonly mailer: Mailer,
  ) {}

  /** Never throws: delivery failures are logged and reported as `false`. */
  async send(template: string, tenantId: string | null, mail: OutgoingEmail): Promise<boolean> {
    let status: 'sent' | 'failed' = 'sent';
    let error: string | null = null;
    let messageId: string | null = null;
    try {
      messageId = (await this.mailer.send(mail)).messageId;
    } catch (e) {
      status = 'failed';
      error = e instanceof Error ? e.message : String(e);
    }
    await this.db
      .insertInto('email_log')
      .values({
        id: uuidv7(),
        tenant_id: tenantId,
        template,
        to_address: mail.to,
        subject: mail.subject,
        body_text: mail.text,
        status,
        error,
        provider_message_id: messageId,
      })
      .execute();
    return status === 'sent';
  }
}

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Minimal branded HTML alternative; URLs become links. */
function toHtml(mail: OutgoingEmail): string {
  const body = escape(mail.text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#111">$1</a>')
    .replace(/\n/g, '<br>');
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#18181b;max-width:560px">
<div style="border-bottom:2px solid #18181b;padding-bottom:8px;margin-bottom:16px;font-weight:700;letter-spacing:.08em">GRIDS</div>
${body}</div>`;
}
