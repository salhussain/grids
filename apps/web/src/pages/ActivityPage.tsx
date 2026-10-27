import { PageHeader } from '@grids/ui';
import { NoAccess, useCan, useWorkspace } from '../session';
import { useT } from '../i18n';
import { ActivityLog } from './ActivityLog';

export function ActivityPage() {
  const t = useT();
  const ws = useWorkspace();
  const can = useCan();
  if (!can('audit.view')) return <NoAccess what="the activity log" />;
  return (
    <>
      <PageHeader eyebrow={t('web.nav.help')} title={t('web.nav.activity')} meta={<span>Everything that happens in this organisation, across all its projects.</span>} />
      <ActivityLog tenantId={ws.tenant.id} queryKey="activity" />
    </>
  );
}
