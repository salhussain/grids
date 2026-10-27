import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROOT_PARENT, type EntityTypeDto } from '@grids/schema';
import { confirmDialog, Button, ErrorNotice, Loading, PageHeader, Panel, Table, Td } from '@grids/ui';
import { Boxes, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { useCan, useWorkspace } from '../session';
import { iconOf } from './projects/context';
import { TypeDialog, type TypeAdapter } from './projects/SettingsTab';


/** Entity types defined once for the whole organisation: every project holds a linked copy. */
export function OrgEntityTypesPage() {
  const t = useT();
  const ws = useWorkspace();
  const can = useCan();
  const qc = useQueryClient();
  const id = ws.tenant.id;
  const types = useQuery({ queryKey: ['org-types', id], queryFn: () => api.orgTypes(id) });
  const [editing, setEditing] = useState<EntityTypeDto | 'new' | null>(null);
  const manage = ws.me.role === 'org_admin' || can('projects.manage');
  const removeType = useMutation({
    mutationFn: (key: string) => api.deleteOrgType(id, key),
    onSuccess: (data) => {
      qc.setQueryData(['org-types', id], data);
      void qc.invalidateQueries({ queryKey: ['types'] });
    },
  });
  const adapter: TypeAdapter = {
    color: ws.theme.primaryColor,
    organisation: true,
    root: { name: 'Project', icon: 'folder', color: ws.theme.primaryColor },
    save: (input, key) => api.saveOrgType(id, input, key),
    remove: (key) => api.deleteOrgType(id, key),
    onSaved: (data) => {
      qc.setQueryData(['org-types', id], data);
      // Every project's own list changed too.
      void qc.invalidateQueries({ queryKey: ['types'] });
    },
  };
  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.workspace')}
        title={t('web.nav.entityTypes')}
        meta={<span>Defined once, they appear in every project and are edited here only.</span>}
        actions={manage && <Button icon={Plus} onClick={() => setEditing('new')}>Add type</Button>}
      />
      {types.isPending ? (
        <Loading />
      ) : types.isError ? (
        <ErrorNotice error={types.error} />
      ) : (
        <>
          <ErrorNotice error={removeType.error} />
          <Panel flush title="Entity types" description="Locked in every project, so each one uses the same definition.">
            <Table
              head={['Type', 'Key', 'Sits under', 'Entities', '']}
              empty={
                <div className="flex flex-col items-center gap-2">
                  <Boxes className="size-6 text-accent-600" />
                  <span className="font-medium text-zinc-900">No organisation entity types yet</span>
                  <span>Types you add here, such as a province or a facility, appear in every project automatically and are locked there.</span>
                  {manage && <Button className="mt-3" icon={Plus} onClick={() => setEditing('new')}>Add your first type</Button>}
                </div>
              }
            >
              {types.data.map((x) => {
                const Icon = iconOf(x.icon);
                const parents = [...(x.parentTypes.includes(ROOT_PARENT) || !x.parentTypes.length ? ['Project'] : []), ...x.parentTypes.filter((k) => k !== ROOT_PARENT)];
                return (
                  <tr key={x.key} className="hover:bg-zinc-50">
                    <Td>
                      <span className="flex items-center gap-2 font-medium">
                        <span className="flex size-7 shrink-0 items-center justify-center text-white" style={{ background: x.color }}>
                          <Icon className="size-3.5" strokeWidth={1.75} />
                        </span>
                        {x.name}
                      </span>
                    </Td>
                    <Td className="font-mono text-xs text-zinc-500">{x.key}</Td>
                    <Td className="text-zinc-600">{parents.join(', ')}</Td>
                    <Td className="num">{x.count.toLocaleString()}</Td>
                    <Td>
                      {manage && (
                        <div className="flex justify-end gap-1">
                          <button type="button" aria-label={`Edit ${x.name}`} title="Edit" className="p-1.5 text-zinc-500 hover:text-ink" onClick={() => setEditing(x)}>
                            <Pencil className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${x.name}`}
                            title="Delete"
                            disabled={removeType.isPending}
                            className="p-1.5 text-zinc-500 hover:text-red-700 disabled:opacity-50"
                            onClick={async () => (await confirmDialog(`Delete the entity type “${x.name}” from every project? This only works while it has no entities.`)) && removeType.mutate(x.key)}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </Panel>
        </>
      )}
      {editing && <TypeDialog adapter={adapter} type={editing === 'new' ? null : editing} all={types.data ?? []} onClose={() => setEditing(null)} />}
    </>
  );
}
