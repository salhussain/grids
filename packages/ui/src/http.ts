import type { Problem } from '@grids/schema';

/** An RFC 7807 problem returned by a Grids API. */
export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
  }
  get status() {
    return this.problem.status;
  }
}

/** JSON request helper with bearer auth and problem-details errors. */
export function createRequester(baseUrl: string, getToken: () => Promise<string | null>) {
  return async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { anonymous?: boolean } = {},
  ): Promise<T> {
    const token = opts.anonymous ? null : await getToken();
    // Files (Blob) go as raw bytes; everything else as JSON.
    const raw = typeof Blob !== 'undefined' && body instanceof Blob;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'content-type': raw ? 'application/octet-stream' : 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : raw ? (body as Blob) : JSON.stringify(body),
    });
    if (!res.ok) {
      const problem = (await res.json().catch(() => null)) as Problem | null;
      throw new ApiError(
        problem ?? { type: 'about:blank', title: res.statusText, status: res.status },
      );
    }
    return (res.status === 204 ? undefined : res.json()) as Promise<T>;
  };
}

export const qs = (params: Record<string, string | number | boolean | undefined | null> | object) => {
  const p = Object.entries(params as Record<string, unknown>).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  return p.length ? `?${new URLSearchParams(p.map(([k, v]) => [k, String(v)]))}` : '';
};
