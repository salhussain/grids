import { NOT_PUBLIC_TYPES, type FormDefinition, type FormSettings } from '@grids/schema';
import { questionsOf } from './runtime.js';

export type FillState = 'open' | 'not_yet' | 'closed' | 'full' | 'limit';

/** How far `timeZone`'s wall clock is ahead of UTC at `at`, in milliseconds. */
function offsetAt(at: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The moment a wall-clock time (`2026-11-30T17:00`) is in `timeZone`; null when it is not a valid time or zone. */
export function zonedInstant(wall: string | null | undefined, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall ?? '');
  if (!m) return null;
  try {
    const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
    // Two passes settle times next to a daylight-saving change.
    const first = guess - offsetAt(new Date(guess), timeZone);
    const at = new Date(guess - offsetAt(new Date(first), timeZone));
    return Number.isNaN(at.getTime()) ? null : at;
  } catch {
    return null;
  }
}

export const validTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

const show = (at: Date, timeZone: string) => `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(at)} (${timeZone})`;

/** Problems with the availability and limits a form's author entered. */
export function availabilityProblems(s: Pick<FormSettings, 'availability' | 'limits'>): string[] {
  const a = s.availability;
  const out: string[] = [];
  if (!validTimeZone(a.timezone)) return [`Unknown time zone "${a.timezone}"`];
  const opens = zonedInstant(a.opensAt, a.timezone);
  const closes = zonedInstant(a.closesAt, a.timezone);
  if (a.opensAt && !opens) out.push('The opening time is not a valid date and time');
  if (a.closesAt && !closes) out.push('The closing time is not a valid date and time');
  if (opens && closes && closes <= opens) out.push('The form must close after it opens');
  return out;
}

/**
 * Whether a form can be filled in at `now`, and what to tell the person when it cannot.
 * `total` counts every submission; `mine` the ones this person already sent.
 */
export function fillState(s: Pick<FormSettings, 'availability' | 'limits'>, now: Date, counts: { total: number; mine: number }): { state: FillState; message: string | null; opensAt: Date | null; closesAt: Date | null } {
  const a = s.availability;
  const zone = validTimeZone(a.timezone) ? a.timezone : 'UTC';
  const opensAt = zonedInstant(a.opensAt, zone);
  const closesAt = zonedInstant(a.closesAt, zone);
  const base = { opensAt, closesAt };
  if (closesAt && now >= closesAt) return { ...base, state: 'closed', message: a.afterMessage || `This form closed on ${show(closesAt, zone)}.` };
  if (opensAt && now < opensAt) return { ...base, state: 'not_yet', message: a.beforeMessage || `This form opens on ${show(opensAt, zone)}.` };
  const l = s.limits;
  if (l.maxSubmissions !== null && counts.total >= l.maxSubmissions) return { ...base, state: 'full', message: l.fullMessage || 'This form is no longer accepting submissions.' };
  if (l.perPerson !== null && counts.mine >= l.perPerson) return { ...base, state: 'limit', message: l.fullMessage || (l.perPerson === 1 ? 'You have already sent this form.' : `You have already sent this form ${l.perPerson} times.`) };
  return { ...base, state: 'open', message: null };
}

/** What the form asks that people without an account cannot answer (the form then cannot be made public). */
export function publicProblems(def: FormDefinition): string[] {
  const blocked = new Set<string>(NOT_PUBLIC_TYPES);
  return questionsOf(def)
    .filter((q) => !q.primary && blocked.has(q.type))
    .map((q) => `"${q.label || q.key}" is a ${q.type} question, which needs an account`);
}

/**
 * The form as people without an account see it: nothing meant for a role, and no main-entity question when the link
 * carries the place. A link that does not name a place leaves the choice to the person (`keepMain`).
 */
export function publicDefinition(def: FormDefinition, opts: { keepMain?: boolean } = {}): FormDefinition {
  const sections = def.sections
    .filter((s) => !s.fillAt)
    .map((s) => ({ ...s, questions: s.questions.filter((q) => (opts.keepMain || !q.primary) && !q.visibleTo) }))
    .filter((s) => s.questions.length);
  return { ...def, sections: sections.length ? sections : def.sections.slice(0, 1).map((s) => ({ ...s, questions: [] })) };
}
