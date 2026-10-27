import type { Problem } from '@grids/schema';
import type * as S from '@grids/schema';
import { SyncError } from '@grids/offline';
import { accessToken } from './auth';
import { env } from './env';

const problemText = (p: Problem | null, fallback: string) =>
  p ? [p.detail ?? p.title, ...(p.errors ?? []).map((e) => `${e.path}: ${e.message}`)].join('\n') : fallback;

interface Options {
  anonymous?: boolean;
  /** Milliseconds before giving up; a stuck connection is the same as none. */
  timeout?: number;
  headers?: Record<string, string>;
}

/** A request to the API. Any failure is a `SyncError`: with no status when there was no answer. */
export async function request<T>(method: string, path: string, body?: unknown, opts: Options = {}): Promise<T> {
  const token = opts.anonymous ? null : await accessToken();
  const raw = typeof Blob !== 'undefined' && body instanceof Blob;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout ?? 30_000);
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method,
      signal: ctl.signal,
      headers: {
        ...(body !== undefined && { 'content-type': raw ? 'application/octet-stream' : 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
        ...opts.headers,
      },
      body: body === undefined ? undefined : raw ? (body as Blob) : JSON.stringify(body),
    });
  } catch (e) {
    throw new SyncError(ctl.signal.aborted ? 'The server took too long to answer' : e instanceof Error ? e.message : 'No connection');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as Problem | null;
    throw new SyncError(problem?.title ?? res.statusText, res.status, problemText(problem, res.statusText));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${new URLSearchParams(p.map(([k, v]) => [k, String(v)]))}` : '';
};
const base = (t: string, p: string) => `/tenants/${t}/projects/${p}`;

export const api = {
  me: () => request<S.MeDto>('GET', '/me'),
  projects: (tenantId: string) => request<S.ProjectDto[]>('GET', `/tenants/${tenantId}/projects`),
  forms: (tenantId: string, project: string) => request<S.FormDto[]>('GET', `${base(tenantId, project)}/forms`),
  placesSync: (tenantId: string, project: string, q: { since?: string | null; after?: string | null; limit?: number }) =>
    request<S.EntitySyncDto>('GET', `${base(tenantId, project)}/entities/sync${qs({ since: q.since, after: q.after, limit: q.limit })}`, undefined, { timeout: 60_000 }),
  mySubmissions: (tenantId: string, project: string, form: string, page = 1) =>
    request<S.Page<S.SubmissionDto>>('GET', `${base(tenantId, project)}/forms/${form}/submissions${qs({ mine: true, page, pageSize: 50 })}`),
  submit: (tenantId: string, project: string, form: string, input: S.SubmissionInput) =>
    request<S.SubmissionDto>('POST', `${base(tenantId, project)}/forms/${form}/submissions`, input),
  upload: (tenantId: string, project: string, form: string, file: Blob, name: string, type: string) =>
    request<S.AttachmentDto>('PUT', `${base(tenantId, project)}/forms/${form}/attachments${qs({ name, type })}`, file, { timeout: 180_000 }),

  // links for people without an account
  linkForm: (path: string) => request<S.PublicFormDto>('GET', `/public/forms/${encodeURIComponent(path)}`, undefined, { anonymous: true }),
  linkPlaces: (path: string, question: string) => request<S.PublicPlaceDto[]>('GET', `/public/forms/${encodeURIComponent(path)}/places${qs({ question })}`, undefined, { anonymous: true }),
  linkSubmit: (path: string, input: S.PublicSubmissionInput) =>
    request<{ message: string }>('POST', `/public/forms/${encodeURIComponent(path)}/submissions`, input, { anonymous: true }),
  linkUpload: (path: string, file: Blob, name: string, type: string) =>
    request<S.AttachmentDto>('PUT', `/public/forms/${encodeURIComponent(path)}/attachments${qs({ name, type })}`, file, { anonymous: true, timeout: 180_000 }),
};
