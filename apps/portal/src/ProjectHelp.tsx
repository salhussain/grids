import { useQuery } from '@tanstack/react-query';
import { SupportWidget } from '@grids/viz';
import { useMemo } from 'react';
import { api } from './api';
import { SupportBubble } from './SupportBubble';
import { accountSupport } from './support';

/**
 * Help from the portal. When the organisation has switched its help desk on, people ask it here and chat with a
 * representative (the project they are looking at is only where the request came from); otherwise they raise a ticket
 * with the organisation's admins, as before.
 */
export function ProjectHelp({ tenantId, project }: { tenantId: string; project: string }) {
  const client = useMemo(() => accountSupport(tenantId), [tenantId]);
  const info = useQuery({ queryKey: ['help-info', tenantId], queryFn: () => api.helpInfo(tenantId), staleTime: 60_000, retry: false });
  if (info.isPending) return null;
  const side = info.data?.helpPosition === 'right' ? 'end' : 'start';
  return info.data?.enabled ? <SupportWidget client={client} project={project} side={side} /> : <SupportBubble tenantId={tenantId} side={side} />;
}
