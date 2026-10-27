import type { AuditEntryDto } from '@grids/schema';

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const words = (s: string) => s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface ChangeRow {
  field: string;
  before: string | null;
  after: string | null;
}
/** What was changed, if the entry kept it. */
export const changesOf = (d: Record<string, unknown>): ChangeRow[] => (Array.isArray(d.changes) ? (d.changes as ChangeRow[]).filter((c) => c && typeof c.field === 'string') : []);
const changeCount = (d: Record<string, unknown>) => {
  const n = changesOf(d).length;
  return n ? `${n} ${n === 1 ? 'field' : 'fields'} changed` : undefined;
};

/** What an entry says happened, in a sentence, and the one detail that helps most. */
export function describe(e: Pick<AuditEntryDto, 'action' | 'details'>): { what: string; detail?: string } {
  const d = e.details;
  const form = str(d.form);
  const known: Record<string, [string, (string | undefined)?]> = {
    'submission.created': [`Sent a submission${form ? ` to ${form}` : ''}`, str(d.via) === 'link' ? `Through a link${str(d.submitter) ? ` by ${str(d.submitter)}` : ''}` : undefined],
    'submission.reviewed': [`${sentence(str(d.decision) ?? 'Reviewed')} a submission`, form],
    'submission.viewed': ['Opened a submission'],
    'project.viewed': ['Opened the project'],
    'form.viewed': ['Opened the forms'],
    'dashboard.viewed': ['Viewed the dashboards'],
    'overlay.viewed': ['Viewed a map layer', str(d.overlay)],
    'entity.viewed': ['Opened a place or thing'],
    'work.viewed': ['Opened a piece of work'],
    'public.form_viewed': [`A visitor opened ${form ?? 'a form'}`, str(d.label) ?? (str(d.link) === 'invite' ? 'Through an invitation' : 'Through the shared link')],
    'public.project_viewed': ['A visitor opened the public project'],
    'public.map_viewed': ['A visitor opened the public map'],
    'public.overlay_viewed': ['A visitor viewed a map layer', str(d.overlay)],
    'public.dashboard_viewed': ['A visitor viewed a dashboard', str(d.dashboard)],
    'form.link_created': [`Made ${d.count ?? ''} ${str(d.kind) === 'invite' ? 'invitation' : 'shared'} link${d.count === 1 ? '' : 's'}${form ? ` for ${form}` : ''}`.replace(/\s+/g, ' ')],
    'form.link_revoked': [`Revoked a link${form ? ` for ${form}` : ''}`],
    'form.link_updated': [`Changed a link${form ? ` for ${form}` : ''}`],
    'form.published': [`Published ${form ?? 'a form'}`, d.version ? `Version ${String(d.version)}` : undefined],
    'entity.created': [`Added ${str(d.entity) ?? 'a place or thing'}`, str(d.type)],
    'entity.updated': [`Changed ${str(d.entity) ?? 'a place or thing'}`, changeCount(d)],
    'entity.deleted': [`Deleted ${str(d.entity) ?? 'a place or thing'}`, str(d.type)],
    'project.created': ['Created the project'],
    'project.updated': ['Changed the project’s settings', changeCount(d)],
    'project.imported': ['Imported places and things', d.created !== undefined ? `${String(d.created)} new, ${String(d.updated ?? 0)} updated` : undefined],
    'project.member_set': [`Changed access for ${str(d.member) ?? 'a member'}`, changeCount(d)],
    'project.member_removed': ['Removed a member'],
    'invitation.created': ['Invited someone to the organisation'],
    'invitation.accepted': ['Accepted an invitation'],
    'invitation.resent': ['Resent an invitation', str(d.email)],
    'invitation.revoked': ['Cancelled an invitation', str(d.email)],
  };
  const hit = known[e.action];
  if (hit) return { what: hit[0], detail: hit[1] };
  const what = sentence(words(e.action));
  const path = str(d.path);
  return { what, detail: path ?? str(d.name) ?? str(d.key) ?? str(d.dataset) ?? str(d.job) ?? str(d.overlay) };
}

/** A short name for a browser, from its user-agent string. */
export function browserOf(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl|node|python|axios|bot/i.test(ua) ? 'Script' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
