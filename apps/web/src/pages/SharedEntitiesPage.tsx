import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EntitySummary } from '@grids/schema';
import { Button, Dialog, ErrorNotice, Input, Loading, PageHeader, Pagination, Panel, Table, Tag, Td, cx, relTime, useToast, usePagination } from '@grids/ui';
import { Boxes, FileUp, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { useCan, useWorkspace } from '../session';
import { iconOf } from './projects/context';
import { EntityForm, ImportForm, type EntityOps } from './projects/EntitiesTab';

/** The centred message inside an empty table, as on the other pages. */
function EmptyNote({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <Boxes className="size-6 text-accent-600" />
      <span className="font-medium text-zinc-900">{title}</span>
      {children && <span>{children}</span>}
    </div>
  );
}

/** Entities of the organisation's types: kept once here, visible in every project. */
export function SharedEntitiesPage() {
  const t = useT();
  const ws = useWorkspace();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const id = ws.tenant.id;
  const manage = ws.me.role === 'org_admin' || can('projects.manage');
  const types = useQuery({ queryKey: ['org-types', id], queryFn: () => api.orgTypes(id) });
  const [type, setType] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [pg, setPg] = usePagination([type, q], 25);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<EntitySummary | null>(null);
  const list = useQuery({
    queryKey: ['shared-entities', id, type, q, pg],
    queryFn: () => api.sharedEntities(id, { ...pg, type: type ?? undefined, q: q || undefined }),
    placeholderData: keepPreviousData,
  });
  const detail = useQuery({ queryKey: ['shared-entity', id, editingId], queryFn: () => api.sharedEntity(id, editingId!), enabled: !!editingId });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['shared-entities', id] });
    void qc.invalidateQueries({ queryKey: ['shared-entity', id] });
    void qc.invalidateQueries({ queryKey: ['org-types', id] });
    void qc.invalidateQueries({ queryKey: ['entities'] });
  };
  const ops: EntityOps = {
    scope: `${id}:shared`,
    create: (input) => api.createSharedEntity(id, input),
    update: (entityId, input) => api.updateSharedEntity(id, entityId, input),
    search: async (parent, search) => (await api.sharedEntities(id, { type: parent, q: search || undefined, pageSize: 10 })).items,
    importRows: (input) => api.importSharedEntities(id, input),
    saved: refresh,
    imported: refresh,
  };
  const remove = useMutation({
    mutationFn: (e: EntitySummary) => api.deleteSharedEntity(id, e.id),
    onSuccess: () => {
      refresh();
      setRemoving(null);
      toast('Entity deleted');
    },
  });
  const orgTypes = types.data ?? [];
  const current = orgTypes.find((x) => x.key === type);
  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.workspace')}
        title={t('web.nav.sharedEntities')}
        meta={<span>Kept once for the whole organisation and shown in every project. Projects record their own data against them.</span>}
        actions={
          manage && orgTypes.length > 0 ? (
            <>
              <Button variant="secondary" icon={FileUp} onClick={() => setImporting(true)}>
                Import
              </Button>
              <Button icon={Plus} onClick={() => setAdding(true)}>
                Add
              </Button>
            </>
          ) : undefined
        }
      />
      {types.isPending ? (
        <Loading />
      ) : !orgTypes.length ? (
        <Panel flush title="Entities" description="Add entity types first; their entities then appear here.">
          <Table
            head={['Name', 'Code', 'Type', 'In', 'Updated', '']}
            empty={<EmptyNote title="No organisation entity types yet">Shared entities belong to the organisation’s entity types, such as a province or a facility. Define a type under Entity types first, then add its entities here.</EmptyNote>}
          >
            {null}
          </Table>
        </Panel>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div role="tablist" aria-label="Entity types" className="flex flex-wrap gap-px border border-zinc-300 bg-zinc-300">
              {[{ key: null, plural: 'All', count: orgTypes.reduce((s, x) => s + x.count, 0) }, ...orgTypes].map((x) => (
                <button key={x.key ?? 'all'} role="tab" aria-selected={type === x.key} onClick={() => setType(x.key)} className={cx('flex items-center gap-2 px-3 py-1.5 text-sm', type === x.key ? 'bg-ink text-canvas' : 'bg-snow hover:bg-zinc-50')}>
                  {x.plural}
                  <span className="num text-xs opacity-70">{x.count.toLocaleString()}</span>
                </button>
              ))}
            </div>
            <div className="relative ms-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-zinc-400" />
              <Input aria-label="Search entities" placeholder="Search name or code" value={q} onChange={(e) => setQ(e.target.value)} className="ps-8" />
            </div>
          </div>
          <Panel flush title={current ? current.plural : 'All entities'} description="Shown in every project; edited here only.">
            <ErrorNotice error={list.error} />
            <Table head={['Name', 'Code', ...(current ? [] : ['Type']), 'In', 'Updated', '']} empty={<EmptyNote title={q ? 'No matches' : 'Nothing here yet'}>{q ? 'Try a different search.' : 'Add the first one with the Add button.'}</EmptyNote>}>
              {list.data?.items.map((e) => {
                const Icon = iconOf(e.type.icon);
                return (
                  <tr key={e.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                    <Td>
                      <span className="flex items-center gap-2 font-medium">
                        <span className="flex size-7 shrink-0 items-center justify-center text-white" style={{ background: e.type.color }}>
                          <Icon className="size-3.5" strokeWidth={1.75} />
                        </span>
                        {e.name}
                      </span>
                    </Td>
                    <Td className="font-mono text-xs">{e.code}</Td>
                    {!current && (
                      <Td>
                        <Tag>{e.type.name}</Tag>
                      </Td>
                    )}
                    <Td className="text-zinc-600">{e.parent?.name ?? '—'}</Td>
                    <Td className="text-xs text-zinc-500">{relTime(e.updatedAt)}</Td>
                    <Td>
                      {manage && (
                        <div className="flex justify-end gap-1">
                          <button type="button" aria-label={`Edit ${e.name}`} title="Edit" className="p-1.5 text-zinc-500 hover:text-ink" onClick={() => setEditingId(e.id)}>
                            <Pencil className="size-4" />
                          </button>
                          <button type="button" aria-label={`Delete ${e.name}`} title="Delete" className="p-1.5 text-zinc-500 hover:text-[#7a1f24]" onClick={() => setRemoving(e)}>
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
            {list.data && <Pagination {...pg} total={list.data.total} onChange={setPg} />}
          </Panel>
        </div>
      )}
      {adding && orgTypes.length > 0 && <EntityForm types={orgTypes} defaultType={type} ops={ops} onClose={() => setAdding(false)} />}
      {importing && orgTypes.length > 0 && <ImportForm types={orgTypes} defaultType={type} ops={ops} onClose={() => setImporting(false)} />}
      {editingId && detail.data && orgTypes.length > 0 && <EntityForm types={orgTypes} defaultType={detail.data.type.key} entity={detail.data} ops={ops} onClose={() => setEditingId(null)} />}
      {removing && (
        <Dialog
          open
          onClose={() => setRemoving(null)}
          tone="danger"
      title={`Delete ${removing.name}?`}
          footer={
            <>
              <Button variant="secondary" icon={X} onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button variant="danger" icon={Trash2} onClick={() => remove.mutate(removing)} loading={remove.isPending}>
                Delete entity
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <ErrorNotice error={remove.error} />
            <p className="text-sm text-zinc-700">
              <b>{removing.name}</b> will disappear from every project. If any project has data or submissions recorded for it, it can’t be deleted.
            </p>
          </div>
        </Dialog>
      )}
    </>
  );
}
