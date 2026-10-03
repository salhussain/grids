import { useQuery } from '@tanstack/react-query';
import { Empty, ErrorNotice, Listbox, Loading, Panel } from '@grids/ui';
import { ClipboardList } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { SubmissionSheet } from '../forms/SubmissionSheet';
import { useProject } from './context';
import { SubmissionsTable } from './FormsTab';
import { PermissionGroupsPanel } from './permissions';
import { Members, Types } from './SettingsTab';

export function MembersTab() {
  return (
    <div className="space-y-6">
      <Members />
      <PermissionGroupsPanel />
    </div>
  );
}

export function TypesTab() {
  return <Types />;
}

/** Every form's submissions in one place, one form at a time. */
export function SubmissionsTab() {
  const { tenantId, project } = useProject();
  const forms = useQuery({ queryKey: ['forms', tenantId, project.key], queryFn: () => api.forms(tenantId, project.key) });
  const [key, setKey] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (forms.isPending) return <Loading />;
  if (forms.isError) return <ErrorNotice error={forms.error} />;
  if (!forms.data.length)
    return (
      <div className="border border-zinc-200 bg-snow">
        <Empty icon={ClipboardList} title="No forms yet">
          Create a form first; its submissions appear here.
        </Empty>
      </div>
    );
  const form = forms.data.find((f) => f.key === key) ?? forms.data[0]!;
  return (
    <Panel
      flush
      title="Submissions"
      actions={
        <Listbox
          compact
          align="end"
          label="Form"
          className="w-64"
          value={form.key}
          onChange={setKey}
          options={forms.data.map((f) => ({ value: f.key, label: f.name, description: `${f.submissionCount.toLocaleString()} submissions`, text: f.name }))}
        />
      }
    >
      <div className="p-4">
        <SubmissionsTable key={form.key} form={form} onOpen={setOpen} />
      </div>
      {open && <SubmissionSheet tenantId={tenantId} project={project.key} id={open} onClose={() => setOpen(null)} />}
    </Panel>
  );
}
