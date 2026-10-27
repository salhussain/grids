/**
 * Turns on the organisation's help desk and adds a handful of tickets to review the inbox with: visitors asking from
 * the public pages, a signed-in member, tickets at different stages with assignees, labels and internal notes, one
 * resolved and one passed on to the Grids team.
 *
 *   pnpm --filter @grids/api build && node --env-file=../../.env dist/scripts/seed-help-desk.js
 *
 * Safe to run again: the settings are updated, and the example tickets are only added once.
 */
import { createDb, TenantRouter, type CellDB, type PlatformDB } from '@grids/db';
import { HelpDeskConfig } from '@grids/schema';
import { loadConfig } from '../config.js';
import { GridsIdpClient } from '../idp/grids.js';
import { cellResolver } from '../services/cells.js';
import type { Actor } from '../services/context.js';
import { EmailService, mailerFor } from '../services/email.js';
import { createServices } from '../services/index.js';
import { secretsKeyFrom } from '../services/secrets.js';

const config = loadConfig();
const platformDb = createDb<PlatformDB>(config.DATABASE_URL_PLATFORM, { max: 4 });
const cells = new TenantRouter<CellDB>(cellResolver(platformDb));
const services = createServices({
  db: platformDb,
  cells,
  idp: new GridsIdpClient(config.IDENTITY_INTERNAL_URL, config.IDENTITY_SERVICE_TOKEN),
  email: new EmailService(platformDb, mailerFor(config.SMTP_URL, config.MAIL_FROM)),
  consoleUrl: config.CONSOLE_URL,
  workspaceUrl: config.WEB_URL,
  baseDomain: config.BASE_DOMAIN,
  supportEmail: config.SUPPORT_EMAIL,
  secretsKey: secretsKeyFrom(config.SECRETS_KEY, false),
  allowPrivateConnections: true,
  now: () => new Date(),
});

const tenant = process.env.ORGANISATION_ID ?? (await platformDb.selectFrom('tenant').select('id').orderBy('created_at').executeTakeFirstOrThrow()).id;
const admin = await platformDb
  .selectFrom('membership as m')
  .innerJoin('user_identity as u', 'u.id', 'm.user_id')
  .select(['u.id', 'u.email'])
  .where('m.tenant_id', '=', tenant)
  .where('m.role', '=', 'org_admin')
  .$if(!!process.env.USER_ID, (q) => q.where('u.id', '=', process.env.USER_ID!))
  .orderBy('m.created_at')
  .executeTakeFirstOrThrow();
const actor: Actor = { id: admin.id, email: admin.email, isPlatformAdmin: false, permissions: new Set() };

const org = await platformDb.selectFrom('tenant').select(['id', 'slug', 'name']).where('id', '=', tenant).executeTakeFirstOrThrow();
const current = await services.support.deskOf(tenant);
await services.support.saveDesk(actor, tenant, HelpDeskConfig.parse({ ...current, enabled: true, captcha: false, replies: current.replies.length ? current.replies : [
  { id: 'ask_screenshot', title: 'Ask for a screenshot', body: 'Hi {name},\n\nThanks for getting in touch. Could you send a screenshot of what you see? It helps us find the cause faster.' },
  { id: 'looking', title: 'We are looking into it', body: 'Hi {name},\n\nThanks for letting us know. We are looking into it and will write back here as soon as we know more.' },
  { id: 'fixed', title: 'It is fixed', body: 'Hi {name},\n\nThis is fixed now. Reply here if you still see the problem and we will open it again.' },
] }));
console.log(`${org.name}: help desk on`);

const people = await services.support.handlers(actor, tenant);
const other = people.find((p) => p.id !== actor.id) ?? null;
const seen = new Set((await services.support.list(actor, { tenantId: tenant, pageSize: 100 })).items.map((t) => t.subject));
const asks = [
  { name: 'Marie Joseph', email: 'marie.joseph@example.org', project: 'caribbean-health', subject: 'Vaccination map shows no data for Saint Lucia', body: 'I opened the vaccination coverage layer and every parish in Saint Lucia is grey. Is the data late?', priority: 'high' as const, labels: ['bug', 'data'], stage: 'new', assignee: actor.id, reply: null as string | null, note: null as string | null, escalate: false },
  { name: 'Daniel Greaves', email: 'daniel.greaves@example.org', project: 'caribbean-health', subject: 'Can I download the clinic visits as a spreadsheet?', body: 'We would like the weekly clinic visits for Barbados as a CSV for our own report.', priority: 'normal' as const, labels: ['feature'], stage: 'pending_investigation', assignee: actor.id, reply: 'Good question. Dashboards can be exported by the project team; we are checking whether a CSV export can be opened up for the public view.', note: 'Finance asked for the same last month. Worth bringing to planning.', escalate: true },
  { name: 'Aisha Khan', email: 'aisha.khan@example.org', project: 'country-atlas', subject: 'Wrong spelling on the map', body: 'Castries is spelled "Castires" in the hover card.', priority: 'low' as const, labels: ['data'], stage: 'resolved', assignee: other?.id ?? actor.id, reply: 'Thank you for spotting that. It was a typo in our data; it is corrected now.', note: null, escalate: false },
  { name: 'Tomas Reyes', email: 'tomas.reyes@example.org', project: 'country-atlas', subject: 'Life expectancy overlay looks flipped', body: 'Green should be the higher numbers, I think? It looks the other way round to me.', priority: 'normal' as const, labels: ['question'], stage: 'in_progress', assignee: null as string | null, reply: 'We are looking at whether the colours are the wrong way round.', note: null, escalate: false },
  { name: 'Lena Fischer', email: 'lena.fischer@example.org', project: 'caribbean-weather', subject: 'Cannot sign in to the portal', body: 'The sign-in page says my account is not part of the organisation, but I was invited last week.', priority: 'urgent' as const, labels: ['access'], stage: 'new', assignee: null, reply: null, note: null, escalate: false },
];
for (const a of asks) {
  if (seen.has(a.subject)) continue;
  const sent = await services.helpDesk.requestPublic(org.slug, { name: a.name, email: a.email, subject: a.subject, body: a.body, project: a.project, attachments: [], captcha: null } as never, '127.0.0.1');
  const id = sent.thread.id;
  const patch = (p: object) => services.support.orgUpdate(actor, tenant, id, p as never);
  await patch({ priority: a.priority, labels: a.labels, ...(a.assignee ? { assigneeId: a.assignee } : {}) });
  if (a.note) await services.support.reply(actor, id, { body: a.note, internal: true, attachments: [] });
  if (a.reply) await services.support.reply(actor, id, { body: a.reply, internal: false, attachments: [] });
  if (a.stage !== 'new') await patch({ stage: a.stage });
  if (a.escalate) await services.support.escalate(actor, tenant, id, 'This might need a platform change. Can you confirm whether CSV export for public views is on the roadmap?');
  console.log(`  ${sent.thread.ref} ${a.subject}`);
}
process.exit(0);
