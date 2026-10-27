import { EmptyState, SectionHead } from '@grids/ui';
import { Lock } from 'lucide-react';
import { ActivityLog } from '../ActivityLog';
import { useProject } from './context';

/** What has happened in the project, by whom and from where: for its managers. */
export function ActivityTab() {
  const { tenantId, project, can } = useProject();
  if (!can('manager'))
    return (
      <EmptyState icon={Lock} title="For project managers">
        The activity log shows who did what in this project, and from where.
      </EmptyState>
    );
  return (
    <div className="space-y-4">
      <SectionHead title="Activity" description="Submissions, approvals, invitations, changes, views and public visits, with the address and place each came from." />
      <ActivityLog tenantId={tenantId} project={project.key} queryKey="project-activity" />
    </div>
  );
}
