import type { Kysely } from 'kysely';
import nodemailer, { type Transporter } from 'nodemailer';
import type { PlatformDB } from '@grids/db';
import { uuidv7, type EmailSettings } from '@grids/schema';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  /** The formatted message (the body of the email); when absent one is made from `text`. */
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType: string; cid?: string }[];
  /** Where replies go. */
  replyTo?: string;
  /** The name shown as the sender. */
  fromName?: string;
  /** The finished page (header, body and footer in an organisation's look); used as it is. */
  framed?: string;
}

/** How an organisation's emails look: its name, colour and logo, and the design it chose. */
export interface EmailBrand {
  name: string;
  /** The workspace's colour: the accent unless the email design names one. */
  color: string;
  logo: string | null;
  settings: EmailSettings;
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
    const { framed: _framed, fromName, ...rest } = mail;
    const address = /<([^>]+)>/.exec(this.from)?.[1] ?? this.from;
    const info = await this.transport.sendMail({ from: fromName ? { name: fromName, address } : this.from, ...rest, html: toHtml(mail) });
    return { messageId: info.messageId };
  }
}

/**
 * No external delivery: messages are only recorded in the platform email log and
 * read in the console (Email log). The default for development and demos.
 */
export class LogOnlyMailer implements Mailer {
  async send() {
    return { messageId: `local-${uuidv7()}` };
  }
}

/** `SMTP_URL=log` (or empty) keeps mail inside the platform; anything else is an SMTP URL. */
export const mailerFor = (url: string | undefined, from: string): Mailer =>
  !url || url === 'log' ? new LogOnlyMailer() : new SmtpMailer(url, from);

/** Sends transactional email and records every attempt in the email log. */
export class EmailService {
  constructor(
    private readonly db: Kysely<PlatformDB>,
    private readonly mailer: Mailer,
  ) {}

  private brandOf: ((tenantId: string) => Promise<EmailBrand | null>) | null = null;
  /** Lets messages for an organisation carry its header, footer and reply address. */
  useBranding(fn: (tenantId: string) => Promise<EmailBrand | null>) {
    this.brandOf = fn;
  }

  /** Recent messages to one address (development mailbox; never exposed in production). */
  async recent(to: string, since: Date, limit = 20) {
    return this.db
      .selectFrom('email_log')
      .select(['id', 'template', 'to_address', 'subject', 'body_text', 'status', 'created_at'])
      .where('to_address', '=', to)
      .where('created_at', '>=', since)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  }

  /** Never throws: delivery failures are logged and reported as `false`. */
  /** `brand`: send in this look instead of the one the organisation has saved (a test of a design not yet saved). */
  async send(template: string, tenantId: string | null, mail: OutgoingEmail, brand?: EmailBrand): Promise<boolean> {
    let status: 'sent' | 'failed' = 'sent';
    let error: string | null = null;
    let messageId: string | null = null;
    try {
      if (tenantId && (brand || this.brandOf)) {
        const look = brand ?? (await this.brandOf!(tenantId).catch(() => null));
        if (look) mail = brandedMail(mail, look, { template });
      }
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

const bodyOf = (mail: OutgoingEmail) =>
  mail.html ??
  escape(mail.text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#111">$1</a>')
    .replace(/\n/g, '<br>');

const HEX = /^#[0-9a-f]{6}$/i;
const LOGO = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const FONTS = {
  sans: "Inter,Arial,Helvetica,sans-serif",
  system: "-apple-system,'Segoe UI',Roboto,Arial,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
} as const;

/** Black or white, whichever reads on this colour. */
const onColour = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#18181b' : '#ffffff';
};

/** Plain words from a settings page as HTML: paragraphs, line breaks, and web addresses as links. */
const paragraphs = (text: string, link: string, style: string) =>
  text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p style="${style}">${escape(p.trim()).replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${link}">$1</a>`).replace(/\n/g, '<br>')}</p>`)
    .join('');

/**
 * The message in an organisation's design: a header (logo, colour bar or none), the message on a card, its own
 * words before and after, a sign-off, and a footer with links. Built from tables with inline styles, which is
 * what mail programs understand. `inlineLogo` puts the logo into the page itself (for a preview) instead of
 * sending it as an attachment.
 */
export function brandedMail(mail: OutgoingEmail, b: EmailBrand, opts: { template?: string; inlineLogo?: boolean } = {}): OutgoingEmail {
  const st = b.settings;
  const accent = st.accentColor && HEX.test(st.accentColor) ? st.accentColor : HEX.test(b.color) ? b.color : '#0f62fe';
  const page = HEX.test(st.pageColor) ? st.pageColor : '#f4f4f5';
  const ink = HEX.test(st.textColor) ? st.textColor : '#18181b';
  const font = FONTS[st.font] ?? FONTS.sans;
  const radius = st.corners === 'soft' ? 10 : 0;
  const msg = (opts.template && st.messages[opts.template]) || { subjectPrefix: '', intro: '', outro: '' };
  const name = st.fromName || b.name;

  const attachments = [...(mail.attachments ?? [])];
  const logo = b.logo ? LOGO.exec(b.logo) : null;
  let logoSrc: string | null = null;
  if (logo && opts.inlineLogo) logoSrc = b.logo;
  else if (logo) {
    attachments.push({ filename: `logo.${logo[1] === 'jpeg' ? 'jpg' : logo[1]}`, content: Buffer.from(logo[2]!, 'base64'), contentType: `image/${logo[1]}`, cid: 'brand-logo' });
    logoSrc = 'cid:brand-logo';
  } else if (b.logo && /^https:\/\//.test(b.logo)) logoSrc = b.logo;
  const align = st.headerAlign;

  let head = '';
  if (st.header === 'colour')
    head = `<tr><td align="${align}" style="background:${accent};color:${onColour(accent)};padding:16px 24px;font-size:17px;font-weight:700;border-radius:${radius}px ${radius}px 0 0">${escape(b.name)}</td></tr>`;
  else if (st.header === 'logo')
    head = `<tr><td align="${align}" style="padding:4px 0 16px">${
      logoSrc ? `<img src="${escape(logoSrc)}" alt="${escape(b.name)}" height="40" style="height:40px;max-width:220px;display:inline-block;border:0">` : `<span style="font-size:18px;font-weight:700;color:${ink}">${escape(b.name)}</span>`
    }<div style="height:3px;background:${accent};margin-top:14px"></div></td></tr>`;

  const para = `margin:0 0 14px;`;
  const body = bodyOf(mail).replace(/<a (?![^>]*style=)/g, `<a style="color:${accent}" `);
  const inner = [
    msg.intro ? paragraphs(msg.intro, accent, para) : '',
    `<div>${body}</div>`,
    msg.outro ? `<div style="margin-top:14px">${paragraphs(msg.outro, accent, para)}</div>` : '',
    st.signature ? `<div style="margin-top:18px;color:${ink}">${paragraphs(st.signature, accent, 'margin:0 0 4px;')}</div>` : '',
  ].join('');
  const cardStyle = st.card
    ? `background:#ffffff;padding:28px;${st.header === 'colour' ? '' : `border-radius:${radius}px;`}${st.header === 'colour' ? `border-radius:0 0 ${radius}px ${radius}px;` : ''}border:1px solid #e4e4e7;`
    : 'padding:4px 0;';
  const links = st.links.map((l) => `<a href="${escape(l.url)}" style="color:#71717a;text-decoration:underline">${escape(l.label)}</a>`).join(' &nbsp;·&nbsp; ');
  const foot = st.footer || links
    ? `<tr><td align="${align}" style="padding:18px 4px 0;font-size:12px;line-height:1.6;color:#71717a">${st.footer ? `<div>${escape(st.footer).replace(/\n/g, '<br>')}</div>` : ''}${links ? `<div style="margin-top:6px">${links}</div>` : ''}</td></tr>`
    : '';
  const framed =
    `<div style="background:${page};padding:24px 12px;font-family:${font};font-size:15px;line-height:1.65;color:${ink}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td align="center">` +
    `<table role="presentation" width="${st.width}" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:${st.width}px;text-align:left">` +
    `${head}<tr><td style="${cardStyle}">${inner}</td></tr>${foot}</table></td></tr></table></div>`;

  const textTail = [st.signature, st.footer, ...st.links.map((l) => `${l.label}: ${l.url}`)].filter(Boolean).join('\n');
  const text = [msg.intro, mail.text, msg.outro].filter(Boolean).join('\n\n') + (textTail ? `\n\n--\n${textTail}` : '');
  return {
    ...mail,
    subject: msg.subjectPrefix ? `${msg.subjectPrefix} ${mail.subject}` : mail.subject,
    text,
    framed,
    fromName: name,
    attachments: attachments.length ? attachments : undefined,
    replyTo: mail.replyTo ?? (st.replyTo || undefined),
  };
}

/** Minimal branded HTML alternative; URLs become links. A formatted message (already safe HTML) is used as it is. */
function toHtml(mail: OutgoingEmail): string {
  if (mail.framed) return mail.framed;
  const body = bodyOf(mail);
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#18181b;max-width:560px">
<div style="border-bottom:2px solid #18181b;padding-bottom:8px;margin-bottom:16px;font-weight:700;letter-spacing:.08em">GRIDS</div>
${body}</div>`;
}
