import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { AttributeDef, EntityDetail, EntityTypeDto } from '@grids/schema';
import {
  Button,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
  Input,
  Loading,
  Pagination,
  Select,
  Table,
  Td,
  Tag,
  cx,
  relTime,
  usePagination,
  useToast,
} from '@grids/ui';
import { Boxes, FileUp, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../../api';
import { iconOf, useProject } from './context';

export function useTypes() {
  const { tenantId, project } = useProject();
  return useQuery({ queryKey: ['types', tenantId, project.key], queryFn: () => api.types(tenantId, project.key) });
}

export const fmtAttr = (def: AttributeDef | undefined, v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  if (def?.type === 'boolean' || typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return `${v.toLocaleString()}${def?.unit ? ` ${def.unit}` : ''}`;
  return String(v);
};

export function EntitiesTab() {
  const { tenantId, project, base, can } = useProject();
  const types = useTypes();
  const [type, setType] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [pg, setPg] = usePagination([type, q], 25);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const list = useQuery({
    queryKey: ['entities', tenantId, project.key, type, q, pg],
    queryFn: () => api.entities(tenantId, project.key, { ...pg, type: type ?? undefined, q: q || undefined }),
    placeholderData: keepPreviousData,
  });
  const current = types.data?.find((t) => t.key === type);
  const summaryAttrs = (current?.attributes ?? []).filter((a) => a.summary).slice(0, 4);

  if (types.isPending) return <Loading />;
  if (!types.data?.length)
    return (
      <div className="border border-zinc-200 bg-snow">
        <Empty icon={Boxes} title="No entity types yet" action={can('manager') ? <Link to={`${base}/types`} className="text-sm font-medium text-accent-700 hover:underline">Define entity types</Link> : undefined}>
          Entity types describe the things this project tracks (facilities, assets, people…).
        </Empty>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Entity types" className="flex flex-wrap gap-px border border-zinc-300 bg-zinc-300">
          {[{ key: null, plural: 'All', count: types.data.reduce((s, t) => s + t.count, 0) }, ...types.data].map((t) => (
            <button
              key={t.key ?? 'all'}
              role="tab"
              aria-selected={type === t.key}
              onClick={() => setType(t.key)}
              className={cx('flex items-center gap-2 px-3 py-1.5 text-sm', type === t.key ? 'bg-ink text-canvas' : 'bg-snow hover:bg-zinc-50')}
            >
              {t.plural}
              <span className="num text-xs opacity-70">{t.count.toLocaleString()}</span>
            </button>
          ))}
        </div>
        <div className="relative ms-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-zinc-400" />
          <Input aria-label="Search entities" placeholder="Search name or code" value={q} onChange={(e) => setQ(e.target.value)} className="ps-8" />
        </div>
        {can('editor') && (
          <>
            <Button variant="secondary" icon={FileUp} onClick={() => setImporting(true)}>
              Import CSV
            </Button>
            <Button icon={Plus} onClick={() => setAdding(true)}>
              Add
            </Button>
          </>
        )}
      </div>
      <div className="border border-zinc-200 bg-snow">
        <ErrorNotice error={list.error} />
        <Table
          head={['Name', 'Code', ...(current ? [] : ['Type']), 'In', ...summaryAttrs.map((a) => a.label), 'Updated']}
          empty={<Empty icon={Boxes} title={q ? 'No matches' : 'Nothing here yet'} />}
        >
          {list.data?.items.map((e) => {
            const Icon = iconOf(e.type.icon);
            return (
              <tr key={e.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                <Td>
                  <Link to={`${base}/entities/${e.id}`} className="flex items-center gap-2 font-medium text-accent-700 hover:underline">
                    <Icon className="size-4 shrink-0" style={{ color: e.type.color }} />
                    {e.name}
                  </Link>
                </Td>
                <Td className="font-mono text-xs">{e.code}</Td>
                {!current && (
                  <Td>
                    <Tag>{e.type.name}</Tag>
                  </Td>
                )}
                <Td className="text-zinc-600">{e.parent?.name ?? '—'}</Td>
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
      {adding && <EntityDialog types={types.data} defaultType={type} onClose={() => setAdding(false)} />}
      {importing && <ImportDialog types={types.data} defaultType={type} onClose={() => setImporting(false)} />}
    </div>
  );
}

/** Searchable picker over entities of the allowed parent types. */
function ParentPicker({ parentTypes, value, onChange }: { parentTypes: string[]; value: { id: string; name: string } | null; onChange(v: { id: string; name: string } | null): void }) {
  const { tenantId, project } = useProject();
  const [q, setQ] = useState('');
  const results = useQuery({
    queryKey: ['parent-search', tenantId, project.key, parentTypes, q],
    queryFn: async () => (await Promise.all(parentTypes.map((t) => api.entities(tenantId, project.key, { type: t, q: q || undefined, pageSize: 10 })))).flatMap((p) => p.items),
    enabled: parentTypes.length > 0,
  });
  if (!parentTypes.length) return <p className="text-xs text-zinc-500">This type sits at the top level.</p>;
  return (
    <div>
      {value ? (
        <div className="flex items-center justify-between border border-zinc-300 px-3 py-2 text-sm">
          {value.name}
          <button type="button" className="text-xs text-accent-700 hover:underline" onClick={() => onChange(null)}>
            Change
          </button>
        </div>
      ) : (
        <>
          <Input aria-label="Search parent" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-1 max-h-40 overflow-y-auto border border-zinc-200">
            {results.data?.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onChange({ id: r.id, name: r.name })} className="flex w-full items-center justify-between px-3 py-1.5 text-start text-sm hover:bg-zinc-50">
                  {r.name} <span className="text-xs text-zinc-500">{r.type.name}</span>
                </button>
              </li>
            ))}
            {results.data && !results.data.length && <li className="px-3 py-2 text-xs text-zinc-500">No matches</li>}
          </ul>
        </>
      )}
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
      return <Input {...common} type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    default:
      return <Input {...common} type={def.type === 'email' ? 'email' : def.type === 'url' ? 'url' : def.type === 'phone' ? 'tel' : 'text'} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Create or edit an entity: code, name, parent, attributes and location. */
export function EntityDialog({ types, defaultType, entity, onClose }: { types: EntityTypeDto[]; defaultType: string | null; entity?: EntityDetail; onClose(): void }) {
  const { tenantId, project, base } = useProject();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [typeKey, setTypeKey] = useState(entity?.type.key ?? defaultType ?? types[0]!.key);
  const type = types.find((t) => t.key === typeKey)!;
  const [code, setCode] = useState(entity?.code ?? '');
  const [name, setName] = useState(entity?.name ?? '');
  const [parent, setParent] = useState<{ id: string; name: string } | null>(entity?.parent ?? null);
  const [attrs, setAttrs] = useState<Record<string, unknown>>(entity?.attributes ?? {});
  const point = entity?.geometry?.type === 'Point' ? (entity.geometry.coordinates as [number, number]) : null;
  const [lat, setLat] = useState(point ? String(point[1]) : '');
  const [lon, setLon] = useState(point ? String(point[0]) : '');
  const geometry = type.geometry === 'point' && lat !== '' && lon !== '' ? { type: 'Point' as const, coordinates: [Number(lon), Number(lat)] } : type.geometry === 'point' ? null : undefined;
  const save = useMutation({
    mutationFn: () =>
      entity
        ? api.updateEntity(tenantId, project.key, entity.id, { code, name, attributes: attrs, parentId: parent?.id ?? null, version: entity.version, ...(geometry !== undefined && { geometry }) })
        : api.createEntity(tenantId, project.key, { typeKey, code, name, attributes: attrs, parentId: parent?.id ?? null, geometry: geometry ?? null }),
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: ['entities', tenantId, project.key] });
      void qc.invalidateQueries({ queryKey: ['types', tenantId, project.key] });
      qc.setQueryData(['entity', tenantId, project.key, e.id], e);
      toast(entity ? 'Saved' : `${type.name} added`);
      onClose();
      if (!entity) void navigate({ to: `${base}/entities/${e.id}` });
    },
  });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={entity ? `Edit ${entity.name}` : `Add ${type.name.toLowerCase()}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!code || !name}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error} />
        <div className="grid gap-4 sm:grid-cols-3">
          {!entity && (
            <Field label="Type">
              <Select value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
                {types.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Code" required hint="Unique within the type">
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium tracking-wide text-zinc-600">Parent</div>
          <ParentPicker parentTypes={type.parentTypes} value={parent} onChange={setParent} />
        </div>
        {type.attributes.length > 0 && (
          <div className="grid gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2">
            {type.attributes.map((a) => (
              <Field key={a.key} label={`${a.label}${a.unit ? ` (${a.unit})` : ''}`} required={a.required}>
                <AttributeInput def={a} value={attrs[a.key]} onChange={(v) => setAttrs({ ...attrs, [a.key]: v })} />
              </Field>
            ))}
          </div>
        )}
        {type.geometry === 'point' && (
          <div className="grid gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-3">
            <Field label="Latitude">
              <Input type="number" step="any" min={-90} max={90} value={lat} onChange={(e) => setLat(e.target.value)} />
            </Field>
            <Field label="Longitude">
              <Input type="number" step="any" min={-180} max={180} value={lon} onChange={(e) => setLon(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <Button
                variant="secondary"
                onClick={() =>
                  navigator.geolocation?.getCurrentPosition((p) => {
                    setLat(p.coords.latitude.toFixed(6));
                    setLon(p.coords.longitude.toFixed(6));
                  })
                }
              >
                Use my location
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Splits CSV text into rows of objects (RFC 4180 quoting). */
export function parseCsv(text: string): Record<string, string>[] {
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
    else if (c === ',') {
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

function ImportDialog({ types, defaultType, onClose }: { types: EntityTypeDto[]; defaultType: string | null; onClose(): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const [typeKey, setTypeKey] = useState(defaultType ?? types[0]!.key);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const type = types.find((t) => t.key === typeKey)!;
  const columns = useMemo(() => (rows?.[0] ? Object.keys(rows[0]) : []), [rows]);
  const known = new Set(['code', 'name', 'parent_code', 'lat', 'lon', ...type.attributes.map((a) => a.key)]);
  const run = useMutation({
    mutationFn: () => api.importRows(tenantId, project.key, { typeKey, rows: rows! }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['entities', tenantId, project.key] });
      void qc.invalidateQueries({ queryKey: ['types', tenantId, project.key] });
    },
  });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Import from CSV"
      description="Existing codes are updated, new ones created: re-importing the same file is safe."
      footer={
        run.data ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => run.mutate()} loading={run.isPending} disabled={!rows?.length || !columns.includes('code')}>
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
            <b>{run.data.created}</b> created, <b>{run.data.updated}</b> updated, {run.data.unchanged} unchanged.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Entity type">
                <Select value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
                  {types.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.plural}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="CSV file" hint={fileName || 'UTF-8, first row = column names'}>
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setFileName(f.name);
                    setRows(parseCsv(await f.text()));
                  }}
                />
              </Field>
            </div>
            <p className="text-xs text-zinc-500">
              Columns: <code>code</code> (required), <code>name</code>, <code>parent_code</code>
              {type.geometry === 'point' && (
                <>
                  , <code>lat</code>, <code>lon</code>
                </>
              )}
              {type.attributes.length > 0 && <>, and attributes: {type.attributes.map((a) => a.key).join(', ')}</>}.
            </p>
            {rows && (
              <div className="overflow-x-auto border border-zinc-200">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50">
                    <tr>
                      {columns.map((c) => (
                        <th key={c} className={cx('px-2 py-1.5 text-start font-medium', !known.has(c) && 'text-zinc-400 line-through')} title={known.has(c) ? undefined : 'Ignored'}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t border-zinc-100">
                        {columns.map((c) => (
                          <td key={c} className="px-2 py-1">
                            {r[c]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
