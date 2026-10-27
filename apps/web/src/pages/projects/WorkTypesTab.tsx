import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { DEFAULT_WORK_STATES, WORK_PRIORITIES, WORK_PRIORITY_LABEL, type WorkState, type WorkTypeDto } from '@grids/schema';
import { Button, Dialog, EmptyState, ErrorNotice, Field, Input, Listbox, Loading, SectionHead, Textarea, confirmDialog, cx } from '@grids/ui';
import { ArrowDown, ArrowLeft, ArrowUp, Pencil, Plus, Ticket, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { IconPicker } from './fields';
import { iconOf, useProject } from './context';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'k_$1').slice(0, 40);
const KIND_LABEL: Record<WorkState['kind'], string> = { open: 'Waiting to be picked up', active: 'Being worked on', done: 'Finished' };
const COLORS = ['#0f62fe', '#6929c4', '#007d79', '#c2561f', '#a2191f', '#161616'];

interface Draft {
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  prefix: string;
  states: WorkState[];
  respond: Record<string, string>;
  resolve: Record<string, string>;
}
const blank = (): Draft => ({ key: '', name: '', description: '', icon: 'ticket', color: COLORS[0]!, prefix: '', states: DEFAULT_WORK_STATES.map((s) => ({ ...s })), respond: {}, resolve: {} });
const draftOf = (t: WorkTypeDto): Draft => ({
  key: t.key,
  name: t.name,
  description: t.description,
  icon: t.icon,
  color: t.color,
  prefix: t.prefix,
  states: t.states.map((s) => ({ ...s })),
  respond: Object.fromEntries(Object.entries(t.sla.respondHours).map(([k, v]) => [k, String(v)])),
  resolve: Object.fromEntries(Object.entries(t.sla.resolveHours).map(([k, v]) => [k, String(v)])),
});
const hours = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));

/** Sets up one kind of work: its look, the states it moves through, and how fast it should be answered and finished. */
function TypeDialog({ existing, onClose }: { existing: WorkTypeDto | null; onClose(): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(existing ? draftOf(existing) : blank());
  const patch = (p: Partial<Draft>) => setD({ ...d, ...p });
  const setState = (i: number, p: Partial<WorkState>) => patch({ states: d.states.map((s, n) => (n === i ? { ...s, ...p } : s)) });
  const move = (i: number, by: number) => {
    const next = [...d.states];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x!);
    patch({ states: next });
  };
  const save = useMutation({
    mutationFn: () =>
      api.saveWorkType(
        tenantId,
        project.key,
        { key: existing?.key ?? (slug(d.name) || 'work'), name: d.name, description: d.description, icon: d.icon, color: d.color, prefix: d.prefix || d.name.slice(0, 3) || 'W', states: d.states.map((s) => ({ ...s, key: s.key || slug(s.label) || 'state' })), sla: { respondHours: hours(d.respond), resolveHours: hours(d.resolve) } },
        existing?.key,
      ),
    onSuccess: (list) => {
      qc.setQueryData(['work-types', tenantId, project.key], list);
      onClose();
    },
  });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : 'New kind of work'}
      description="What it is called, the states it moves through, and how fast it should be answered and finished."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!d.name.trim() || d.states.length < 2} onClick={() => save.mutate()}>
            {existing ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <ErrorNotice error={save.error} />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Field label="Name" intro="e.g. Ticket, Task, Vehicle service">
            <Input autoFocus value={d.name} maxLength={60} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="Number prefix" intro="TKT-12">
            <Input value={d.prefix} maxLength={6} className="uppercase" placeholder={(d.name.slice(0, 3) || 'W').toUpperCase()} onChange={(e) => patch({ prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
          </Field>
        </div>
        <Field label="Description" intro="What it is for">
          <Textarea value={d.description} maxLength={300} onChange={(e) => patch({ description: e.target.value })} className="min-h-16" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <IconPicker label="Icon" value={d.icon} onChange={(icon) => patch({ icon })} color={d.color} />
          <div>
            <div className="mb-1.5 text-xs font-medium tracking-wide text-zinc-600">Colour</div>
            <div className="flex flex-wrap items-center gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={c} aria-pressed={d.color === c} onClick={() => patch({ color: c })} className={cx('size-8 border-2 border-snow', d.color === c ? 'ring-2 ring-ink' : 'ring-1 ring-zinc-300')} style={{ background: c }} />
              ))}
              <label className="relative flex size-8 cursor-pointer items-center justify-center border border-dashed border-zinc-400 text-xs text-zinc-500" title="Any colour">
                +
                <input type="color" aria-label="Pick a colour" className="absolute inset-0 cursor-pointer opacity-0" value={d.color} onChange={(e) => patch({ color: e.target.value })} />
              </label>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1 text-[13px] font-medium text-zinc-700">States</div>
          <p className="mb-2 text-xs text-zinc-500">Work starts in the first state that is waiting to be picked up, and counts as finished in any finished state.</p>
          <ul className="divide-y divide-zinc-100 border border-zinc-200">
            {d.states.map((s, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)_auto] items-center gap-2 p-2">
                <Input aria-label="State name" value={s.label} maxLength={40} onChange={(e) => setState(i, { label: e.target.value, ...(!existing?.states.some((x) => x.key === s.key) && { key: slug(e.target.value) }) })} />
                <Listbox compact label="Kind" value={s.kind} options={(Object.keys(KIND_LABEL) as WorkState['kind'][]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} onChange={(kind) => setState(i, { kind: kind as WorkState['kind'] })} />
                <span className="flex">
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30">
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" aria-label="Move down" disabled={i === d.states.length - 1} onClick={() => move(i, 1)} className="p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30">
                    <ArrowDown className="size-4" />
                  </button>
                  <button type="button" aria-label="Remove" disabled={d.states.length <= 2} onClick={() => patch({ states: d.states.filter((_, n) => n !== i) })} className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-700 disabled:opacity-30">
                    <Trash2 className="size-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {d.states.length < 10 && (
            <Button size="sm" variant="secondary" icon={Plus} className="mt-2" onClick={() => patch({ states: [...d.states, { key: `state_${d.states.length + 1}`, label: '', kind: 'active' }] })}>
              Add a state
            </Button>
          )}
        </div>

        <div>
          <div className="mb-1 text-[13px] font-medium text-zinc-700">Service times</div>
          <p className="mb-2 text-xs text-zinc-500">How many hours people have to answer, and to finish, for each priority. Leave blank for no deadline. Work past its time is flagged.</p>
          <div className="border border-zinc-200">
            <div className="grid grid-cols-[6rem_1fr_1fr] gap-3 bg-zinc-50 px-3 py-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
              <span>Priority</span>
              <span>Answer within (hours)</span>
              <span>Finish within (hours)</span>
            </div>
            {WORK_PRIORITIES.map((p) => (
              <div key={p} className="grid grid-cols-[6rem_1fr_1fr] items-center gap-3 border-t border-zinc-100 px-3 py-2">
                <span className="text-sm">{WORK_PRIORITY_LABEL[p]}</span>
                <Input type="number" min={0} step="any" aria-label={`${WORK_PRIORITY_LABEL[p]}: answer within`} value={d.respond[p] ?? ''} onChange={(e) => patch({ respond: { ...d.respond, [p]: e.target.value } })} />
                <Input type="number" min={0} step="any" aria-label={`${WORK_PRIORITY_LABEL[p]}: finish within`} value={d.resolve[p] ?? ''} onChange={(e) => patch({ resolve: { ...d.resolve, [p]: e.target.value } })} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** The kinds of work a project tracks: tickets, tasks, visits, maintenance. */
export function WorkTypesTab() {
  const { tenantId, project, base } = useProject();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const types = useQuery({ queryKey: ['work-types', tenantId, project.key], queryFn: () => api.workTypes(tenantId, project.key) });
  const [editing, setEditing] = useState<WorkTypeDto | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (key: string) => api.deleteWorkType(tenantId, project.key, key),
    onSuccess: (list) => qc.setQueryData(['work-types', tenantId, project.key], list),
  });
  if (types.isPending) return <Loading />;
  return (
    <div className="space-y-4">
      <SectionHead
        title="Work types"
        description="What this project tracks as work, the states each moves through, and how fast it should be answered and finished."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={ArrowLeft} onClick={() => void navigate({ to: `${base}/work` })}>
              Work
            </Button>
            <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
              New type
            </Button>
          </div>
        }
      />
      <ErrorNotice error={types.error ?? remove.error} />
      {!types.data?.length ? (
        <EmptyState icon={Ticket} title="No work types yet">
          A type is a kind of work, like a ticket or a vehicle service. It sets the states work moves through and the time allowed.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {types.data.map((t) => {
            const I = iconOf(t.icon);
            return (
              <li key={t.id} className="flex flex-col gap-3 border border-zinc-200 bg-snow p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center text-white" style={{ background: t.color }}>
                    <I className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-zinc-500">
                      <span className="font-mono">{t.prefix}-</span> · {t.openCount} not finished
                    </div>
                  </div>
                  <button type="button" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)} className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink">
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${t.name}`}
                    onClick={async () => (await confirmDialog(`Delete the type "${t.name}"? This cannot be undone.`, { confirmLabel: 'Delete', danger: true })) && remove.mutate(t.key)}
                    className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-700"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {t.description && <p className="text-sm text-zinc-600">{t.description}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {t.states.map((s) => (
                    <span key={s.key} className={cx('inline-flex h-[22px] items-center px-2 text-xs', s.kind === 'done' ? 'bg-emerald-100 text-emerald-900' : s.kind === 'active' ? 'bg-sky-50 text-sky-800 ring-1 ring-sky-200' : 'bg-zinc-100 text-zinc-700')}>
                      {s.label}
                    </span>
                  ))}
                </div>
                {(Object.keys(t.sla.respondHours).length > 0 || Object.keys(t.sla.resolveHours).length > 0) && (
                  <p className="text-xs text-zinc-500">
                    Service times:{' '}
                    {WORK_PRIORITIES.filter((p) => t.sla.respondHours[p] || t.sla.resolveHours[p])
                      .map((p) => `${WORK_PRIORITY_LABEL[p]} ${t.sla.respondHours[p] ? `answer ${t.sla.respondHours[p]} h` : ''}${t.sla.respondHours[p] && t.sla.resolveHours[p] ? ', ' : ''}${t.sla.resolveHours[p] ? `finish ${t.sla.resolveHours[p]} h` : ''}`)
                      .join(' · ')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <TypeDialog existing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
