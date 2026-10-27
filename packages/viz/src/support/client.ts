import type { CaptchaChallenge, SupportAttachmentDto, SupportInfo, SupportMineDto, SupportReplyInput, SupportRequestInput, SupportSent, SupportThreadDto } from '@grids/schema';

/**
 * What the help window needs from an app. A visitor (not signed in) and a signed-in person talk to different
 * endpoints, so each app supplies the one that fits; the window itself is the same.
 */
export interface SupportClient {
  /** A signed-in person is not asked for a name, an email or the puzzle. */
  signedIn: boolean;
  /** Who the website the window sits on says the visitor is (the window then skips asking). */
  identity?: { name?: string; email?: string } | null;
  /** Where a visitor's conversations are remembered on this device. */
  storageKey: string;
  info(): Promise<SupportInfo>;
  /** A fresh puzzle (visitors only). */
  captcha?(): Promise<CaptchaChallenge>;
  /** Emails a code to confirm an address (visitors, when the organisation asks for that). */
  sendEmailCode?(email: string): Promise<void>;
  /** Checks the code; the proof it returns goes with the request. */
  verifyEmail?(email: string, code: string): Promise<{ proof: string }>;
  /** Tells the team what the person is typing right now (empty when they stop). */
  typing?(thread: string, text: string): Promise<void>;
  /** Uploads a file; `thread` is set when it goes with a reply to a conversation that exists. */
  upload(file: File, thread: string | null): Promise<SupportAttachmentDto>;
  create(input: SupportRequestInput): Promise<SupportSent>;
  thread(key: string): Promise<SupportThreadDto>;
  reply(key: string, input: SupportReplyInput): Promise<SupportThreadDto>;
  /** The conversations of a signed-in person. */
  mine?(): Promise<SupportMineDto>;
  /** Shows a file that came with a message. */
  openFile(thread: string, file: SupportAttachmentDto): void | Promise<void>;
  /** An address a picture in a message can be shown from. */
  fileUrl?(thread: string, id: string): Promise<string>;
}

/** Finds the number the puzzle hides (in small steps, so the page stays alive). */
export async function solvePuzzle(c: CaptchaChallenge): Promise<number> {
  const enc = new TextEncoder();
  const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
  for (let n = 0; n <= c.maxNumber; n++) {
    if (hex(await crypto.subtle.digest('SHA-256', enc.encode(`${c.salt}${n}`))) === c.challenge) return n;
    if (n % 500 === 0) await new Promise((r) => setTimeout(r));
  }
  throw new Error('The check could not be completed. Reload the page and try again.');
}

export interface Remembered {
  key: string;
  ref: string;
  subject: string;
  at: string;
}
/** The conversations a visitor has started from this device (their secret links live only here and in their email). */
export function remembered(storageKey: string): Remembered[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as Remembered[];
    return Array.isArray(raw) ? raw.slice(0, 20) : [];
  } catch {
    return [];
  }
}
export function remember(storageKey: string, r: Remembered) {
  try {
    localStorage.setItem(storageKey, JSON.stringify([r, ...remembered(storageKey).filter((x) => x.key !== r.key)].slice(0, 20)));
  } catch {
    // Private windows can refuse storage: the email still carries the link.
  }
}
