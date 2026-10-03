import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DatasetDto } from '@grids/schema';
import { Button, Dialog, Empty, ErrorNotice, Field, Input, Panel, Table, Td, Textarea, dateTime, useToast } from '@grids/ui';
import { Database, Pencil, Plus, Table2, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { FreshnessBadge } from '@grids/viz';
import { useProject } from './context';
import { DatasetRows } from './DataTab';
import { parseCsv } from './EntitiesTab';
import { ChoiceCards } from './fields';

/** Datasets: tables built by jobs, or made here and filled from a CSV. Widgets can chart them. */
export function DatasetsTab() {
  const { tenantId, project, can } = useProject();
  const qc = useQueryClient();
  const datasets = useQuery({ queryKey: ['datasets', tenantId, project.key], queryFn: () => api.datasets(tenantId, project.key) });
  const [editing, setEditing] = useState<DatasetDto | 'new' | null>(null);
  const [upload, setUpload] = useState<DatasetDto | null>(null);
  const [view, setView] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (key: string) => api.deleteDataset(tenantId, project.key, key),
    onSuccess: (d) => qc.setQueryData(['datasets', tenantId, project.key], d),
  });
  return (
    <Panel
      flush
      title="Datasets"
      description="Tables of rows: made by jobs, or created here and loaded from a spreadsheet. Dashboard widgets can chart them."
      actions={can('manager') ? <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>New dataset</Button> : undefined}
    >
      <ErrorNotice error={datasets.error ?? remove.error} />
      <Table head={['Dataset', 'Rows', 'Columns', 'Updated', 'Freshness', '']} empty={<Empty icon={Database} title="No datasets yet">Create one and upload a CSV, or let a job write one.</Empty>}>
        {datasets.data?.map((d) => (
          <tr key={d.key} className="border-t border-zinc-100">
            <Td>
              <div className="font-medium">{d.name}</div>
              {d.description && <div className="max-w-xs truncate text-xs text-zinc-500">{d.description}</div>}
            </Td>
            <Td className="num">{d.rowCount.toLocaleString()}</Td>
            <Td className="max-w-xs truncate text-xs text-zinc-500">{d.columns.join(', ') || '—'}</Td>
            <Td className="text-xs">{dateTime(d.lastMaterialisedAt)}</Td>
            <Td>
              <FreshnessBadge value={d.freshness} compact />
            </Td>
            <Td>
              <span className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" icon={Table2} onClick={() => setView(d.key)}>
                  Rows
                </Button>
                {can('editor') && (
                  <Button size="sm" variant="secondary" icon={Upload} onClick={() => setUpload(d)}>
                    Upload
                  </Button>
                )}
                {can('manager') && (
                  <>
                    <button type="button" aria-label={`Edit ${d.name}`} className="p-1.5 text-zinc-500 hover:text-ink" onClick={() => setEditing(d)}>
                      <Pencil className="size-4" />
                    </button>
                    <button type="button" aria-label={`Delete ${d.name}`} className="p-1.5 text-zinc-500 hover:text-red-700" onClick={() => confirm(`Delete ${d.name} and its rows?`) && remove.mutate(d.key)}>
                      <Trash2 className="size-4" />
                    </button>
                  </>
                )}
              </span>
            </Td>
          </tr>
        ))}
      </Table>
      {editing && <DatasetDialog dataset={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onCreated={(d) => setUpload(d)} />}
      {upload && <UploadDialog dataset={upload} onClose={() => setUpload(null)} />}
      {view && <DatasetRows datasetKey={view} onClose={() => setView(null)} />}
    </Panel>
  );
}

const keyOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'd_$1')
    .slice(0, 60) || 'dataset';

function DatasetDialog({ dataset, onClose, onCreated }: { dataset: DatasetDto | null; onClose(): void; onCreated(d: DatasetDto): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: dataset?.name ?? '', description: dataset?.description ?? '', columns: dataset?.columns.join(', ') ?? '', every: '' });
  const key = dataset?.key ?? keyOf(f.name);
  const save = useMutation({
    mutationFn: () =>
      api.saveDataset(
        tenantId,
        project.key,
        {
          key,
          name: f.name,
          description: f.description,
          columns: f.columns.split(',').map((c) => c.trim()).filter(Boolean),
          freshnessMinutes: f.every ? Math.round(Number(f.every) * 60 * 24) : null,
        },
        dataset?.key,
      ),
    onSuccess: (list) => {
      qc.setQueryData(['datasets', tenantId, project.key], list);
      onClose();
      const created = list.find((d) => d.key === key);
      if (!dataset && created) onCreated(created);
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={dataset ? `Edit ${dataset.name}` : 'New dataset'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name.trim()}>
            {dataset ? 'Save' : 'Create and upload rows'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error} />
        <Field label="Name" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Description">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Columns (optional)" hint="Comma-separated. Uploads add any new columns automatically.">
          <Input value={f.columns} onChange={(e) => setF({ ...f, columns: e.target.value })} />
        </Field>
        <Field label="Expected update every (days)" hint="Optional: drives the freshness badge">
          <Input type="number" min={0.01} step="any" value={f.every} onChange={(e) => setF({ ...f, every: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

function UploadDialog({ dataset, onClose }: { dataset: DatasetDto; onClose(): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [file, setFile] = useState('');
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const run = useMutation({
    mutationFn: () => api.uploadDatasetRows(tenantId, project.key, dataset.key, { mode, rows: rows! }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['datasets', tenantId, project.key] });
      toast(`${r.added.toLocaleString()} rows loaded · ${r.rows.toLocaleString()} in total`);
      onClose();
    },
  });
  const cols = rows?.[0] ? Object.keys(rows[0]) : [];
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Upload rows to ${dataset.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => run.mutate()} loading={run.isPending} disabled={!rows?.length}>
            Load {rows?.length ? `${rows.length.toLocaleString()} rows` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={run.error} />
        <Field label="CSV file" hint={file || 'First row = column names; numbers are stored as numbers'}>
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFile(f.name);
              setRows(parseCsv(await f.text()));
            }}
          />
        </Field>
        <ChoiceCards<'replace' | 'append'>
          label="Existing rows"
          value={mode}
          onChange={setMode}
          options={{
            replace: { label: 'Replace', text: `Remove the ${dataset.rowCount.toLocaleString()} rows there now`, icon: Trash2 },
            append: { label: 'Append', text: 'Add to the rows already there', icon: Plus },
          }}
        />
        {rows && (
          <div className="overflow-x-auto border border-zinc-200">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50">
                <tr>
                  {cols.map((c) => (
                    <th key={c} className="px-2 py-1.5 text-start font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t border-zinc-100">
                    {cols.map((c) => (
                      <td key={c} className="px-2 py-1">
                        {r[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  );
}
