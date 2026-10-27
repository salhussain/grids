import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_DATA_GROUP, DataGroupInput } from '@grids/schema';
import { Button, confirmDialog, Dialog, ErrorNotice, Field, Input, Loading, SectionHead } from '@grids/ui';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { freeKey, keyProblem } from './ElementForm';
import { useProject } from './context';

/** The groups indicators are put in: add one, or change a group's name. A group's key stays as it was made. */
export function DataGroupsTab() {
  const { tenantId, project, can } = useProject();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['data-groups', tenantId, project.key], queryFn: () => api.dataGroups(tenantId, project.key) });
  const groups = query.data ?? [];
  const manager = can('manager');
  const elements = useQuery({ queryKey: ['elements', tenantId, project.key], queryFn: () => api.elements(tenantId, project.key) });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const put = (data: unknown) => qc.setQueryData(['data-groups', tenantId, project.key], data);
  const add = useMutation({
    mutationFn: () => api.saveDataGroup(tenantId, project.key, DataGroupInput.parse({ key, name: name.trim() })),
    onSuccess: (data) => (put(data), setName(''), setKey(''), setKeyEdited(false), setAdding(false)),
  });
  const rename = useMutation({ mutationFn: (g: { key: string; name: string; description: string }) => api.saveDataGroup(tenantId, project.key, { key: g.key, name: g.name.trim(), description: g.description }, g.key), onSuccess: put });
  const remove = useMutation({
    mutationFn: (k: string) => api.deleteDataGroup(tenantId, project.key, k, true),
    onSuccess: (data) => {
      put(data);
      // Its indicators went with it, and the form questions that recorded into them were unlinked.
      void qc.invalidateQueries({ queryKey: ['elements', tenantId, project.key] });
      void qc.invalidateQueries({ queryKey: ['forms', tenantId, project.key] });
    },
  });
  /** Asks first, saying what goes with the group: its indicators, their readings, and what forms lose. */
  const askRemove = async (g: { key: string; name: string }) => {
    const mine = (elements.data ?? []).filter((e) => e.group === g.key);
    const readings = mine.reduce((n, e) => n + e.observationCount, 0);
    const forms = [...new Set(mine.flatMap((e) => e.forms))];
    const message = mine.length
      ? `Delete the group “${g.name}”? This also deletes its ${mine.length} data element${mine.length === 1 ? '' : 's'}${readings ? ` and ${readings.toLocaleString()} recorded reading${readings === 1 ? '' : 's'}` : ''}.${forms.length ? ` Questions in ${forms.join(', ')} that record into them will no longer be linked to an indicator.` : ''} This cannot be undone.`
      : `Delete the group “${g.name}”?`;
    if (await confirmDialog(message, { confirmLabel: mine.length ? 'Delete group and data elements' : 'Delete group', danger: true })) remove.mutate(g.key);
  };
  const taken = groups.map((g) => g.key);
  const [editing, setEditing] = useState<{ key: string; name: string } | null>(null);
  const commit = (g: { key: string; name: string; description: string }) => {
    const next = editing?.name.trim();
    setEditing(null);
    if (next && next !== g.name) rename.mutate({ ...g, name: next });
  };
  const keyBad = !!key && (taken.includes(key) || keyProblem(key, []) !== undefined);
  return (
    <div className="space-y-5">
      <SectionHead
        title="Data groups"
        description="Organise data elements into groups."
        actions={
          manager ? (
            <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
              Add data group
            </Button>
          ) : undefined
        }
      />
      {query.isPending ? (
        <Loading />
      ) : (
      <>
        <ErrorNotice error={rename.error ?? remove.error} />
        <div className="border border-zinc-200">
          <div className="grid grid-cols-[1fr_12rem_7rem_6rem] items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2 font-mono text-[11px] tracking-widest text-zinc-500 uppercase">
            <span>Group</span>
            <span>Key</span>
            <span className="text-end">Indicators</span>
            <span />
          </div>
          <ul className="divide-y divide-zinc-100">
            {groups.map((g) => {
              const fixed = g.key === DEFAULT_DATA_GROUP;
              const on = editing?.key === g.key;
              return (
                <li key={g.key} className="grid grid-cols-[1fr_12rem_7rem_6rem] items-center gap-3 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Layers className="size-4 shrink-0 text-zinc-400" />
                    {on ? (
                      <Input
                        autoFocus
                        aria-label={`Name of ${g.name}`}
                        value={editing.name}
                        maxLength={80}
                        onChange={(e) => setEditing({ key: g.key, name: e.target.value })}
                        onBlur={() => commit(g)}
                        onKeyDown={(e) => (e.key === 'Enter' ? commit(g) : e.key === 'Escape' && setEditing(null))}
                      />
                    ) : (
                      <span className="truncate text-sm font-medium">{g.name}</span>
                    )}
                    {fixed && <span className="shrink-0 border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-500">Default</span>}
                  </div>
                  <span className="truncate font-mono text-xs text-zinc-500">{g.key}</span>
                  <span className="num text-end text-sm text-zinc-600">{g.elementCount}</span>
                  <span className="flex justify-end">
                    {!fixed && manager && (
                      <>
                        <button
                          type="button"
                          aria-label={`Rename ${g.name}`}
                          title="Rename"
                          onClick={() => setEditing({ key: g.key, name: g.name })}
                          className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${g.name}`}
                          title={g.elementCount ? `Delete, with its ${g.elementCount} data element${g.elementCount === 1 ? '' : 's'}` : 'Delete'}
                          onClick={() => void askRemove(g)}
                          className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-700"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        {adding && (
          <Dialog
            open
            onClose={() => setAdding(false)}
            title="Add data group"
            description="What its indicators have in common."
            footer={
              <>
                <Button variant="secondary" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
                <Button icon={Plus} loading={add.isPending} disabled={!name.trim() || !key || keyBad} onClick={() => add.mutate()}>
                  Add group
                </Button>
              </>
            }
          >
            <div className="space-y-4">
              <ErrorNotice error={add.error} />
              <Field label="Name" required>
                <Input
                  autoFocus
                  value={name}
                  maxLength={80}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!keyEdited) setKey(freeKey(e.target.value, taken));
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && name.trim() && key && !keyBad && add.mutate()}
                  placeholder="e.g. Site visits"
                />
              </Field>
              <Field label="Key" intro="Used in references, can’t change later" error={key && taken.includes(key) ? 'Already used' : undefined}>
                <Input
                  className="font-mono"
                  value={key}
                  maxLength={40}
                  onChange={(e) => {
                    setKeyEdited(true);
                    setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
                  }}
                />
              </Field>
            </div>
          </Dialog>
        )}
      </>
      )}
    </div>
  );
}
