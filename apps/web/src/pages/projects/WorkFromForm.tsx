import { useQuery } from '@tanstack/react-query';
import { WORK_PRIORITIES, WORK_PRIORITY_LABEL, type FormSettings } from '@grids/schema';
import { Input, Listbox, Textarea } from '@grids/ui';
import { Ticket, Variable } from 'lucide-react';
import type { ReactNode } from 'react';
import { api } from '../../api';
import type { Draft } from './FormBuilder';
import { Card } from './PanelCard';
import { useProject } from './context';

/** A setting: its name and a line about it on the left, the control on the right. */
function Row({ label, intro, children }: { label: string; intro: string; children: ReactNode }) {
  return (
    <div className="grid items-start gap-x-8 gap-y-2 border-t border-zinc-100 pt-5 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div>
        <div className="text-[13px] font-medium text-zinc-700">{label}</div>
        <p className="mt-0.5 text-xs text-zinc-500">{intro}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Opens a ticket, a task or a visit for each submission, filled in from its answers. */
export function WorkFromSubmissions({ draft, setSettings }: { draft: Draft; setSettings(patch: Partial<FormSettings>): void }) {
  const { tenantId, project } = useProject();
  const types = useQuery({ queryKey: ['work-types', tenantId, project.key], queryFn: () => api.workTypes(tenantId, project.key) });
  const members = useQuery({ queryKey: ['project-members', tenantId, project.key], queryFn: () => api.projectMembers(tenantId, project.key) });
  const w = draft.settings.work;
  const set = (patch: Partial<typeof w>) => setSettings({ work: { ...w, ...patch } });
  const questions = draft.def.sections.flatMap((s) => s.questions).filter((q) => q.type !== 'note');
  const insert = (field: 'title' | 'description', key: string) => set({ [field]: `${w[field]}\${${key}}` });
  const answers = questions.map((q) => ({ value: q.key, label: q.label || q.key, description: q.key }));
  const insertMenu = (field: 'title' | 'description') => (
    <Listbox searchable label="Insert an answer" value={null} align="end" trigger={{ className: 'inline-flex h-7 items-center gap-1.5 text-xs font-medium text-accent-700 hover:underline', children: <><Variable className="size-3.5" /> Insert an answer</> }} options={answers} onChange={(k) => insert(field, k)} />
  );
  return (
    <Card title="Work from submissions" description="Open a ticket, task or visit for each submission, with the answers filled in. Works for forms people send through a link too." icon={Ticket}>
      <Row label="Open work of this kind" intro="Leave as none to keep submissions as they are">
        <Listbox
          label="Kind of work"
          value={w.type ?? '__none'}
          placeholder={types.isPending ? 'Loading…' : 'None'}
          options={[{ value: '__none', label: 'None' }, ...(types.data ?? []).map((t) => ({ value: t.key, label: t.name, description: t.description || undefined }))]}
          onChange={(v) => set({ type: v === '__none' ? null : v })}
        />
        {types.data && !types.data.length && <p className="mt-1.5 text-xs text-amber-700">This project has no work types yet. Add one under Work › Work types.</p>}
      </Row>
      {w.type && (
        <>
          <Row label="Title" intro="Leave blank to use the form’s name">
            <Input aria-label="Title of the work" value={w.title} maxLength={200} placeholder="e.g. Report from ${facility}" onChange={(e) => set({ title: e.target.value })} />
            <div className="mt-1.5">{insertMenu('title')}</div>
          </Row>
          <Row label="Details" intro="What the person who picks it up needs to know">
            <Textarea aria-label="Details of the work" value={w.description} maxLength={2000} className="min-h-20" onChange={(e) => set({ description: e.target.value })} />
            <div className="mt-1.5">{insertMenu('description')}</div>
          </Row>
          <Row label="Priority" intro="It sets the service times of the kind of work">
            <Listbox label="Priority" value={w.priority} options={WORK_PRIORITIES.map((p) => ({ value: p, label: WORK_PRIORITY_LABEL[p] }))} onChange={(priority) => set({ priority: priority as typeof w.priority })} />
          </Row>
          <Row label="Give it to" intro="Whoever should pick it up first">
            <Listbox label="Give it to" searchable value={w.assigneeId ?? '__none'} options={[{ value: '__none', label: 'Nobody: it waits to be taken' }, ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.name ?? m.email ?? 'Someone', description: m.email ?? undefined }))]} onChange={(v) => set({ assigneeId: v === '__none' ? null : v })} />
          </Row>
          <Row label="Due" intro="Hours after the submission arrives. Leave blank for no due date">
            <Input type="number" min={1} aria-label="Due in hours" placeholder="No due date" value={w.dueInHours ?? ''} onChange={(e) => set({ dueInHours: e.target.value === '' ? null : Math.max(1, Math.floor(Number(e.target.value)) || 1) })} />
          </Row>
        </>
      )}
    </Card>
  );
}
