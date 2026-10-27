import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { isDatabaseKind, type DatasetDto } from '@grids/schema';
import {
  confirmDialog,
  Button,
  cx,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Listbox,
  Panel,
  Table,
  Textarea,
  relTime,
  dateTime,
  useToast,
  SectionHead,
  Empty,
  Loading,
} from '@grids/ui';
import {
  AlertCircle,
  BarChart3,
  ClipboardList,
  Database,
  CheckCircle2,
  ChevronRight,
  FileUp,
  Globe,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  TriangleAlert,
  Type,
  Upload,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { FilterMenu, type FilterCategory, type FilterValue } from '../support/FilterMenu';
import { api } from '../../api';
import { FreshnessBadge } from '@grids/viz';
import { DurationInput, fromMinutes, toMinutes } from './Duration';
import { useProject } from './context';
import { KIND } from './ConnectionsTab';
import { DatasetRows } from './DataTab';
import { parseCsv } from './EntitiesTab';
import { ChoiceCards } from './fields';
import { BRAND_ICON, DATASET_ICON } from './DbIcons';

/** What a dataset is made from. */
const GROUPS = [
  ['table', 'Tables'],
  ['sql', 'SQL'],
  ['code', 'Code'],
  ['rows', 'Uploaded'],
] as const;
type Group = (typeof GROUPS)[number][0];
const groupOf = (d: DatasetDto): Group =>
  d.source.type === 'script'
    ? 'code'
    : d.kind === 'rows'
      ? 'rows'
      : d.kind === 'physical'
        ? 'table'
        : 'sql';
const LANG_LABEL = { python: 'Python', r: 'R', javascript: 'JavaScript' } as const;

/** When the rows were last loaded: "2 days ago", and a click shows the date and time instead. */
function LoadedAt({ at, live }: { at: string | null | undefined; live?: boolean }) {
  const [exact, setExact] = useState(false);
  if (!at)
    return <div className="mt-0.5 text-zinc-500">{live ? 'Not queried yet' : 'Never loaded'}</div>;
  return (
    <button
      type="button"
      onClick={() => setExact(!exact)}
      title={exact ? 'Show how long ago' : 'Show the date and time'}
      className="mt-0.5 text-zinc-500 hover:text-ink hover:underline"
    >
      {live && !exact ? `Queried ${relTime(at)}` : exact ? dateTime(at) : relTime(at)}
    </button>
  );
}

/** The mark and the words for where a dataset's rows come from. */
function originOf(d: DatasetDto, conns: Map<string, { name: string; kind: string }>) {
  const s = d.source;
  if (s.type === 'connection') {
    const c = conns.get(s.connection);
    const kind = (c?.kind ?? 'postgres') as keyof typeof BRAND_ICON;
    return {
      Icon: BRAND_ICON[kind] ?? BRAND_ICON.postgres,
      title: s.table ? 'Table' : 'SQL',
      detail: `${c?.name ?? s.connection}${s.table ? ` · ${s.table}` : ''}`,
    };
  }
  if (s.type === 'local')
    return {
      Icon: DATASET_ICON.sql,
      title: 'SQL',
      detail: s.inputs.length ? `over ${s.inputs.map((i) => i.ref).join(', ')}` : 'DuckDB',
    };
  if (s.type === 'script')
    return {
      Icon: DATASET_ICON[s.language],
      title: LANG_LABEL[s.language],
      detail: s.inputs.length ? `over ${s.inputs.map((i) => i.ref).join(', ')}` : 'Code',
    };
  return { Icon: DATASET_ICON.rows, title: 'Rows', detail: 'Uploaded or written by a job' };
}

const IconBtn = ({
  label,
  title,
  icon: I,
  onClick,
  danger,
  busy,
}: {
  label: string;
  title: string;
  icon: typeof Pencil;
  onClick(): void;
  danger?: boolean;
  busy?: boolean;
}) => (
  <button
    type="button"
    aria-label={label}
    title={title}
    disabled={busy}
    onClick={onClick}
    className={cx(
      'p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-60',
      danger ? 'hover:text-red-700' : 'hover:text-ink',
    )}
  >
    <I className={cx('size-4', busy && 'animate-spin')} />
  </button>
);

/** Datasets: tables of rows that dashboards chart. Made from SQL on a database, SQL over forms, files and APIs, or filled by a job or an upload. */
export function DatasetsTab() {
  const { tenantId, project, base, can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const datasets = useQuery({
    queryKey: ['datasets', tenantId, project.key],
    queryFn: () => api.datasets(tenantId, project.key),
  });
  const connections = useQuery({
    queryKey: ['connections', tenantId, project.key],
    queryFn: () => api.connections(tenantId, project.key),
    enabled: can('manager'),
  });
  const dashboards = useQuery({
    queryKey: ['dashboards', tenantId, project.key],
    queryFn: () => api.dashboards(tenantId, project.key),
  });
  /** Dataset key to the dashboards whose widgets read it. */
  const usedBy = new Map<string, Set<string>>();
  for (const dash of dashboards.data ?? [])
    for (const w of dash.widgets) {
      const k = (w.query as { dataset?: string } | undefined)?.dataset;
      if (k) usedBy.set(k, (usedBy.get(k) ?? new Set()).add(dash.name));
    }
  const conns = new Map(
    (connections.data ?? []).map((c) => [c.key, { name: c.name, kind: c.kind }]),
  );
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<FilterValue>({});
  const categories: FilterCategory[] = [
    {
      id: 'type',
      label: 'Type',
      icon: Layers,
      options: GROUPS.map(([value, label]) => ({ value, label })),
    },
    {
      id: 'usage',
      label: 'Usage',
      icon: BarChart3,
      options: [
        { value: 'used', label: 'Used by a dashboard' },
        { value: 'unused', label: 'Unused' },
      ],
    },
  ];
  const matches = (d: DatasetDto) => {
    const t = filters.type ?? [];
    const u = filters.usage ?? [];
    return (
      (!t.length || t.includes(groupOf(d))) &&
      (!u.length || u.includes(usedBy.has(d.key) ? 'used' : 'unused'))
    );
  };
  const filtered = Object.values(filters).some((v) => v.length);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DatasetDto | null>(null);
  const [importing, setImporting] = useState<DatasetDto | 'new' | null>(null);
  const [view, setView] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (key: string) => api.deleteDataset(tenantId, project.key, key),
    onSuccess: (d) => qc.setQueryData(['datasets', tenantId, project.key], d),
  });
  const refresh = useMutation({
    mutationFn: (key: string) => api.refreshDataset(tenantId, project.key, key),
    onSuccess: (d, key) => {
      qc.setQueryData(['datasets', tenantId, project.key], d);
      void qc.invalidateQueries({ queryKey: ['dataset-rows', tenantId, project.key, key] });
      toast(
        `${d.find((x) => x.key === key)?.rowCount.toLocaleString() ?? 0} rows ${d.find((x) => x.key === key)?.freshness.live ? 'returned' : 'loaded'}`,
      );
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['datasets', tenantId, project.key] }),
  });
  const edit = (d: DatasetDto) =>
    d.source.type === 'rows'
      ? setEditing(d)
      : void navigate({ to: `${base}/datasets/${d.key}/edit` });
  return (
    <>
      <SectionHead
        title="Datasets"
        description="Tables that dashboard widgets chart. Built from a database, form responses, a file or API, other datasets, or an imported file."
        actions={
          can('manager') ? (
            <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
              New dataset
            </Button>
          ) : undefined
        }
      />
      <ErrorNotice error={datasets.error ?? remove.error ?? refresh.error} />
      {datasets.isPending ? (
        <Loading />
      ) : datasets.data && !datasets.data.length ? (
        <Panel flush>
          <Table
            head={['Dataset', 'Rows', 'Freshness', 'Used by', '']}
            empty={
              <Empty icon={Database} title="No datasets yet">
                A dataset is a table that dashboard widgets can chart. Start from a database, a form, a file or API, or import a spreadsheet.
              </Empty>
            }
          >
            {[]}
          </Table>
        </Panel>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-72">
              <Input
                icon={Search}
                aria-label="Search datasets"
                placeholder="Search datasets…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <FilterMenu categories={categories} value={filters} onChange={setFilters} />
            {filtered && (
              <button
                type="button"
                onClick={() => setFilters({})}
                className="inline-flex h-9 items-center gap-1 text-xs text-zinc-500 hover:text-ink"
              >
                <X className="size-3.5" /> Clear
              </button>
            )}
          </div>
          <Panel flush>
            {(() => {
              const shown = (datasets.data ?? []).filter(
                (d) =>
                  matches(d) &&
                  `${d.name} ${d.key} ${d.description} ${d.columns.join(' ')}`
                    .toLowerCase()
                    .includes(q.trim().toLowerCase()),
              );
              const sections = [
                ['Sources', shown.filter((d) => d.kind === 'physical' || d.kind === 'rows')],
                [
                  'Built from sources',
                  shown.filter((d) => d.kind !== 'physical' && d.kind !== 'rows'),
                ],
              ] as const;
              if (!shown.length)
                return (
                  <p className="px-4 py-8 text-center text-sm text-zinc-500">No datasets match.</p>
                );
              return sections.map(([title, rows]) =>
                rows.length ? (
                  <section key={title}>
                    <h3 className="border-y border-zinc-100 bg-zinc-50 px-4 py-2 text-[11px] font-medium uppercase tracking-widest text-zinc-500 first:border-t-0">
                      {title}
                    </h3>
                    <ul className="divide-y divide-zinc-100">
                      {rows.map((d) => {
                        const o = originOf(d, conns);
                        const reads =
                          d.source.type === 'local' || d.source.type === 'script'
                            ? d.source.inputs.map((i) => i.ref)
                            : [];
                        const used = [...(usedBy.get(d.key) ?? [])];
                        return (
                          <li
                            key={d.key}
                            className="group flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-zinc-50"
                          >
                            <o.Icon className="size-7 shrink-0" />
                            <div className="min-w-0 flex-1 basis-64">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <button
                                  type="button"
                                  onClick={() => setView(d.key)}
                                  className="truncate text-start text-sm font-semibold hover:text-accent-700 hover:underline"
                                >
                                  {d.name}
                                </button>
                                <span className="border border-zinc-200 bg-zinc-50 px-1.5 text-[11px] text-zinc-600">
                                  {o.title}
                                </span>
                                {reads.length > 0 && (
                                  <span className="truncate text-xs text-zinc-500">
                                    reads {reads.join(', ')}
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-xs text-zinc-500">
                                {d.description || o.detail}
                              </div>
                            </div>
                            <div className="w-20 text-end">
                              <div className="num text-sm font-semibold">
                                {d.rowCount.toLocaleString()}
                              </div>
                              <div
                                className="text-[11px] text-zinc-500"
                                title={
                                  d.freshness.live
                                    ? 'The rows the last query returned. Nothing is stored.'
                                    : undefined
                                }
                              >
                                {d.freshness.live ? 'rows seen' : 'rows'}
                              </div>
                            </div>
                            <div className="flex w-36 flex-col items-center text-center text-xs">
                              {d.refreshError ? (
                                <span
                                  className="block truncate text-red-700"
                                  title={d.refreshError}
                                >
                                  Refresh failed
                                </span>
                              ) : (
                                <FreshnessBadge value={d.freshness} compact />
                              )}
                              <LoadedAt at={d.lastMaterialisedAt} live={d.freshness.live} />
                            </div>
                            <div className="w-28 text-xs text-zinc-500" title={used.join(', ')}>
                              {used.length ? (
                                <span className="inline-flex items-center gap-1">
                                  <BarChart3 className="size-3.5" /> {used.length} dashboard
                                  {used.length === 1 ? '' : 's'}
                                </span>
                              ) : (
                                'Unused'
                              )}
                            </div>
                            <span className="flex items-center justify-end gap-0.5">
                              <IconBtn
                                label={`See the rows of ${d.name}`}
                                title="Rows"
                                icon={Table2}
                                onClick={() => setView(d.key)}
                              />
                              {can('manager') && d.source.type !== 'rows' && (
                                <IconBtn
                                  label={`${d.freshness.live ? 'Query' : 'Refresh'} ${d.name}`}
                                  title={d.freshness.live ? 'Query now' : 'Refresh'}
                                  icon={RefreshCw}
                                  busy={refresh.isPending && refresh.variables === d.key}
                                  onClick={() => refresh.mutate(d.key)}
                                />
                              )}
                              {can('manager') && d.source.type === 'rows' && (
                                <IconBtn
                                  label={`Import into ${d.name}`}
                                  title="Import"
                                  icon={Upload}
                                  onClick={() => setImporting(d)}
                                />
                              )}
                              {can('manager') && (
                                <>
                                  <IconBtn
                                    label={`Edit ${d.name}`}
                                    title="Edit"
                                    icon={Pencil}
                                    onClick={() => edit(d)}
                                  />
                                  <IconBtn
                                    label={`Delete ${d.name}`}
                                    title="Delete"
                                    icon={Trash2}
                                    danger
                                    onClick={async () =>
                                      (await confirmDialog(
                                        used.length
                                          ? `Delete ${d.name}? ${used.length} dashboard${used.length === 1 ? ' uses' : 's use'} it (${used.join(', ')}).`
                                          : d.freshness.live
                                            ? `Delete ${d.name}?`
                                            : `Delete ${d.name} and its rows?`,
                                      )) && remove.mutate(d.key)
                                    }
                                  />
                                </>
                              )}
                            </span>
                            {d.refreshError && (
                              <p className="w-full basis-full ps-10 text-xs text-red-700">
                                {d.refreshError}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null,
              );
            })()}
          </Panel>
        </>
      )}
      {creating && (
        <NewDatasetDialog
          onImport={() => (setCreating(false), setImporting('new'))}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && <DatasetDialog dataset={editing} onClose={() => setEditing(null)} />}
      {importing && (
        <ImportDialog
          dataset={importing === 'new' ? null : importing}
          onChange={importing === 'new' ? () => (setImporting(null), setCreating(true)) : undefined}
          onClose={() => setImporting(null)}
        />
      )}
      {view && <DatasetRows datasetKey={view} onClose={() => setView(null)} />}
    </>
  );
}

type Origin = 'database' | 'form' | 'file' | 'dataset' | 'import';
type Language = 'sql' | 'python' | 'r' | 'javascript';
const LANGUAGES: { id: Language; label: string; text: string }[] = [
  { id: 'sql', label: 'SQL', text: 'Select, join and group' },
  { id: 'python', label: 'Python', text: 'pandas and numpy' },
  { id: 'r', label: 'R', text: 'Base R data frames' },
  { id: 'javascript', label: 'JavaScript', text: 'Plain JavaScript' },
];

const kindOf = (k: string) => (KIND as Record<string, (typeof KIND)[keyof typeof KIND]>)[k];

/** Making a dataset: where the data is, then (for forms, files and datasets) how to shape it. */
function NewDatasetDialog({ onImport, onClose }: { onImport(): void; onClose(): void }) {
  const { tenantId, project, base } = useProject();
  const navigate = useNavigate();
  const sources = useQuery({
    queryKey: ['sql-sources', tenantId, project.key],
    queryFn: () => api.localSources(tenantId, project.key),
  });
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [pick, setPick] = useState('');
  const [lang, setLang] = useState<Language>('sql');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const existing = useQuery({ queryKey: ['datasets', tenantId, project.key], queryFn: () => api.datasets(tenantId, project.key) });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  // A dataset's name is unique in the project, by what it reads as and by the key made from it.
  const taken = (existing.data ?? []).some((d) => d.key === slug.replace(/^(\d)/, 'd_$1') || d.name.trim().toLowerCase() === name.trim().toLowerCase());
  const named = !!name.trim() && !!slug && !taken;
  const src = sources.data;
  const databases = (src?.connections ?? []).filter((c) => isDatabaseKind(c.kind));
  const fileApis = (src?.connections ?? []).filter((c) => !isDatabaseKind(c.kind));
  const choices: {
    id: Origin;
    icon: typeof Database;
    title: string;
    text: string;
    count: number;
    none: string;
  }[] = [
    {
      id: 'database',
      icon: Database,
      title: 'Database',
      text: 'A table or a query on one of your connections',
      count: databases.length,
      none: 'Add a database under Connections',
    },
    {
      id: 'form',
      icon: ClipboardList,
      title: 'Form responses',
      text: 'The submissions of a form in this project',
      count: src?.forms.length ?? 0,
      none: 'No forms yet',
    },
    {
      id: 'file',
      icon: Globe,
      title: 'File or API',
      text: 'A spreadsheet or API on a connection',
      count: fileApis.length,
      none: 'Add a file or API under Connections',
    },
    {
      id: 'dataset',
      icon: Layers,
      title: 'Other datasets',
      text: 'Join or reshape datasets you already have',
      count: src?.datasets.length ?? 0,
      none: 'No datasets yet',
    },
    {
      id: 'import',
      icon: Upload,
      title: 'Import data',
      text: 'Drop in a CSV or Excel file',
      count: 1,
      none: '',
    },
  ];
  const options =
    origin === 'database'
      ? databases.map((c) => ({
          value: c.key,
          label: c.name,
          description: `${kindOf(c.kind)?.label ?? c.kind} · SQL`,
          icon: kindOf(c.kind)?.icon,
        }))
      : origin === 'form'
        ? (src?.forms ?? []).map((f) => ({
            value: f.key,
            label: f.name,
            description: `${f.columns.length - 5} questions`,
          }))
        : origin === 'file'
          ? fileApis.map((c) => ({
              value: c.key,
              label: c.name,
              description: kindOf(c.kind)?.label ?? c.kind,
              icon: kindOf(c.kind)?.icon,
            }))
          : origin === 'dataset'
            ? (src?.datasets ?? []).map((d) => ({
                value: d.key,
                label: d.name,
                description: `${d.columns.length} columns`,
              }))
            : [];
  const noun = {
    database: 'connection',
    form: 'form',
    file: 'connection',
    dataset: 'dataset',
    import: '',
  }[origin ?? 'import'];
  const go = () => {
    if (origin === 'import') return onImport();
    const chosen = pick || options[0]?.value;
    if (!origin || !chosen || !named) return;
    const about = { name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) };
    if (origin === 'database')
      void navigate({ to: `${base}/datasets/new`, search: { type: 'connection', from: chosen, ...about } });
    else {
      const from = `${origin === 'file' ? 'source' : origin}:${chosen}`;
      void navigate({
        to: `${base}/datasets/new`,
        search: { type: 'local', from, ...(lang !== 'sql' ? { lang } : {}), ...about },
      });
    }
    onClose();
  };
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="New dataset"
      description={
        origin
          ? {
              database: 'Pick a connection. The query uses its SQL.',
              form: 'Pick a form, then choose how to shape its answers.',
              file: 'Pick a connection, then choose how to shape its rows.',
              dataset: 'Start from one dataset. Add more in the editor.',
              import: '',
            }[origin]
          : 'Where is the data?'
      }
      footer={origin && origin !== 'import' ? <Button onClick={go} disabled={!named}>Continue</Button> : undefined}
    >
      {!origin ? (
        <div className="space-y-4">
          {sources.isPending ? (
            <Loading />
          ) : (
            [
              ['Data you already have', ['form', 'dataset']],
              ['Outside data', ['database', 'file']],
              ['A file from your computer', ['import']],
            ].map(([title, ids]) => {
              // Every way in is listed; the ones this project cannot use yet are greyed out, with what to do about it.
              const rows = choices.filter((c) => (ids as string[]).includes(c.id));
              return rows.length ? (
                <section key={title as string}>
                  <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-widest text-zinc-500">
                    {title as string}
                  </h3>
                  <ul className="divide-y divide-zinc-100 border border-zinc-200">
                    {rows.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          disabled={c.count === 0}
                          onClick={() =>
                            c.id === 'import'
                              ? onImport()
                              : (setOrigin(c.id), setPick(''), setLang('sql'))
                          }
                          className="group flex w-full items-center gap-3 bg-snow px-3 py-3 text-start hover:bg-accent-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:hover:bg-zinc-50"
                        >
                          <span className={cx('grid size-10 shrink-0 place-items-center bg-accent-50 text-accent-700 group-hover:bg-snow', c.count === 0 && 'bg-zinc-100 text-zinc-400 group-hover:bg-zinc-100')}>
                            <c.icon className="size-5" />
                          </span>
                          <span className={cx('min-w-0 flex-1', c.count === 0 && 'opacity-60')}>
                            <span className="block text-sm font-semibold">{c.title}</span>
                            <span className="block text-xs text-zinc-500">{c.text}</span>
                          </span>
                          <span className={cx('hidden shrink-0 text-xs sm:block', c.count === 0 ? 'text-zinc-500' : 'text-zinc-400')}>
                            {c.count === 0 ? c.none : c.id === 'import' ? '' : `${c.count} available`}
                          </span>
                          {c.count > 0 && <ChevronRight className="size-4 shrink-0 text-zinc-400 group-hover:text-accent-700" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null;
            })
          )}
        </div>
      ) : origin === 'import' ? null : (
        <div className="space-y-4">
          {(() => {
            const c = choices.find((x) => x.id === origin)!;
            return (
              <div className="flex items-center gap-3 border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center bg-accent-50 text-accent-700">
                  <c.icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block text-sm font-medium">{c.title}</b>
                  <span className="block truncate text-xs text-zinc-500">{c.text}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setOrigin(null)}
                  className="text-sm font-medium text-accent-700 hover:underline"
                >
                  Change
                </button>
              </div>
            );
          })()}
          <Field label={noun[0]!.toUpperCase() + noun.slice(1)}>
            <Listbox
              value={pick || options[0]?.value || ''}
              onChange={setPick}
              label={noun}
              options={options}
            />
          </Field>
          <Field label="Name" intro="Unique within the project" error={taken ? 'Another dataset already has this name.' : undefined} required>
            <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && named && go()} />
          </Field>
          <Field label="Description" intro="What the rows are, for the people who build dashboards">
            <Textarea value={description} maxLength={500} className="min-h-16" onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {origin !== 'database' && (
            <Field
              label="Write it in"
              intro="The data is available to the code as tables you can query"
            >
              <ChoiceCards<Language>
                label="Language"
                hideLabel
                value={lang}
                onChange={setLang}
                options={
                  Object.fromEntries(
                    LANGUAGES.map((l) => [
                      l.id,
                      {
                        label: l.label,
                        text: l.text,
                        icon: DATASET_ICON[l.id === 'sql' ? 'sql' : l.id],
                      },
                    ]),
                  ) as never
                }
              />
            </Field>
          )}
        </div>
      )}
    </Dialog>
  );
}

type Cell = string | number | boolean | null;
type ImportRow = Record<string, Cell>;
/** Most rows one import may carry. */
const MAX_IMPORT_ROWS = 50_000;

/** Rows from a spreadsheet, the first row as names. Blank and repeated names are made unique, and the change is noted. */
function toRows(grid: unknown[][]): { rows: ImportRow[]; notes: string[] } {
  const [head, ...body] = grid.filter((r) =>
    r.some((c) => c !== null && c !== undefined && c !== ''),
  );
  if (!head) return { rows: [], notes: [] };
  const notes: string[] = [];
  const seen = new Set<string>();
  const names = head.map((h, i) => {
    let n = String(h ?? '').trim();
    if (!n) {
      n = `column_${i + 1}`;
      notes.push(`Column ${i + 1} had no name, so it is called ${n}.`);
    }
    const base = n;
    for (let k = 2; seen.has(n); k++) n = `${base}_${k}`;
    if (n !== base)
      notes.push(`The name ${base} appears more than once. The later one is called ${n}.`);
    seen.add(n);
    return n;
  });
  return { rows: body.map((r) => Object.fromEntries(names.map((n, i) => [n, cell(r[i])]))), notes };
}
function cell(v: unknown): Cell {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date)
    return v.getUTCHours() + v.getUTCMinutes() + v.getUTCSeconds() === 0
      ? v.toISOString().slice(0, 10)
      : v.toISOString();
  return typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
}

type ColType = 'number' | 'date' | 'yes/no' | 'text' | 'empty';
const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?$/;
const typeOf = (v: Cell): Exclude<ColType, 'empty'> =>
  typeof v === 'number'
    ? 'number'
    : typeof v === 'boolean'
      ? 'yes/no'
      : typeof v === 'string' && DATE.test(v)
        ? 'date'
        : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
          ? 'number'
          : 'text';

/** What is in the file, and what is wrong with it: problems stop the import, notes are worth a look. */
function check(rows: ImportRow[], existing: DatasetDto | null, parseNotes: string[]) {
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const problems: string[] = [];
  const notes = [...parseNotes];
  if (!rows.length)
    problems.push(
      'The file has no rows. The first row must hold the column names, with data under it.',
    );
  if (rows.length > MAX_IMPORT_ROWS)
    problems.push(
      `The file has ${rows.length.toLocaleString()} rows. One import takes up to ${MAX_IMPORT_ROWS.toLocaleString()}. Split it, or load it from a database.`,
    );
  const types: Record<string, ColType> = {};
  for (const c of cols) {
    const seen = new Map<string, number>();
    let empty = 0;
    for (const r of rows) {
      const v = r[c] ?? null;
      if (v === null) empty++;
      else seen.set(typeOf(v), (seen.get(typeOf(v)) ?? 0) + 1);
    }
    types[c] =
      seen.size === 0
        ? 'empty'
        : ([...seen.entries()].sort((x, y) => y[1] - x[1])[0]![0] as ColType);
    if (seen.size === 0) notes.push(`${c} is empty in every row.`);
    else if (seen.size > 1)
      notes.push(`${c} mixes ${[...seen.keys()].join(' and ')} values. It is read as ${types[c]}.`);
    else if (empty > rows.length / 2)
      notes.push(
        `${c} is empty in ${empty.toLocaleString()} of ${rows.length.toLocaleString()} rows.`,
      );
  }
  if (existing && cols.length) {
    const have = new Set(existing.columns);
    const added = cols.filter((c) => !have.has(c));
    const missing = existing.columns.filter((c) => !cols.includes(c));
    if (added.length) notes.push(`New columns, added to the dataset: ${added.join(', ')}.`);
    if (missing.length) notes.push(`Not in this file, left empty: ${missing.join(', ')}.`);
  }
  return { cols, types, problems, notes };
}

const keyOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'd_$1')
    .slice(0, 60) || 'dataset';

/** Import data in two steps: pick the file and see what is in it (with what is wrong), then name it and load it. */
function ImportDialog({
  dataset,
  onChange,
  onClose,
}: {
  dataset: DatasetDto | null;
  onChange?(): void;
  onClose(): void;
}) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const taken = new Set(
    (qc.getQueryData<DatasetDto[]>(['datasets', tenantId, project.key]) ?? []).map((d) => d.key),
  );
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'file' | 'details'>('file');
  const [over, setOver] = useState(false);
  const [file, setFile] = useState('');
  const [name, setName] = useState('');
  const [grid, setGrid] = useState<{ rows: ImportRow[]; notes: string[] } | null>(null);
  const [sheets, setSheets] = useState<{ sheet: string; data: unknown[][] }[]>([]);
  const [sheet, setSheet] = useState(0);
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [problem, setProblem] = useState('');
  const rows = grid?.rows ?? null;
  const report = grid ? check(grid.rows, dataset, grid.notes) : null;
  const ok = !!rows?.length && !report?.problems.length;
  const load = (g: { rows: ImportRow[]; notes: string[] }) => {
    setGrid(g);
  };
  const take = async (f: File | undefined) => {
    if (!f) return;
    setProblem('');
    try {
      const ext = f.name.split('.').pop()?.toLowerCase();
      if (ext === 'xlsx') {
        const { default: readXlsx } = await import('read-excel-file/browser');
        const all = (await readXlsx(f)) as { sheet: string; data: unknown[][] }[];
        if (!all.length) throw new Error('empty');
        setSheets(all);
        setSheet(0);
        load(toRows(all[0]!.data));
      } else if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        setSheets([]);
        load({ rows: parseCsv(await f.text(), ext === 'tsv' ? '\t' : ','), notes: [] });
      } else throw new Error('type');
      setFile(f.name);
      if (!dataset && !name)
        setName(
          f.name
            .replace(/\.[^.]+$/, '')
            .replace(/[_-]+/g, ' ')
            .trim(),
        );
    } catch (e) {
      setGrid(null);
      setFile('');
      setProblem(
        (e as Error).message === 'type'
          ? 'Use a .csv, .tsv or .xlsx file.'
          : 'That file could not be read. Check that it is a spreadsheet with a header row.',
      );
    }
  };
  const run = useMutation({
    mutationFn: async () => {
      let key = dataset?.key ?? '';
      if (!dataset) {
        const base = keyOf(name);
        key = base;
        for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
        await api.saveDataset(tenantId, project.key, {
          key,
          name: name.trim(),
          source: { type: 'rows' },
          settings: { timeColumn: null, metrics: [], parameters: [] },
        });
      }
      return api.uploadDatasetRows(tenantId, project.key, key, {
        mode: dataset ? mode : 'replace',
        rows: rows!,
      });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['datasets', tenantId, project.key] });
      toast(
        `${r.added.toLocaleString()} rows loaded${dataset ? ` · ${r.rows.toLocaleString()} in total` : ''}`,
      );
      onClose();
    },
  });
  const cols = report?.cols ?? [];
  const TYPE_TONE: Record<ColType, string> = {
    number: 'text-sky-700',
    date: 'text-violet-700',
    'yes/no': 'text-emerald-700',
    text: 'text-zinc-500',
    empty: 'text-zinc-400',
  };
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={dataset ? `Import into ${dataset.name}` : 'Import data'}
      description={
        step === 'file'
          ? 'Choose a CSV or Excel file and check what is in it.'
          : 'Name it and load the rows.'
      }
      footer={
        step === 'file' ? (
          <Button onClick={() => setStep('details')} disabled={!ok}>
            Continue
          </Button>
        ) : (
          <Button
            onClick={() => run.mutate()}
            loading={run.isPending}
            disabled={!ok || (!dataset && !name.trim())}
          >
            Import {rows?.length.toLocaleString()} rows
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={run.error} />
        {!dataset && onChange && step === 'file' && (
          <div className="flex items-center gap-3 border border-zinc-200 bg-zinc-50 px-3 py-2.5">
            <span className="grid size-9 shrink-0 place-items-center bg-accent-50 text-accent-700">
              <Upload className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-sm font-medium">Import data</b>
              <span className="block truncate text-xs text-zinc-500">
                A CSV or Excel file from your computer
              </span>
            </span>
            <button
              type="button"
              onClick={onChange}
              className="text-sm font-medium text-accent-700 hover:underline"
            >
              Change
            </button>
          </div>
        )}
        {step === 'file' ? (
          <>
            <div
              role="button"
              tabIndex={0}
              aria-label="Choose or drop a CSV or Excel file"
              onClick={() => input.current?.click()}
              onKeyDown={(e) =>
                (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current?.click())
              }
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
              className={cx(
                'flex cursor-pointer flex-col items-center gap-1.5 border border-dashed px-4 py-8 text-center focus-visible:outline-2 focus-visible:outline-accent-600',
                over
                  ? 'border-accent-600 bg-accent-50'
                  : 'border-zinc-300 bg-zinc-50 hover:border-accent-600 hover:bg-accent-50',
              )}
            >
              <FileUp className="size-6 text-zinc-400" aria-hidden />
              <p className="text-sm text-zinc-700">
                {over ? 'Drop the file' : file || 'Drop a file here, or click to choose one'}
              </p>
              <p className="text-xs text-zinc-400">
                {file && rows
                  ? `${rows.length.toLocaleString()} rows · ${cols.length} columns. Drop another file to replace it`
                  : '.csv, .tsv or .xlsx, with column names in the first row'}
              </p>
            </div>
            <input
              ref={input}
              type="file"
              hidden
              accept=".csv,.tsv,.txt,.xlsx"
              onChange={(e) => (void take(e.target.files?.[0]), (e.target.value = ''))}
            />
            {problem && <p className="text-xs text-red-700">{problem}</p>}
            {sheets.length > 1 && (
              <Field label="Sheet">
                <Listbox<string>
                  label="Sheet"
                  value={String(sheet)}
                  onChange={(v) => (setSheet(Number(v)), load(toRows(sheets[Number(v)]!.data)))}
                  options={sheets.map((x, i) => ({ value: String(i), label: x.sheet }))}
                />
              </Field>
            )}
            {report && (
              <>
                {report.problems.map((m) => (
                  <p
                    key={m}
                    className="flex items-start gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
                  >
                    <AlertCircle className="mt-px size-3.5 shrink-0" /> {m}
                  </p>
                ))}
                {report.notes.length > 0 && (
                  <ul className="space-y-1 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {report.notes.slice(0, 6).map((m) => (
                      <li key={m} className="flex items-start gap-2">
                        <TriangleAlert className="mt-px size-3.5 shrink-0" /> {m}
                      </li>
                    ))}
                    {report.notes.length > 6 && (
                      <li className="ps-5">and {report.notes.length - 6} more</li>
                    )}
                  </ul>
                )}
                {ok && report.notes.length === 0 && (
                  <p className="flex items-center gap-2 text-xs text-emerald-700">
                    <CheckCircle2 className="size-3.5" /> No problems found.
                  </p>
                )}
                {rows && rows.length > 0 && (
                  <div className="overflow-x-auto border border-zinc-200">
                    <table className="w-full text-xs">
                      <thead className="bg-zinc-50">
                        <tr>
                          {cols.map((c) => (
                            <th
                              key={c}
                              className="whitespace-nowrap px-2 py-1.5 text-start font-medium"
                            >
                              {c}{' '}
                              <span className={cx('font-normal', TYPE_TONE[report.types[c]!])}>
                                {report.types[c]}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 8).map((r, i) => (
                          <tr key={i} className="border-t border-zinc-100">
                            {cols.map((c) => (
                              <td key={c} className="whitespace-nowrap px-2 py-1">
                                {r[c] === null ? (
                                  <span className="text-zinc-400">empty</span>
                                ) : (
                                  String(r[c])
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 8 && (
                      <p className="border-t border-zinc-100 px-2 py-1.5 text-xs text-zinc-500">
                        The first 8 of {rows.length.toLocaleString()} rows.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 border border-zinc-200 bg-zinc-50 px-3 py-2.5">
              <span className="grid size-9 shrink-0 place-items-center bg-accent-50 text-accent-700">
                <FileUp className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm font-medium">{file}</b>
                <span className="block text-xs text-zinc-500">
                  {rows?.length.toLocaleString()} rows · {cols.length} columns
                </span>
              </span>
              <button
                type="button"
                onClick={() => setStep('file')}
                className="text-sm font-medium text-accent-700 hover:underline"
              >
                Change file
              </button>
            </div>
            {!dataset && (
              <>
                <Field label="Name" required intro="What people see, e.g. District targets">
                  <Input
                    icon={Type}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                </Field>
              </>
            )}
            {dataset && (
              <ChoiceCards<'replace' | 'append'>
                label="Existing rows"
                value={mode}
                onChange={setMode}
                options={{
                  replace: {
                    label: 'Replace',
                    text: `Remove the ${dataset.rowCount.toLocaleString()} rows there now`,
                    icon: Trash2,
                  },
                  append: { label: 'Append', text: 'Add to the rows already there', icon: Plus },
                }}
              />
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** The name, description and settings of an imported dataset. */
function DatasetDialog({ dataset, onClose }: { dataset: DatasetDto; onClose(): void }) {
  const { tenantId, project } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: dataset.name,
    description: dataset.description,
    every: fromMinutes(dataset.freshnessMinutes),
  });
  const save = useMutation({
    mutationFn: () =>
      api.saveDataset(
        tenantId,
        project.key,
        {
          key: dataset.key,
          name: f.name,
          description: f.description,
          columns: dataset.columns,
          freshnessMinutes: toMinutes(f.every),
          source: dataset.source,
          settings: {
            ...dataset.settings,
            metrics: [],
          },
        },
        dataset.key,
      ),
    onSuccess: (list) => {
      qc.setQueryData(['datasets', tenantId, project.key], list);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit ${dataset.name}`}
      footer={
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name.trim()}>
          Save
        </Button>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error} />
        <Field label="Name" required intro="What people see, e.g. Weekly cases">
          <Input
            icon={Type}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            autoFocus
          />
        </Field>
        <Field label="Description" intro="What the rows are">
          <Textarea
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
        {!dataset.freshness.live && (
          <Field label="Expected update every" intro="Optional: drives the freshness badge">
            <DurationInput value={f.every} onChange={(every) => setF({ ...f, every })} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
