import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_DATA_GROUP, DataGroupInput, type DataElementDto } from '@grids/schema';
import { confirmDialog, Button, Dialog, ErrorNotice, Pagination, Panel, Table, Td, relTime, usePagination, SectionHead, Empty, Loading } from '@grids/ui';
import { Pencil, Plus, Sigma, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { ElementForm, freeKey, keyProblem, type ElementDraft } from './ElementForm';
import { useProject } from './context';

export function DataTab() {
  const { tenantId, project, can } = useProject();
  const elements = useQuery({ queryKey: ['elements', tenantId, project.key], queryFn: () => api.elements(tenantId, project.key) });
  const groups = useQuery({ queryKey: ['data-groups', tenantId, project.key], queryFn: () => api.dataGroups(tenantId, project.key) });
  const [editing, setEditing] = useState<DataElementDto | 'new' | null>(null);
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (key: string) => api.deleteElement(tenantId, project.key, key),
    onSuccess: (data) => qc.setQueryData(['elements', tenantId, project.key], data),
  });
  return (
    <div className="space-y-6">
      <>
        <SectionHead title="Data elements" description="Indicators recorded as observations over time (by forms, jobs or the API)." actions={can('manager') ? (
          <>
            <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
              Add element
            </Button>
          </>
        ) : undefined} />
        <ErrorNotice error={elements.error ?? remove.error} />
        {elements.isPending ? (
          <Loading />
        ) : (
        <Panel flush>
        <Table head={['Name', 'Key', 'Group', 'Type', 'Aggregation', 'Observations', 'Latest', '']} empty={<Empty icon={Sigma} title="No data elements yet">A data element is one indicator you measure over time, such as malaria cases or stock-out days. Forms, jobs and the API record values against it.</Empty>}>
          {elements.data?.map((e) => (
            <tr key={e.ref} className="border-t border-zinc-100">
              <Td>
                <div className="font-medium">{e.name}</div>
                {e.description && <div className="text-xs text-zinc-500">{e.description}</div>}
              </Td>
              <Td className="font-mono text-xs">{e.key}</Td>
              <Td className="text-xs text-zinc-600">{e.groupName}</Td>
              <Td>
                {e.valueType}
                {e.unit && <span className="text-zinc-500"> ({e.unit})</span>}
              </Td>
              <Td>{e.aggregation}{e.forms.length > 0 && <div className="text-xs text-zinc-500">in {e.forms.length} {e.forms.length === 1 ? 'form' : 'forms'}</div>}</Td>
              <Td className="num">{e.observationCount.toLocaleString()}</Td>
              <Td className="text-xs text-zinc-500">{e.lastAt ? relTime(e.lastAt) : '—'}</Td>
              <Td>
                {can('manager') && (
                  <span className="flex items-center justify-end">
                    <button type="button" aria-label={`Edit ${e.name}`} title="Edit" onClick={() => setEditing(e)} className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink">
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${e.name}`}
                      title={e.forms.length ? `Used by ${e.forms.join(', ')}` : 'Delete'}
                      disabled={e.forms.length > 0}
                      onClick={async () => (await confirmDialog(`Delete ${e.name}${e.observationCount ? ` and its ${e.observationCount.toLocaleString()} readings` : ''}? This cannot be undone.`, { confirmLabel: 'Delete', danger: true })) && remove.mutate(e.ref)}
                      className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
        )}
      </>
      {editing && <ElementDialog element={editing === 'new' ? null : editing} taken={(elements.data ?? []).filter((e) => e.ref !== (editing === 'new' ? '' : editing.ref)).map((e) => ({ group: e.group, key: e.key }))} groups={groups.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ElementDialog({ element, taken, groups, onClose }: { element: DataElementDto | null; taken: { group: string; key: string }[]; groups: { key: string; name: string }[]; onClose(): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState<ElementDraft>({
    group: element?.group ?? DEFAULT_DATA_GROUP,
    key: element?.key ?? '',
    name: element?.name ?? '',
    description: element?.description ?? '',
    valueType: element?.valueType ?? 'number',
    unit: element?.unit ?? '',
    aggregation: element?.aggregation ?? 'sum',
  });
  const forms = element?.forms ?? [];
  const locked = !!element && (forms.length > 0 || element.observationCount > 0);
  const save = useMutation({
    mutationFn: () => api.saveElement(tenantId, project.key, { ...f, name: f.name.trim() }, element?.ref),
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
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name.trim() || (!locked && !!keyProblem(f.key, taken.filter((t) => t.group === f.group).map((t) => t.key)))}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error} />
        <ElementForm
          value={f}
          onChange={setF}
          taken={taken}
          groups={groups}
          onNewGroup={async (name) => {
            const key = freeKey(name, groups.map((g) => g.key)).replace(/^indicator$/, 'group');
            qc.setQueryData(['data-groups', tenantId, project.key], await api.saveDataGroup(tenantId, project.key, DataGroupInput.parse({ key, name })));
            return key;
          }}
          autoKey={!element}
          keyLocked={locked}
          typeLocked={locked}
          lockedBecause={forms.length ? `Held because ${forms.join(', ')} record${forms.length === 1 ? 's' : ''} into it.` : 'Held because readings have been recorded.'}
        />
      </div>
    </Dialog>
  );
}

export function DatasetRows({ datasetKey, onClose }: { datasetKey: string; onClose(): void }) {
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
