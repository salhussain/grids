import { Button, Dialog, ErrorNotice, Field, Input, Listbox, Panel } from '@grids/ui';
import { CornerDownRight, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

export interface TreeGroup {
  id: string;
  parentId: string | null;
  name: string;
  /** Items in the group (overlays, forms). */
  count: number;
}

/** Groups in tree order with their depth and full path. */
export function flatten(groups: TreeGroup[]) {
  const kids = new Map<string | null, TreeGroup[]>();
  for (const g of groups) kids.set(g.parentId && groups.some((x) => x.id === g.parentId) ? g.parentId : null, [...(kids.get(g.parentId && groups.some((x) => x.id === g.parentId) ? g.parentId : null) ?? []), g]);
  const out: (TreeGroup & { depth: number; path: string })[] = [];
  const walk = (parent: string | null, depth: number, prefix: string) => {
    for (const g of (kids.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix ? `${prefix} › ${g.name}` : g.name;
      out.push({ ...g, depth, path });
      walk(g.id, depth + 1, path);
    }
  };
  walk(null, 0, '');
  return out;
}

/**
 * Nested groups (levels) for a project's overlays or forms: add, rename, move
 * under another group, delete when empty.
 */
export function GroupTree({
  title,
  description,
  noun,
  groups,
  canEdit,
  onSave,
  onDelete,
  error,
}: {
  title: string;
  description: string;
  /** "overlay", "form" (for counts). */
  noun: string;
  groups: TreeGroup[];
  canEdit: boolean;
  onSave(input: { name: string; parentId: string | null }, id?: string): Promise<unknown>;
  onDelete(id: string): Promise<unknown>;
  error?: unknown;
}) {
  const rows = useMemo(() => flatten(groups), [groups]);
  const [editing, setEditing] = useState<{ id?: string; name: string; parentId: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const submit = async () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      await onSave({ name: editing.name.trim(), parentId: editing.parentId }, editing.id);
      setEditing(null);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  // A group can't move under itself or its descendants.
  const below = (id: string | undefined) => {
    if (!id) return new Set<string>();
    const out = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const g of groups)
        if (g.parentId && out.has(g.parentId) && !out.has(g.id)) {
          out.add(g.id);
          grew = true;
        }
    }
    return out;
  };
  return (
    <Panel flush title={title} description={description} actions={canEdit ? <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing({ name: '', parentId: null })}>Add group</Button> : undefined}>
      <ErrorNotice error={error} />
      {rows.length ? (
        <ul>
          {rows.map((g) => (
            <li key={g.id} className="group flex items-center gap-2 border-t border-zinc-100 px-4 py-2 first:border-t-0">
              <span style={{ paddingInlineStart: g.depth * 20 }} className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                {g.depth > 0 ? <CornerDownRight className="size-3.5 shrink-0 text-zinc-400" /> : <FolderTree className="size-4 shrink-0 text-zinc-500" />}
                <span className="truncate font-medium">{g.name}</span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {g.count} {noun}
                  {g.count === 1 ? '' : 's'}
                </span>
              </span>
              {canEdit && (
                <span className="flex gap-0.5 opacity-60 group-hover:opacity-100">
                  <button type="button" aria-label={`Edit ${g.name}`} className="p-1 text-zinc-500 hover:text-ink" onClick={() => setEditing({ id: g.id, name: g.name, parentId: g.parentId })}>
                    <Pencil className="size-3.5" />
                  </button>
                  <button type="button" aria-label={`Delete ${g.name}`} className="p-1 text-zinc-500 hover:text-red-700" onClick={() => confirm(`Delete the group “${g.name}”? Its ${noun}s stay, ungrouped.`) && void onDelete(g.id)}>
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-5 text-sm text-zinc-500">No groups yet. Groups (and groups inside groups) organise long lists into levels.</p>
      )}
      {editing && (
        <Dialog
          open
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit group' : 'New group'}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} loading={busy} disabled={!editing.name.trim()}>
                Save
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <ErrorNotice error={err} />
            <Field label="Name">
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Inside" hint="Pick a group to nest this one as a level below it">
              <Listbox
                label="Inside"
                value={editing.parentId ?? 'top'}
                onChange={(v) => setEditing({ ...editing, parentId: v === 'top' ? null : v })}
                options={[{ value: 'top', label: 'Top level' }, ...rows.filter((r) => !below(editing.id).has(r.id)).map((r) => ({ value: r.id, label: r.path }))]}
              />
            </Field>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
