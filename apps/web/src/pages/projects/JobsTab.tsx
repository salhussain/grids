import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FILE_MAX_BYTES, JOB_EVENTS, JobInput, type JobDto, type JobEvent, type RunDto, type RunStatus, type UploadResult } from '@grids/schema';
import {
  Button,
  CopyField,
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
import { CircleCheck, CircleX, Clock, Loader, FileUp, Pencil, Play, Plus, Radar, RotateCcw, Trash2, Upload, Webhook, Workflow, Zap, XCircle } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { env } from '../../env';
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
              <TriggerChips job={j} />
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-zinc-500">Schedule</dt>
                  <dd>{!j.enabled ? 'Paused' : !j.schedule && (j.triggers.events.length || j.triggers.webhook || j.sensor || j.runOnUpload) ? 'Triggers only' : cronText(j.schedule)}</dd>
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
      <FilesPanel onRun={setOpenRun} />
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
      {openRun && <RunDialog runId={openRun} onClose={() => setOpenRun(null)} onOpen={setOpenRun} />}
      {editing && <JobEditor job={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const EVENT_INFO: Record<JobEvent, { label: string; ref: string }> = {
  'submission.created': { label: 'A form is submitted', ref: 'Form' },
  'entity.changed': { label: 'Entities change', ref: 'Entity type' },
  'dataset.materialised': { label: 'A dataset is refreshed', ref: 'Dataset' },
  'job.succeeded': { label: 'Another job succeeds', ref: 'Job' },
  'job.failed': { label: 'Another job fails', ref: 'Job' },
};

/** What starts a job besides its schedule: events, webhook, sensor, uploads. */
function TriggerChips({ job }: { job: JobDto }) {
  const chips: { icon: typeof Zap; text: string; title?: string; tone?: 'bad' }[] = [];
  for (const e of job.triggers.events) chips.push({ icon: Zap, text: `${EVENT_INFO[e.event].label}${e.ref ? `: ${e.ref}` : ''}` });
  if (job.triggers.webhook) chips.push({ icon: Webhook, text: 'Webhook' });
  if (job.sensor)
    chips.push({
      icon: Radar,
      text: `Sensor every ${job.sensor.everyMinutes} min${job.sensorState?.lastCheckedAt ? ` · checked ${relTime(job.sensorState.lastCheckedAt)}` : ''}`,
      title: job.sensorState?.lastError ?? job.sensor.url,
      tone: job.sensorState?.lastError ? 'bad' : undefined,
    });
  if (job.runOnUpload) chips.push({ icon: FileUp, text: 'On file upload' });
  if (!chips.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5 text-xs">
      {chips.map((c) => (
        <li key={c.text} title={c.title} className={cx('inline-flex items-center gap-1 border px-1.5 py-0.5', c.tone === 'bad' ? 'border-red-300 bg-red-50 text-red-800' : 'border-accent-100 bg-accent-50 text-accent-800')}>
          <c.icon className="size-3" /> {c.text}
        </li>
      ))}
    </ul>
  );
}

function TriggersEditor({
  value,
  webhookPath,
  onChange,
}: {
  value: { triggers: JobDto['triggers']; sensor: JobDto['sensor'] };
  webhookPath: string | null;
  onChange(v: { triggers: JobDto['triggers']; sensor: JobDto['sensor'] }): void;
}) {
  const { tenantId, project } = useProject();
  const forms = useQuery({ queryKey: ['forms', tenantId, project.key], queryFn: () => api.forms(tenantId, project.key) });
  const types = useQuery({ queryKey: ['types', tenantId, project.key], queryFn: () => api.types(tenantId, project.key) });
  const datasets = useQuery({ queryKey: ['datasets', tenantId, project.key], queryFn: () => api.datasets(tenantId, project.key) });
  const jobs = useQuery({ queryKey: ['jobs', tenantId, project.key], queryFn: () => api.jobs(tenantId, project.key) });
  const { triggers: t, sensor } = value;
  const refs = (e: JobEvent): { key: string; name: string }[] =>
    e === 'submission.created'
      ? (forms.data ?? []).map((x) => ({ key: x.key, name: x.name }))
      : e === 'entity.changed'
        ? (types.data ?? []).map((x) => ({ key: x.key, name: x.plural }))
        : e === 'dataset.materialised'
          ? (datasets.data ?? []).map((x) => ({ key: x.key, name: x.name }))
          : (jobs.data ?? []).map((x) => ({ key: x.key, name: x.name }));
  const setEvents = (events: JobDto['triggers']['events']) => onChange({ ...value, triggers: { ...t, events } });
  return (
    <fieldset className="space-y-4 border border-zinc-200 p-4">
      <legend className="px-1 text-sm font-medium">Triggers</legend>
      <div className="space-y-2">
        <div className="text-xs font-medium text-zinc-600">Run when…</div>
        {t.events.map((e, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select aria-label="Event" value={e.event} onChange={(x) => setEvents(t.events.map((y, j) => (j === i ? { event: x.target.value as JobEvent } : y)))} className="w-56">
              {JOB_EVENTS.map((ev) => (
                <option key={ev} value={ev}>
                  {EVENT_INFO[ev].label}
                </option>
              ))}
            </Select>
            <Select aria-label={EVENT_INFO[e.event].ref} value={e.ref ?? ''} onChange={(x) => setEvents(t.events.map((y, j) => (j === i ? { ...y, ref: x.target.value || undefined } : y)))} className="w-56">
              <option value="">Any {EVENT_INFO[e.event].ref.toLowerCase()}</option>
              {refs(e.event).map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </Select>
            <button type="button" aria-label="Remove trigger" onClick={() => setEvents(t.events.filter((_, j) => j !== i))} className="p-1 text-zinc-500 hover:text-red-700">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEvents([...t.events, { event: 'submission.created' }])} disabled={t.events.length >= 10}>
          Add event
        </Button>
        <p className="text-xs text-zinc-500">
          Expressions can read the event as <code className="font-mono">$event</code> (e.g. <code className="font-mono">$event.submission</code>).
        </p>
      </div>
      <div className="grid gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-2">
        <div className="space-y-2">
          <SwitchField
            label="Webhook"
            description="Other systems POST JSON to a secret URL; the body (an array, or { rows: [...] }) becomes the job’s rows."
            checked={t.webhook}
            onChange={(v) => onChange({ ...value, triggers: { ...t, webhook: v } })}
          />
          {t.webhook && (webhookPath ? <CopyField value={`${env.apiUrl}${webhookPath}`} /> : <p className="text-xs text-zinc-500">Save the job to get its URL.</p>)}
        </div>
        <div className="space-y-2">
          <SwitchField
            label="Sensor"
            description="Poll a URL and run when it changes."
            checked={!!sensor}
            onChange={(v) => onChange({ ...value, sensor: v ? { url: 'https://example.org/feed.json', headers: {}, everyMinutes: 5 } : null })}
          />
          {sensor && (
            <div className="grid gap-2 sm:grid-cols-[1fr_7rem]">
              <Field label="URL">
                <Input value={sensor.url} onChange={(e) => onChange({ ...value, sensor: { ...sensor, url: e.target.value } })} />
              </Field>
              <Field label="Every (min)">
                <Input type="number" min={1} max={1440} value={sensor.everyMinutes} onChange={(e) => onChange({ ...value, sensor: { ...sensor, everyMinutes: Number(e.target.value) } })} />
              </Field>
              <Field label="Cursor (JSONata, optional)" hint="Runs when this value changes, e.g. $max(items.updated_at). Blank: when the response changes." className="sm:col-span-2">
                <Input value={sensor.cursor ?? ''} onChange={(e) => onChange({ ...value, sensor: { ...sensor, cursor: e.target.value || undefined } })} className="font-mono" />
              </Field>
            </div>
          )}
        </div>
      </div>
    </fieldset>
  );
}

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Uploaded files that `file.parse` steps read (latest version per key). */
function FilesPanel({ onRun }: { onRun(id: string): void }) {
  const { tenantId, project, can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const files = useQuery({ queryKey: ['files', tenantId, project.key], queryFn: () => api.files(tenantId, project.key) });
  const [uploading, setUploading] = useState<string | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (key: string) => api.deleteFile(tenantId, project.key, key),
    onSuccess: (data) => qc.setQueryData(['files', tenantId, project.key], data),
  });
  if (!files.data?.length && !can('editor')) return null;
  return (
    <Panel
      flush
      title="Files"
      actions={
        can('editor') && (
          <Button size="sm" variant="secondary" icon={Upload} onClick={() => setUploading('new')}>
            Upload file
          </Button>
        )
      }
    >
      <ErrorNotice error={files.error ?? remove.error} />
      <Table head={['Key', 'File', 'Size', 'Uploaded', 'Used by', '']} empty={<Empty icon={FileUp} title="No files yet">Upload CSV or JSON files for jobs to parse with a file.parse step.</Empty>}>
        {files.data?.map((f) => (
          <tr key={f.key} className="border-t border-zinc-100">
            <Td className="font-mono text-xs">{f.key}</Td>
            <Td>
              {f.name}
              {f.versions > 1 && <span className="text-xs text-zinc-500"> · {f.versions} versions</span>}
            </Td>
            <Td className="num">{bytes(f.size)}</Td>
            <Td className="text-xs">
              {dateTime(f.uploadedAt)}
              {f.uploadedBy && <span className="text-zinc-500"> · {f.uploadedBy}</span>}
            </Td>
            <Td className="text-xs text-zinc-600">{f.jobs.map((j) => `${j.name}${j.runOnUpload ? ' (on upload)' : ''}`).join(', ') || '—'}</Td>
            <Td className="text-end whitespace-nowrap">
              {can('editor') && (
                <Button size="sm" variant="ghost" icon={Upload} onClick={() => setUploading(f.key)}>
                  Replace
                </Button>
              )}
              {can('manager') && (
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${f.key}`} onClick={() => confirm(`Delete ${f.key} and all its versions?`) && remove.mutate(f.key)} />
              )}
            </Td>
          </tr>
        ))}
      </Table>
      {uploading && (
        <UploadDialog
          fileKey={uploading === 'new' ? null : uploading}
          onClose={() => setUploading(null)}
          onDone={(r) => {
            setUploading(null);
            void qc.invalidateQueries({ queryKey: ['files', tenantId, project.key] });
            void qc.invalidateQueries({ queryKey: ['runs', tenantId, project.key] });
            void qc.invalidateQueries({ queryKey: ['jobs', tenantId, project.key] });
            toast(r.runs.length ? `${r.file.name} uploaded · ${r.runs.length} job${r.runs.length > 1 ? 's' : ''} queued` : `${r.file.name} uploaded`);
            if (r.runs.length === 1) onRun(r.runs[0]!.id);
          }}
        />
      )}
    </Panel>
  );
}

function UploadDialog({ fileKey, onClose, onDone }: { fileKey: string | null; onClose(): void; onDone(r: UploadResult): void }) {
  const { tenantId, project } = useProject();
  const [key, setKey] = useState(fileKey ?? '');
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({ mutationFn: () => api.uploadFile(tenantId, project.key, key, file!), onSuccess: onDone });
  const tooBig = !!file && file.size > FILE_MAX_BYTES;
  return (
    <Dialog
      open
      onClose={onClose}
      title={fileKey ? `Replace ${fileKey}` : 'Upload file'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => upload.mutate()} loading={upload.isPending} disabled={!file || !key || tooBig}>
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={upload.error} />
        {!fileKey && (
          <Field label="Key" hint="Jobs refer to the file by this key, e.g. asset_register">
            <Input value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_'))} className="font-mono" />
          </Field>
        )}
        <Field label="File" hint="CSV (comma, semicolon, tab or pipe separated), JSON or NDJSON, up to 20 MB" error={tooBig ? 'This file is larger than 20 MB' : undefined}>
          <input
            type="file"
            accept=".csv,.tsv,.txt,.json,.ndjson,.jsonl,text/csv,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !key) setKey(f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '') || 'file');
            }}
            className="block w-full text-sm file:me-3 file:border file:border-zinc-300 file:bg-zinc-50 file:px-3 file:py-1.5 file:text-sm"
          />
        </Field>
      </div>
    </Dialog>
  );
}

const summary = (r: RunDto) =>
  Object.entries(r.stats)
    .filter(([k, v]) => k !== 'duration_ms' && v)
    .map(([k, v]) => `${v.toLocaleString()} ${k.replace(/_/g, ' ')}`)
    .join(' · ');

function RunDialog({ runId, onClose, onOpen }: { runId: string; onClose(): void; onOpen(id: string): void }) {
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
  const rerun = useMutation({
    mutationFn: () => api.rerun(tenantId, project.key, runId),
    onSuccess: (next) => {
      void qc.invalidateQueries({ queryKey: ['runs', tenantId, project.key] });
      void qc.invalidateQueries({ queryKey: ['jobs', tenantId, project.key] });
      onOpen(next.id);
    },
  });
  const d = r.data;
  const active = d && ['queued', 'running'].includes(d.status);
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={d ? `${d.jobName} · run` : 'Run'}
      footer={
        d && can('editor') ? (
          active ? (
            <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>Cancel run</Button>
          ) : (
            <Button variant="secondary" icon={RotateCcw} onClick={() => rerun.mutate()} loading={rerun.isPending}>Re-run</Button>
          )
        ) : undefined
      }
    >
      <ErrorNotice error={r.error ?? cancel.error ?? rerun.error} />
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
    runOnUpload: job?.runOnUpload ?? false,
    triggers: job?.triggers ?? { events: [], webhook: false },
    sensor: job?.sensor ?? null,
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
          <div className="sm:col-span-3">
            <SwitchField
              label="Run when a file it parses is uploaded"
              description="Needs a file.parse step"
              checked={f.runOnUpload}
              onChange={(v) => setF({ ...f, runOnUpload: v })}
            />
          </div>
        </div>
        <TriggersEditor value={{ triggers: f.triggers, sensor: f.sensor }} webhookPath={job?.webhookPath ?? null} onChange={(v) => setF({ ...f, ...v })} />
        <Field
          label="Steps (JSON)"
          error={local ?? undefined}
          hint="Types: http.extract · file.parse · transform · filter · entity.upsert · observation.write · dataset.write. Field mappings are JSONata expressions over each row."
        >
          <Textarea value={steps} onChange={(e) => check(e.target.value)} className="min-h-80 font-mono text-xs" spellCheck={false} />
        </Field>
      </div>
    </Dialog>
  );
}
