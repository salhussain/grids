import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { TenantDetail } from '@grids/schema';
import { Pagination, Panel, usePagination } from '@grids/ui';
import { api } from '../../api';
import { ActivityList } from '../shared';

export function ActivityTab({ t }: { t: TenantDetail }) {
  const [page, setPage] = usePagination([], 25);
  const query = { tenantId: t.id, ...page };
  const log = useQuery({
    queryKey: ['audit', query],
    queryFn: () => api.auditLog(query),
    placeholderData: keepPreviousData,
  });
  return (
    <Panel title="Activity" description="Every change to this organisation, newest first" flush>
      <div className="p-5">
        <ActivityList entries={log.data?.items ?? []} />
      </div>
      {log.data && <Pagination {...page} total={log.data.total} onChange={setPage} />}
    </Panel>
  );
}
