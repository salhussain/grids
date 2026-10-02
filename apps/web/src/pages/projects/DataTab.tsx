import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DataElementDto } from '@grids/schema';
import { Button, Dialog, Empty, ErrorNotice, Field, Input, Pagination, Panel, Select, Table, Td, Textarea, dateTime, relTime, usePagination } from '@grids/ui';
import { Database, Pencil, Plus, Sigma } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { FreshnessBadge } from '../../viz/Freshness';
import { useProject } from './context';

export function DataTab() {
  const { tenantId, project, can } = useProject();
  const elements = useQuery({ queryKey: ['elements', tenantId, project.key], queryFn: () => api.elements(tenantId, project.key) });
  const datasets = useQuery({ queryKey: ['datasets', tenantId, project.key], queryFn: () => api.datasets(tenantId, project.key) });
  const [editing, setEditing] = useState<DataElementDto | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <Panel
        flush
        title="Data elements"
        description="Indicators recorded as observations over time (by forms, jobs or the API)."
        actions={can('manager') ? <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>Add element</Button> : undefined}
      >
        <ErrorNotice error={elements.error} />
        <Table head={['Name', 'Key', 'Type', 'Aggregation', 'Observations', 'Latest', '']} empty={<Empty icon={Sigma} title="No data elements yet" />}>
          {elements.data?.map((e) => (
            <tr key={e.key} className="border-t border-zinc-100">
              <Td>
                <div className="font-medium">{e.name}</div>
                {e.description && <div className="text-xs text-zinc-500">{e.description}</div>}
              </Td>
              <Td className="font-mono text-xs">{e.key}</Td>
              <Td>
                {e.valueType}
                {e.unit && <span className="text-zinc-500"> ({e.unit})</span>}
              </Td>
              <Td>{e.aggregation}</Td>
              <Td className="num">{e.observationCount.toLocaleString()}</Td>
              <Td className="text-xs text-zinc-500">{e.lastAt ? relTime(e.lastAt) : '—'}</Td>
              <Td>
                {can('manager') && (
                  <button type="button" aria-label={`Edit ${e.name}`} onClick={() => setEditing(e)} className="p-1 text-zinc-500 hover:text-ink">
                    <Pencil className="size-4" />
                  </button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel flush title="Datasets" description="Tables materialised by jobs, with their freshness.">
        <Table head={['Name', 'Rows', 'Columns', 'Materialised', 'Freshness', '']} empty={<Empty icon={Database} title="No datasets yet">Jobs create datasets with a dataset.write step.</Empty>}>
          {datasets.data?.map((d) => (
            <tr key={d.key} className="border-t border-zinc-100">
              <Td>
                <div className="font-medium">{d.name}</div>
                <div className="font-mono text-xs text-zinc-500">{d.key}</div>
              </Td>
              <Td className="num">{d.rowCount.toLocaleString()}</Td>
              <Td className="max-w-xs truncate text-xs text-zinc-500">{d.columns.join(', ')}</Td>
              <Td className="text-xs">{dateTime(d.lastMaterialisedAt)}</Td>
              <Td>
                <FreshnessBadge value={d.freshness} compact />
              </Td>
              <Td>
                <Button size="sm" variant="secondary" onClick={() => setOpen(d.key)}>
                  View rows
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
      {editing && <ElementDialog element={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {open && <DatasetRows datasetKey={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ElementDialog({ element, onClose }: { element: DataElementDto | null; onClose(): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState({
    key: element?.key ?? '',
    name: element?.name ?? '',
    description: element?.description ?? '',
    valueType: element?.valueType ?? 'number',
    unit: element?.unit ?? '',
    aggregation: element?.aggregation ?? 'sum',
  });
  const save = useMutation({
    mutationFn: () => api.saveElement(tenantId, project.key, f, element?.key),
    onSuccess: (data) => {
      qc.setQueryData(['elements', tenantId, project.key], data);
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteElement(tenantId, project.key, element!.key),
    onSuccess: (data) => {
      qc.setQueryData(['elements', tenantId, project.key], data);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={element ? `Edit ${element.name}` : 'New data element'}
      footer={
        <>
          {element && (
            <Button variant="danger" className="me-auto" onClick={() => confirm(`Delete ${element.name} and all its observations?`) && remove.mutate()}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.key || !f.name}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <ErrorNotice error={save.error ?? remove.error} />
        <Field label="Name" className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, key: element ? f.key : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') })} />
        </Field>
        <Field label="Key" hint="snake_case; used in forms, jobs and queries">
          <Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} className="font-mono" />
        </Field>
        <Field label="Unit">
          <Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
        </Field>
        <Field label="Value type">
          <Select value={f.valueType} onChange={(e) => setF({ ...f, valueType: e.target.value as typeof f.valueType })}>
            <option value="number">Number</option>
            <option value="text">Text</option>
            <option value="boolean">Yes / no</option>
          </Select>
        </Field>
        <Field label="Default aggregation">
          <Select value={f.aggregation} onChange={(e) => setF({ ...f, aggregation: e.target.value as typeof f.aggregation })}>
            {['sum', 'avg', 'min', 'max', 'last', 'count'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

function DatasetRows({ datasetKey, onClose }: { datasetKey: string; onClose(): void }) {
  const { tenantId, project } = useProject();
  const [pg, setPg] = usePagination([], 25);
  const rows = useQuery({
    queryKey: ['dataset-rows', tenantId, project.key, datasetKey, pg],
    queryFn: () => api.datasetRows(tenantId, project.key, datasetKey, pg),
    placeholderData: keepPreviousData,
  });
  return (
    <Dialog open wide onClose={onClose} title={datasetKey}>
      <ErrorNotice error={rows.error} />
      {rows.data && (
        <>
          <div className="max-h-[60vh] overflow-auto border border-zinc-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  {rows.data.columns.map((c) => (
                    <th key={c} className="px-3 py-2 text-start font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.data.items.map((r, i) => (
                  <tr key={i} className="border-t border-zinc-100">
                    {rows.data.columns.map((c) => (
                      <td key={c} className="px-3 py-1.5 whitespace-nowrap">
                        {r[c] === null || r[c] === undefined ? '—' : String(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...pg} total={rows.data.total} onChange={setPg} />
        </>
      )}
    </Dialog>
  );
}
