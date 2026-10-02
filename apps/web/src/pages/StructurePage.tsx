import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { OrgUnitDto } from '@grids/schema';
import {
  Button,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
  Input,
  Loading,
  Mono,
  PageHeader,
  Panel,
  Select,
  Tag,
  useToast,
} from '@grids/ui';
import { api } from '../api';
import { useCan, useWorkspace } from '../session';
import { useT } from '../i18n';
import { indent, subtreeIds } from './tree';

type Editing =
  { mode: 'create'; parent: OrgUnitDto | null } | { mode: 'edit'; unit: OrgUnitDto } | null;

export function StructurePage() {
  const t = useT();
  const ws = useWorkspace();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const id = ws.tenant.id;
  const units = useQuery({ queryKey: ['units', id], queryFn: () => api.units(id) });
  const [editing, setEditing] = useState<Editing>(null);
  const remove = useMutation({
    mutationFn: (u: OrgUnitDto) => api.deleteUnit(id, u.id),
    onSuccess: (d) => (qc.setQueryData(['units', id], d), toast('Unit deleted')),
  });
  const manage = can('structure.manage');
  const list = units.data ?? [];
  const levels = [...new Set(list.map((u) => u.levelLabel).filter(Boolean))];

  return (
    <>
      <PageHeader
        eyebrow={t('web.nav.workspace')}
        title={t('web.nav.structure')}
        meta={
          <span>
            Your organisation’s hierarchy:{' '}
            {levels.length ? levels.join(' → ') : 'regions, departments, teams, any depth'}.
          </span>
        }
        actions={
          manage && (
            <Button icon={Plus} onClick={() => setEditing({ mode: 'create', parent: null })}>
              Add top-level unit
            </Button>
          )
        }
      />
      <ErrorNotice error={units.error ?? remove.error} />
      <Panel
        flush
        title={`${list.length} units`}
        description="People are placed in units; roles can be granted for a unit and everything below it."
      >
        {units.isPending ? (
          <Loading />
        ) : !list.length ? (
          <Empty
            icon={Network}
            title="No structure yet"
            action={
              manage && (
                <Button icon={Plus} onClick={() => setEditing({ mode: 'create', parent: null })}>
                  Add the first unit
                </Button>
              )
            }
          >
            Start with your top level, e.g. regions or divisions.
          </Empty>
        ) : (
          <ul role="tree" aria-label="Organisation structure" className="divide-y divide-zinc-100">
            {list.map((u) => (
              <li
                key={u.id}
                role="treeitem"
                aria-level={u.depth + 1}
                aria-label={u.name}
                className="group flex items-center gap-3 py-2.5 pr-3 hover:bg-zinc-50 sm:pe-5"
                style={{ paddingInlineStart: 16 + u.depth * 20 }}
              >
                <span className="flex size-6 shrink-0 items-center justify-center border border-zinc-300 bg-snow text-[10px] font-semibold text-zinc-500">
                  {u.depth + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    <span className="font-medium">{u.name}</span>
                    {u.code && <Mono className="ml-2 text-xs text-zinc-500">{u.code}</Mono>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    {u.levelLabel && <Tag>{u.levelLabel}</Tag>}
                    <span className="num">
                      {u.memberCount} {u.memberCount === 1 ? 'person' : 'people'}
                    </span>
                  </div>
                </div>
                {manage && (
                  <div className="flex shrink-0 gap-1 opacity-80 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Plus}
                      onClick={() => setEditing({ mode: 'create', parent: u })}
                      aria-label={`Add unit under ${u.name}`}
                    >
                      <span className="hidden sm:inline">Add</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Pencil}
                      onClick={() => setEditing({ mode: 'edit', unit: u })}
                      aria-label={`Edit ${u.name}`}
                    >
                      <span className="hidden sm:inline">Edit</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      onClick={() => confirm(`Delete ${u.name}?`) && remove.mutate(u)}
                      aria-label={`Delete ${u.name}`}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <UnitDialog editing={editing} onClose={() => setEditing(null)} units={list} />
    </>
  );
}

function UnitDialog({
  editing,
  onClose,
  units,
}: {
  editing: Editing;
  onClose: () => void;
  units: OrgUnitDto[];
}) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ name: '', levelLabel: '', code: '', parentId: '' });
  const [loadedFor, setLoadedFor] = useState<Editing>(null);
  if (editing !== loadedFor) {
    setLoadedFor(editing);
    if (editing?.mode === 'edit')
      setV({
        name: editing.unit.name,
        levelLabel: editing.unit.levelLabel ?? '',
        code: editing.unit.code ?? '',
        parentId: editing.unit.parentId ?? '',
      });
    else if (editing) {
      // Suggest the level label used by the parent's other children.
      const sibling = units.find((u) => u.parentId === (editing.parent?.id ?? null));
      setV({
        name: '',
        levelLabel: sibling?.levelLabel ?? '',
        code: '',
        parentId: editing.parent?.id ?? '',
      });
    }
  }
  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: v.name,
        levelLabel: v.levelLabel || undefined,
        code: v.code || undefined,
        parentId: v.parentId || null,
      };
      return editing?.mode === 'edit'
        ? api.updateUnit(ws.tenant.id, editing.unit.id, input)
        : api.createUnit(ws.tenant.id, input);
    },
    onSuccess: (d) => {
      qc.setQueryData(['units', ws.tenant.id], d);
      toast(editing?.mode === 'edit' ? 'Unit updated' : `${v.name} added`);
      onClose();
    },
  });
  // A unit can't move under itself or its descendants.
  const blocked =
    editing?.mode === 'edit' ? subtreeIds(units, [editing.unit.id]) : new Set<string>();
  return (
    <Dialog
      open={!!editing}
      onClose={onClose}
      title={
        editing?.mode === 'edit'
          ? `Edit ${editing.unit.name}`
          : editing?.parent
            ? `Add under ${editing.parent.name}`
            : 'Add top-level unit'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!v.name}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2">
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Level" hint="e.g. Region, District, Team">
          <Input
            value={v.levelLabel}
            onChange={(e) => setV({ ...v, levelLabel: e.target.value })}
          />
        </Field>
        <Field label="Code" hint="Optional external code">
          <Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
        </Field>
        <Field label="Parent" className="sm:col-span-2">
          <Select value={v.parentId} onChange={(e) => setV({ ...v, parentId: e.target.value })}>
            <option value="">None (top level)</option>
            {units
              .filter((u) => !blocked.has(u.id))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {indent(u)}
                </option>
              ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <ErrorNotice error={save.error} />
        </div>
      </div>
    </Dialog>
  );
}
