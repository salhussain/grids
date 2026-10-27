import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ATTRIBUTE_TYPES,
  GEOMETRY_KINDS,
  MARKER_STYLES,
  type AttributeDef,
  type EntityTypeDto,
  type MarkerStyle,
  type ProjectMemberDto,
  type ProjectVisibility,
  ROOT_PARENT,
  attributeProblem,
} from '@grids/schema';
import { confirmDialog, DatePicker, Listbox, Button, Dialog, ErrorNotice, Field, Input, Panel, Select, Table, Tag, Td, Textarea, cx, useToast, SectionHead, EmptyState } from '@grids/ui';
import { Archive, ArrowDown, ArrowUp, Asterisk, EyeOff, ArchiveRestore, Ban, Calendar, Check, Hash, Link2, ListChecks, ListPlus, Mail, MapPin, Percent, Phone, ToggleLeft, Type, Pencil, Pentagon, Plus, Spline, Lock, Trash2, UserPlus, UserRound, X, type LucideIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../api';
import { useWorkspace } from '../../session';
import { ICONS, iconOf, useProject } from './context';
import { ChoiceCards, ColourPicker, IconPicker, Segmented } from './fields';
import { useTypes } from './EntitiesTab';
import { PermissionGroupsPanel, usePermissionGroups } from './permissions';
import { PermissionPicker } from './PermissionPicker';
import { ScopePicker, type ScopeEntity } from './ScopePicker';

export function SettingsTab() {
  const { can } = useProject();
  return (
    <div className="space-y-6">
      {can('manager') && <General />}
      <Types />
      <Members />
      <PermissionGroupsPanel />
    </div>
  );
}

function General() {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: project.name, description: project.description, visibility: project.visibility, color: project.color, icon: project.icon });
  const save = useMutation({
    mutationFn: () => api.updateProject(tenantId, project.key, f),
    onSuccess: (p) => {
      qc.setQueryData(['project', tenantId, project.key], p);
      void qc.invalidateQueries({ queryKey: ['projects', tenantId] });
      toast('Project saved');
    },
  });
  const archive = useMutation({
    mutationFn: () => api.archiveProject(tenantId, project.key, !project.archived),
    onSuccess: (p) => {
      qc.setQueryData(['project', tenantId, project.key], p);
      void qc.invalidateQueries({ queryKey: ['projects', tenantId] });
    },
  });
  return (
    <Panel
      title="Project"
      actions={
        <Button variant="secondary" size="sm" icon={project.archived ? ArchiveRestore : Archive} onClick={() => archive.mutate()} loading={archive.isPending}>
          {project.archived ? 'Restore' : 'Archive'}
        </Button>
      }
    >
      <ErrorNotice error={save.error ?? archive.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Visibility">
          <Select value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value as ProjectVisibility })}>
            <option value="private">Private: project members only</option>
            <option value="organisation">Organisation: every member can view</option>
            <option value="public">Public: anyone can view public dashboards</option>
          </Select>
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Colour">
          <div className="flex gap-2">
            <input type="color" aria-label="Colour" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-9 w-12 border border-zinc-300 bg-snow" />
            <Input value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="font-mono" />
          </div>
        </Field>
        <Field label="Icon">
          <Select value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })}>
            {Object.keys(ICONS).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => save.mutate()} loading={save.isPending}>
          Save
        </Button>
      </div>
    </Panel>
  );
}

const GEOMETRY_TEXT: Record<EntityTypeDto['geometry'], string> = {
  none: 'Not shown on the map',
  point: 'A single position, pinned on the map',
  polygon: 'A boundary, outlined and coloured',
  line: 'A route or path',
};
const GEOMETRY_LABEL: Record<EntityTypeDto['geometry'], string> = {
  none: 'No location',
  point: 'Point',
  polygon: 'Area',
  line: 'Line',
};
const MARKER_INFO: Record<MarkerStyle, { label: string; hint: string }> = {
  dot: { label: 'Dot', hint: 'Small and light, for many places' },
  pin: { label: 'Pin', hint: 'A map pin with the type’s icon' },
  icon: { label: 'Icon', hint: 'The icon itself, e.g. a plane' },
};

/** What a type's places look like on the map. */
function MarkerSample({
  style,
  icon,
  color,
  small,
}: {
  style: MarkerStyle;
  icon: string;
  color: string;
  small?: boolean;
}) {
  const Icon = iconOf(icon);
  const size = small ? 'size-5' : 'size-8';
  if (style === 'dot')
    return (
      <span className={cx('flex shrink-0 items-center justify-center', size)}>
        <span className="size-2.5 rounded-full ring-2 ring-white" style={{ background: color }} />
      </span>
    );
  if (style === 'icon')
    return (
      <span className={cx('flex shrink-0 items-center justify-center', size)}>
        <Icon className={small ? 'size-4' : 'size-6'} style={{ color }} strokeWidth={2.25} />
      </span>
    );
  return (
    <svg viewBox="0 0 32 40" className={cx('shrink-0', small ? 'h-5 w-4' : 'h-9 w-7')} aria-hidden>
      <path
        d="M16 39C16 39 3 24.6 3 15.5a13 13 0 0 1 26 0C29 24.6 16 39 16 39Z"
        fill={color}
        stroke="white"
        strokeWidth="2"
      />
      <circle cx="16" cy="15.5" r="8.5" fill="white" />
      <foreignObject x="9.5" y="9" width="13" height="13">
        <Icon width={13} height={13} color={color} strokeWidth={2.5} />
      </foreignObject>
    </svg>
  );
}

export function Types() {
  const { tenantId, project, base, can } = useProject();
  const qc = useQueryClient();
  const types = useTypes();
  const [editing, setEditing] = useState<EntityTypeDto | 'new' | null>(null);
  const removeType = useMutation({
    mutationFn: (key: string) => api.deleteType(tenantId, project.key, key),
    onSuccess: (data) => qc.setQueryData(['types', tenantId, project.key], data),
  });
  const adapter: TypeAdapter = {
    color: project.color,
    root: { name: project.name, icon: project.icon, color: project.color },
    save: (input, key) => api.saveType(tenantId, project.key, input, key),
    remove: (key) => api.deleteType(tenantId, project.key, key),
    onSaved: (data) => qc.setQueryData(['types', tenantId, project.key], data),
  };
  return (
    <>
      <SectionHead title="Entity types" description="The kinds of things this project tracks, and where they sit in the hierarchy." actions={can('manager') ? <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>Add type</Button> : undefined} />
      <ErrorNotice error={removeType.error} />
      <Panel flush>
      <Table head={['Type', 'Parent', 'Entities', '']}>
        {types.data?.map((t) => {
          const Icon = iconOf(t.icon);
          return (
            <tr key={t.key} className="border-t border-zinc-100">
              <Td>
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="size-4" style={{ color: t.color }} /> {t.name}
                  {t.orgId && <Tag>Organisation</Tag>}
                </span>
                <span className="ms-6 font-mono text-[11px] text-zinc-500">{t.key}</span>
              </Td>
              <Td>
                {[...(t.parentTypes.includes(ROOT_PARENT) || !t.parentTypes.length ? ['Project'] : []), ...t.parentTypes.filter((k) => k !== ROOT_PARENT)].join(', ')}
              </Td>
              <Td className="num">
                {t.count > 0 ? (
                  <Link to={`${base}/entities`} search={{ type: t.key } as never} title={`Show the ${t.plural.toLowerCase()}`} className="text-accent-700 hover:underline">
                    {t.count.toLocaleString()}
                  </Link>
                ) : (
                  t.count.toLocaleString()
                )}
                {t.maxPerProject !== null && <span className="text-zinc-400"> / {t.maxPerProject.toLocaleString()}</span>}
              </Td>
              <Td>
                {t.orgId ? (
                  <Lock className="size-4 text-zinc-400" aria-label="Managed by the organisation" />
                ) : (
                  can('manager') && (
                    <span className="flex items-center gap-1">
                      <button type="button" aria-label={`Edit ${t.name}`} className="p-1 text-zinc-500 hover:text-ink" onClick={() => setEditing(t)}>
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${t.name}`}
                        title="Delete"
                        disabled={removeType.isPending}
                        className="p-1 text-zinc-500 hover:text-red-700 disabled:opacity-50"
                        onClick={async () => (await confirmDialog(`Delete the entity type “${t.name}”? This only works while it has no entities.`)) && removeType.mutate(t.key)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </span>
                  )
                )}
              </Td>
            </tr>
          );
        })}
      </Table>
    </Panel>
      {editing && <TypeDialog adapter={adapter} type={editing === 'new' ? null : editing} all={types.data ?? []} onClose={() => setEditing(null)} />}
    </>
  );
}

/** How a type dialog talks to the server: a project's own types, or the organisation's. */
export interface TypeAdapter {
  color: string;
  /** Organisation types are shared, so they take no per-project limit. */
  organisation?: boolean;
  /** The built-in top of the hierarchy, shown as the default place a type sits. */
  root: { name: string; icon: string; color: string };
  save(input: Parameters<typeof api.saveType>[2], key?: string): Promise<EntityTypeDto[]>;
  remove(key: string): Promise<EntityTypeDto[]>;
  onSaved(data: EntityTypeDto[]): void;
}

export function TypeDialog({ adapter, type, all, onClose }: { adapter: TypeAdapter; type: EntityTypeDto | null; all: EntityTypeDto[]; onClose(): void }) {
  const [f, setF] = useState({
    key: type?.key ?? '',
    name: type?.name ?? '',
    plural: type?.plural ?? '',
    icon: type?.icon ?? 'box',
    color: type?.color ?? adapter.color,
    geometry: type?.geometry ?? 'none',
    marker: type?.marker ?? { style: 'dot' as MarkerStyle, rotateBy: null },
    // A type saved with no parents sat at the project level.
    parentTypes: type ? (type.parentTypes.length ? type.parentTypes : [ROOT_PARENT]) : [],
    maxPerProject: type?.maxPerProject ?? (null as number | null),
  });
  const [attrs, setAttrs] = useState<AttributeDef[]>(type?.attributes ?? []);
  const done = (data: EntityTypeDto[]) => {
    adapter.onSaved(data);
    onClose();
  };
  const save = useMutation({ mutationFn: () => adapter.save({ ...f, attributes: attrs }, type?.key), onSuccess: done });
  const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  // The plural follows the name until someone edits it (irregular ones: Person → People).
  const [pluralEdited, setPluralEdited] = useState(!!type && type.plural !== pluralize(type.name));
  const [attrDialog, setAttrDialog] = useState<{ index: number | null; value: AttributeDef } | null>(null);
  const setName = (name: string) => setF({ ...f, name, ...(type ? {} : { key: slug(name) }), ...(pluralEdited ? {} : { plural: pluralize(name) }) });
  return (
    <Dialog
      open
      onClose={onClose}
      title={type ? `Edit ${type.name}` : 'New entity type'}
      description="The kind of thing this project tracks, how it looks, and what you record about it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.key || !f.name || !f.plural || !f.parentTypes.length}>
            {type ? 'Save changes' : 'Create type'}
          </Button>
        </>
      }
    >
      <div>
        <ErrorNotice error={save.error} />
        <div className="space-y-5">
          <Field label="Name" required intro="Singular, e.g. Facility">
            <Input icon={Type} autoFocus placeholder="e.g. Facility" value={f.name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="space-y-5">
            <Field label="Plural" intro="Used in lists and menus">
              <Input
                icon={ListPlus}
                placeholder="e.g. Facilities"
                value={f.plural}
                onChange={(e) => {
                  setPluralEdited(true);
                  setF({ ...f, plural: e.target.value });
                }}
              />
            </Field>
            <Field label="Key" intro={type ? 'Fixed once created' : 'Used in links and imports'}>
              <Input icon={Hash} placeholder="facility" value={f.key} onChange={(e) => setF({ ...f, key: slug(e.target.value) })} disabled={!!type} className="font-mono" />
            </Field>
          </div>

          <div className="space-y-5">
            <ColourPicker intro="Colour of this type on lists and maps" swatches={false} value={f.color} onChange={(color) => setF({ ...f, color })} />
            <IconPicker intro="Icon of this type on lists and maps" value={f.icon} color={f.color} onChange={(icon) => setF({ ...f, icon })} />
          </div>

          <Field label="Parent type" required intro="Where it can be placed, to build the hierarchy (project › province › district › facility)">
            <Listbox
              value={null}
              values={f.parentTypes}
              onChangeMany={(parentTypes) => setF({ ...f, parentTypes })}
              placeholder="Choose where it can sit"
              options={[
                { value: ROOT_PARENT, label: 'Project', icon: iconOf(adapter.root.icon) },
                ...all.filter((t) => t.key !== type?.key).map((t) => ({ value: t.key, label: t.name, icon: iconOf(t.icon) })),
              ]}
            />
          </Field>

          {!adapter.organisation && (
          <Field label="Limit per project" intro="Most entities one project may hold of this type. Leave empty for no limit">
            <Input icon={Ban} type="number" min={1} placeholder="No limit" value={f.maxPerProject ?? ''} onChange={(e) => setF({ ...f, maxPerProject: e.target.value === '' ? null : Math.max(1, Math.floor(Number(e.target.value))) })} />
          </Field>
          )}

          <ChoiceCards
            label="Shown on the map?"
            intro="Whether places of this type have a position"
            value={f.geometry === 'none' ? 'no' : 'yes'}
            onChange={(v) => setF({ ...f, geometry: v === 'no' ? 'none' : f.geometry === 'none' ? 'point' : f.geometry })}
            options={{
              no: { label: 'No', text: 'A record only: lists, forms and reports, nothing on the map', icon: Ban },
              yes: { label: 'Yes', text: 'Each one has a place that can be shown on the map', icon: MapPin },
            }}
          />
          {f.geometry !== 'none' && (
            <ChoiceCards
              label="What is its shape?"
              intro="A specific spot, or something that covers a wider range"
              value={f.geometry}
              onChange={(geometry) => setF({ ...f, geometry })}
              options={{
                point: { label: 'Point', text: 'One place, like a clinic, a vehicle or an incident', icon: MapPin },
                polygon: { label: 'Polygon', text: 'Covers a range, like a district, zone or boundary', icon: Pentagon },
                line: { label: 'Line', text: 'A route or path, like a road, river or pipeline', icon: Spline },
              }}
            />
          )}
          <section className="space-y-4 border-t border-zinc-200 pt-5">
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Attributes</div>
                  <p className="mt-0.5 text-xs text-zinc-500">What you record about each {f.name.toLowerCase() || 'one'}.</p>
                </div>
                {attrs.length > 0 && (
                  <Button variant="secondary" size="sm" icon={Plus} onClick={() => setAttrDialog({ index: null, value: { key: '', label: '', type: 'text' } })}>
                    Add attribute
                  </Button>
                )}
              </div>
              {attrs.length ? (
                <ul className="divide-y divide-zinc-100 border border-zinc-200 bg-snow">
                  {attrs.map((a, i) => {
                    const TI = ATTR_TYPE[a.type].icon;
                    return (
                      <li key={i} className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50/70">
                        <TI className="size-4 shrink-0 text-zinc-500" aria-hidden />
                        <button type="button" onClick={() => setAttrDialog({ index: i, value: a })} className="min-w-0 flex-1 text-start">
                          <span className="block truncate text-sm font-medium">
                            {a.label || <em className="font-normal text-zinc-400">Untitled</em>}
                            {a.required && <span className="text-accent-600"> *</span>}
                          </span>
                          <span className="block truncate text-xs text-zinc-500">
                            {ATTR_TYPE[a.type].label} · <span className="font-mono">{a.key}</span>
                            {a.default !== undefined && <> · default {typeof a.default === 'boolean' ? (a.default ? 'Yes' : 'No') : String(a.default)}</>}
                          </span>
                        </button>
                        <button type="button" aria-label={`Edit ${a.label || 'attribute'}`} className="p-1.5 text-zinc-500 hover:text-ink" onClick={() => setAttrDialog({ index: i, value: a })}>
                          <Pencil className="size-4" />
                        </button>
                        <button type="button" aria-label={`Remove ${a.label || 'attribute'}`} className="p-1.5 text-zinc-400 hover:text-[#7a1f24]" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}>
                          <Trash2 className="size-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState
                  icon={ListPlus}
                  title="No attributes yet"
                  action={
                    <Button icon={Plus} onClick={() => setAttrDialog({ index: null, value: { key: '', label: '', type: 'text' } })}>
                      Add your first attribute
                    </Button>
                  }
                >
                  Attributes are the facts you record about each {f.name.toLowerCase() || 'one'}, such as population, opening date or status. They appear on its page and can be filled in from forms.
                </EmptyState>
              )}
              {attrDialog && (
                <AttributeDialog
                  value={attrDialog.value}
                  isNew={attrDialog.index === null}
                  takenKeys={attrs.filter((_, j) => j !== attrDialog.index).map((x) => x.key)}
                  onClose={() => setAttrDialog(null)}
                  onSave={(a) => {
                    setAttrs(attrDialog.index === null ? [...attrs, a] : attrs.map((x, j) => (j === attrDialog.index ? a : x)));
                    setAttrDialog(null);
                  }}
                />
              )}
            </>
          </section>
        </div>
      </div>
    </Dialog>
  );
}

/** English plural of a type name: Facility → Facilities, Bus → Buses, Well → Wells. */
const pluralize = (name: string) => {
  const n = name.trim();
  if (!n) return '';
  const word = /[^\s]+$/.exec(n)?.[0] ?? n;
  if (/[^aeiou]y$/i.test(word)) return `${n.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${n}es`;
  return `${n}s`;
};

const ATTR_TYPE: Record<AttributeDef['type'], { label: string; text: string; icon: LucideIcon }> = {
  text: { label: 'Text', text: 'Words or a short note', icon: Type },
  number: { label: 'Number', text: 'A number that can have decimals, like 12.5', icon: Percent },
  integer: { label: 'Integer', text: 'A count, like 24', icon: Hash },
  boolean: { label: 'Boolean', text: 'Yes or no (true or false)', icon: ToggleLeft },
  date: { label: 'Date', text: 'A calendar date', icon: Calendar },
  select: { label: 'Select', text: 'Pick one from a list you define', icon: ListChecks },
  email: { label: 'Email', text: 'An email address', icon: Mail },
  url: { label: 'URL', text: 'A website address', icon: Link2 },
  phone: { label: 'Phone', text: 'A phone number', icon: Phone },
};
const ATTR_TYPE_OPTIONS = ATTRIBUTE_TYPES.map((t) => ({ value: t, label: ATTR_TYPE[t].label, description: ATTR_TYPE[t].text, icon: ATTR_TYPE[t].icon, text: `${t} ${ATTR_TYPE[t].label}` }));

const fieldInput = 'h-9 w-full border border-zinc-300 bg-snow px-3 text-sm focus:border-accent-600 focus:outline-none';
const snake = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** The choices of a select attribute: one box each, Enter adds the next, pasting several lines adds them all. */
function OptionsEditor({ options, onChange }: { options: string[]; onChange(o: string[]): void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [rows, setRows] = useState<string[]>(options.length ? options : ['']);
  const focus = (i: number) => setTimeout(() => refs.current[i]?.focus(), 0);
  const set = (next: string[]) => {
    setRows(next);
    onChange([...new Set(next.map((x) => x.trim()).filter(Boolean))]);
  };
  const dupe = (i: number) => !!rows[i]?.trim() && rows.findIndex((x) => x.trim() === rows[i]!.trim()) !== i;
  return (
    <Field label="Options" required intro="The choices people can pick from">
      <div className="space-y-2">
        {rows.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              icon={ListChecks}
              aria-label={`Option ${i + 1}`}
              placeholder={`Option ${i + 1}`}
              className="min-w-0 flex-1"
              ref={(el: HTMLInputElement | null) => void (refs.current[i] = el)}
              value={o}
              aria-invalid={dupe(i) || undefined}
              onChange={(e) => set(rows.map((x, j) => (j === i ? e.target.value : x)))}
              onPaste={(e) => {
                const lines = e.clipboardData.getData('text').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
                if (lines.length < 2) return;
                e.preventDefault();
                set([...rows.slice(0, i), ...lines, ...rows.slice(i + 1).filter(Boolean)]);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (!o.trim()) return;
                  set([...rows.slice(0, i + 1), '', ...rows.slice(i + 1)]);
                  focus(i + 1);
                } else if (e.key === 'Backspace' && !o && rows.length > 1) {
                  e.preventDefault();
                  set(rows.filter((_, j) => j !== i));
                  focus(Math.max(0, i - 1));
                }
              }}
            />
            <button type="button" aria-label={`Move option ${i + 1} up`} disabled={i === 0} className="p-1 text-zinc-500 hover:text-ink disabled:opacity-30" onClick={() => set(rows.map((x, j) => (j === i - 1 ? rows[i]! : j === i ? rows[i - 1]! : x)))}>
              <ArrowUp className="size-4" />
            </button>
            <button type="button" aria-label={`Move option ${i + 1} down`} disabled={i === rows.length - 1} className="p-1 text-zinc-500 hover:text-ink disabled:opacity-30" onClick={() => set(rows.map((x, j) => (j === i + 1 ? rows[i]! : j === i ? rows[i + 1]! : x)))}>
              <ArrowDown className="size-4" />
            </button>
            <button type="button" aria-label={`Remove option ${i + 1}`} className="p-1 text-zinc-500 hover:text-red-700" onClick={() => set(rows.length > 1 ? rows.filter((_, j) => j !== i) : [''])}>
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          onClick={() => {
            set([...rows, '']);
            focus(rows.length);
          }}
        >
          Add option
        </Button>
      </div>
    </Field>
  );
}

/** The default-value input for one attribute, suited to its type. */
function DefaultInput({ a, onChange }: { a: AttributeDef; onChange(v: AttributeDef['default']): void }) {
  const v = a.default;
  if (a.type === 'boolean')
    return (
      <Listbox
        label="Default"
        value={v === undefined ? 'none' : String(v)}
        onChange={(x) => onChange(x === 'none' ? undefined : x === 'true')}
        options={[
          { value: 'none', label: 'None' },
          { value: 'true', label: 'Yes' },
          { value: 'false', label: 'No' },
        ]}
      />
    );
  if (a.type === 'select')
    return (
      <Listbox
        label="Default"
        value={typeof v === 'string' ? v : 'none'}
        onChange={(x) => onChange(x === 'none' ? undefined : x)}
        options={[{ value: 'none', label: 'None' }, ...(a.options ?? []).map((o) => ({ value: o, label: o }))]}
      />
    );
  if (a.type === 'number' || a.type === 'integer')
    return <input aria-label="Default" type="number" step={a.type === 'integer' ? 1 : 'any'} value={typeof v === 'number' ? v : ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} className={fieldInput} />;
  if (a.type === 'date') return <DatePicker aria-label="Default" value={typeof v === 'string' ? v : ''} onChange={(d) => onChange(d || undefined)} />;
  const hint = { email: 'name@example.com', url: 'https://example.com', phone: '+1 767 555 0100', text: '' }[a.type as 'email' | 'url' | 'phone' | 'text'] ?? '';
  return (
    <Input
      icon={ATTR_TYPE[a.type].icon}
      aria-label="Default"
      type={a.type === 'email' ? 'email' : a.type === 'url' ? 'url' : a.type === 'phone' ? 'tel' : 'text'}
      inputMode={a.type === 'phone' ? 'tel' : undefined}
      placeholder={hint}
      value={typeof v === 'string' ? v : ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      aria-invalid={!!attributeProblem(a, v) || undefined}
    />
  );
}

/** Add or edit one attribute of an entity type, in a small modal of its own. */
function AttributeDialog({ value, isNew, takenKeys, onSave, onClose }: { value: AttributeDef; isNew: boolean; takenKeys: string[]; onSave(a: AttributeDef): void; onClose(): void }) {
  const [a, setA] = useState(value);
  const [keyEdited, setKeyEdited] = useState(!isNew);
  const clash = !!a.key && takenKeys.includes(a.key);
  const problem = attributeProblem(a, a.default);
  const valid = !!a.label.trim() && !!a.key && !clash && !problem && (a.type !== 'select' || !!a.options?.length);
  const patch = (p: Partial<AttributeDef>) => setA({ ...a, ...p });
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Add attribute' : `Edit ${value.label || 'attribute'}`}
      description="A fact you record about each one."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={() => onSave({ ...a, label: a.label.trim() })}>
            {isNew ? 'Add attribute' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-4">
          <Field label="Label" required intro="What people see, e.g. Number of beds">
            <Input icon={Type} autoFocus value={a.label} onChange={(e) => patch({ label: e.target.value, ...(keyEdited ? {} : { key: snake(e.target.value) }) })} />
          </Field>
          <Field label="Key" intro={clash ? 'Another attribute already uses this key' : 'Used in imports and logic'}>
            <Input
              icon={Hash}
              value={a.key}
              onChange={(e) => {
                setKeyEdited(true);
                patch({ key: snake(e.target.value) });
              }}
              className="font-mono"
              aria-invalid={clash || undefined}
            />
          </Field>
        </div>
        <Field label="Type" intro="What kind of value it holds">
          <Listbox
            searchable
            label="Type"
            value={a.type}
            options={ATTR_TYPE_OPTIONS}
            onChange={(t) => patch({ type: t, default: undefined })}
          />
        </Field>
        {a.type === 'select' && (
          <OptionsEditor options={a.options ?? []} onChange={(options) => patch({ options, ...(typeof a.default === 'string' && !options.includes(a.default) ? { default: undefined } : {}) })} />
        )}
        <Field label="Default value" intro="Pre-filled on new ones. Leave empty for none" error={problem ?? undefined}>
          <DefaultInput a={a} onChange={(v) => patch({ default: v })} />
        </Field>
        <div className="space-y-2 border-t border-zinc-200 pt-4">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input type="checkbox" checked={!!a.sensitive} onChange={(e) => patch({ sensitive: e.target.checked })} className="mt-0.5 size-4 accent-[var(--brand-600)]" />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <EyeOff className="size-3.5 text-zinc-500" /> Confidential
              </span>
              <span className="block text-xs text-zinc-500">Shown as •••• wherever it is displayed</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input type="checkbox" checked={!!a.required} onChange={(e) => patch({ required: e.target.checked })} className="mt-0.5 size-4 accent-[var(--brand-600)]" />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <Asterisk className="size-3.5 text-zinc-500" /> Required
              </span>
              <span className="block text-xs text-zinc-500">A value must be entered</span>
            </span>
          </label>
        </div>
      </div>
    </Dialog>
  );
}

const GEOMETRY_ICON: Record<EntityTypeDto['geometry'], LucideIcon> = { none: Ban, point: MapPin, polygon: Pentagon, line: Spline };


export function Members() {
  const { tenantId, project, can } = useProject();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['project-members', tenantId, project.key], queryFn: () => api.projectMembers(tenantId, project.key) });
  const [editing, setEditing] = useState<ProjectMemberDto | 'new' | null>(null);
  const [removing, setRemoving] = useState<ProjectMemberDto | null>(null);
  const groups = usePermissionGroups();
  const manager = can('manager');
  const save = (data: ProjectMemberDto[]) => qc.setQueryData(['project-members', tenantId, project.key], data);
  return (
    <>
      <SectionHead title="Members" description="Organisation admins manage every project. Members of the Admin permission manage this one. Scope a member to one entity to limit them to its part of the hierarchy." actions={manager ? <Button size="sm" icon={UserPlus} onClick={() => setEditing('new')}>Add member</Button> : undefined} />
      <Panel flush>
      <ErrorNotice error={members.error} />
      <Table head={['Person', 'Scope', 'Permissions', '']}>
        {members.data?.map((m) => {
          const name = m.name ?? m.email ?? '';
          return (
            <tr key={m.userId} className="border-t border-zinc-100">
              <Td>
                <div className="flex items-center gap-2 font-medium">
                  {name}
                  {m.implicit && <Tag>Organisation admin</Tag>}
                </div>
                <div className="text-xs text-zinc-500">{m.email}</div>
              </Td>
              <Td>{m.rootEntities.length ? <span title={m.rootEntities.map((r) => r.name).join(', ')}>Custom</span> : <span className="text-zinc-500">Project</span>}</Td>
              <Td>{m.implicit ? <span className="text-zinc-500">Sees everything</span> : (m.permissionGroups.flatMap((id) => groups.data?.find((g) => g.id === id)?.name ?? []).join(', ') || <span className="text-zinc-500">None</span>)}</Td>
              <Td>
                {manager && !m.implicit && (
                  <div className="flex justify-end gap-1">
                    <button type="button" aria-label={`Edit ${name}`} title="Edit" className="p-1.5 text-zinc-500 hover:text-ink" onClick={() => setEditing(m)}>
                      <Pencil className="size-4" />
                    </button>
                    <button type="button" aria-label={`Remove ${name}`} title="Remove" className="p-1.5 text-zinc-500 hover:text-[#7a1f24]" onClick={() => setRemoving(m)}>
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                )}
              </Td>
            </tr>
          );
        })}
      </Table>
      {editing && <MemberDialog member={editing === 'new' ? null : editing} members={members.data ?? []} onClose={() => setEditing(null)} onSaved={save} />}
      {removing && <RemoveMemberDialog member={removing} onClose={() => setRemoving(null)} onRemoved={save} />}
    </Panel>
    </>
  );
}

/** Asks before taking a member off the project. */
function RemoveMemberDialog({ member, onClose, onRemoved }: { member: ProjectMemberDto; onClose(): void; onRemoved(data: ProjectMemberDto[]): void }) {
  const { tenantId, project } = useProject();
  const name = member.name ?? member.email ?? 'this person';
  const remove = useMutation({
    mutationFn: () => api.removeProjectMember(tenantId, project.key, member.userId),
    onSuccess: (data) => {
      onRemoved(data);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      tone="danger"
      title={`Remove ${name}?`}
      footer={
        <>
          <Button variant="secondary" icon={X} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon={Trash2} onClick={() => remove.mutate()} loading={remove.isPending}>
            Remove member
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNotice error={remove.error} />
        <p className="text-sm text-zinc-700">
          <b>{name}</b> will lose access to <b>{project.name}</b> and everything their permissions gave them. They stay in the organisation and you can add them back at any time.
        </p>
      </div>
    </Dialog>
  );
}

/** Adds a member, or edits one. */
function MemberDialog({ member, members, onClose, onSaved }: { member: ProjectMemberDto | null; members: ProjectMemberDto[]; onClose(): void; onSaved(data: ProjectMemberDto[]): void }) {
  const { tenantId, project } = useProject();
  const ws = useWorkspace();
  const org = useQuery({ queryKey: ['members', ws.tenant.id], queryFn: () => api.members(ws.tenant.id), enabled: !member });
  const groups = usePermissionGroups();
  const [userId, setUserId] = useState(member?.userId ?? '');
  // New members start with the project's public permission.
  const [picked, setPicked] = useState<string[] | null>(member ? member.permissionGroups : null);
  const held = picked ?? (groups.data?.filter((g) => g.kind === 'public').map((g) => g.id) ?? []);
  // null = the whole project; a list = limited to those entities.
  const [scope, setScope] = useState<ScopeEntity[] | null>(member?.rootEntities.length ? member.rootEntities : null);
  const done = (data: ProjectMemberDto[]) => {
    onSaved(data);
    onClose();
  };
  const save = useMutation({
    mutationFn: () => api.setProjectMember(tenantId, project.key, { userId, rootEntityIds: (scope ?? []).map((e) => e.id), permissionGroups: held }),
    onSuccess: done,
  });
  const candidates = (org.data?.members ?? []).filter((m) => m.status === 'active' && !members.some((x) => x.userId === m.userId && !x.implicit));
  return (
    <Dialog
      open
      onClose={onClose}
      title={member ? `Edit ${member.name ?? member.email}` : 'Add a member'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!userId || scope?.length === 0}>
            {member ? 'Save member' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={org.error ?? save.error} />
        {member ? (
          <div>
            <div className="font-medium">{member.name ?? member.email}</div>
            <div className="text-xs text-zinc-500">{member.email}</div>
          </div>
        ) : (
          <Field label="Person" intro="Member of the organisation to add to this project">
            <Listbox
              label="Person"
              searchable
              placeholder="Select a person"
              value={userId || null}
              onChange={setUserId}
              options={candidates.map((m) => ({ value: m.userId, label: m.displayName ?? m.email ?? 'Member', description: m.displayName ? (m.email ?? undefined) : undefined, text: `${m.displayName ?? ''} ${m.email ?? ''}`, icon: UserRound }))}
            />
          </Field>
        )}
        {!!groups.data?.length && (
          <Field label="Permissions" intro="Decide which forms, dashboards and overlays they see. Admin makes them a project manager">
            <PermissionPicker groups={groups.data} value={held} onChange={setPicked} />
          </Field>
        )}
        <Field label="Scope" intro="Limit them to some entities and everything under them. Default is the whole project">
          <ScopePicker value={scope} onChange={setScope} />
        </Field>
      </div>
    </Dialog>
  );
}
