import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ErrorNotice,
  Mono,
  PageHeader,
  Pagination,
  Panel,
  RefreshControl,
  Table,
  Td,
  dateTime,
  useLiveInterval,
  usePagination,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan, useWorkspace } from '../session';
import { useT } from '../i18n';

export function ActivityPage() {
  const t = useT();
  const ws = useWorkspace();
  const can = useCan();
  const live = useLiveInterval();
  const [page, setPage] = usePagination([], 25);
  const log = useQuery({
    queryKey: ['activity', ws.tenant.id, page],
    queryFn: () => api.activity(ws.tenant.id, page),
    placeholderData: keepPreviousData,
    refetchInterval: live,
    enabled: can('audit.view'),
  });
  if (!can('audit.view')) return <NoAccess what="the activity log" />;
  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.help')}
        title={t('web.nav.activity')}
        meta={<span>Every change made in this organisation.</span>}
        actions={<RefreshControl queryKeys={[['activity']]} />}
      />
      <Panel flush title={`${log.data?.total ?? '–'} events`}>
        <ErrorNotice error={log.error} />
        <Table head={['Time', 'Action', 'By', 'Details']} empty="No activity yet.">
          {log.data?.items.map((e) => (
            <tr key={e.id} className="align-top">
              <Td className="font-mono text-xs whitespace-nowrap text-zinc-500">
                {dateTime(e.at)}
              </Td>
              <Td>
                <Mono className="text-xs font-medium">{e.action}</Mono>
              </Td>
              <Td className="text-zinc-600">{e.actorEmail ?? 'system'}</Td>
              <Td className="text-xs text-zinc-600">
                {Object.entries(e.details)
                  .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                  .join(' · ')}
              </Td>
            </tr>
          ))}
        </Table>
        {log.data && <Pagination {...page} total={log.data.total} onChange={setPage} />}
      </Panel>
    </>
  );
}
