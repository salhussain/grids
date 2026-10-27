import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ROOT_PARENT, type AttributeDef, type EntityDetail, type EntityTypeDto, type PointGeometry } from '@grids/schema';
import { Button, DatePicker, Dialog, Empty, ErrorNotice, Field, Input, Listbox, Loading, Pagination, Select, Table, Td, Tag, Textarea, cx, relTime, usePagination, useToast, SectionHead, EmptyState } from '@grids/ui';
import { Boxes, Check, Crosshair, Eraser, ChevronDown, Eye, EyeOff, ChevronRight, FileUp, Filter, Hash, LocateFixed, List, ListTree, Lock, MapPin, Network, Pencil, Plus, Search, Shapes, Tag as TagIcon, X, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api';
import { contrastOn } from '../../theme';
import { iconOf, useProject } from './context';
import { centroidOf, parseBoundary } from './geo';

export function useTypes() {
  const { tenantId, project } = useProject();
  return useQuery({ queryKey: ['types', tenantId, project.key], queryFn: () => api.types(tenantId, project.key) });
}

export const fmtAttr = (def: AttributeDef | undefined, v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  if (def?.sensitive) return '••••••••';
  if (def?.type === 'boolean' || typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return `${v.toLocaleString()}${def?.unit ? ` ${def.unit}` : ''}`;
  return String(v);
};

export function EntitiesTab() {
  const { tenantId, project, base, can } = useProject();
  const types = useTypes();
  // Types to show; none picked means all of them.
  const initial = (useSearch({ strict: false }) as { type?: string }).type;
  const [picked, setPicked] = useState<string[]>(() => (initial ? initial.split(',').filter(Boolean) : []));
  const [mode, setMode] = useState<'tree' | 'list'>(initial ? 'list' : 'tree');
  const [q, setQ] = useState('');
  // Types and search only apply to the flat list; the tree is always the whole hierarchy.
  const filter = mode === 'list' ? picked : [];
  const search = mode === 'list' ? q : '';
  const type = filter.length === 1 ? filter[0]! : null;
  const [pg, setPg] = usePagination([filter.join(','), search], 25);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const list = useQuery({
    queryKey: ['entities', tenantId, project.key, filter, search, pg],
    queryFn: () => api.entities(tenantId, project.key, { ...pg, type: filter.length ? filter.join(',') : undefined, q: search || undefined }),
    placeholderData: keepPreviousData,
  });
  const current = types.data?.find((t) => t.key === type);
  // The tree is the whole hierarchy. Searching and filtering by type belong to the flat list.
  const showTree = mode === 'tree';
  const summaryAttrs = (current?.attributes ?? []).filter((a) => a.summary).slice(0, 4);

  if (types.isPending)
    return (
      <div>
        <SectionHead title="Entities" description="The places, assets and people this project tracks." />
        <Loading />
      </div>
    );
  if (!types.data?.length)
    return (
      <div>
        <SectionHead title="Entities" description="The places, assets and people this project tracks." />
        <EmptyState
          icon={Boxes}
          title="No entity types yet"
          action={can('manager') ? <Link to={`${base}/types`} className="inline-flex h-9 items-center bg-accent-600 px-3.5 text-sm font-medium text-on-accent hover:bg-accent-700">Define entity types</Link> : undefined}
        >
          Entities are the places, assets and people this project tracks. Define at least one entity type first, then add entities or import them from a file.
        </EmptyState>
      </div>
    );

  return (
    <div className="space-y-4">
      <SectionHead
        title="Entities"
        description="The places, assets and people this project tracks."
        actions={
          can('manager') && types.data.some((t) => !t.orgId) ? (
            <>
              <Button size="sm" variant="secondary" icon={FileUp} onClick={() => setImporting(true)}>
                Import
              </Button>
              <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
                Add
              </Button>
            </>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="View" className="flex gap-px border border-zinc-300 bg-zinc-300">
          {(
            [
              ['tree', 'Tree', ListTree],
              ['list', 'List', List],
            ] as const
          ).map(([v, label, I]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={mode === v}
              onClick={() => setMode(v)}
              className={cx('flex items-center gap-1.5 px-3 py-1.5 text-sm', mode !== v && 'bg-snow hover:bg-zinc-50')}
              style={mode === v ? { background: `color-mix(in srgb, ${project.color} 14%, var(--color-snow))`, color: `color-mix(in srgb, ${project.color} 70%, var(--color-ink))`, fontWeight: 500 } : undefined}
            >
              <I className="size-4" /> {label}
            </button>
          ))}
        </div>
        {mode === 'list' && <TypeFilter types={types.data} value={picked} onChange={setPicked} />}
        {mode === 'list' && (
        <div className="relative ms-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-zinc-400" />
          <Input aria-label="Search entities" placeholder="Search name or code" value={q} onChange={(e) => setQ(e.target.value)} className="ps-8" />
        </div>
        )}
      </div>
      {showTree ? (
        <div className="border border-zinc-200 bg-snow">
          <EntityTree types={types.data} />
        </div>
      ) : (
      <div className="border border-zinc-200 bg-snow">
        <ErrorNotice error={list.error} />
        <Table
          head={['Name', 'Code', ...(current ? [] : ['Type']), 'Parent', ...summaryAttrs.map((a) => a.label), 'Updated']}
          empty={<Empty icon={Boxes} title={search ? 'No matches' : 'Nothing here yet'} />}
        >
          {list.data?.items.map((e) => {
            const Icon = iconOf(e.type.icon);
            return (
              <tr key={e.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                <Td>
                  <Link to={`${base}/entities/${e.id}`} className="flex items-center gap-2 font-medium text-accent-700 hover:underline">
                    <Icon className="size-4 shrink-0" style={{ color: e.type.color }} />
                    {e.name}
                    {e.shared && <Tag>Shared</Tag>}
                  </Link>
                </Td>
                <Td className="font-mono text-xs">{e.code}</Td>
                {!current && (
                  <Td>
                    <Tag>{e.type.name}</Tag>
                  </Td>
                )}
                <Td className="text-zinc-600">{e.parent?.name ?? project.name}</Td>
                {summaryAttrs.map((a) => (
                  <Td key={a.key} className={cx(typeof e.attributes[a.key] === 'number' && 'num')}>
                    {fmtAttr(a, e.attributes[a.key])}
                  </Td>
                ))}
                <Td className="text-xs text-zinc-500">{relTime(e.updatedAt)}</Td>
              </tr>
            );
          })}
        </Table>
        {list.data && <Pagination {...pg} total={list.data.total} onChange={setPg} />}
      </div>
      )}
      {adding && <EntityDialog types={types.data.filter((t) => !t.orgId)} defaultType={type && !current?.orgId ? type : null} onClose={() => setAdding(false)} />}
      {importing && <ImportDialog types={types.data.filter((t) => !t.orgId)} defaultType={type && !current?.orgId ? type : null} onClose={() => setImporting(false)} />}
    </div>
  );
}

/** Searchable picker over entities of the allowed parent types. */
function ParentPicker({ parentTypes: all, value, onChange, ops }: { parentTypes: string[]; value: { id: string; name: string } | null; onChange(v: { id: string; name: string } | null): void; ops: EntityOps }) {
  const [q, setQ] = useState('');
  const parentTypes = all.filter((t) => t !== ROOT_PARENT);
  const results = useQuery({
    queryKey: ['parent-search', ops.scope, parentTypes, q],
    queryFn: async () => (await Promise.all(parentTypes.map((t) => ops.search(t, q)))).flat(),
    enabled: parentTypes.length > 0,
    placeholderData: keepPreviousData,
  });
  const found = results.data ?? [];
  const optional = all.includes(ROOT_PARENT);
  const options = [
    ...(optional ? [{ value: '__none', label: 'No parent', description: 'Place it at the project level' }] : []),
    ...(value && !found.some((r) => r.id === value.id) ? [{ value: value.id, label: value.name }] : []),
    ...found.map((r) => ({ value: r.id, label: r.name, description: r.type.name, text: `${r.name} ${r.type.name}` })),
  ];
  return (
    <Field label="Parent" intro={optional ? 'Optional. Search by name' : 'Search by name'}>
      <Listbox
        searchable
        onSearch={setQ}
        label="Parent"
        value={value?.id ?? (optional ? '__none' : null)}
        placeholder={`Choose a ${parentTypes.length === 1 ? parentTypes[0] : 'parent'}`}
        options={options}
        onChange={(id) => (id === '__none' ? onChange(null) : onChange({ id, name: found.find((r) => r.id === id)?.name ?? value?.name ?? '' }))}
      />
    </Field>
  );
}

/** A confidential value: hidden while typed, with an eye to see it. */
function SensitiveInput({ label, value, onChange }: { label: string; value: string; onChange(v: unknown): void }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <Input icon={Lock} aria-label={label} type={shown ? 'text' : 'password'} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" aria-label={shown ? 'Hide value' : 'Show value'} title={shown ? 'Hide' : 'Show'} className="p-1 text-zinc-500 hover:text-ink" onClick={() => setShown(!shown)}>
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function AttributeInput({ def, value, onChange }: { def: AttributeDef; value: unknown; onChange(v: unknown): void }) {
  const common = { 'aria-label': def.label };
  switch (def.type) {
    case 'boolean':
      return (
        <Select {...common} value={value === true ? 'true' : value === false ? 'false' : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </Select>
      );
    case 'select':
      return (
        <Select {...common} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {def.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </Select>
      );
    case 'number':
    case 'integer':
      return <Input {...common} type="number" step={def.type === 'integer' ? 1 : 'any'} value={(value as number) ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'date':
      return <DatePicker aria-label={common['aria-label']} value={(value as string) ?? ''} onChange={(d) => onChange(d || null)} />;
    default:
      if (def.sensitive) return <SensitiveInput label={def.label} value={(value as string) ?? ''} onChange={onChange} />;
      return <Input {...common} type={def.type === 'email' ? 'email' : def.type === 'url' ? 'url' : def.type === 'phone' ? 'tel' : 'text'} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Create or edit an entity: code, name, parent, attributes and location. */
/** What the entity forms need from the server: a project's entities, or the organisation's shared ones. */
export interface EntityOps {
  /** Keeps caches of different places apart. */
  scope: string;
  create(input: Parameters<typeof api.createEntity>[2]): Promise<{ id: string }>;
  update(id: string, input: Parameters<typeof api.updateEntity>[3]): Promise<{ id: string }>;
  search(type: string, q: string): Promise<{ id: string; name: string; type: { name: string } }[]>;
  importRows(input: { typeKey?: string; rows: Record<string, string | number | boolean | null>[] }): Promise<{ created: number; updated: number; unchanged: number; skipped: number }>;
  /** After a save: refresh lists, and say where to go next. */
  saved(e: { id: string }, created: boolean): void;
  imported(): void;
}

/** The entity operations of the current project. */
export function useProjectEntityOps(): EntityOps {
  const { tenantId, project, base } = useProject();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return {
    scope: `${tenantId}:${project.key}`,
    create: (input) => api.createEntity(tenantId, project.key, input),
    update: (id, input) => api.updateEntity(tenantId, project.key, id, input),
    search: async (type, q) => (await api.entities(tenantId, project.key, { type, q: q || undefined, pageSize: 10 })).items,
    importRows: (input) => api.importRows(tenantId, project.key, input),
    saved: (e, created) => {
      void qc.invalidateQueries({ queryKey: ['entities', tenantId, project.key] });
      void qc.invalidateQueries({ queryKey: ['types', tenantId, project.key] });
      qc.setQueryData(['entity', tenantId, project.key, e.id], e);
      if (created) void navigate({ to: `${base}/entities/${e.id}` });
    },
    imported: () => {
      void qc.invalidateQueries({ queryKey: ['entities', tenantId, project.key] });
      void qc.invalidateQueries({ queryKey: ['types', tenantId, project.key] });
    },
  };
}

/** A section of a form window: a header with an icon, a title and a line of help, then the fields. */
function Part({ icon: I, title, text, children }: { icon: LucideIcon; title: string; text?: string; children: React.ReactNode }) {
  return (
    <section className="border border-zinc-200 bg-snow">
      <header className="flex items-center gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center bg-accent-50 text-accent-700">
          <I className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {text && <p className="text-xs text-zinc-500">{text}</p>}
        </div>
      </header>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

export function EntityDialog(props: { types: EntityTypeDto[]; defaultType: string | null; entity?: EntityDetail; onClose(): void }) {
  return <EntityForm {...props} ops={useProjectEntityOps()} />;
}

export function EntityForm({ types, defaultType, entity, onClose, ops }: { types: EntityTypeDto[]; defaultType: string | null; entity?: EntityDetail; onClose(): void; ops: EntityOps }) {
  const toast = useToast();
  const [typeKey, setTypeKey] = useState(entity?.type.key ?? defaultType ?? types[0]!.key);
  const type = types.find((t) => t.key === typeKey)!;
  const [code, setCode] = useState(entity?.code ?? '');
  const [name, setName] = useState(entity?.name ?? '');
  const [parent, setParent] = useState<{ id: string; name: string } | null>(entity?.parent ?? null);
  const defaultsOf = (t: EntityTypeDto) => Object.fromEntries(t.attributes.filter((x) => x.default !== undefined).map((x) => [x.key, x.default]));
  const [attrs, setAttrs] = useState<Record<string, unknown>>(entity?.attributes ?? defaultsOf(types.find((t) => t.key === (defaultType ?? types[0]!.key)) ?? types[0]!));
  // Location: an optional boundary, and an optional point (the place itself, or a boundary's centre).
  const located = type.geometry !== 'none' || !!entity?.geometry || !!entity?.point;
  const shape = entity?.geometry && entity.geometry.type !== 'Point' ? entity.geometry : null;
  const spot =
    entity?.geometry?.type === 'Point'
      ? (entity.geometry.coordinates as [number, number])
      : (entity?.point?.coordinates ?? null);
  const [boundary, setBoundary] = useState(shape ? JSON.stringify(shape) : '');
  const [lat, setLat] = useState(spot ? String(spot[1]) : '');
  const [lon, setLon] = useState(spot ? String(spot[0]) : '');
  const location = () => {
    const b = boundary.trim() ? parseBoundary(boundary) : null;
    const p: PointGeometry | null =
      lat !== '' && lon !== '' ? { type: 'Point', coordinates: [Number(lon), Number(lat)] } : null;
    // A place without a boundary is just its point.
    return b ? { geometry: b, point: p } : { geometry: p, point: null };
  };
  const save = useMutation({
    mutationFn: () => {
      const loc = located ? location() : {};
      return entity
        ? ops.update(entity.id, {
            code,
            name,
            attributes: attrs,
            parentId: parent?.id ?? null,
            version: entity.version,
            ...loc,
          })
        : ops.create({
            typeKey,
            code,
            name,
            attributes: attrs,
            parentId: parent?.id ?? null,
            ...loc,
          });
    },
    onSuccess: (e) => {
      ops.saved(e, !entity);
      toast(entity ? 'Saved' : `${type.name} added`);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={entity ? `Edit ${entity.name}` : `Add ${type.name.toLowerCase()}`}
      description={entity ? `${type.name} · ${entity.code}` : `Adds a ${type.name.toLowerCase()} to the project. Only the code and name are needed.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!code || !name}>
            {entity ? 'Save' : `Add ${type.name.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ErrorNotice error={save.error} />
        <Part icon={Shapes} title="What it is" text="Its kind, a code and a name">
          <div className="space-y-4">
            {!entity && (
              <Field label="Type" intro="The kind of thing">
                <Listbox
                  label="Type"
                  value={typeKey}
                  options={types.map((t) => ({ value: t.key, label: t.name, icon: iconOf(t.icon) }))}
                  onChange={(k) => {
                    setTypeKey(k);
                    setAttrs(defaultsOf(types.find((t) => t.key === k)!));
                  }}
                />
              </Field>
            )}
            <Field label="Code" required intro="Unique within the type">
              <Input icon={Hash} value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field label="Name" required intro="Shown on maps and lists">
              <Input icon={TagIcon} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
        </Part>
        {type.parentTypes.some((t) => t !== ROOT_PARENT) && (
          <Part icon={Network} title="Where it sits" text="What it belongs under">
            <ParentPicker parentTypes={type.parentTypes} value={parent} onChange={setParent} ops={ops} />
          </Part>
        )}
        {type.attributes.length > 0 && (
          <Part icon={List} title={`${type.name} details`} text="What the project records">
            <div className="space-y-4">
              {type.attributes.map((a) => (
                <Field key={a.key} label={`${a.label}${a.unit ? ` (${a.unit})` : ''}`} required={a.required}>
                  <AttributeInput def={a} value={attrs[a.key]} onChange={(v) => setAttrs({ ...attrs, [a.key]: v })} />
                </Field>
              ))}
            </div>
          </Part>
        )}
        {located && (
          <Part icon={MapPin} title="Location" text="Where it is on the map">
            <LocationFields
              boundaryFirst={type.geometry === 'polygon' || type.geometry === 'line' || !!shape}
              boundary={boundary}
              setBoundary={setBoundary}
              lat={lat}
              lon={lon}
              setPoint={(la, lo) => (setLat(la), setLon(lo))}
            />
          </Part>
        )}
      </div>
    </Dialog>
  );
}

/** An entity's boundary (GeoJSON, dropped, chosen as a file or typed) and its point (typed, from the boundary's centre, or the device). */
function LocationFields({
  boundaryFirst,
  boundary,
  setBoundary,
  lat,
  lon,
  setPoint,
}: {
  boundaryFirst: boolean;
  boundary: string;
  setBoundary(v: string): void;
  lat: string;
  lon: string;
  setPoint(lat: string, lon: string): void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [over, setOver] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => {
    if (!boundary.trim()) return null;
    try {
      return parseBoundary(boundary);
    } catch {
      return null;
    }
  }, [boundary]);
  const take = async (f: File | undefined) => {
    if (!f) return;
    try {
      setBoundary(JSON.stringify(parseBoundary(await f.text())));
      setProblem(null);
      setManual(false);
    } catch (err) {
      setProblem((err as Error).message);
    }
  };
  const fromBoundary = () => {
    try {
      const c = centroidOf(parseBoundary(boundary));
      if (c) setPoint(String(c.coordinates[1]), String(c.coordinates[0]));
      setProblem(null);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  const boundaryBlock = (
    <div className="space-y-2">
      <div>
        <div className="text-[13px] font-medium text-zinc-700">Boundary</div>
        <p className="text-xs text-zinc-500">Optional. The area it covers, highlighted on maps (GeoJSON polygon, multipolygon or line)</p>
      </div>
      <input ref={file} type="file" accept=".geojson,.json,application/geo+json,application/json" className="sr-only" onChange={(e) => (void take(e.target.files?.[0]), (e.target.value = ''))} />
      {parsed && !manual ? (
        <div className="flex items-center gap-3 border border-accent-600 bg-accent-50 px-3 py-2.5 text-sm">
          <Shapes className="size-4 shrink-0 text-accent-700" aria-hidden />
          <span className="min-w-0 flex-1">
            <b className="font-medium">{parsed.type === 'MultiPolygon' ? `${parsed.coordinates.length} polygons` : parsed.type}</b>
            <span className="block text-xs text-zinc-500">{boundary.length.toLocaleString()} characters</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>
            Replace
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setManual(true)}>
            Edit
          </Button>
          <button type="button" aria-label="Remove boundary" title="Remove" className="p-1 text-zinc-500 hover:bg-snow hover:text-red-700" onClick={() => (setBoundary(''), setProblem(null))}>
            <X className="size-4" />
          </button>
        </div>
      ) : manual ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            value={boundary}
            onChange={(e) => (setBoundary(e.target.value), setProblem(null))}
            onBlur={() => {
              if (!boundary.trim()) return;
              try {
                parseBoundary(boundary);
              } catch (e) {
                setProblem((e as Error).message);
              }
            }}
            placeholder='{"type": "Polygon", "coordinates": [...]}'
            className="min-h-28 font-mono text-xs"
            aria-label="Boundary as GeoJSON"
            aria-invalid={!!problem || undefined}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setManual(false)}>
              Done
            </Button>
            <Button size="sm" variant="ghost" onClick={() => file.current?.click()}>
              Load a file instead
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose or drop a GeoJSON file"
            onClick={() => file.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), file.current?.click())}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('Files')) return;
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void take(e.dataTransfer.files[0]);
            }}
            className={cx('flex cursor-pointer flex-col items-center gap-1.5 border border-dashed px-4 py-6 text-center focus-visible:outline-2 focus-visible:outline-accent-600', over ? 'border-accent-600 bg-accent-50' : 'border-zinc-300 bg-zinc-50 hover:border-accent-600 hover:bg-accent-50')}
          >
            <FileUp className="size-5 text-zinc-400" aria-hidden />
            <p className="text-[13px] text-zinc-700">{over ? 'Drop the file' : 'Drop a GeoJSON file here, or click to choose one'}</p>
            <p className="text-xs text-zinc-400">.geojson or .json</p>
          </div>
          <button type="button" onClick={() => setManual(true)} className="mx-auto flex items-center gap-1.5 text-sm font-medium text-accent-700 hover:underline">
            <Pencil className="size-3.5" /> Enter it manually
          </button>
        </div>
      )}
      {problem && <p className="text-xs text-red-700">{problem}</p>}
    </div>
  );
  const pointBlock = (
    <div className="space-y-3">
      {boundaryFirst && (
        <div>
          <div className="text-[13px] font-medium text-zinc-700">Centre point</div>
          <p className="text-xs text-zinc-500">Optional, to pin the area on maps</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude" intro="North or south">
          <Input icon={MapPin} type="number" step="any" min={-90} max={90} value={lat} onChange={(e) => setPoint(e.target.value, lon)} />
        </Field>
        <Field label="Longitude" intro="East or west">
          <Input icon={MapPin} type="number" step="any" min={-180} max={180} value={lon} onChange={(e) => setPoint(lat, e.target.value)} />
        </Field>
      </div>
      <Button className="w-full" icon={LocateFixed} onClick={() => navigator.geolocation?.getCurrentPosition((p) => setPoint(p.coords.latitude.toFixed(6), p.coords.longitude.toFixed(6)))}>
        Use my location
      </Button>
      {(boundary.trim() || lat || lon) && (
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1">
          {boundary.trim() && (
            <button type="button" onClick={fromBoundary} className="inline-flex items-center gap-1.5 py-1 text-sm font-medium text-accent-700 hover:underline">
              <Crosshair className="size-3.5" /> Use the boundary’s centre
            </button>
          )}
          {(lat || lon) && (
            <button type="button" onClick={() => setPoint('', '')} className="inline-flex items-center gap-1.5 py-1 text-sm text-zinc-600 hover:text-red-700">
              <Eraser className="size-3.5" /> Clear point
            </button>
          )}
        </div>
      )}
    </div>
  );
  return (
    <fieldset className="space-y-5">
      <legend className="sr-only">Location</legend>
      {boundaryFirst ? (
        <>
          {boundaryBlock}
          {pointBlock}
        </>
      ) : (
        <>
          {pointBlock}
          {boundaryBlock}
        </>
      )}
    </fieldset>
  );
}

/** Splits CSV text into rows of objects (RFC 4180 quoting). */
export function parseCsv(text: string, delimiter = ','): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === delimiter) {
      cur.push(f);
      f = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cur.push(f);
      rows.push(cur);
      cur = [];
      f = '';
    } else f += c;
  }
  if (f || cur.length) {
    cur.push(f);
    rows.push(cur);
  }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!head) return [];
  const keys = head.map((h) => h.trim().replace(/^\uFEFF/, ''));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

type ImportRow = Record<string, string | number | boolean | null>;

/** Rows from a dropped file: CSV/TSV, GeoJSON (each feature is a row, its geometry a column) or a JSON array. */
export async function readImportFile(file: File): Promise<ImportRow[]> {
  const text = (await file.text()).replace(/^﻿/, '');
  const head = text.trimStart();
  if (head.startsWith('{') || head.startsWith('[')) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('That file isn’t valid JSON.');
    }
    const flat = (o: Record<string, unknown>): ImportRow =>
      Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : (v as string | number | boolean | null)]));
    const j = json as { type?: string; features?: { id?: string | number; properties?: Record<string, unknown> | null; geometry?: unknown }[] };
    if (j.type === 'FeatureCollection' && Array.isArray(j.features))
      return j.features.map((f) => {
        const row = flat(f.properties ?? {});
        if (f.id !== undefined && !('code' in row)) row.code = String(f.id);
        if (f.geometry) row.geometry = JSON.stringify(f.geometry);
        return row;
      });
    if (j.type === 'Feature') throw new Error('Use a FeatureCollection: one feature per entity.');
    if (Array.isArray(json)) return json.map((o) => flat(o as Record<string, unknown>));
    throw new Error('Expected a GeoJSON FeatureCollection or a JSON array of rows.');
  }
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length] as const).sort((x, y) => y[1] - x[1])[0]![0];
  return parseCsv(text, delimiter);
}

function ImportDialog(props: { types: EntityTypeDto[]; defaultType: string | null; onClose(): void }) {
  return <ImportForm {...props} ops={useProjectEntityOps()} />;
}

const FIXED_COLUMNS = ['type', 'entity_type', 'code', 'name', 'parent', 'parent_code', 'parent_type', 'geometry', 'geom', 'wkt', 'boundary', 'lat', 'latitude', 'lon', 'lng', 'longitude'];

export function ImportForm({ types, defaultType, onClose, ops }: { types: EntityTypeDto[]; defaultType: string | null; onClose(): void; ops: EntityOps }) {
  const [typeKey, setTypeKey] = useState(defaultType ?? types[0]!.key);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const columns = useMemo(() => [...new Set((rows ?? []).flatMap((r) => Object.keys(r)))], [rows]);
  const lower = (c: string) => c.trim().toLowerCase();
  const typeCol = columns.find((c) => ['type', 'entity_type'].includes(lower(c)));
  const hasCode = columns.some((c) => lower(c) === 'code');
  // Each row's type: its own `type` cell (a key, name or plural), else the one picked above.
  const resolved = useMemo(() => {
    const byWord = new Map<string, EntityTypeDto>();
    for (const t of types) for (const w of [t.key, t.name, t.plural]) byWord.set(w.trim().toLowerCase(), t);
    const counts = new Map<string, number>();
    const unknown = new Set<string>();
    const typed = (rows ?? []).map((r) => {
      const raw = typeCol ? String(r[typeCol] ?? '').trim() : '';
      if (!raw) return types.find((t) => t.key === typeKey)!;
      const t = byWord.get(raw.toLowerCase());
      if (!t) unknown.add(raw);
      return t;
    });
    for (const t of typed) if (t) counts.set(t.key, (counts.get(t.key) ?? 0) + 1);
    return { typed, counts, unknown: [...unknown] };
  }, [rows, typeCol, typeKey, types]);
  const used = types.filter((t) => resolved.counts.has(t.key));
  const attrKeys = new Set(used.flatMap((t) => t.attributes.map((a) => a.key.toLowerCase())));
  const known = (c: string) => FIXED_COLUMNS.includes(lower(c)) || attrKeys.has(lower(c));
  const needsType = !typeCol || (rows ?? []).some((r) => !String(r[typeCol] ?? '').trim());

  const load = async (f: File | undefined) => {
    if (!f) return;
    setProblem(null);
    try {
      const r = await readImportFile(f);
      if (!r.length) throw new Error('No rows found in that file.');
      setRows(r);
      setFileName(f.name);
    } catch (e) {
      setRows(null);
      setFileName('');
      setProblem((e as Error).message);
    }
  };

  const run = useMutation({
    mutationFn: () => {
      // Send canonical type keys, so names and plurals in the file work too.
      const out = rows!.map((r, i) => ({ ...r, ...(typeCol && resolved.typed[i] ? { [typeCol]: resolved.typed[i]!.key } : {}) }));
      return ops.importRows({ typeKey, rows: out });
    },
    onSuccess: () => ops.imported(),
  });
  const blocked = !rows?.length || !hasCode || resolved.unknown.length > 0;
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Import entities"
      description="One file: CSV, TSV or GeoJSON. Existing codes are updated, new ones created, so re-importing is safe."
      footer={
        run.data ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => run.mutate()} loading={run.isPending} disabled={blocked}>
              Import {rows?.length ? `${rows.length.toLocaleString()} rows` : ''}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={run.error} />
        {run.data ? (
          <p className="text-sm">
            <b>{run.data.created}</b> created, <b>{run.data.updated}</b> updated, {run.data.unchanged} unchanged{run.data.skipped ? `, ${run.data.skipped} skipped` : ''}.
          </p>
        ) : (
          <>
            <label
              onDragOver={(e) => (e.preventDefault(), setOver(true))}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                void load(e.dataTransfer.files[0]);
              }}
              className={cx(
                'flex cursor-pointer flex-col items-center gap-1 border border-dashed px-4 py-8 text-center text-sm hover:border-zinc-600',
                over ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-300',
              )}
            >
              <FileUp className="size-5 text-zinc-500" />
              <span className="font-medium">{fileName || 'Drop a file here, or click to choose'}</span>
              <span className="text-xs text-zinc-500">.csv, .tsv, .geojson or .json</span>
              <input
                type="file"
                accept=".csv,.tsv,.txt,.geojson,.json,text/csv,application/json,application/geo+json"
                className="sr-only"
                onChange={(e) => {
                  void load(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            {problem && <p className="text-sm text-red-700">{problem}</p>}
            <p className="text-xs text-zinc-500">
              Columns: <code>code</code> (required), <code>type</code>, <code>name</code>, <code>parent_code</code>, <code>geometry</code> (GeoJSON or WKT) or <code>lat</code>/<code>lon</code>, then any attribute. GeoJSON properties become columns.
            </p>
            {rows && (
              <>
                {needsType && (
                  <Field label={typeCol ? 'Type for rows with none' : 'Entity type'} hint="The file has no type for these rows">
                    <Select value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
                      {types.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.plural}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {!hasCode && <p className="text-sm text-red-700">The file needs a “code” column.</p>}
                {resolved.unknown.length > 0 && <p className="text-sm text-red-700">Unknown type: {resolved.unknown.slice(0, 5).join(', ')}.</p>}
                {used.length > 0 && (
                  <p className="text-xs text-zinc-600">
                    {used.map((t) => `${resolved.counts.get(t.key)!.toLocaleString()} ${t.plural}`).join(' · ')}
                  </p>
                )}
                <div className="overflow-x-auto border border-zinc-200">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-50">
                      <tr>
                        {columns.map((c) => (
                          <th key={c} className={cx('px-2 py-1.5 text-start font-medium', !known(c) && 'text-zinc-400 line-through')} title={known(c) ? undefined : 'Ignored'}>
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 5).map((r, i) => (
                        <tr key={i} className="border-t border-zinc-100">
                          {columns.map((c) => (
                            <td key={c} className="max-w-48 truncate px-2 py-1">
                              {String(r[c] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** The whole hierarchy: the project at the top, then its entities, opened one level at a time. */
function EntityTree({ types }: { types: EntityTypeDto[] }) {
  const { tenantId, project } = useProject();
  // The project's own children are the top-level entities (the same list the tree opens with).
  const top = useQuery({ queryKey: ['entity-tree', tenantId, project.key, null], queryFn: () => api.places(tenantId, project.key, null) });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ProjectIcon = iconOf(project.icon);
  return (
    <Table head={['Name', 'Code', 'Type', 'Children', '']}>
      <tr className="border-t border-zinc-100 bg-zinc-50/70">
        <Td>
          <span className="flex items-center gap-2 font-medium">
            <ProjectIcon className="size-4 shrink-0" style={{ color: project.color }} />
            {project.name}
            <Tag>Built in</Tag>
          </span>
        </Td>
        <Td className="text-zinc-400">—</Td>
        <Td className="text-zinc-600">Project</Td>
        <Td className="num text-zinc-600">{top.data?.length ? top.data.length.toLocaleString() : '—'}</Td>
        <Td>
          <Lock className="size-4 text-zinc-400" aria-label="Built in" />
        </Td>
      </tr>
      <TreeLevel parent={null} depth={0} types={types} open={open} onToggle={toggle} />
    </Table>
  );
}

function TreeLevel({ parent, depth, types, open, onToggle }: { parent: string | null; depth: number; types: EntityTypeDto[]; open: Set<string>; onToggle(id: string): void }) {
  const { tenantId, project, base, can } = useProject();
  const nodes = useQuery({ queryKey: ['entity-tree', tenantId, project.key, parent], queryFn: () => api.places(tenantId, project.key, parent) });
  if (nodes.isPending)
    return (
      <tr>
        <Td className="text-xs text-zinc-400">
          <span style={{ paddingInlineStart: 30 + depth * 28 }}>Loading…</span>
        </Td>
        <Td />
        <Td />
        <Td />
        <Td />
      </tr>
    );
  if (nodes.isError || !nodes.data.length) return depth === 0 ? (
    <tr>
      <Td className="text-sm text-zinc-500">No entities yet.</Td>
      <Td />
      <Td />
      <Td />
      <Td />
    </tr>
  ) : null;
  return (
    <>
      {nodes.data.map((n) => {
        const Icon = iconOf(types.find((t) => t.key === n.type.key)?.icon ?? 'box');
        const expanded = open.has(n.id);
        const editable = can('manager') && !types.find((t) => t.key === n.type.key)?.orgId;
        return (
          <FragmentRow key={n.id}>
            <tr className="border-t border-zinc-100 hover:bg-zinc-50">
              <Td>
                <span className="flex items-center gap-1.5" style={{ paddingInlineStart: depth * 28 }}>
                  <button
                    type="button"
                    aria-label={expanded ? `Collapse ${n.name}` : `Expand ${n.name}`}
                    aria-expanded={n.hasChildren ? expanded : undefined}
                    disabled={!n.hasChildren}
                    onClick={() => onToggle(n.id)}
                    className="flex size-6 shrink-0 items-center justify-center text-zinc-500 hover:text-ink disabled:invisible"
                  >
                    <ChevronRight className={cx('size-4 transition-transform', expanded && 'rotate-90')} />
                  </button>
                  <Link to={`${base}/entities/${n.id}`} className="flex items-center gap-2 font-medium text-accent-700 hover:underline">
                    <Icon className="size-4 shrink-0" style={{ color: n.type.color }} />
                    {n.name}
                  </Link>
                </span>
              </Td>
              <Td className="font-mono text-xs">{n.code}</Td>
              <Td>
                <Tag>{n.type.name}</Tag>
              </Td>
              <Td className="num text-zinc-600">{n.childCount > 0 ? n.childCount.toLocaleString() : '—'}</Td>
              <Td>
                {editable && (
                  <Link to={`${base}/entities/${n.id}`} aria-label={`Open ${n.name}`} className="inline-flex p-1 text-zinc-500 hover:text-ink">
                    <Pencil className="size-4" />
                  </Link>
                )}
              </Td>
            </tr>
            {expanded && <TreeLevel parent={n.id} depth={depth + 1} types={types} open={open} onToggle={onToggle} />}
          </FragmentRow>
        );
      })}
    </>
  );
}

const FragmentRow = ({ children }: { children: React.ReactNode }) => <>{children}</>;

/** A dropdown to pick any number of entity types; none picked means all of them. */
function TypeFilter({ types, value, onChange }: { types: EntityTypeDto[]; value: string[]; onChange(v: string[]): void }) {
  const { project } = useProject();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !btn.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  const total = types.reduce((n, t) => n + t.count, 0);
  const label = value.length === 0 ? 'All types' : value.length === 1 ? (types.find((t) => t.key === value[0])?.plural ?? value[0]) : `${value.length} types`;
  const active = value.length > 0;
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 296)) });
          setOpen(!open);
        }}
        className={cx('flex h-9 items-center gap-2 border px-3 text-sm', active ? '' : 'border-zinc-300 bg-snow hover:border-zinc-500')}
        style={active ? { borderColor: project.color, background: `color-mix(in srgb, ${project.color} 10%, var(--color-snow))`, color: `color-mix(in srgb, ${project.color} 70%, var(--color-ink))` } : undefined}
      >
        <Filter className="size-4" />
        <span className="font-medium">Type</span>
        <span className="text-zinc-600" style={active ? { color: 'inherit' } : undefined}>
          {label}
        </span>
        <span className="num text-xs opacity-70">{(active ? types.filter((t) => value.includes(t.key)).reduce((n, t) => n + t.count, 0) : total).toLocaleString()}</span>
        <ChevronDown className={cx('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open &&
        at &&
        createPortal(
          <div ref={pop} role="listbox" aria-multiselectable aria-label="Entity types" style={{ top: at.top, left: at.left }} className="fixed z-[100] max-h-[min(24rem,70vh)] w-72 overflow-y-auto border border-zinc-300 bg-snow py-1 shadow-lg">
            <div className="flex items-center justify-between px-3 py-1.5 text-xs text-zinc-500">
              <span>{active ? `${value.length} selected` : 'Showing all types'}</span>
              {active && (
                <button type="button" className="underline hover:text-ink" onClick={() => onChange([])}>
                  Clear
                </button>
              )}
            </div>
            {types.map((t) => {
              const on = value.includes(t.key);
              const Icon = iconOf(t.icon);
              return (
                <button key={t.key} type="button" role="option" aria-selected={on} onClick={() => toggle(t.key)} className="flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm hover:bg-zinc-100">
                  <span className="flex size-4 shrink-0 items-center justify-center border" style={on ? { background: project.color, borderColor: project.color, color: contrastOn(project.color) } : { borderColor: '#a1a1aa' }}>
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <Icon className="size-4 shrink-0" style={{ color: t.color }} />
                  <span className="min-w-0 flex-1 truncate">{t.plural}</span>
                  <span className="num text-xs text-zinc-500">{t.count.toLocaleString()}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
