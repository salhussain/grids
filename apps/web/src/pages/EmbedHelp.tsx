import { useQuery } from '@tanstack/react-query';
import { SupportWidget } from '@grids/viz';
import { useEffect, useMemo } from 'react';
import { api } from '../api';
import { visitorSupport } from '../support/clients';
import { applyTheme } from '../theme';

/** Whether `host` is one of the allowed sites (`*.example.org` allows its subdomains). */
const allowed = (host: string, list: string[]) =>
  list.some((o) => {
    const h = o.replace(/:\d+$/, '');
    return h.startsWith('*.') ? host === h.slice(2) || host.endsWith(h.slice(1)) : host === h;
  });

/**
 * /embed/help: the help window as a page of its own, for another website to show in a frame (see /embed.js).
 * It draws nothing unless the site that framed it is on the organisation's list.
 */
export function EmbedHelp() {
  const q = new URLSearchParams(window.location.search);
  const org = q.get('org') ?? '';
  const project = q.get('project') ?? undefined;
  const page = q.get('page') ?? undefined;
  const info = useQuery({
    queryKey: ['embed-info', org],
    queryFn: () => api.publicHelpInfo(org),
    enabled: !!org,
    retry: false,
  });
  const token = q.get('token') ?? '';
  // The page that framed this one handed over a short-lived token; the server says whether it is good (and embeds are not paused).
  const ok = useQuery({
    queryKey: ['embed-check', org, token],
    queryFn: () => api.publicHelpEmbedCheck(org, token),
    enabled: !!org && !!token,
    retry: false,
  });
  const client = useMemo(() => visitorSupport(org, token, ok.data?.identity), [org, token, ok.data?.identity]);
  // The website the window sits on: the browser lists every page above this one (the last is the top).
  const topHost = useMemo(() => {
    const chain = (window.location as Location & { ancestorOrigins?: DOMStringList })
      .ancestorOrigins;
    if (!chain?.length) return null;
    try {
      return new URL(chain[chain.length - 1]!).hostname.toLowerCase();
    } catch {
      return '';
    }
  }, []);
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    if (info.data?.color) applyTheme({ primaryColor: info.data.color } as never);
  }, [info.data]);
  // An address that names a corner wins; otherwise the organisation's branding setting.
  const pos = q.get('position');
  const side = pos === 'left' || pos === 'right' ? (pos === 'left' ? 'start' : 'end') : info.data?.helpPosition === 'right' ? 'end' : 'start';
  const tell = (type: 'open' | 'close') =>
    window.parent.postMessage({ source: 'grids-help', type }, '*');
  // The server (frame-ancestors) already refuses other sites; where the browser can say who is on top, check that as well.
  if (
    !info.data?.enabled ||
    !ok.data?.ok ||
    (topHost !== null && !allowed(topHost, [ok.data.host ?? '']))
  )
    return null;
  return (
    <SupportWidget
      client={client}
      project={project}
      page={page}
      side={side}
      className="bottom-4!"
      onOpenChange={(open) => tell(open ? 'open' : 'close')}
    />
  );
}
