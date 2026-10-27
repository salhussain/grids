import { ALLOWED_AGGREGATIONS, Key, type DataElementDto } from '@grids/schema';
import { Button, ErrorNotice, Field, Input, Listbox, Textarea } from '@grids/ui';
import { Hash, KeyRound, Layers, Lock, Plus, Ruler, Tag, ToggleLeft, Type, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { aggregationOptions } from './aggregations';

export interface ElementDraft {
  /** The group it is in; its key only has to be unique there. */
  group: string;
  key: string;
  name: string;
  description: string;
  valueType: DataElementDto['valueType'];
  unit: string;
  aggregation: DataElementDto['aggregation'];
}

export const keyOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'i_$1').slice(0, 40);

/** A key no other indicator has: the name's, or the name's with a number after it. */
export const freeKey = (name: string, taken: string[]) => {
  const base = keyOf(name) || 'indicator';
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`;
  return key;
};

/** What is wrong with an indicator's key, in words (nothing when it is fine). */
export const keyProblem = (key: string, taken: string[]) => (!key ? 'A key is needed' : !Key.safeParse(key).success ? 'Lower-case letters, digits and underscores, starting with a letter' : taken.includes(key) ? 'Another indicator already has this key' : undefined);

const TYPE_ICON: Record<DataElementDto['valueType'], LucideIcon> = { number: Hash, text: Type, boolean: ToggleLeft };
const TYPE_LABEL = { number: 'Number', text: 'Text', boolean: 'Yes / no' } as const;

/**
 * The details of an indicator. What it can be added up as depends on its type (a number can be totalled or averaged,
 * a yes/no counted, text only counted); the type and key are held still when forms or readings depend on them.
 */
export function ElementForm({
  value,
  onChange,
  taken,
  groups,
  keyLocked,
  typeLocked,
  lockedBecause,
  autoKey,
  onNewGroup,
}: {
  value: ElementDraft;
  onChange(v: ElementDraft): void;
  /** The other indicators, so a key can be checked against the ones in the same group. */
  taken: { group: string; key: string }[];
  groups: { key: string; name: string }[];
  keyLocked?: boolean;
  typeLocked?: boolean;
  /** Why the type (and key) are held, shown beneath them. */
  lockedBecause?: string;
  /** The key follows the name until it is edited by hand. */
  autoKey?: boolean;
  /** Makes a group from a name and gives back its key; with it, the Group list ends with “New group…”. */
  onNewGroup?(name: string): Promise<string>;
}) {
  const NEW = '__new_group';
  const [creating, setCreating] = useState<{ name: string; busy: boolean; error: unknown } | null>(null);
  const put = (p: Partial<ElementDraft>) => onChange({ ...value, ...p });
  const make = async () => {
    if (!creating || !onNewGroup) return;
    setCreating({ ...creating, busy: true, error: null });
    try {
      const group = await onNewGroup(creating.name.trim());
      setCreating(null);
      onChange({ ...value, group, ...(autoKey && !keyLocked && { key: freeKey(value.name, taken.filter((t) => t.group === group).map((t) => t.key)) }) });
    } catch (e) {
      setCreating({ ...creating, busy: false, error: e });
    }
  };
  const allowed = ALLOWED_AGGREGATIONS[value.valueType];
  const takenKeys = taken.filter((t) => t.group === value.group).map((t) => t.key);
  const problem = keyLocked ? undefined : keyProblem(value.key, takenKeys);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" intro="Shown in dashboards and reports" className="sm:col-span-2">
        <Input icon={Tag} autoFocus value={value.name} maxLength={80} onChange={(e) => put({ name: e.target.value, ...(autoKey && !keyLocked && { key: freeKey(e.target.value, takenKeys) }) })} />
      </Field>
      <Field label="Group" intro="Keys only need to be unique inside a group" className="sm:col-span-2">
        <Listbox
          label="Group"
          value={value.group}
          disabled={keyLocked}
          options={[
            ...groups.map((g) => ({ value: g.key, label: g.name, description: g.key, icon: Layers })),
            ...(onNewGroup && !keyLocked ? [{ value: NEW, label: 'New group…', description: 'Make one now', icon: Plus }] : []),
          ]}
          onChange={(group) => {
            if (group === NEW) return setCreating({ name: '', busy: false, error: null });
            setCreating(null);
            onChange({ ...value, group, ...(autoKey && !keyLocked && { key: freeKey(value.name, taken.filter((t) => t.group === group).map((t) => t.key)) }) });
          }}
        />
      </Field>
      {creating && onNewGroup && (
          <div className="space-y-2 sm:col-span-2 border border-zinc-200 bg-zinc-50/60 p-3">
            <ErrorNotice error={creating.error} />
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                aria-label="Name of the new group"
                placeholder="e.g. Site visits"
                value={creating.name}
                maxLength={80}
                onChange={(e) => setCreating({ ...creating, name: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && creating.name.trim() && (e.preventDefault(), void make())}
              />
              <Button disabled={!creating.name.trim()} loading={creating.busy} onClick={() => void make()}>
                Add group
              </Button>
              <Button variant="ghost" onClick={() => setCreating(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

      <Field label="Key" intro="Used in forms, jobs and queries" error={problem} className="sm:col-span-2">
        <Input icon={keyLocked ? Lock : KeyRound} value={value.key} disabled={keyLocked} className="font-mono" onChange={(e) => put({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
      </Field>
      <Field label="Type" intro="What a reading is">
        <Listbox
          label="Type"
          value={value.valueType}
          disabled={typeLocked}
          options={(['number', 'text', 'boolean'] as const).map((t) => ({ value: t, label: TYPE_LABEL[t], icon: TYPE_ICON[t] }))}
          onChange={(valueType) => put({ valueType, aggregation: ALLOWED_AGGREGATIONS[valueType].includes(value.aggregation) ? value.aggregation : ALLOWED_AGGREGATIONS[valueType][0]!, ...(valueType !== 'number' && { unit: '' }) })}
        />
      </Field>
      <Field label="Aggregation" intro={value.valueType === 'text' ? 'Text can only be counted' : 'How several readings combine'}>
        <Listbox label="Aggregation" value={value.aggregation} disabled={allowed.length === 1} options={aggregationOptions(allowed, value.valueType === 'boolean')} onChange={(aggregation) => put({ aggregation })} />
      </Field>
      {typeLocked && lockedBecause && (
        <p className="flex items-start gap-1.5 text-xs text-zinc-500 sm:col-span-2">
          <Lock className="mt-0.5 size-3 shrink-0" aria-hidden /> {lockedBecause}
        </p>
      )}
      {value.valueType === 'number' && (
        <Field label="Unit" intro="e.g. cases, kg, hours" className="sm:col-span-2">
          <Input icon={Ruler} value={value.unit} maxLength={20} onChange={(e) => put({ unit: e.target.value })} />
        </Field>
      )}
      <Field label="Description" intro="What it measures, and how" className="sm:col-span-2">
        <Textarea value={value.description} maxLength={300} className="min-h-16" onChange={(e) => put({ description: e.target.value })} />
      </Field>
    </div>
  );
}
