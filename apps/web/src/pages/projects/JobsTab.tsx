import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { JobInput, type JobDto, type RunDto, type RunStatus } from '@grids/schema';
import {
  Button,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
  Input,
  Pagination,
  Panel,
  RefreshControl,
  Select,
  SwitchField,
  Table,
  Td,
  Textarea,
  cx,
  dateTime,
  relTime,
  useLiveInterval,
  usePagination,
  useToast,
} from '@grids/ui';
import { CircleCheck, CircleX, Clock, Loader, Pencil, Play, Plus, Workflow, XCircle } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { FreshnessBadge } from '../../viz/Freshness';
import { useProject } from './context';

const STATUS: Record<RunStatus, { icon: typeof Clock; cls: string; label: string }> = {
  queued: { icon: Clock, cls: 'text-zinc-500', label: 'Queued' },
  running: { icon: Loader, cls: 'text-accent-700 [&>svg]:animate-spin', label: 'Running' },
  succeeded: { icon: CircleCheck, cls: 'text-emerald-700', label: 'Succeeded' },
  failed: { icon: CircleX, cls: 'text-red-700', label: 'Failed' },
  cancelled: { icon: XCircle, cls: 'text-zinc-500', label: 'Cancelled' },
};
export function RunStatusBadge({ status }: { status: RunStatus }) {
  const s = STATUS[status];
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-sm font-medium', s.cls)}>
      <s.icon className="size-4" /> {s.label}
    </span>
  );
}

const cronText = (cron: string | null) => {
  if (!cron) return 'Manual only';
  const m = cron.match(/^\*\/(\d+) \* \* \* \*$/);
  if (m) return `Every ${m[1]} minutes`;
  if (cron === '0 * * * *') return 'Hourly';
  if (/^\d+ \d+ \* \* \*$/.test(cron)) return `Daily at ${cron.split(' ')[1]!.padStart(2, '0')}:${cron.split(' ')[0]!.padStart(2, '0')}`;
  return cron;
};
const duration = (ms: number | null) => (ms === null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function JobsTab() {
  const { tenantId, project, can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const interval = useLiveInterval();
  const jobs = useQuery({ queryKey: ['jobs', tenantId, project.key], queryFn: () => api.jobs(tenantId, project.key), refetchInterval: interval });
  const [status, setStatus] = useState<string>('');
  const [pg, setPg] = usePagination([status], 25);
  const runs = useQuery({
    queryKey: ['runs', tenantId, project.key, status, pg],
    queryFn: () => api.runs(tenantId, project.key, { ...pg, status: status || undefined }),
    placeholderData: keepPreviousData,
    refetchInterval: interval,
  });
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [editing, setEditing] = useState<JobDto | 'new' | null>(null);
  const run = useMutation({
    mutationFn: (key: string) => api.runJob(tenantId, project.key, key),
    onSuccess: (r) => {
      toast(`${r.jobName} queued`);
      void qc.invalidateQueries({ queryKey: ['runs', tenantId, project.key] });
      void qc.invalidateQueries({ queryKey: ['jobs', tenantId, project.key] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-600">Pipelines that pull data in, map it to entities and observations, and keep datasets fresh.</p>
        <div className="flex items-center gap-2">
          <RefreshControl queryKeys={[['jobs', tenantId, project.key], ['runs', tenantId, project.key]]} />
          {can('manager') && (
            <Button icon={Plus} onClick={() => setEditing('new')}>
              New job
            </Button>
          )}
        </div>
      </div>
      <ErrorNotice error={jobs.error ?? run.error} />
      {jobs.data && !jobs.data.length ? (
        <div className="border border-zinc-200 bg-snow">
          <Empty icon={Workflow} title="No jobs yet">
            A job fetches from an API or file, transforms rows, and writes entities, observations or datasets on a schedule.
          </Empty>
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {jobs.data?.map((j) => (
            <li key={j.key} className="border border-zinc-200 bg-snow p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold">{j.name}</h3>
                  <p className="mt-0.5 text-sm text-zinc-500">{j.description || `${j.steps.length} steps`}</p>
                </div>
                <FreshnessBadge value={j.freshness} compact />
              </div>
              <ol className="mt-4 flex flex-wrap items-center gap-1 text-xs">
                {j.steps.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-1">
                    {i > 0 && <span className="text-zinc-400">→</span>}
                    <span className="border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono" title={s.label}>
                      {s.type}
                    </span>
                  </li>
                ))}
              </ol>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-zinc-500">Schedule</dt>
                  <dd>{j.enabled ? cronText(j.schedule) : 'Paused'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Next run</dt>
                  <dd>{j.nextRunAt ? relTime(j.nextRunAt) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Last run</dt>
                  <dd>{j.lastRun ? <button type="button" className="hover:underline" onClick={() => setOpenRun(j.lastRun!.id)}><RunStatusBadge status={j.lastRun.status} /></button> : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Success (7 days)</dt>
                  <dd className="num">{j.successRate === null ? '—' : `${Math.round(j.successRate * 100)}%`}</dd>
                </div>
              </dl>
              <div className="mt-4 flex gap-2 border-t border-zinc-100 pt-4">
                {can('editor') && (
                  <Button size="sm" icon={Play} onClick={() => run.mutate(j.key)} loading={run.isPending && run.variables === j.key}>
                    Run now
                  </Button>
                )}
                {can('manager') && (
                  <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(j)}>
                    Edit
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Panel
        flush
        title="Runs"
        actions={
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        }
      >
        <Table head={['Job', 'Status', 'Trigger', 'Queued', 'Duration', 'Result']} empty={<Empty icon={Clock} title="No runs yet" />}>
          {runs.data?.items.map((r) => (
            <tr key={r.id} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50" onClick={() => setOpenRun(r.id)}>
              <Td className="font-medium">{r.jobName}</Td>
              <Td>
                <RunStatusBadge status={r.status} />
              </Td>
              <Td className="text-zinc-600">
                {r.trigger}
                {r.attempt > 1 && ` · attempt ${r.attempt}`}
              </Td>
              <Td className="text-xs">{dateTime(r.queuedAt)}</Td>
              <Td className="num">{duration(r.durationMs)}</Td>
              <Td className="max-w-sm truncate text-xs text-zinc-500">{r.error ?? summary(r)}</Td>
            </tr>
          ))}
        </Table>
        {runs.data && <Pagination {...pg} total={runs.data.total} onChange={setPg} />}
      </Panel>
      {openRun && <RunDialog runId={openRun} onClose={() => setOpenRun(null)} />}
      {editing && <JobEditor job={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const summary = (r: RunDto) =>
  Object.entries(r.stats)
    .filter(([k, v]) => k !== 'duration_ms' && v)
    .map(([k, v]) => `${v.toLocaleString()} ${k.replace(/_/g, ' ')}`)
    .join(' · ');

function RunDialog({ runId, onClose }: { runId: string; onClose(): void }) {
  const { tenantId, project, can } = useProject();
  const qc = useQueryClient();
  const r = useQuery({
    queryKey: ['run', tenantId, project.key, runId],
    queryFn: () => api.run(tenantId, project.key, runId),
    refetchInterval: (q) => (q.state.data && ['queued', 'running'].includes(q.state.data.status) ? 2000 : false),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelRun(tenantId, project.key, runId),
    onSuccess: (d) => {
      qc.setQueryData(['run', tenantId, project.key, runId], d);
      void qc.invalidateQueries({ queryKey: ['runs', tenantId, project.key] });
    },
  });
  const d = r.data;
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={d ? `${d.jobName} · run` : 'Run'}
      footer={d && ['queued', 'running'].includes(d.status) && can('editor') ? <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>Cancel run</Button> : undefined}
    >
      <ErrorNotice error={r.error ?? cancel.error} />
      {d && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <RunStatusBadge status={d.status} />
            <span>{d.trigger}{d.attempt > 1 && ` · attempt ${d.attempt}`}</span>
            <span>Started {dateTime(d.startedAt)}</span>
            <span>Duration {duration(d.durationMs)}</span>
          </div>
          {Object.keys(d.stats).length > 0 && (
            <dl className="grid grid-cols-2 gap-px border border-zinc-200 bg-zinc-200 sm:grid-cols-4">
              {Object.entries(d.stats)
                .filter(([k]) => k !== 'duration_ms')
                .map(([k, v]) => (
                  <div key={k} className="bg-snow px-3 py-2">
                    <dd className="num text-lg font-semibold">{v.toLocaleString()}</dd>
                    <dt className="text-xs text-zinc-500">{k.replace(/_/g, ' ')}</dt>
                  </div>
                ))}
            </dl>
          )}
          <div className="max-h-[50vh] overflow-auto border border-zinc-200 bg-zinc-50 font-mono text-xs" role="log" aria-label="Run log">
            {d.logs.map((l, i) => (
              <div key={i} className={cx('flex gap-3 border-b border-zinc-100 px-3 py-1.5', l.level === 'error' && 'bg-red-50 text-red-800', l.level === 'warn' && 'text-amber-800')}>
                <span className="shrink-0 text-zinc-400">{new Date(l.at).toLocaleTimeString()}</span>
                <span className="w-24 shrink-0 truncate text-zinc-500">{l.step ?? 'run'}</span>
                <span className="whitespace-pre-wrap">{l.message}</span>
              </div>
            ))}
            {!d.logs.length && <p className="px-3 py-4 text-zinc-500">Waiting for a worker…</p>}
          </div>
        </div>
      )}
    </Dialog>
  );
}

const STARTER = [
  { id: 'fetch', type: 'http.extract', url: 'https://example.org/data.json', rows: '$' },
  { id: 'items', type: 'entity.upsert', entityType: 'site', code: 'id', name: 'name', attributes: {} },
];

/** Job settings plus its steps as JSON (validated by the API's schema). */
function JobEditor({ job, onClose }: { job: JobDto | null; onClose(): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState({
    key: job?.key ?? '',
    name: job?.name ?? '',
    description: job?.description ?? '',
    schedule: job?.schedule ?? '',
    timezone: job?.timezone ?? 'UTC',
    enabled: job?.enabled ?? true,
    maxRetries: job?.maxRetries ?? 2,
    timeoutSeconds: job?.timeoutSeconds ?? 300,
    freshnessMinutes: job?.freshnessMinutes ?? null,
  });
  const [steps, setSteps] = useState(JSON.stringify(job?.steps ?? STARTER, null, 2));
  const [local, setLocal] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const input = { ...f, schedule: f.schedule.trim() || null, steps: JSON.parse(steps) };
      const parsed = JobInput.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
      return api.saveJob(tenantId, project.key, input, job?.key);
    },
    onSuccess: (data) => {
      qc.setQueryData(['jobs', tenantId, project.key], data);
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteJob(tenantId, project.key, job!.key),
    onSuccess: (data) => {
      qc.setQueryData(['jobs', tenantId, project.key], data);
      onClose();
    },
  });
  const check = (text: string) => {
    setSteps(text);
    try {
      JSON.parse(text);
      setLocal(null);
    } catch (e) {
      setLocal((e as Error).message);
    }
  };
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={job ? `Edit ${job.name}` : 'New job'}
      footer={
        <>
          {job && (
            <Button variant="danger" className="me-auto" onClick={() => confirm(`Delete ${job.name} and its run history?`) && remove.mutate()}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!!local || !f.key || !f.name}>
            Save job
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error ?? remove.error} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, key: job ? f.key : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') })} />
          </Field>
          <Field label="Key">
            <Input value={f.key} disabled={!!job} onChange={(e) => setF({ ...f, key: e.target.value })} className="font-mono" />
          </Field>
          <Field label="Schedule (cron)" hint="e.g. */15 * * * * · blank = manual">
            <Input value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })} className="font-mono" />
          </Field>
          <Field label="Time zone">
            <Input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />
          </Field>
          <Field label="Expected every (minutes)" hint="Drives the freshness badge">
            <Input type="number" min={1} value={f.freshnessMinutes ?? ''} onChange={(e) => setF({ ...f, freshnessMinutes: e.target.value ? Number(e.target.value) : null })} />
          </Field>
          <Field label="Retries">
            <Input type="number" min={0} max={10} value={f.maxRetries} onChange={(e) => setF({ ...f, maxRetries: Number(e.target.value) })} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <div className="flex items-end pb-1">
            <SwitchField label="Enabled" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
          </div>
        </div>
        <Field
          label="Steps (JSON)"
          error={local ?? undefined}
          hint="Types: http.extract · transform · filter · entity.upsert · observation.write · dataset.write. Field mappings are JSONata expressions over each row."
        >
          <Textarea value={steps} onChange={(e) => check(e.target.value)} className="min-h-80 font-mono text-xs" spellCheck={false} />
        </Field>
      </div>
    </Dialog>
  );
}
