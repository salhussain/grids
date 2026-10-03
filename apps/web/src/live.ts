import { useQueryClient, type Query } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { currentUser } from './auth';
import { env } from './env';

export type LiveStatus = 'connecting' | 'live' | 'offline';
export type ChangeMessage = { kind: 'data'; table: string } | { kind: 'run'; run: { id: string; jobId: string; status: string } };

/**
 * Follows a server-sent event stream (spec §9 live updates), reconnecting with
 * backoff. Uses fetch rather than EventSource so it can send the bearer token.
 */
function useEventStream(path: string | null, opts: { auth: boolean; onChange(m: ChangeMessage): void }): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const onChange = useRef(opts.onChange);
  onChange.current = opts.onChange;

  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    let attempt = 0;
    const run = async () => {
      while (!ctrl.signal.aborted) {
        try {
          const token = opts.auth ? (await currentUser())?.access_token : null;
          const res = await fetch(`${env.apiUrl}${path}`, {
            headers: { accept: 'text/event-stream', ...(token && { authorization: `Bearer ${token}` }) },
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value;
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const event = /^event: (.*)$/m.exec(block)?.[1];
              const data = /^data: (.*)$/m.exec(block)?.[1];
              if (event === 'ready') {
                attempt = 0;
                setStatus('live');
              } else if (event === 'change' && data) onChange.current(JSON.parse(data) as ChangeMessage);
            }
          }
        } catch {
          if (ctrl.signal.aborted) return;
        }
        setStatus('offline');
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt++)));
      }
    };
    void run();
    return () => ctrl.abort();
  }, [path, opts.auth]);

  return path ? status : 'offline';
}

const RUN_KEYS = new Set(['runs', 'run', 'jobs', 'datasets', 'files', 'project']);

/** Live updates for a project: refetches its queries when its data or runs change. */
export function useProjectEvents(tenantId: string, projectKey: string | null): LiveStatus {
  const qc = useQueryClient();
  return useEventStream(projectKey ? `/tenants/${tenantId}/projects/${projectKey}/events` : null, {
    auth: true,
    onChange: (m) => {
      const scoped = (q: Query) => q.queryKey[1] === tenantId && q.queryKey[2] === projectKey;
      void qc.invalidateQueries({ predicate: (q) => scoped(q) && (m.kind === 'data' || RUN_KEYS.has(String(q.queryKey[0]))) });
    },
  });
}

/** Live updates for an anonymous public project page. */
export function usePublicEvents(tenant: string, project: string): LiveStatus {
  const qc = useQueryClient();
  return useEventStream(`/public/projects/${tenant}/${project}/events`, {
    auth: false,
    onChange: (m) => {
      if (m.kind === 'data')
        void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('public-') && q.queryKey[1] === tenant && q.queryKey[2] === project });
    },
  });
}
