import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WORK_PRIORITIES, WORK_PRIORITY_LABEL, type WorkPriority, type WorkScheduleDto } from '@grids/schema';
import { Button, Dialog, EmptyState, ErrorNotice, Field, Input, Listbox, Loading, SectionHead, Textarea, confirmDialog, dateTime } from '@grids/ui';
import { Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { useProject } from './context';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'k_$1').slice(0, 40);

interface Draft {
  name: string;
  type: string;
  title: string;
  description: string;
  priority: WorkPriority;
  entityType: string;
  everyDays: string;
  meterAttribute: string;
  meterEvery: string;
  leadDays: string;
  active: boolean;
}
const blank = (type = '', entityType = ''): Draft => ({ name: '', type, title: '', description: '', priority: 'normal', entityType, everyDays: '', meterAttribute: '', meterEvery: '', leadDays: '7', active: true });
const draftOf = (s: WorkScheduleDto): Draft => ({ name: s.name, type: s.type, title: s.title, description: s.description, priority: s.priority, entityType: s.entityType ?? '', everyDays: s.everyDays ? String(s.everyDays) : '', meterAttribute: s.meterAttribute ?? '', meterEvery: s.meterEvery ? String(s.meterEvery) : '', leadDays: String(s.leadDays), active: s.active });

const rhythm = (s: WorkScheduleDto) => [s.everyDays && `every ${s.everyDays} days`, s.meterEvery && `every ${s.meterEvery.toLocaleString()} ${s.meterAttribute}`].filter(Boolean).join(' or ');

/** Sets up work that comes round again: for every thing of a type, by the calendar and/or by use. */
function ScheduleDialog({ existing, onClose }: { existing: WorkScheduleDto | null; onClose(): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const workTypes = useQuery({ queryKey: ['work-types', tenantId, project.key], queryFn: () => api.workTypes(tenantId, project.key) });
  const entityTypes = useQuery({ queryKey: ['types', tenantId, project.key], queryFn: () => api.types(tenantId, project.key) });
  const [d, setD] = useState<Draft>(existing ? draftOf(existing) : blank());
  const patch = (p: Partial<Draft>) => setD({ ...d, ...p });
  const numeric = (entityTypes.data?.find((t) => t.key === d.entityType)?.attributes ?? []).filter((a) => a.type === 'number' || a.type === 'integer');
  const typeKey = d.type || workTypes.data?.[0]?.key || '';
  const days = Number(d.everyDays) || null;
  const meter = d.meterAttribute && Number(d.meterEvery) > 0 ? { meterAttribute: d.meterAttribute, meterEvery: Number(d.meterEvery) } : { meterAttribute: null, meterEvery: null };
  const save = useMutation({
    mutationFn: () =>
      api.saveWorkSchedule(
        tenantId,
        project.key,
        { key: existing?.key ?? (slug(d.name) || 'schedule'), name: d.name, type: typeKey, title: d.title || d.name, description: d.description, priority: d.priority, assigneeId: existing?.assigneeId ?? null, entityId: existing?.entityId ?? null, entityType: existing?.entityId ? null : d.entityType || null, everyDays: days, ...meter, leadDays: Number(d.leadDays) || 0, active: d.active },
        existing?.key,
      ),
    onSuccess: (list) => {
      qc.setQueryData(['work-schedules', tenantId, project.key], list);
      onClose();
    },
  });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : 'New recurring work'}
      description="Work that opens by itself when it falls due, and again each time the last one is finished."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!d.name.trim() || !typeKey || (!existing?.entityId && !d.entityType) || (!days && !meter.meterEvery)} onClick={() => save.mutate()}>
            {existing ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ErrorNotice error={save.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" intro="e.g. Routine service">
            <Input autoFocus value={d.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="Opens as" intro="The kind of work">
            <Listbox label="Opens as" value={typeKey} onChange={(v) => patch({ type: v })} options={(workTypes.data ?? []).map((t) => ({ value: t.key, label: t.name }))} />
          </Field>
        </div>
        <Field label="Title of each job" intro="${name} and ${code} are the thing it is for">
          <Input value={d.title} maxLength={200} placeholder={`${d.name || 'Service'} \${name}`} onChange={(e) => patch({ title: e.target.value })} />
        </Field>
        <Field label="Instructions" intro="Shown on every job">
          <Textarea value={d.description} maxLength={2000} className="min-h-16" onChange={(e) => patch({ description: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="For every" intro="Which things it applies to">
            {existing?.entityId ? (
              <div className="py-2 text-sm">{existing.entityName ?? 'One thing'}</div>
            ) : (
              <Listbox label="For every" value={d.entityType} onChange={(v) => patch({ entityType: v, meterAttribute: '' })} placeholder="Choose a type" options={(entityTypes.data ?? []).map((t) => ({ value: t.key, label: t.name }))} />
            )}
          </Field>
          <Field label="Priority">
            <Listbox label="Priority" value={d.priority} onChange={(v) => patch({ priority: v as WorkPriority })} options={WORK_PRIORITIES.map((p) => ({ value: p, label: WORK_PRIORITY_LABEL[p] }))} />
          </Field>
        </div>
        <div className="grid gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-3">
          <Field label="Every (days)" intro="By the calendar">
            <Input type="number" min={1} value={d.everyDays} onChange={(e) => patch({ everyDays: e.target.value })} />
          </Field>
          <Field label="Or by use" intro="A number that keeps rising">
            <Listbox label="Or by use" value={d.meterAttribute} onChange={(v) => patch({ meterAttribute: v })} placeholder="None" options={[{ value: '', label: 'None' }, ...numeric.map((a) => ({ value: a.key, label: a.label }))]} />
          </Field>
          <Field label="Every (amount)" intro={d.meterAttribute ? 'e.g. 10000 km' : 'Pick a number first'}>
            <Input type="number" min={1} disabled={!d.meterAttribute} value={d.meterEvery} onChange={(e) => patch({ meterEvery: e.target.value })} />
          </Field>
        </div>
        <Field label="Open early (days)" intro="How long before the date to raise the job">
          <Input type="number" min={0} max={365} className="max-w-32" value={d.leadDays} onChange={(e) => patch({ leadDays: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={d.active} onChange={(e) => patch({ active: e.target.checked })} /> Active
        </label>
      </div>
    </Dialog>
  );
}

/** Recurring work: what comes round again, and when it is next due. */
export function WorkSchedulesTab() {
  const { tenantId, project, can } = useProject();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['work-schedules', tenantId, project.key], queryFn: () => api.workSchedules(tenantId, project.key) });
  const [editing, setEditing] = useState<WorkScheduleDto | 'new' | null>(null);
  const remove = useMutation({ mutationFn: (key: string) => api.deleteWorkSchedule(tenantId, project.key, key), onSuccess: (l) => qc.setQueryData(['work-schedules', tenantId, project.key], l) });
  if (list.isPending) return <Loading />;
  const manage = can('manager');
  return (
    <div className="space-y-4">
      <SectionHead
        title="Recurring work"
        description="Services, inspections and checks that open by themselves, by the calendar or by use."
        actions={
          manage && (
            <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
              New schedule
            </Button>
          )
        }
      />
      <ErrorNotice error={list.error ?? remove.error} />
      {!list.data?.length ? (
        <EmptyState icon={Repeat} title="Nothing recurring yet">
          Set up a service every six months, or every 10,000 km, and the job appears when it is due.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.data.map((s) => (
            <li key={s.id} className="flex flex-col gap-2 border border-zinc-200 bg-snow p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center bg-zinc-100 text-zinc-700">
                  <Repeat className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {s.name} {!s.active && <span className="ml-1 text-xs font-normal text-zinc-500">Paused</span>}
                  </div>
                  <div className="text-xs text-zinc-500">{rhythm(s)}</div>
                </div>
                {manage && (
                  <>
                    <button type="button" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)} className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink">
                      <Pencil className="size-4" />
                    </button>
                    <button type="button" aria-label={`Delete ${s.name}`} onClick={async () => (await confirmDialog(`Delete "${s.name}"? Work already opened stays.`, { confirmLabel: 'Delete', danger: true })) && remove.mutate(s.key)} className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-700">
                      <Trash2 className="size-4" />
                    </button>
                  </>
                )}
              </div>
              <p className="text-sm text-zinc-600">
                Opens “{s.title}” as {s.type}, for {s.entityName ?? `every ${s.entityType}`}.
              </p>
              <p className="text-xs text-zinc-500">
                {s.targets} tracked{s.nextDueAt ? ` · next due ${dateTime(s.nextDueAt)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      {editing && <ScheduleDialog existing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
