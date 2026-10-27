import { z } from 'zod';
import { Key } from './common.js';

// ---------------------------------------------------------------- the organisation's help desk
// People using any of an organisation's public pages, or its portal, can ask the organisation for help, with or without
// an account. A request is one of the organisation's own support tickets (it lands in the same inbox as the tickets its
// members raise), and it moves through the stages the organisation chose. Only the organisation can pass a request on
// to the Grids team; the person who asked never writes to Grids directly.

/** One step a request moves through. `kind` says what it means: waiting to be picked up, being worked on, or finished. */
export const SupportStage = z.object({
  key: Key,
  label: z.string().trim().min(1).max(40),
  kind: z.enum(['open', 'active', 'done']),
});
export type SupportStage = z.infer<typeof SupportStage>;

/** The stages an organisation starts with; it changes them to suit how it works. */
export const DEFAULT_SUPPORT_STAGES: SupportStage[] = [
  { key: 'new', label: 'New', kind: 'open' },
  { key: 'in_progress', label: 'In progress', kind: 'active' },
  { key: 'pending_investigation', label: 'Pending investigation', kind: 'active' },
  { key: 'under_review', label: 'Under review', kind: 'active' },
  { key: 'waiting', label: 'Waiting for the requester', kind: 'active' },
  { key: 'post_release', label: 'Post-release check', kind: 'active' },
  { key: 'resolved', label: 'Resolved', kind: 'done' },
  { key: 'closed', label: 'Closed', kind: 'done' },
];

/** A tag the team puts on tickets to sort them (Bug, Billing, Data issue…). */
export const SupportLabel = z.object({
  key: Key,
  label: z.string().trim().min(1).max(30),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type SupportLabel = z.infer<typeof SupportLabel>;
export const DEFAULT_SUPPORT_LABELS: SupportLabel[] = [
  { key: 'bug', label: 'Bug', color: '#e5484d' },
  { key: 'question', label: 'Question', color: '#0091ff' },
  { key: 'feature', label: 'Feature request', color: '#8e4ec6' },
  { key: 'data', label: 'Data issue', color: '#30a46c' },
  { key: 'access', label: 'Access', color: '#f5a623' },
];

/** A ready-made reply the team inserts with a click (Zendesk calls these macros). */
export const SupportCannedReply = z.object({ id: Key, title: z.string().trim().min(1).max(60), body: z.string().trim().min(1).max(4000) });
export type SupportCannedReply = z.infer<typeof SupportCannedReply>;

/** One website that may show the help window: where it is, its own key, and how many requests it may send an hour. */
export const SupportEmbedSite = z.object({
  /** Made by the server. */
  id: z.string().max(40).default(''),
  /** `www.example.org`, or `*.example.org` for any subdomain. */
  host: z.string().trim().toLowerCase().max(200).regex(/^(\*\.)?[a-z0-9.-]+(:\d+)?$/, 'Use a host name like www.example.org or *.example.org'),
  /** Public key in this site's snippet; made by the server, changed with "New key". */
  key: z.string().max(64).default(''),
  paused: z.boolean().default(false),
  /** Requests this site may send in an hour. */
  hourlyLimit: z.number().int().min(1).max(1000).default(30),
  /** The site's own server must sign a short-lived token for every page that shows the window (the key alone is not enough). */
  secure: z.boolean().default(false),
  /** Changed by the server when the site's secret is renewed. */
  secretVersion: z.number().int().min(1).default(1),
});
export type SupportEmbedSite = z.infer<typeof SupportEmbedSite>;

/** How the organisation takes requests for help. */
export const HelpDeskConfig = z
  .object({
    enabled: z.boolean().default(false),
    /** Lets people keep talking with a representative in the same window, not only send a first message. */
    chat: z.boolean().default(true),
    /** A small puzzle the browser solves before a request from someone not signed in is sent. */
    captcha: z.boolean().default(true),
    /** Whether the help window asks for a phone number. */
    phone: z.enum(['off', 'optional', 'required']).default('off'),
    /** Websites that show the help window inside their own pages. Each has its own key, switch and hourly limit. */
    embedSites: z.array(SupportEmbedSite).max(20).default([]),
    /** Switches every website embed off at once, without touching the organisation's own pages. */
    embedPaused: z.boolean().default(false),
    /** Whether an email address is confirmed with a code before the person goes on. */
    verifyEmail: z.boolean().default(false),
    /** What people see at the top of the help window. */
    greeting: z.string().trim().max(300).default('How can we help? Tell us what is wrong and a member of the team will reply here.'),
    /** What a request can be about (the list people choose from). */
    categories: z.array(z.string().trim().min(1).max(60)).max(12).default(['Question', 'Something is not working', 'Access or account', 'Suggestion']),
    /** An icon for each topic (by its name); the icons are named in the settings. */
    categoryIcons: z.record(z.string().max(60), z.string().max(60)).default({}),
    stages: z.array(SupportStage).min(2).max(15).default(DEFAULT_SUPPORT_STAGES),
    labels: z.array(SupportLabel).max(30).default(DEFAULT_SUPPORT_LABELS),
    replies: z.array(SupportCannedReply).max(30).default([]),
  })
  .superRefine((c, ctx) => {
    if (new Set(c.stages.map((s) => s.key)).size !== c.stages.length) ctx.addIssue({ code: 'custom', path: ['stages'], message: 'Two stages share a key' });
    if (c.stages[0]?.kind !== 'open') ctx.addIssue({ code: 'custom', path: ['stages'], message: 'The first stage is where new requests start: make it a waiting stage' });
    if (!c.stages.some((s) => s.kind === 'done')) ctx.addIssue({ code: 'custom', path: ['stages'], message: 'Add a finished stage, such as Resolved' });
  });
export type HelpDeskConfig = z.infer<typeof HelpDeskConfig>;
export type HelpDeskConfigInput = z.input<typeof HelpDeskConfig>;

/** What the help window needs to know before it opens. */
export const SupportInfo = z.object({
  enabled: z.boolean(),
  orgName: z.string(),
  chat: z.boolean(),
  captcha: z.boolean(),
  phone: z.enum(['off', 'optional', 'required']).default('off'),
  verifyEmail: z.boolean().default(false),
  /** The organisation's colour. */
  color: z.string().nullable().default(null),
  /** Which bottom corner the help button sits in (the branding setting). */
  helpPosition: z.enum(['left', 'right']).default('left'),
  greeting: z.string(),
  categories: z.array(z.string()),
  categoryIcons: z.record(z.string(), z.string()).default({}),
});
export type SupportInfo = z.infer<typeof SupportInfo>;

export const SUPPORT_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
export const SupportAttachmentDto = z.object({ id: z.uuid(), name: z.string(), contentType: z.string(), size: z.number().int() });
export type SupportAttachmentDto = z.infer<typeof SupportAttachmentDto>;

const Captcha = z.object({ salt: z.string(), challenge: z.string(), signature: z.string(), number: z.number().int() });

/** A new request. Someone not signed in gives a name and email so the team can write back; a signed-in person does not. */
export const SupportRequestInput = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.email().max(200).optional(),
  phone: z.string().trim().max(25).optional(),
  /** Proof that the request came through an allowed website's embed (from the embed page). */
  embed: z.string().max(700).optional(),
  /** What proves the email was confirmed (from the code check), when the organisation asks for that. */
  emailProof: z.string().max(400).optional(),
  subject: z.string().trim().min(4).max(200),
  body: z.string().trim().min(1).max(8000),
  category: z.string().trim().max(60).optional(),
  attachments: z.array(z.uuid()).max(5).default([]),
  /** The project whose page they were on, and the page. */
  project: z.string().max(63).optional(),
  page: z.string().max(300).optional(),
  captcha: Captcha.nullable().default(null),
});
export type SupportRequestInput = z.input<typeof SupportRequestInput>;

/** What a look at a website's DNS found. */
export const SupportSiteCheck = z.object({
  host: z.string(),
  /** The name that was looked up (a wildcard is checked at its parent). */
  name: z.string(),
  /** `local`: a local name or an address, not looked up. */
  kind: z.enum(['domain', 'local']),
  resolves: z.boolean(),
  addresses: z.array(z.string()),
  cname: z.array(z.string()),
  nameservers: z.array(z.string()),
  mail: z.boolean(),
  /** For `*.` entries: whether any subdomain resolves (a wildcard record). */
  wildcard: z.boolean().nullable(),
});
export type SupportSiteCheck = z.infer<typeof SupportSiteCheck>;
/** How much each website has used of its hourly allowance. */
export const SupportEmbedUsage = z.array(z.object({ siteId: z.string(), used: z.number().int(), limit: z.number().int(), refused: z.number().int() }));
export type SupportEmbedUsage = z.infer<typeof SupportEmbedUsage>;
export const SupportEmbedSecret = z.object({ secret: z.string() });
export const SupportSiteIdInput = z.object({ siteId: z.string().max(40) });

export const SupportSiteCheckInput = z.object({ host: z.string().trim().toLowerCase().max(200).regex(/^(\*\.)?[a-z0-9.-]+(:\d+)?$/) });

export const SupportEmailCodeInput = z.object({ email: z.email().max(200) });
export const SupportEmailVerifyInput = z.object({ email: z.email().max(200), code: z.string().trim().regex(/^\d{6}$/) });
export const SupportEmailProof = z.object({ proof: z.string() });

export const SupportReplyInput = z.object({
  body: z.string().trim().max(8000).default(''),
  attachments: z.array(z.uuid()).max(5).default([]),
});
export type SupportReplyInput = z.input<typeof SupportReplyInput>;

export const SupportTypingInput = z.object({ text: z.string().max(500).default('') });

export const SupportMessageDto = z.object({
  id: z.string(),
  /** `requester`: the person who asked; `staff`: the organisation's team; `system`: a change (a new stage, passed on). */
  from: z.enum(['requester', 'staff', 'system']),
  name: z.string(),
  body: z.string(),
  attachments: z.array(SupportAttachmentDto),
  /** Set when the words were changed after they were sent. */
  editedAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type SupportMessageDto = z.infer<typeof SupportMessageDto>;

/** A request as the person who made it sees it. */
export const SupportThreadDto = z.object({
  id: z.string(),
  /** The number they quote, like #12. */
  ref: z.string(),
  subject: z.string(),
  orgName: z.string(),
  stage: z.object({ key: z.string(), label: z.string(), kind: z.enum(['open', 'active', 'done']) }),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Whether they can still add to it. */
  canReply: z.boolean(),
  chat: z.boolean(),
  /** Whether a member of the team has written back yet. */
  answered: z.boolean(),
  /** The team member who is writing an answer right now. */
  agentTyping: z.string().nullable().default(null),
  messages: z.array(SupportMessageDto),
});
export type SupportThreadDto = z.infer<typeof SupportThreadDto>;

/** What someone is given on sending a request: the thread, and (when not signed in) the secret that opens it again. */
export const SupportSent = z.object({ token: z.string().nullable(), thread: SupportThreadDto });
export type SupportSent = z.infer<typeof SupportSent>;

/** The requests a signed-in person has made (newest first). */
export const SupportMineDto = z.array(z.object({ id: z.string(), ref: z.string(), subject: z.string(), stage: SupportThreadDto.shape.stage, updatedAt: z.string() }));
export type SupportMineDto = z.infer<typeof SupportMineDto>;

/** The stage a ticket is in: its own, or (for tickets from before stages) the one that matches its plain status. */
export function stageOf(stages: readonly SupportStage[], t: { stage: string | null; status: string }): SupportStage {
  const own = t.stage ? stages.find((s) => s.key === t.stage) : undefined;
  if (own) return own;
  const done = stages.filter((s) => s.kind === 'done');
  if (t.status === 'resolved') return done.find((s) => s.key === 'resolved') ?? done[0] ?? stages[0]!;
  if (t.status === 'closed') return done.find((s) => s.key === 'closed') ?? done.at(-1) ?? stages[0]!;
  if (t.status === 'pending') return stages.find((s) => s.kind === 'active') ?? stages[0]!;
  return stages[0]!;
}
/** The plain status a stage stands for (what the platform's own screens and counts use). */
export const statusOfStage = (s: Pick<SupportStage, 'key' | 'kind'>): 'open' | 'resolved' | 'closed' => (s.kind !== 'done' ? 'open' : s.key === 'closed' ? 'closed' : 'resolved');
