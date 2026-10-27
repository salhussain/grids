import { useQuery } from '@tanstack/react-query';
import { ErrorNotice, Listbox, Loading, SectionHead, EmptyState } from '@grids/ui';
import { ClipboardList } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { SubmissionSheet } from '../forms/SubmissionSheet';
import { useProject } from './context';
import { SubmissionsTable } from './FormsTab';
import { PermissionGroupsPanel } from './permissions';
import { Members, Types } from './SettingsTab';

export function MembersTab() {
  return <Members />;
}

export function PermissionGroupsTab() {
  return <PermissionGroupsPanel />;
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
  if (forms.isPending)
    return (
      <div>
        <SectionHead title="Submissions" description="Everything collected through this project’s forms, one form at a time." />
        <Loading />
      </div>
    );
  if (forms.isError) return <ErrorNotice error={forms.error} />;
  if (!forms.data.length)
    return (
      <EmptyState icon={ClipboardList} title="No forms yet">
        Create and publish a form first. Every answer people submit to it is listed here.
      </EmptyState>
    );
  const form = forms.data.find((f) => f.key === key) ?? forms.data[0]!;
  return (
    <>
      <SectionHead title="Submissions" description="Everything collected through this project’s forms, one form at a time." actions={
        <Listbox
          compact
          align="end"
          label="Form"
          className="w-64"
          value={form.key}
          onChange={setKey}
          options={forms.data.map((f) => ({ value: f.key, label: f.name, description: `${f.submissionCount.toLocaleString()} submissions`, text: f.name }))}
        />
      } />
      <SubmissionsTable key={form.key} form={form} onOpen={setOpen} />
      {open && <SubmissionSheet tenantId={tenantId} project={project.key} id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
