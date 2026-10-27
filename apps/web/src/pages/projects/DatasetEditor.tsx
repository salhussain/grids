import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import {
  isDatabaseKind,
  PARAM_TYPES,
  type DatasetDto,
  type DatasetInputRef,
  type DatasetParam,
  type DatasetSource,
  type DatasetVersionDto,
  type SqlResult,
} from '@grids/schema';
import {
  Button,
  confirmDialog,
  cx,
  ApiError,
  DatePicker,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Listbox,
  Loading,
  Select,
  relTime,
  Spinner,
  SwitchField,
  Textarea,
  useToast,
} from '@grids/ui';
import { columnKind, KIND_ICON, KIND_LABEL, type ColumnKind } from './columnTypes';
import {
  AlertTriangle,
  AlignLeft,
  Braces,
  ChevronDown,
  ChevronRight,
  ChevronsRight,
  Columns3,
  Copy,
  Eye,
  Database,
  FileSpreadsheet,
  Globe,
  Hash,
  CalendarClock,
  Type,
  History,
  ClipboardList,
  Layers,
  MapPin,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sigma,
  SlidersHorizontal,
  Table2,
  Trash2,
  X,
  PenLine,
  Zap,
  Pencil,
  Rows3,
  Bug,
  ArrowDown,
  ArrowUp,
  Download,
  Filter,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { contrastOn } from '../../theme';
import { api } from '../../api';
import { KIND } from './ConnectionsTab';
import {
  DurationInput,
  fromMinutes,
  formatMinutes,
  noDuration,
  toMinutes,
  type Duration,
} from './Duration';
import { useProject } from './context';

const SqlEditor = lazy(() => import('./SqlEditor'));
const ScriptEditor = lazy(() => import('./ScriptEditor'));

/** What a dataset can be written in. SQL runs on DuckDB; the rest run in a sandbox. */
type Lang = 'sql' | 'python' | 'r' | 'javascript';
const LANGS: { id: Lang; label: string; about: string }[] = [
  { id: 'sql', label: 'SQL', about: 'Query the sources with DuckDB SQL' },
  { id: 'python', label: 'Python', about: 'pandas and numpy; each source is a DataFrame' },
  { id: 'r', label: 'R', about: 'Base R; each source is a data.frame' },
  { id: 'javascript', label: 'JavaScript', about: 'Each source is a list of rows in tables' },
];
/** Where to start in each language: it reads the first source and returns it. */
const starter = (lang: Lang, alias: string): string =>
  ({
    sql: '',
    python: `# Each source is a pandas DataFrame named like its alias${alias ? `: ${alias}` : ''}.\n# Set \`result\` to the table you want (a DataFrame).\nresult = ${alias || 'data'}.copy()\n`,
    r: `# Each source is a data.frame named like its alias${alias ? `: ${alias}` : ''}.\n# Set \`result\` to the table you want (a data.frame).\nresult <- ${alias || 'data'}\n`,
    javascript: `// Each source is a list of rows in tables${alias ? `.${alias}` : ''}.\n// Return the rows you want, as a list of objects.\nreturn tables.${alias || 'data'};\n`,
  })[lang];

/** The `:names` a query uses: not inside strings or comments, and not the `::` of a cast. */
function usedParams(sql: string): string[] {
  const bare = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"/g, ' ');
  return [...new Set([...bare.matchAll(/(?<![:\w]):([a-z][a-z0-9_]{0,62})\b/g)].map((m) => m[1]!))];
}
const paramLabel = (name: string) => name.replace(/_+/g, ' ').replace(/^./, (c) => c.toUpperCase());
/** The column a `:name` is compared with (`beds = :beds`, `:from <= visited_on`, `name like :q`), and how. */
function comparedWith(sql: string, name: string): { column: string; op: string } | null {
  const bare = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/g, ' ');
  const id = String.raw`((?:[a-z_][a-z0-9_]*\.)*(?:[a-z_][a-z0-9_]*|"[^"]+"))`;
  const op = String.raw`(<=|>=|<>|!=|=|<|>|not\s+ilike|not\s+like|ilike|like|in)`;
  const colFirst = new RegExp(`${id}\\s*${op}\\s*\\(?\\s*:${name}\\b`, 'i').exec(bare);
  if (colFirst) return { column: colFirst[1]!.split('.').pop()!.replace(/"/g, '').toLowerCase(), op: colFirst[2]!.toLowerCase() };
  const paramFirst = new RegExp(`:${name}\\b\\s*${op}\\s*${id}`, 'i').exec(bare);
  if (paramFirst) return { column: paramFirst[2]!.split('.').pop()!.replace(/"/g, '').toLowerCase(), op: paramFirst[1]!.toLowerCase() };
  return null;
}

/** What kind of value a parameter probably takes, from its name. */
const guessParamType = (name: string): DatasetParam['type'] =>
  /date|(^|_)(from|since|until|day)(_|$)/.test(name) ? 'date' : /(^|_)(id|num|number|count|limit|min|max|year|age|amount|total)(_|$)/.test(name) ? 'number' : 'text';

/** The query with a condition on its rows, as a database tool's filter bar applies it. */
const filtered = (sql: string, where?: string) =>
  where?.trim()
    ? `select * from (\n${sql.trim().replace(/;+\s*$/, '')}\n) as _f\nwhere ${where.trim()}`
    : sql;

/** The fetch sizes offered, and the most rows one run will bring back ("fetch all"). */
const PAGE_SIZES = [50, 100, 200, 500, 1000, 5000] as const;
const FETCH_ALL = 50_000;
/** Rows drawn at once; the query itself may return more. */
const DRAW = 1000;

const snake = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'd_$1')
    .slice(0, 60);

const QUOTE: Record<string, [string, string]> = {
  mysql: ['`', '`'],
  mariadb: ['`', '`'],
  clickhouse: ['`', '`'],
  bigquery: ['`', '`'],
  mssql: ['[', ']'],
};
const quote = (kind: string, id: string) => {
  const [a, b] = QUOTE[kind] ?? ['"', '"'];
  return `${a}${id.replaceAll(b, b + b)}${b}`;
};

type Mode = 'connection' | 'local';
interface Draft {
  name: string;
  description: string;
  /** How often the rows are expected to be refreshed. */
  freshness: Duration;
  mode: Mode;
  /** For a dataset over local sources: the language the text in the editor is written in. */
  lang: Lang;
  connection: string;
  /** "schema.table" while the dataset is a table as it is (physical), else null (virtual). */
  table: string | null;
  /** The text in the editor: SQL, or code in the chosen language. */
  sql: string;
  inputs: DatasetInputRef[];
  /** The date column dashboard periods filter. */
  timeColumn: string | null;
  parameters: DatasetParam[];
  /** Run the query again for the values viewers pick on a dashboard. */
  runPerViewer: boolean;
}

const blank = (mode: Mode): Draft => ({
  name: '',
  description: '',
  freshness: noDuration,
  mode,
  lang: 'sql',
  connection: '',
  table: null,
  sql: '',
  inputs: [],
  timeColumn: null,
  parameters: [],
  runPerViewer: false,
});

function fromDataset(
  d: Pick<DatasetDto, 'name' | 'description' | 'freshnessMinutes' | 'source' | 'settings'>,
): Draft {
  const s = d.source;
  return {
    name: d.name,
    description: d.description,
    freshness: fromMinutes(d.freshnessMinutes),
    mode: s.type === 'local' || s.type === 'script' ? 'local' : 'connection',
    lang: s.type === 'script' ? s.language : 'sql',
    connection: s.type === 'connection' ? s.connection : '',
    table: s.type === 'connection' ? (s.table ?? null) : null,
    sql: s.type === 'rows' ? '' : s.type === 'script' ? s.code : s.sql,
    inputs: s.type === 'local' || s.type === 'script' ? s.inputs : [],
    timeColumn: d.settings.timeColumn,
    parameters: d.settings.parameters,
    runPerViewer: d.settings.runPerViewer,
  };
}

const sourceOf = (d: Draft): DatasetSource =>
  d.mode === 'connection'
    ? {
        type: 'connection',
        connection: d.connection,
        sql: d.sql,
        ...(d.table ? { table: d.table } : {}),
      }
    : d.lang === 'sql'
      ? { type: 'local', sql: d.sql, inputs: d.inputs }
      : { type: 'script', language: d.lang, code: d.sql, inputs: d.inputs };

/**
 * Builds a dataset from SQL in a full-screen pop-up: pick a database connection (or forms, files, APIs and
 * other datasets), write a query, see the rows, and save. A saved dataset is refreshed into rows that
 * dashboards read.
 */
export function DatasetEditor() {
  const { tenantId, project, base } = useProject();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { datasetKey } = useParams({ strict: false }) as { datasetKey?: string };
  const search = useSearch({ strict: false }) as {
    name?: string;
    description?: string;
    type?: Mode;
    lang?: Exclude<Lang, 'sql'>;
    from?: string;
  };
  /** Where a new dataset starts: on a connection, or reading a form, a file or API, or another dataset. */
  const start = (): Draft => {
    const [what, ref = ''] = (search.from ?? '').includes(':')
      ? (search.from as string).split(/:(.*)/s)
      : ['connection', search.from ?? ''];
    // Named in the New dataset dialog.
    const named = { name: search.name ?? '', description: search.description ?? '' };
    if (search.type !== 'local') return { ...blank('connection'), ...named, connection: ref };
    const alias = snake(ref) || 'data';
    const inputs: DatasetInputRef[] = !ref
      ? []
      : what === 'form'
        ? [{ kind: 'form', ref, as: alias }]
        : what === 'entity'
          ? [{ kind: 'entity', ref, as: alias }]
          : what === 'dataset'
            ? [{ kind: 'dataset', ref, as: alias }]
            : [{ kind: 'connection', ref, as: alias }];
    const lang = search.lang ?? 'sql';
    return {
      ...blank('local'),
      ...named,
      lang,
      inputs,
      sql:
        lang === 'sql'
          ? inputs.length
            ? `select * from ${alias}`
            : ''
          : starter(lang, inputs.length ? alias : ''),
    };
  };
  const isNew = !datasetKey;
  const datasets = useQuery({
    queryKey: ['datasets', tenantId, project.key],
    queryFn: () => api.datasets(tenantId, project.key),
  });
  const existing = datasets.data?.find((d) => d.key === datasetKey);
  const dashboards = useQuery({
    queryKey: ['dashboards', tenantId, project.key],
    queryFn: () => api.dashboards(tenantId, project.key),
  });
  const usedBy = (dashboards.data ?? [])
    .filter((dash) =>
      dash.widgets.some(
        (w) => (w.query as { dataset?: string } | undefined)?.dataset === datasetKey,
      ),
    )
    .map((dash) => dash.name);
  const [draft, setDraft] = useState<Draft | null>(isNew ? start() : null);
  const [saved, setSaved] = useState<string>(() => JSON.stringify(isNew ? start() : null));
  // Every run keeps its own tab; Run refreshes the open one, and Run in new tab adds another.
  const [runs, setRuns] = useState<RunTab[]>([]);
  const [activeRun, setActiveRun] = useState<number | null>(null);
  const runSeq = useRef(0);
  // The part of the query that is selected, kept for the Run buttons.
  const selection = useRef('');
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  const current = runs.find((r) => r.id === activeRun) ?? null;
  const result = current?.result ?? null;
  const running = runs.some((r) => r.pending);
  const clearRuns = () => (setRuns([]), setActiveRun(null));
  // Like a database tool: a page of rows at a time, the next page on request or when the grid is scrolled to its end.
  const [pageSize, setPageSize] = useState<number>(200);
  const [counts, setCounts] = useState<Record<number, number | 'busy' | 'na'>>({});
  // A dataset named in the New dataset dialog needs no settings pop-up first.
  // A dataset that arrives without a name (not from the New dataset dialog) is asked for it first, with nothing behind.
  const [askName, setAskName] = useState(isNew && !search.name?.trim());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pane, setPane] = useState<'results' | 'debug'>('results');
  // The results stay out of the way while the query is being written; running (or opening a saved dataset) brings them up.
  const [resultsOpen, setResultsOpen] = useState(false);
  const autoRan = useRef(false);
  // The left panel: where the data comes from, then what is defined on it.
  const [side, setSide] = useState<'source' | 'parameters'>('source');

  useEffect(() => {
    if (existing && !draft) {
      const d = fromDataset(existing);
      setDraft(d);
      setSaved(JSON.stringify(d));
    }
  }, [existing, draft]);

  const connections = useQuery({
    queryKey: ['connections', tenantId, project.key],
    queryFn: () => api.connections(tenantId, project.key),
  });
  const dbs = (connections.data ?? []).filter((c) => isDatabaseKind(c.kind));
  const conn = dbs.find((c) => c.key === draft?.connection);
  const catalog = useQuery({
    queryKey: ['catalog', tenantId, project.key, draft?.connection],
    queryFn: () => api.catalog(tenantId, project.key, draft!.connection),
    enabled: draft?.mode === 'connection' && !!conn,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const sources = useQuery({
    queryKey: ['sql-sources', tenantId, project.key],
    queryFn: () => api.localSources(tenantId, project.key),
    enabled: draft?.mode === 'local',
  });

  // The first connection is chosen for a new dataset.
  useEffect(() => {
    if (draft && draft.mode === 'connection' && !draft.connection && dbs[0])
      setDraft({ ...draft, connection: dbs[0].key });
  }, [draft, dbs]);

  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const key = existing?.key ?? snake(draft?.name ?? '');
  const set = (patch: Partial<Draft>) => draft && setDraft({ ...draft, ...patch });

  const canRun = !!draft && !!draft.sql.trim() && (draft.mode === 'local' || !!draft.connection);
  /** Switches the language; code the person wrote is replaced only after they agree. */
  const changeLang = async (l: Lang) => {
    if (!draft || draft.lang === l) return;
    const alias = draft.inputs[0]?.as ?? '';
    const fresh = !draft.sql.trim() || LANGS.some((o) => draft.sql === starter(o.id, alias));
    const label = LANGS.find((o) => o.id === l)?.label;
    if (
      !fresh &&
      !(await confirmDialog(
        `Switch to ${label}? The code in the editor is replaced by a ${label} starter.`,
        { confirmLabel: `Switch to ${label}`, danger: true },
      ))
    )
      return;
    setDraft({ ...draft, lang: l, sql: starter(l, alias) });
    clearRuns();
    setBreakpoints([]);
  };
  const isCode = draft?.mode === 'local' && draft.lang !== 'sql';
  /** how: Run refreshes the open tab, Run in new tab adds one, Debug stops at the first breakpoint. */
  /** `where`: a filter on the rows (a SQL condition); left out, the open tab keeps its own, and a new tab has none. */
  const execute = async (
    how: 'run' | 'new' | 'debug',
    selection?: string,
    more?: number,
    where?: string,
  ) => {
    const rows = more ?? pageSize;
    if (!draft || !canRun || running) return;
    const debug =
      isCode && breakpoints.length ? { lines: breakpoints, stop: how === 'debug' } : undefined;
    const reuse = how === 'new' ? null : (current?.id ?? null);
    const id = reuse ?? ++runSeq.current;
    const base = selection?.trim() ? selection : draft.sql;
    const filter =
      how === 'debug'
        ? undefined
        : where === undefined
          ? reuse
            ? current?.where
            : undefined
          : where.trim() || undefined;
    setRuns((rs) =>
      reuse
        ? rs.map((r) => (r.id === id ? { ...r, pending: true, error: null } : r))
        : [
            ...rs.slice(-7),
            { id, result: null, error: null, pending: true, ran: base, where: filter },
          ],
    );
    setActiveRun(id);
    setPane('results');
    setResultsOpen(true);
    // A fresh run starts a new count; fetching more rows of the same query keeps it.
    if (more === undefined)
      setCounts((c) => {
        const { [id]: _gone, ...rest } = c;
        return rest;
      });
    try {
      const r = await api.runSql(tenantId, project.key, {
        source: sourceOf({ ...draft, ...(filter && { table: null }), sql: filtered(base, filter) }),
        limit: rows,
        parameters: draft.parameters.filter((p) => p.name),
        ...(debug && { debug }),
      });
      setRuns((rs) =>
        rs.map((x) =>
          x.id === id
            ? {
                ...x,
                result: r,
                error: null,
                pending: false,
                at: Date.now(),
                ran: base,
                where: filter,
              }
            : x,
        ),
      );
      if (r.debug?.stopped) setPane('debug');
    } catch (e) {
      // A failed run clears that tab's rows, so the error is not shown above stale results.
      setRuns((rs) =>
        rs.map((x) =>
          x.id === id ? { ...x, result: null, error: e, pending: false, where: filter } : x,
        ),
      );
    }
  };
  const runIt = (selection?: string) => void execute('run', selection);
  /** More rows of the open run: re-runs its own query asking for a page more (or all of them). */
  const fetchMore = (all?: boolean) =>
    void execute(
      'run',
      current?.ran,
      all ? FETCH_ALL : Math.min(FETCH_ALL, (result?.rows.length ?? 0) + pageSize),
    );
  /** Filters the open run's rows with a SQL condition (empty = all of them). */
  const applyFilter = (expr: string) => void execute('run', current?.ran, undefined, expr);
  /** The exact number of rows the open run's query has, as the database counts them. */
  const countRows = async () => {
    if (!current?.ran || !draft || isCode) return;
    const id = current.id;
    setCounts((c) => ({ ...c, [id]: 'busy' }));
    try {
      const inner = filtered(current.ran, current.where)
        .trim()
        .replace(/;+\s*$/, '');
      const r = await api.runSql(tenantId, project.key, {
        source: sourceOf({
          ...draft,
          table: null,
          sql: `select count(*) as n from (\n${inner}\n) as _c`,
        }),
        limit: 1,
        parameters: draft.parameters.filter((p) => p.name),
      });
      const n = Number(Object.values(r.rows[0] ?? {})[0]);
      setCounts((c) => ({ ...c, [id]: Number.isFinite(n) ? n : 'na' }));
    } catch {
      setCounts((c) => ({ ...c, [id]: 'na' }));
    }
  };
  const runNew = (selection?: string) => void execute('new', selection);
  const debugIt = () => void execute('debug');
  // A saved dataset shows its rows when it is opened.
  useEffect(() => {
    if (isNew || !draft || !canRun || autoRan.current) return;
    autoRan.current = true;
    void execute('run');
  }, [isNew, draft, canRun]);

  const save = useMutation({
    mutationFn: async (refresh: boolean) => {
      const d = draft!;
      const list = await api.saveDataset(
        tenantId,
        project.key,
        {
          key,
          name: d.name,
          description: d.description,
          freshnessMinutes: toMinutes(d.freshness),
          source: sourceOf(d),
          settings: {
            timeColumn: d.timeColumn,
            metrics: [],
            parameters: d.parameters.filter((p) => p.name),
            runPerViewer: d.runPerViewer,
          },
        },
        existing?.key,
      );
      qc.setQueryData(['datasets', tenantId, project.key], list);
      setSaved(JSON.stringify(d));
      if (refresh) return api.refreshDataset(tenantId, project.key, key);
      return list;
    },
    onSuccess: (list, refresh) => {
      qc.setQueryData(['datasets', tenantId, project.key], list);
      void qc.invalidateQueries({ queryKey: ['dataset-rows', tenantId, project.key] });
      const ds = list.find((x) => x.key === key);
      toast(
        refresh && ds?.freshness.live
          ? `Saved · the query returned ${ds.rowCount.toLocaleString()} rows`
          : refresh
            ? `Saved · ${ds?.rowCount.toLocaleString() ?? 0} rows loaded`
            : 'Saved',
      );
      // Saving brings the results up too: the rows of the last run, or a fresh run of the saved query.
      if (runs.length) setResultsOpen(true);
      else void execute('run');
      if (isNew) void navigate({ to: `${base}/datasets/${key}/edit`, replace: true });
    },
  });

  const close = async () => {
    if (
      dirty &&
      !(await confirmDialog('Close without saving your changes?', {
        confirmLabel: 'Close without saving',
        danger: true,
      }))
    )
      return;
    void navigate({ to: `${base}/datasets` });
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' &&
      !document.querySelector('dialog[open]') &&
      !document.querySelector('.cm-tooltip-autocomplete') &&
      closeRef.current();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, []);

  const schema = useMemo(() => {
    const out: Record<string, string[]> = {};
    if (draft?.mode === 'connection') {
      for (const t of catalog.data?.tables ?? []) {
        const cols = t.columns.map((c) => c.name);
        out[t.name] = cols;
        out[`${t.schema}.${t.name}`] = cols;
      }
    } else {
      for (const i of draft?.inputs ?? []) {
        const cols =
          i.kind === 'form'
            ? sources.data?.forms.find((f) => f.key === i.ref)?.columns
            : i.kind === 'dataset'
              ? sources.data?.datasets.find((f) => f.key === i.ref)?.columns
              : i.kind === 'entity'
                ? sources.data?.entities.find((f) => f.key === i.ref)?.columns
                : i.kind === 'entity_types'
                  ? sources.data?.entityTypes.columns
                  : [];
        out[i.as] = cols ?? [];
      }
    }
    return out;
  }, [draft?.mode, draft?.inputs, catalog.data, sources.data]);

  const shell = (children: React.ReactNode) =>
    createPortal(
      <div
        className="brand-scope fixed inset-0 z-[45] bg-black/55 p-2 sm:p-4"
        style={
          {
            '--brand-600': project.color,
            '--brand-contrast': contrastOn(project.color),
          } as React.CSSProperties
        }
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={existing ? `Edit ${existing.name}` : 'New dataset'}
          className="mx-auto flex h-full max-w-[1800px] flex-col overflow-hidden bg-canvas text-ink shadow-raised"
        >
          {children}
        </div>
      </div>,
      document.body,
    );
  // A `:name` written in the query becomes a parameter by itself, a moment after typing stops; one made this way
  // and then dropped from the query (a half-typed name, say) goes again while it is still untouched.
  // Its type comes from the column it is compared with (a number for `beds = :beds`), from what is known of the
  // columns (the last run, else the connection's tables), else from its name; and is looked at again when more is known.
  const autoParams = useRef(new Map<string, DatasetParam['type']>());
  useEffect(() => {
    if (!draft || (draft.mode === 'local' && draft.lang !== 'sql')) return;
    const typeOf = (name: string): DatasetParam['type'] => {
      const hit = comparedWith(draft.sql, name);
      if (hit) {
        if (/like/.test(hit.op)) return 'text';
        const sqlType =
          result?.columns.find((c) => c.name.toLowerCase() === hit.column)?.type ??
          catalog.data?.tables.flatMap((t) => t.columns).find((c) => c.name.toLowerCase() === hit.column)?.type;
        const k = columnKind(hit.column, sqlType);
        if (sqlType || k !== 'text') return k === 'number' ? 'number' : k === 'date' ? 'date' : 'text';
      }
      return guessParamType(name);
    };
    const id = setTimeout(() => {
      const used = new Set(usedParams(draft.sql));
      const have = new Set(draft.parameters.map((p) => p.name));
      const gone = draft.parameters.filter((p) => autoParams.current.has(p.name) && !used.has(p.name) && !p.default && p.label === paramLabel(p.name) && !p.column);
      const add = [...used].filter((n) => !have.has(n));
      // One made here and not touched since takes the better guess when there is one.
      const retyped = draft.parameters.filter((p) => !gone.includes(p) && autoParams.current.get(p.name) === p.type && used.has(p.name) && typeOf(p.name) !== p.type);
      if (!add.length && !gone.length && !retyped.length) return;
      for (const g of gone) autoParams.current.delete(g.name);
      for (const n of add) autoParams.current.set(n, typeOf(n));
      for (const r of retyped) autoParams.current.set(r.name, typeOf(r.name));
      set({
        parameters: [
          ...draft.parameters.filter((p) => !gone.includes(p)).map((p) => (retyped.includes(p) ? { ...p, type: typeOf(p.name) } : p)),
          ...add.map((n) => ({ name: n, label: paramLabel(n), type: typeOf(n), default: '' }) as DatasetParam),
        ],
      });
      if (add.length) toast(add.length === 1 ? `Added the parameter :${add[0]}` : `Added ${add.length} parameters`);
    }, 700);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.sql, draft?.parameters, draft?.mode, draft?.lang, result, catalog.data]);

  if (datasets.isPending || (!isNew && existing && !draft)) return shell(<Loading />);
  if (!draft)
    return shell(
      <div className="p-6">
        <ErrorNotice error={new Error('Dataset not found')} />
      </div>,
    );
  const kind = draft.mode === 'connection' ? (conn?.kind ?? 'postgres') : 'local';
  const dialect = (KIND as Record<string, { label: string }>)[kind]?.label ?? 'SQL';
  const taken = (datasets.data ?? []).some(
    (d) =>
      d.key !== existing?.key &&
      (d.key === key || d.name.trim().toLowerCase() === draft.name.trim().toLowerCase()),
  );
  const valid = !!draft.name.trim() && !!key && !taken && canRun;
  // A new dataset starts with just this question: the editor behind it opens once it has a name.
  if (askName)
    return (
      <SettingsDialog
        open
        onClose={() => void close()}
        onDone={() => setAskName(false)}
        draft={draft}
        isNew={isNew}
        taken={taken}
        onName={(name) => set({ name })}
        onLang={(l) => void changeLang(l)}
        onChange={set}
        usedBy={null}
      />
    );

  return shell(
    <>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        draft={draft}
        isNew={isNew}
        taken={taken}
        onName={(name) => set({ name })}
        onLang={(l) => void changeLang(l)}
        onChange={set}
        usedBy={existing ? usedBy : null}
      />
      {historyOpen && existing && (
        <HistoryDialog
          tenantId={tenantId}
          projectKey={project.key}
          datasetKey={existing.key}
          draft={draft}
          onClose={() => setHistoryOpen(false)}
          onRestore={(v) => {
            setDraft({ ...fromDataset(v), name: draft.name === v.name ? draft.name : v.name });
            clearRuns();
            setHistoryOpen(false);
            toast(`Version ${v.version} is in the editor. Save to keep it as a new version`);
          }}
        />
      )}
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-zinc-200 bg-snow px-4 py-2.5 sm:px-6">
        <div className="min-w-0 flex-1">
          <h1
            className="truncate px-1 text-xl font-semibold tracking-tight"
            title="Change the name in the settings"
          >
            {draft.name || 'Untitled dataset'}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 px-1 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1">
              {draft.mode === 'connection' ? (
                <Database className="size-3" />
              ) : (
                <ClipboardList className="size-3" />
              )}
              {draft.mode === 'connection'
                ? draft.table
                  ? `${dialect} table`
                  : `${dialect} SQL`
                : `${LANGS.find((l) => l.id === draft.lang)?.label} over ${draft.inputs.length ? draft.inputs.map((i) => i.ref).join(', ') : 'your data'}`}
            </span>
            {key && <span className="font-mono">{key}</span>}
            {existing?.lastMaterialisedAt &&
              (draft.mode === 'connection' ? (
                <span>Live · last queried {relTime(existing.lastMaterialisedAt)}</span>
              ) : (
                <span>{existing.rowCount.toLocaleString()} rows stored</span>
              ))}
            {taken && <span className="text-red-700">Another dataset already has this name</span>}
            {dirty && <span className="text-amber-700">Unsaved changes</span>}
          </p>
        </div>
        {existing && (
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label="Version history"
            title="Version history"
            className="p-2 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
          >
            <History className="size-5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Dataset settings"
          title="Name, language and description"
          className="p-2 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
        >
          <Settings className="size-5" />
        </button>
        {draft.mode === 'connection' ? (
          <Button
            icon={Save}
            disabled={!valid || !dirty}
            loading={save.isPending}
            onClick={() => save.mutate(true)}
            title="Saves the dataset and queries the database once to learn its columns. No rows are stored."
          >
            Save
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              icon={Save}
              disabled={!valid || !dirty}
              loading={save.isPending && !save.variables}
              onClick={() => save.mutate(false)}
            >
              Save
            </Button>
            <Button
              icon={RefreshCw}
              disabled={!valid}
              loading={save.isPending && !!save.variables}
              onClick={() => save.mutate(true)}
            >
              Save and load rows
            </Button>
          </>
        )}
        <button
          type="button"
          onClick={() => void close()}
          aria-label="Close"
          title="Close (Esc)"
          className="p-2 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[25rem_1fr]">
        <aside className="grid min-h-0 grid-cols-[2.75rem_1fr] border-b border-zinc-200 bg-snow lg:border-e lg:border-b-0">
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label="Dataset parts"
            className="border-e border-zinc-200 bg-zinc-50 py-1.5"
          >
            {(
              [
                ['source', 'Source', draft.mode === 'connection' ? Database : ClipboardList, 0, 0],
                ['parameters', 'Parameters', SlidersHorizontal, draft.parameters.length, 0],
              ] as const
            ).map(([id, label, Icon, n, bad]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={side === id}
                onClick={() => setSide(id)}
                className={cx(
                  'flex w-full flex-col items-center gap-2 border-s-[3px] px-0 py-3 text-xs font-medium',
                  side === id
                    ? 'border-accent-600 bg-snow text-ink'
                    : 'border-transparent text-zinc-500 hover:text-ink',
                )}
              >
                <Icon className="size-4 -rotate-90" aria-hidden />
                <span className="[writing-mode:vertical-rl] rotate-180">{label}</span>
                {n > 0 && (
                  <span
                    className={cx(
                      'rounded-full px-1.5 text-[10px] leading-4',
                      bad ? 'bg-red-700 text-white' : 'bg-accent-600 text-on-accent',
                    )}
                    title={bad ? `${bad} need${bad === 1 ? 's' : ''} fixing` : undefined}
                  >
                    {bad ? '!' : n}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="min-h-0 min-w-0 overflow-y-auto">
            {side === 'parameters' ? (
              <ParametersPane
                draft={draft}
                onChange={set}
                auto={autoParams.current}
                onManual={(name) => autoParams.current.delete(name)}
              />
            ) : (
              <>
                {draft.mode === 'connection' ? (
                  <ConnectionSide
                    draft={draft}
                    dbs={dbs}
                    loading={connections.isPending}
                    catalog={catalog}
                    onConnection={(c) => set({ connection: c, table: null })}
                    onTable={(schemaName, name) => {
                      const ident = schemaName
                        ? `${quote(kind, schemaName)}.${quote(kind, name)}`
                        : quote(kind, name);
                      set({ table: `${schemaName}.${name}`, sql: `select * from ${ident}` });
                    }}
                  />
                ) : (
                  <LocalSide
                    tenantId={tenantId}
                    projectKey={project.key}
                    onInsert={draft.lang === 'sql' ? (sql) => set({ sql }) : undefined}
                    draft={draft}
                    sources={sources.data}
                    loading={sources.isPending}
                    error={sources.error}
                    onChange={(inputs) => set({ inputs })}
                  />
                )}
              </>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col">
          <div
            className={cx(
              'border-b border-zinc-200 bg-snow',
              resultsOpen ? 'shrink-0' : 'flex min-h-0 flex-1 flex-col',
            )}
          >
            {draft.mode === 'local' && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  title="Change the language"
                  className="border border-zinc-300 bg-canvas px-2 py-0.5 text-xs font-medium hover:bg-zinc-100"
                >
                  {LANGS.find((l) => l.id === draft.lang)?.label}
                </button>
                <span className="text-xs text-zinc-500">
                  {LANGS.find((l) => l.id === draft.lang)?.about}
                </span>
              </div>
            )}
            <div className={cx('flex', !resultsOpen && 'min-h-0 flex-1')}>
              <div
                role="toolbar"
                aria-orientation="vertical"
                aria-label="Run"
                className="flex w-7 shrink-0 flex-col items-center gap-0.5 border-e border-zinc-200 bg-zinc-50 py-1.5"
              >
                <RunTool
                  label="Run"
                  hint={
                    isCode
                      ? 'Ctrl or ⌘ + Enter'
                      : 'Ctrl or ⌘ + Enter · runs the selection if there is one'
                  }
                  disabled={!canRun || running}
                  busy={running}
                  onClick={() => runIt(selection.current || undefined)}
                >
                  <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                    <path d="M7 4l13 8-13 8z" fill="currentColor" />
                  </svg>
                </RunTool>
                <RunTool
                  label="Run in new tab"
                  hint="Ctrl or ⌘ + \"
                  disabled={!canRun || running}
                  onClick={() => runNew(selection.current || undefined)}
                >
                  <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                    <path d="M4 3l12 7.5L4 18z" fill="currentColor" />
                    <path
                      d="M18 14v7M14.5 17.5h7"
                      style={{ stroke: 'var(--plus, currentColor)' }}
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </svg>
                </RunTool>
                {isCode && (
                  <RunTool
                    label="Run and stop at the first breakpoint"
                    hint={
                      breakpoints.length
                        ? 'Ctrl or ⌘ + Shift + Enter'
                        : 'Click a line number to set a breakpoint first'
                    }
                    disabled={!canRun || running}
                    badge={breakpoints.length}
                    onClick={debugIt}
                  >
                    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                      <rect
                        x="3.5"
                        y="2.5"
                        width="17"
                        height="19"
                        rx="3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path d="M9.5 7.5l6 4.5-6 4.5z" fill="currentColor" />
                    </svg>
                  </RunTool>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Suspense
                  fallback={
                    <div className="grid h-[260px] place-items-center">
                      <Spinner />
                    </div>
                  }
                >
                  {draft.mode === 'local' && draft.lang !== 'sql' ? (
                    <ScriptEditor
                      value={draft.sql}
                      onChange={(v) => set({ sql: v })}
                      onRun={() => runIt()}
                      onRunNew={() => runNew()}
                      onDebug={debugIt}
                      onBreakpoints={setBreakpoints}
                      parameters={draft.parameters}
                      language={draft.lang}
                      height={resultsOpen ? undefined : '100%'}
                    />
                  ) : (
                    <SqlEditor
                      value={draft.sql}
                      onChange={(v) => set({ sql: v, table: null })}
                      onRun={runIt}
                      onRunNew={runNew}
                      onSelection={(t) => (selection.current = t)}
                      dialect={kind}
                      schema={schema}
                      parameters={draft.parameters}
                      height={resultsOpen ? undefined : '100%'}
                    />
                  )}
                </Suspense>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 px-3 py-2">
              {draft.mode === 'local' && draft.lang !== 'sql' && (
                <span className="text-xs text-zinc-500">
                  Runs in a sandbox, no network.{' '}
                  {draft.lang === 'python' ? 'The first run takes a few seconds.' : ''}
                </span>
              )}
            </div>
          </div>

          {!resultsOpen && runs.length > 0 && (
            <button
              type="button"
              onClick={() => setResultsOpen(true)}
              className="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-start text-sm text-zinc-700 hover:bg-zinc-100"
            >
              <Table2 className="size-4 text-zinc-500" /> Show results
              <span className="text-xs text-zinc-400">
                {runs.length} run{runs.length === 1 ? '' : 's'}
              </span>
            </button>
          )}
          {resultsOpen && (
            <div
              role="tablist"
              aria-label="Results"
              className="flex shrink-0 items-end gap-0.5 overflow-x-auto border-b border-zinc-200 px-3 pt-1.5"
            >
              {runs.map((r) => {
                const on = r.id === activeRun && pane === 'results';
                return (
                  <span
                    key={r.id}
                    className={cx(
                      '-mb-px inline-flex shrink-0 items-center border-b-2',
                      on
                        ? 'border-accent-600 text-ink'
                        : 'border-transparent text-zinc-600 hover:text-ink',
                    )}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => (setActiveRun(r.id), setPane('results'))}
                      className={cx(
                        'flex items-center gap-1.5 py-2 ps-3 pe-1.5 text-sm',
                        on && 'font-medium',
                      )}
                    >
                      {r.pending ? (
                        <Spinner />
                      ) : r.error ? (
                        <X className="size-4 text-red-700" aria-hidden />
                      ) : (
                        <Table2 className="size-4" aria-hidden />
                      )}
                      {runs.length === 1 ? 'Results' : `Run ${r.id}`}
                      {r.result && (
                        <span className="text-xs font-normal text-zinc-400">
                          {r.result.rows.length.toLocaleString()}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`Close ${runs.length === 1 ? 'results' : `run ${r.id}`}`}
                      onClick={() => {
                        const rest = runs.filter((x) => x.id !== r.id);
                        setRuns(rest);
                        if (!rest.length) setResultsOpen(false);
                        if (activeRun === r.id) setActiveRun(rest.at(-1)?.id ?? null);
                      }}
                      className="me-1 p-1 text-zinc-400 hover:text-ink"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                );
              })}
              {(result?.debug?.hits.length || result?.debug?.stopped) && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={pane === 'debug'}
                  onClick={() => setPane('debug')}
                  className={cx(
                    '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
                    pane === 'debug'
                      ? 'border-accent-600 font-medium text-ink'
                      : 'border-transparent text-zinc-600 hover:text-ink',
                  )}
                >
                  <Bug className="size-4" /> Variables
                </button>
              )}
              <button
                type="button"
                onClick={() => setResultsOpen(false)}
                aria-label="Hide results"
                title="Hide results"
                className="ms-auto mb-1 p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>
          )}

          {resultsOpen && (
            <div className="min-h-0 flex-1 overflow-auto bg-canvas">
              <div className="flex h-full min-h-0 flex-col p-3">
                {current?.error ? <QueryError error={current.error} /> : <ErrorNotice error={save.error} />}
                {current?.pending && !result ? (
                  <Loading />
                ) : !result && current?.error ? null : !result ? (
                  <p className="p-6 text-center text-sm text-zinc-500">
                    {existing?.refreshError && !current ? (
                      <span className="text-red-700">
                        Last refresh failed: {existing.refreshError}
                      </span>
                    ) : (
                      'Run the query to see its rows.'
                    )}
                  </p>
                ) : pane === 'debug' && result.debug ? (
                  <div className="min-h-0 flex-1 overflow-auto">
                    <DebugPane debug={result.debug} />
                  </div>
                ) : (
                  <ResultsPanel
                    result={result}
                    at={current?.at}
                    running={running}
                    where={current?.where}
                    onFilter={applyFilter}
                    pageSize={pageSize}
                    onPageSize={setPageSize}
                    onMore={fetchMore}
                    count={current ? counts[current.id] : undefined}
                    onCount={isCode ? undefined : () => void countRows()}
                    onRefresh={() => runIt()}
                    canRun={canRun}
                  />
                )}
              </div>
            </div>
          )}
          {!resultsOpen && save.error && (
            <div className="shrink-0 p-3">
              <ErrorNotice error={save.error} />
            </div>
          )}
        </main>
      </div>
    </>,
  );
}

/** One button of the strip beside the editor: an icon in the editor's own orange, its name and shortcut as the tooltip. */
function RunTool({
  label,
  hint,
  onClick,
  disabled,
  busy,
  badge,
  children,
}: {
  label: string;
  hint: string;
  onClick(): void;
  disabled?: boolean;
  busy?: boolean;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={`${label} (${hint})`}
      aria-label={label}
      aria-busy={busy}
      disabled={disabled}
      onClick={onClick}
      className="relative grid size-6 place-items-center rounded text-[#e8832a] [--plus:#2e9b3e] hover:bg-zinc-200/70 disabled:text-zinc-300 disabled:[--plus:currentColor] disabled:hover:bg-transparent"
    >
      {busy ? <Spinner /> : children}
      {!!badge && (
        <span className="absolute -end-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-[#da1e28] px-1 text-[10px] leading-4 font-semibold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

type ResultView = 'grid' | 'text' | 'record';

/** The rows of a run as DBeaver shows them: a filter bar, typed column headers, a footer with the row limit, Refresh and export. */
function ResultsPanel({
  result,
  at,
  running,
  where,
  onFilter,
  pageSize,
  onPageSize,
  onMore,
  count,
  onCount,
  onRefresh,
  canRun,
}: {
  result: SqlResult;
  at?: number;
  running: boolean;
  /** The filter on the rows (a SQL condition) and how to change it. */
  where?: string;
  onFilter(expr: string): void;
  pageSize: number;
  onPageSize(n: number): void;
  /** Fetch the next page, or every row. */
  onMore(all?: boolean): void;
  /** The exact row count, once asked for: a number, busy, or not available. */
  count?: number | 'busy' | 'na';
  onCount?: () => void;
  onRefresh(): void;
  canRun: boolean;
}) {
  const [view, setView] = useState<ResultView>('grid');
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [rec, setRec] = useState(0);
  const [pop, setPop] = useState<{
    name: string;
    kind: ColumnKind;
    left: number;
    top: number;
  } | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const cols = result.columns;
  const rows = useMemo(() => {
    let out = result.rows;
    if (sort)
      out = [...out].sort((a, b) => {
        const x = a[sort.col];
        const y = b[sort.col];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (
          (typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir
        );
      });
    return out;
  }, [result.rows, sort]);
  const kinds = cols.map((c) => columnKind(c.name, c.type));
  /** A condition from the menus joins the filter with `and`. */
  const addCondition = (cond: string) =>
    onFilter(where?.trim() ? `(${where.trim()}) and ${cond}` : cond);
  const exportCsv = () => {
    const cell = (v: unknown) => {
      const t =
        v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = [
      cols.map((c) => cell(c.name)).join(','),
      ...rows.map((r) => cols.map((c) => cell(r[c.name])).join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'rows.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const record = rows[Math.min(rec, Math.max(rows.length - 1, 0))];
  return (
    <div className="flex min-h-0 flex-1 border border-zinc-200 bg-snow">
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label="Show the rows as"
        className="w-11 shrink-0 border-e border-zinc-200 bg-zinc-50 py-1.5"
      >
        {(
          [
            ['grid', 'Grid', Table2],
            ['text', 'Text', AlignLeft],
            ['record', 'Record', Rows3],
          ] as const
        ).map(([v, label, Icon]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            title={`Show the rows as ${label.toLowerCase()}`}
            onClick={() => setView(v)}
            className={cx(
              'flex w-full flex-col items-center gap-2 border-s-[3px] py-3 text-xs font-medium',
              view === v
                ? 'border-accent-600 bg-snow text-ink'
                : 'border-transparent text-zinc-500 hover:text-ink',
            )}
          >
            <Icon className="size-4 -rotate-90" aria-hidden />
            <span className="[writing-mode:vertical-rl] rotate-180">{label}</span>
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <FilterBar
          value={where ?? ''}
          columns={cols.map((c) => c.name)}
          disabled={running}
          onApply={(e) => (setRec(0), onFilter(e))}
        />
        <div
          className="min-h-24 flex-1 overflow-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            // Scrolled to the end of what is loaded: the next page comes by itself.
            if (
              result.truncated &&
              !running &&
              el.scrollTop + el.clientHeight >= el.scrollHeight - 80
            )
              onMore();
          }}
        >
          {!cols.length ? (
            <p className="p-6 text-center text-sm text-zinc-500">The query returned no columns.</p>
          ) : view === 'grid' ? (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-100 text-zinc-700">
                <tr>
                  <th className="w-10 border-b border-e border-zinc-200 px-2 py-1.5 text-end font-normal text-zinc-400">
                    #
                  </th>
                  {cols.map((c, i) => {
                    const K = KIND_ICON[kinds[i]!];
                    const on = sort?.col === c.name;
                    return (
                      <th
                        key={c.name}
                        className="group/h border-b border-e border-zinc-200 p-0 text-start font-medium"
                        onContextMenu={(e) => (
                          e.preventDefault(),
                          setMenu({ x: e.clientX, y: e.clientY, name: c.name, kind: kinds[i]! })
                        )}
                      >
                        <div className="flex items-center">
                          <button
                            type="button"
                            onClick={() =>
                              setSort(
                                !on
                                  ? { col: c.name, dir: 1 }
                                  : sort.dir === 1
                                    ? { col: c.name, dir: -1 }
                                    : null,
                              )
                            }
                            className="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 hover:bg-zinc-200/60"
                            title={`${KIND_LABEL[kinds[i]!]}${c.type ? `, ${c.type}` : ''}. Click to sort`}
                          >
                            <K className="size-3.5 shrink-0 text-accent-700" aria-hidden />
                            {c.name}
                            {on &&
                              (sort.dir === 1 ? (
                                <ArrowUp className="ms-auto size-3.5" />
                              ) : (
                                <ArrowDown className="ms-auto size-3.5" />
                              ))}
                          </button>
                          <ColumnFilterButton
                            name={c.name}
                            onOpen={(left, top) =>
                              setPop({ name: c.name, kind: kinds[i]!, left, top })
                            }
                          />
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, DRAW).map((r, i) => (
                  <tr key={i} className="odd:bg-snow even:bg-accent-50/50 hover:bg-accent-100/60">
                    <td className="num border-e border-zinc-100 bg-zinc-50 px-2 py-1 text-end text-zinc-400">
                      {i + 1}
                    </td>
                    {cols.map((c, ci) => (
                      <td
                        key={c.name}
                        className={cx(
                          'max-w-72 truncate whitespace-nowrap border-e border-zinc-100 px-2.5 py-1',
                          typeof r[c.name] === 'number' && 'num text-end',
                        )}
                        title={String(r[c.name] ?? '')}
                        onContextMenu={(e) => (
                          e.preventDefault(),
                          setMenu({
                            x: e.clientX,
                            y: e.clientY,
                            name: c.name,
                            kind: kinds[ci]!,
                            cell: { value: r[c.name] },
                          })
                        )}
                      >
                        <Cell v={r[c.name]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : view === 'text' ? (
            <pre className="p-3 font-mono text-xs leading-5">
              {(() => {
                const w = cols.map((c) =>
                  Math.min(
                    40,
                    Math.max(
                      c.name.length,
                      ...rows.slice(0, 200).map((r) => String(r[c.name] ?? 'null').length),
                    ),
                  ),
                );
                const line = (f: (i: number) => string) =>
                  cols.map((_, i) => f(i).slice(0, w[i]).padEnd(w[i]!)).join('  ');
                return [
                  line((i) => cols[i]!.name),
                  line((i) => '-'.repeat(w[i]!)),
                  ...rows
                    .slice(0, DRAW)
                    .map((r) => line((i) => String(r[cols[i]!.name] ?? 'null'))),
                ].join('\n');
              })()}
            </pre>
          ) : record ? (
            <div>
              <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1.5 text-xs text-zinc-600">
                <button
                  type="button"
                  aria-label="Previous row"
                  disabled={rec <= 0}
                  onClick={() => setRec(rec - 1)}
                  className="px-1.5 disabled:opacity-30"
                >
                  ‹
                </button>
                Row {Math.min(rec, rows.length - 1) + 1} of {rows.length.toLocaleString()}
                <button
                  type="button"
                  aria-label="Next row"
                  disabled={rec >= rows.length - 1}
                  onClick={() => setRec(rec + 1)}
                  className="px-1.5 disabled:opacity-30"
                >
                  ›
                </button>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {cols.map((c, i) => {
                    const K = KIND_ICON[kinds[i]!];
                    return (
                      <tr
                        key={c.name}
                        className="border-b border-zinc-100 odd:bg-snow even:bg-accent-50/50"
                      >
                        <td className="w-1/3 whitespace-nowrap px-3 py-1.5 font-medium text-zinc-700">
                          <span className="inline-flex items-center gap-1.5">
                            <K className="size-3.5 text-accent-700" aria-hidden />
                            {c.name}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono">
                          <Cell v={record[c.name]} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {!rows.length && cols.length > 0 && (
            <p className="p-4 text-center text-xs text-zinc-500">
              {where ? 'No row matches the filter.' : 'No rows.'}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-1 border-t border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-600">
          <FootTool
            label="Refresh"
            disabled={!canRun || running}
            onClick={onRefresh}
            busy={running}
          >
            <RefreshCw className="size-4 text-accent-700" />
          </FootTool>
          <FootTool label="Export to CSV" disabled={!rows.length} onClick={exportCsv}>
            <Download className="size-4 text-accent-700" />
          </FootTool>
          <span className="mx-1 h-5 w-px bg-zinc-300" aria-hidden />
          <FootTool
            label="Fetch the next page"
            disabled={!result.truncated || running}
            onClick={() => onMore()}
          >
            <ChevronRight className="size-4 text-accent-700" />
          </FootTool>
          <FootTool
            label={`Fetch all rows, up to ${FETCH_ALL.toLocaleString()}`}
            disabled={!result.truncated || running}
            onClick={() => onMore(true)}
          >
            <ChevronsRight className="size-4 text-accent-700" />
          </FootTool>
          <label className="flex items-center gap-1" title="How many rows each page brings">
            <Settings className="size-4 text-accent-700" aria-hidden />
            <input
              type="number"
              min={1}
              max={FETCH_ALL}
              list="fetch-sizes"
              aria-label="Fetch size"
              value={pageSize}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                if (Number.isFinite(n) && n >= 1) onPageSize(Math.min(n, FETCH_ALL));
              }}
              className="h-7 w-16 border border-zinc-300 bg-snow px-1.5 text-xs text-ink"
            />
            <datalist id="fetch-sizes">
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <FootTool
            label={onCount ? 'Count all the rows' : 'The rows cannot be counted here'}
            disabled={!result.truncated || !onCount || count === 'busy'}
            onClick={() => onCount?.()}
            busy={count === 'busy'}
            wide
          >
            <Sigma className="size-4 text-accent-700" />
            <span className="num ms-1 text-ink">
              {typeof count === 'number'
                ? count.toLocaleString()
                : count === 'na'
                  ? 'n/a'
                  : result.truncated
                    ? `${result.rows.length.toLocaleString()}+`
                    : result.rows.length.toLocaleString()}
            </span>
          </FootTool>
          <span className="ms-2 text-zinc-500">
            {result.rows.length.toLocaleString()} row{result.rows.length === 1 ? '' : 's'} fetched ·{' '}
            {result.ms} ms
            {at
              ? ` · ${new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
              : ''}
          </span>
        </div>
      </div>
      {pop && <ColumnFilterPop {...pop} onApply={addCondition} onClose={() => setPop(null)} />}
      {menu && (
        <CellMenu
          at={menu}
          onClose={() => setMenu(null)}
          onSort={(dir) => setSort({ col: menu.name, dir })}
          onFilterBy={() =>
            setPop({
              name: menu.name,
              kind: menu.kind,
              left: Math.min(menu.x, window.innerWidth - 270),
              top: menu.y,
            })
          }
          onAdd={addCondition}
          onClear={() => (setSort(null), where && onFilter(''))}
          canClear={!!sort || !!where}
        />
      )}
    </div>
  );
}

/** A button of the footer under the rows: just an icon, its name as the tooltip. */
function FootTool({
  label,
  onClick,
  disabled,
  busy,
  wide,
  children,
}: {
  label: string;
  onClick(): void;
  disabled?: boolean;
  busy?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-busy={busy}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex h-7 items-center justify-center text-xs hover:bg-zinc-200/70 disabled:opacity-40 disabled:hover:bg-transparent',
        wide ? 'px-2' : 'w-7',
      )}
    >
      {busy ? <Spinner /> : children}
    </button>
  );
}

type RunTab = {
  id: number;
  result: SqlResult | null;
  error: unknown;
  pending: boolean;
  at?: number;
  /** The filter on its rows, a SQL condition. */
  where?: string;
  /** The text the run executed (all of the editor, or the selected part). */
  ran?: string;
};

/** What the variables were each time a marked line was reached, one pass at a time. */
function DebugPane({ debug }: { debug: NonNullable<SqlResult['debug']> }) {
  const [at, setAt] = useState(0);
  const hit = debug.hits[Math.min(at, debug.hits.length - 1)];
  if (!hit)
    return (
      <p className="p-6 text-center text-sm text-zinc-500">
        {debug.stopped
          ? 'It stopped, but no variables could be read.'
          : 'No marked line was reached.'}
      </p>
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {debug.stopped ? (
          <span className="inline-flex items-center gap-1.5 border border-red-300 bg-red-50 px-2 py-0.5 text-red-800">
            <Bug className="size-3.5" aria-hidden /> Stopped at line {hit.line}
          </span>
        ) : (
          <span className="text-zinc-600">
            Line {hit.line} was reached {debug.hits.length} time{debug.hits.length === 1 ? '' : 's'}
            {debug.hits.length >= 50 && ' (the first 50 are kept)'}
          </span>
        )}
        {debug.hits.length > 1 && (
          <span className="ms-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              disabled={at === 0}
              onClick={() => setAt(at - 1)}
              aria-label="Previous pass"
            >
              ‹
            </Button>
            <span className="px-1 text-xs text-zinc-600">
              Pass {at + 1} of {debug.hits.length}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={at >= debug.hits.length - 1}
              onClick={() => setAt(at + 1)}
              aria-label="Next pass"
            >
              ›
            </Button>
          </span>
        )}
      </div>
      <div className="overflow-auto border border-zinc-200 bg-snow">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-1.5 text-start font-medium">Variable</th>
              <th className="px-3 py-1.5 text-start font-medium">Kind</th>
              <th className="px-3 py-1.5 text-start font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {hit.vars.map((v) => (
              <tr key={v.name} className="border-t border-zinc-100 align-top">
                <td className="px-3 py-1.5 font-mono">{v.name}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-zinc-500">{v.type}</td>
                <td className="px-3 py-1.5">
                  <pre className="max-w-xl overflow-auto font-mono whitespace-pre-wrap">
                    {v.preview}
                  </pre>
                </td>
              </tr>
            ))}
            {!hit.vars.length && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-zinc-500">
                  No variables yet at this line.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const Cell = ({ v }: { v: unknown }) =>
  v === null || v === undefined ? (
    <span className="text-zinc-400">null</span>
  ) : typeof v === 'object' ? (
    <>{JSON.stringify(v)}</>
  ) : (
    <>{String(v)}</>
  );

/** Values the query or code takes: :name in SQL, params in code. */
function ParametersPane({
  draft,
  onChange,
  auto,
  onManual,
}: {
  draft: Draft;
  onChange(patch: Partial<Draft>): void;
  /** The names of parameters that were added from the query, not by hand. */
  auto?: ReadonlyMap<string, unknown>;
  /** A parameter was edited by hand, so it no longer counts as automatic. */
  onManual?(name: string): void;
}) {
  const list = draft.parameters;
  const [editing, setEditing] = useState<{ index: number | null; param: DatasetParam } | null>(
    null,
  );
  const use =
    draft.lang === 'r'
      ? 'params$name'
      : draft.lang === 'javascript'
        ? 'params.name'
        : 'params["name"]';
  const save = (p: DatasetParam) => {
    const was = editing && editing.index !== null ? list[editing.index] : undefined;
    if (was) onManual?.(was.name);
    onChange({
      parameters:
        editing?.index === null || editing === null
          ? [...list, p]
          : list.map((x, j) => (j === editing.index ? p : x)),
    });
    setEditing(null);
  };
  return (
    <div className="space-y-3 p-3">
      <p className="text-xs text-zinc-500">
        A value the query or code takes. Write{' '}
        <code className="bg-zinc-100 px-1">
          {draft.mode === 'local' && draft.lang !== 'sql' ? use : ':name'}
        </code>{' '}
        where it goes{draft.mode === 'local' && draft.lang !== 'sql' ? '' : ' and it is added here by itself'}. A dashboard can connect a filter to it.
      </p>
      <Button
        className="w-full"
        icon={Plus}
        onClick={() =>
          setEditing({ index: null, param: { name: '', label: '', type: 'text', default: '' } })
        }
      >
        Add a parameter
      </Button>
      {list.length > 0 && (
        <ul className="divide-y divide-zinc-100 border border-zinc-200 bg-snow">
          {list.map((p, i) => (
            <li key={i} className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => setEditing({ index: i, param: p })}
                className="min-w-0 flex-1 text-start"
                title="Edit"
              >
                <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {auto?.has(p.name) ? (
                    <Zap
                      className="size-3.5 shrink-0 animate-pulse text-accent-600 motion-reduce:animate-none"
                      aria-label="Added automatically from the query"
                    >
                      <title>Added automatically from the query</title>
                    </Zap>
                  ) : (
                    <PenLine className="size-3.5 shrink-0 text-zinc-400" aria-label="Added by hand">
                      <title>Added by hand</title>
                    </PenLine>
                  )}
                  <span className="truncate">{p.label || p.name || 'Unnamed parameter'}</span>
                </span>
                <span className="block truncate font-mono text-xs text-zinc-500">
                  {p.name
                    ? draft.mode === 'local' && draft.lang !== 'sql'
                      ? use.replace('name', p.name)
                      : `:${p.name}`
                    : '…'}{' '}
                  · {p.type}
                  {p.default ? ` · ${p.default}` : ''}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Edit ${p.name || 'parameter'}`}
                onClick={() => setEditing({ index: i, param: p })}
                className="p-1.5 text-zinc-500 hover:text-ink"
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${p.name || 'parameter'}`}
                className="p-1.5 text-zinc-500 hover:text-red-700"
                onClick={async () =>
                  (await confirmDialog(
                    `Delete the parameter “${p.label || p.name || 'Unnamed parameter'}”? A query that uses it will stop working.`,
                  )) && onChange({ parameters: list.filter((_, j) => j !== i) })
                }
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {draft.mode !== 'connection' && (
        <SwitchField
          label="Run again for each value a viewer picks"
          description="By default the query runs once and a dashboard filters the stored rows. Turn this on when the data is too large to store whole, or comes from a live database: each value a viewer picks runs the query, and the result is kept for a while."
          checked={draft.runPerViewer}
          onChange={(v) => onChange({ runPerViewer: v })}
        />
      )}
      {draft.mode !== 'connection' && draft.runPerViewer && (
        <p className="text-xs text-zinc-500">
          Only a limited number of different values run at a time, and each run keeps up to 20,000
          rows.
        </p>
      )}
      {editing && (
        <ParameterDialog
          initial={editing.param}
          isNew={editing.index === null}
          others={list.filter((_, j) => j !== editing.index).map((x) => x.name)}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** One parameter: what a viewer sees, how the query refers to it, its type and its default. */
function ParameterDialog({
  initial,
  isNew,
  others,
  onSave,
  onClose,
}: {
  initial: DatasetParam;
  isNew: boolean;
  others: string[];
  onSave(p: DatasetParam): void;
  onClose(): void;
}) {
  const { project } = useProject();
  const [p, setP] = useState(initial);
  const [tried, setTried] = useState(false);
  const problem = !p.name
    ? 'Give the parameter a name'
    : others.includes(p.name)
      ? 'Another parameter already has this name'
      : undefined;
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Add a parameter' : 'Edit the parameter'}
      footer={
        <Button
          onClick={() => (problem ? setTried(true) : onSave({ ...p, label: p.label.trim() }))}
        >
          {isNew ? 'Add' : 'Save'}
        </Button>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs font-medium text-zinc-600">Label</span>
          <span className="mb-1 block text-xs text-zinc-500">What a viewer sees</span>
          <Input
            aria-label="Label"
            autoFocus
            placeholder="From date"
            value={p.label}
            onChange={(e) => setP({ ...p, label: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-zinc-600">Name in the query</span>
          <span className="mb-1 block text-xs text-zinc-500">How the query refers to it</span>
          <Input
            aria-label="Name in the query"
            className="font-mono"
            placeholder="from_date"
            aria-invalid={tried && !!problem ? true : undefined}
            value={p.name}
            onChange={(e) => setP({ ...p, name: snake(e.target.value) })}
          />
          {tried && problem && (
            <span role="alert" className="mt-1 block text-xs text-red-700">
              {problem}
            </span>
          )}
        </label>
        <div>
          <span className="block text-xs font-medium text-zinc-600">Type</span>
          <span className="mb-1 block text-xs text-zinc-500">What kind of value it is</span>
          <Listbox
            label="Type"
            value={p.type}
            onChange={(v) =>
              setP({
                ...p,
                type: v as DatasetParam['type'],
                default: '',
                ...(v === 'text' && { compare: undefined }),
              })
            }
            options={PARAM_TYPES.map((t) => ({
              value: t,
              label: { text: 'Text', number: 'Number', date: 'Date' }[t],
              icon: { text: Type, number: Hash, date: CalendarClock }[t],
            }))}
          />
        </div>
        <div>
          <span className="block text-xs font-medium text-zinc-600">Default</span>
          <span className="mb-1 block text-xs text-zinc-500">Used when nobody picks one</span>
          {p.type === 'date' ? (
            <DatePicker
              aria-label="Default"
              accent={project.color}
              value={p.default}
              onChange={(v) => setP({ ...p, default: v })}
            />
          ) : (
            <Input
              aria-label="Default"
              type={p.type === 'number' ? 'number' : 'text'}
              value={p.default}
              onChange={(e) => setP({ ...p, default: e.target.value })}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}

type Conn = { key: string; name: string; kind: string };

/** Pick the database and browse its tables: choosing one makes the dataset that table as it is. */
function ConnectionSide({
  draft,
  dbs,
  loading,
  catalog,
  onConnection,
  onTable,
}: {
  draft: Draft;
  dbs: Conn[];
  loading: boolean;
  catalog: {
    data?: {
      tables: { schema: string; name: string; columns: { name: string; type: string }[] }[];
      truncated: boolean;
    };
    isPending: boolean;
    isFetching: boolean;
    error: unknown;
  };
  onConnection(key: string): void;
  onTable(schema: string, name: string): void;
}) {
  const { base } = useProject();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const tables = (catalog.data?.tables ?? []).filter((t) =>
    `${t.schema}.${t.name}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const bySchema = [
    ...tables.reduce(
      (m, t) => m.set(t.schema, [...(m.get(t.schema) ?? []), t]),
      new Map<string, typeof tables>(),
    ),
  ].sort(([x], [y]) => (x === 'public' ? -1 : y === 'public' ? 1 : x.localeCompare(y)));
  const row = (t: (typeof tables)[number]) => {
    const id = `${t.schema}.${t.name}`;
    const isOpen = open.has(id);
    return (
      <li key={id}>
        <div
          className={cx(
            'flex items-center gap-1 px-1 py-0.5 hover:bg-zinc-100',
            draft.table === id && 'bg-accent-50',
          )}
        >
          <button
            type="button"
            aria-label={`${isOpen ? 'Hide' : 'Show'} columns of ${t.name}`}
            className="p-0.5 text-zinc-500"
            onClick={() => setOpen((s) => (s.delete(id) || s.add(id), new Set(s)))}
          >
            {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-start"
            title={`Use ${id} as the dataset`}
            onClick={() => onTable(t.schema, t.name)}
          >
            <Table2 className="size-3.5 shrink-0 text-zinc-500" />
            <span className="truncate">{t.name}</span>
          </button>
        </div>
        {isOpen && (
          <ul className="mb-1 ms-6 border-s border-zinc-200 ps-2 text-xs">
            {t.columns.map((c) => (
              <li key={c.name} className="flex justify-between gap-2 py-0.5">
                <span className="truncate font-mono">{c.name}</span>
                <span className="shrink-0 text-zinc-400">{c.type}</span>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };
  if (loading) return <Loading />;
  if (!dbs.length)
    return (
      <div className="space-y-3 p-4 text-sm text-zinc-600">
        <p>
          No database connections yet. Add PostgreSQL, MySQL, SQL Server, BigQuery and more under
          Connections.
        </p>
        <Button size="sm" icon={Plus} onClick={() => void navigate({ to: `${base}/connections` })}>
          Add a connection
        </Button>
      </div>
    );
  return (
    <div className="space-y-3 p-3">
      <Field label="Database" intro="Queries run here, read-only">
        <Select
          icon={Database}
          value={draft.connection}
          onChange={(e) => onConnection(e.target.value)}
        >
          {dbs.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Input
        icon={Search}
        aria-label="Find a table"
        placeholder="Find a table"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {catalog.isPending && catalog.isFetching ? (
        <Loading />
      ) : catalog.error ? (
        <ErrorNotice error={catalog.error} />
      ) : (
        <ul className="-mx-1 text-sm">
          {bySchema.map(([schema, list]) => {
            const expanded =
              toggled[schema] ?? (q.trim() !== '' || bySchema.length <= 3 || schema === 'public');
            return (
              <li key={schema}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-1 px-1 py-1 text-start text-xs font-semibold tracking-wide text-zinc-600 uppercase hover:bg-zinc-100"
                  onClick={() => setToggled({ ...toggled, [schema]: !expanded })}
                >
                  {expanded ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                  <span className="truncate">{schema}</span>
                  <span className="ms-auto font-normal text-zinc-400 normal-case">
                    {list.length}
                  </span>
                </button>
                {expanded && (
                  <ul className="ms-2 border-s border-zinc-200 ps-1">{list.map(row)}</ul>
                )}
              </li>
            );
          })}
          {!tables.length && (
            <li className="px-1 py-2 text-xs text-zinc-500">
              {q ? 'No table matches.' : 'No tables found.'}
            </li>
          )}
          {catalog.data?.truncated && (
            <li className="px-1 py-2 text-xs text-zinc-500">
              Large database: only part of the tables are listed. You can still query any table by
              name.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

const ICON = {
  form: ClipboardList,
  dataset: Table2,
  entity: MapPin,
  entity_types: Layers,
  connection: Globe,
} as const;

/** Name and language of the dataset. The name is unique within the project. */
function SettingsDialog({
  open,
  onClose,
  onDone,
  draft,
  isNew,
  taken,
  onName,
  onLang,
  onChange,
  usedBy,
}: {
  open: boolean;
  onClose(): void;
  /** The footer button, when it does something other than close. */
  onDone?(): void;
  draft: Draft;
  isNew: boolean;
  taken: boolean;
  onName(v: string): void;
  onLang(l: Lang): void;
  onChange(p: Partial<Draft>): void;
  usedBy: string[] | null;
}) {
  const empty = !draft.name.trim();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isNew ? 'New dataset' : 'Dataset settings'}
      footer={
        <Button disabled={empty || taken} onClick={onDone ?? onClose}>
          {isNew ? 'Continue' : 'Done'}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field
          label="Name"
          intro="Unique within the project"
          error={taken ? 'Another dataset already has this name.' : undefined}
          required
        >
          <Input
            autoFocus
            value={draft.name}
            onChange={(e) => onName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !empty && !taken && onClose()}
          />
        </Field>
        {draft.mode === 'local' && (
          <Field label="Language" intro={LANGS.find((l) => l.id === draft.lang)?.about}>
            <Select
              aria-label="Language"
              value={draft.lang}
              onChange={(e) => onLang(e.target.value as Lang)}
            >
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Description" intro="What the rows are, for the people who build dashboards">
          <Textarea
            value={draft.description}
            onChange={(e) => onChange({ description: e.target.value })}
            className="min-h-20"
          />
        </Field>
        {draft.mode !== 'connection' && (
          <Field label="Expected refresh every" intro="Drives the freshness badge. Empty for none">
            <DurationInput
              value={draft.freshness}
              onChange={(freshness) => onChange({ freshness })}
            />
          </Field>
        )}
        {!!usedBy?.length && (
          <Field label="Used by" intro="Dashboards with a widget on this dataset">
            <p className="text-sm text-zinc-700">{usedBy.join(', ')}</p>
          </Field>
        )}
      </div>
    </Dialog>
  );
}

/** Sources a local dataset reads: each is a table in the SQL, under the name given here. */
function LocalSide({
  draft,
  sources,
  loading,
  error,
  onChange,
  onInsert,
  tenantId,
  projectKey,
}: {
  tenantId: string;
  projectKey: string;
  /** Puts a query over the source in the editor (SQL only). */
  onInsert?(sql: string): void;
  draft: Draft;
  sources?: {
    forms: { key: string; name: string; columns: string[]; defaults?: Record<string, string> }[];
    datasets: { key: string; name: string; columns: string[] }[];
    entities: { key: string; name: string; columns: string[] }[];
    entityTypes: { columns: string[] };
    connections: Conn[];
  };
  loading: boolean;
  error: unknown;
  onChange(inputs: DatasetInputRef[]): void;
}) {
  const inputs = draft.inputs;
  const [menu, setMenu] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const patch = (i: number, p: Record<string, unknown>) =>
    onChange(inputs.map((x, j) => (j === i ? ({ ...x, ...p } as DatasetInputRef) : x)));
  const add = (kind: DatasetInputRef['kind'], ref: string) => {
    let as = snake(ref);
    for (let n = 2; inputs.some((x) => x.as === as); n++) as = `${snake(ref)}_${n}`;
    onChange([...inputs, { kind, ref, as } as DatasetInputRef]);
    setMenu(false);
  };
  const connKind = (ref: string) => sources?.connections.find((c) => c.key === ref)?.kind ?? '';
  const connLabel = (k: string) => (k === 'http' ? 'API' : isDatabaseKind(k) ? 'Database' : 'File');
  const count = (n?: number) => (n === undefined ? '' : ` · ${n} column${n === 1 ? '' : 's'}`);
  const previewLabel = (i: DatasetInputRef) =>
    i.kind === 'form'
      ? `Form · ${sources?.forms.find((f) => f.key === i.ref)?.name ?? i.ref}`
      : i.kind === 'dataset'
        ? `Dataset · ${sources?.datasets.find((f) => f.key === i.ref)?.name ?? i.ref}`
        : i.kind === 'entity'
          ? `Entities · ${sources?.entities.find((e) => e.key === i.ref)?.name ?? i.ref}`
          : i.kind === 'entity_types'
            ? 'Entity types'
            : `${connLabel(connKind(i.ref))} · ${sources?.connections.find((c) => c.key === i.ref)?.name ?? i.ref}`;
  if (loading) return <Loading />;
  const groups: {
    label: string;
    items: {
      kind: DatasetInputRef['kind'];
      ref: string;
      name: string;
      info: string;
      Icon: typeof Table2;
    }[];
  }[] = [
    {
      label: 'Form submissions',
      items: (sources?.forms ?? []).map((f) => ({
        kind: 'form' as const,
        ref: f.key,
        name: f.name,
        info: `Form${count(f.columns.length)}`,
        Icon: ClipboardList,
      })),
    },
    {
      label: 'Entities',
      items: [
        ...(sources?.entities ?? []).map((e) => ({
          kind: 'entity' as const,
          ref: e.key,
          name: e.name,
          info: `Entities${count(e.columns.length)}`,
          Icon: MapPin,
        })),
        ...(sources
          ? [
              {
                kind: 'entity_types' as const,
                ref: 'entity_types',
                name: 'Entity types',
                info: `Types of entity${count(sources.entityTypes.columns.length)}`,
                Icon: Layers,
              },
            ]
          : []),
      ],
    },
    {
      label: 'Datasets',
      items: (sources?.datasets ?? []).map((d) => ({
        kind: 'dataset' as const,
        ref: d.key,
        name: d.name,
        info: `Dataset${count(d.columns.length)}`,
        Icon: Table2,
      })),
    },
    {
      label: 'Files, APIs and databases',
      items: (sources?.connections ?? []).map((c) => ({
        kind: 'connection' as const,
        ref: c.key,
        name: c.name,
        info: connLabel(c.kind),
        Icon: isDatabaseKind(c.kind) ? Database : c.kind === 'http' ? Globe : FileSpreadsheet,
      })),
    },
  ].filter((g) => g.items.length);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <ErrorNotice error={error} />
        <p className="text-xs text-zinc-600">
          {draft.lang === 'sql'
            ? 'Add what the query reads. Each source is a table in your SQL, under the name you give it.'
            : draft.lang === 'python'
              ? 'Add what the code reads. Each source is a pandas DataFrame under the name you give it.'
              : draft.lang === 'r'
                ? 'Add what the code reads. Each source is a data.frame under the name you give it.'
                : 'Add what the code reads. Each source is a list of rows in tables, under the name you give it.'}
        </p>
        <ul className="space-y-2">
          {inputs.map((i, n) => {
            const ck = i.kind === 'connection' ? connKind(i.ref) : '';
            const Icon =
              i.kind === 'connection' && isDatabaseKind(ck)
                ? Database
                : i.kind === 'connection' && ck !== 'http'
                  ? FileSpreadsheet
                  : ICON[i.kind];
            const form =
              i.kind === 'form' ? sources?.forms.find((f) => f.key === i.ref) : undefined;
            const ent =
              i.kind === 'entity' ? sources?.entities.find((e) => e.key === i.ref) : undefined;
            const cols =
              form?.columns ??
              ent?.columns ??
              (i.kind === 'entity_types'
                ? sources?.entityTypes.columns
                : i.kind === 'dataset'
                  ? sources?.datasets.find((f) => f.key === i.ref)?.columns
                  : undefined);
            const origin =
              form?.name ??
              ent?.name ??
              (i.kind === 'entity_types'
                ? 'All types'
                : i.kind === 'dataset'
                  ? sources?.datasets.find((f) => f.key === i.ref)?.name
                  : sources?.connections.find((c) => c.key === i.ref)?.name) ??
              i.ref;
            return (
              <li key={n} className="border border-zinc-200 bg-canvas p-2">
                <div className="flex items-center gap-1.5">
                  <Icon className="size-4 shrink-0 text-zinc-500" />
                  {i.kind === 'form' ? (
                    <span
                      className="min-w-0 flex-1 truncate px-1 font-mono text-sm"
                      title="Named after the form"
                    >
                      {i.as}
                    </span>
                  ) : (
                    <Input
                      aria-label="Table name in SQL"
                      className="min-w-0 flex-1 font-mono"
                      value={i.as}
                      onChange={(e) => patch(n, { as: snake(e.target.value) })}
                    />
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${i.as}`}
                    className="p-1 text-zinc-500 hover:text-red-700"
                    onClick={() => onChange(inputs.filter((_, j) => j !== n))}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <p className="mt-1 ps-5 text-[11px] text-zinc-500">
                  {i.kind === 'form'
                    ? 'Form'
                    : i.kind === 'dataset'
                      ? 'Dataset'
                      : i.kind === 'entity'
                        ? 'Entities'
                        : i.kind === 'entity_types'
                          ? 'Entity types'
                          : connLabel(ck)}{' '}
                  · {origin}
                </p>
                {i.kind === 'connection' && isDatabaseKind(ck) && (
                  <Textarea
                    aria-label="Query to run on the database"
                    className="mt-1.5 min-h-16 font-mono text-xs"
                    placeholder="select * from …  (runs on the database, its rows are loaded as this table)"
                    value={i.sql ?? ''}
                    onChange={(e) => patch(n, { sql: e.target.value })}
                  />
                )}
                {i.kind === 'connection' && ck === 'http' && (
                  <div className="mt-1.5 space-y-1.5">
                    <Input
                      icon={Globe}
                      aria-label="Endpoint"
                      className="font-mono text-xs"
                      placeholder="/v1/items"
                      value={i.endpoint ?? ''}
                      onChange={(e) => patch(n, { endpoint: e.target.value })}
                    />
                    <Input
                      icon={Braces}
                      aria-label="Path to the rows"
                      className="font-mono text-xs"
                      placeholder="data.items"
                      value={i.path ?? ''}
                      onChange={(e) => patch(n, { path: e.target.value })}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setViewing(n)}
                  className="mt-1 ms-5 inline-flex items-center gap-1 text-[11px] text-accent-600 hover:underline"
                >
                  <Eye className="size-3" />
                  View source{cols ? ` · ${cols.length} column${cols.length === 1 ? '' : 's'}` : ''}
                </button>
              </li>
            );
          })}
          {!inputs.length && (
            <li className="text-xs text-zinc-500">
              No sources yet. Submissions have columns _id, _status, _submitted_at and one per
              answer.
            </li>
          )}
        </ul>
      </div>
      {viewing !== null && inputs[viewing] && (
        <SourcePreview
          tenantId={tenantId}
          projectKey={projectKey}
          input={inputs[viewing]!}
          label={previewLabel(inputs[viewing]!)}
          defaults={
            inputs[viewing]!.kind === 'form'
              ? sources?.forms.find((f) => f.key === inputs[viewing]!.ref)?.defaults
              : undefined
          }
          onInsert={onInsert && ((sql) => (onInsert(sql), setViewing(null)))}
          onClose={() => setViewing(null)}
        />
      )}
      <div className="relative shrink-0 border-t border-zinc-200 bg-snow p-3">
        {menu && (
          <>
            <button
              type="button"
              aria-label="Close"
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setMenu(false)}
            />
            <div className="absolute inset-x-3 bottom-full z-20 mb-1 max-h-[60vh] overflow-y-auto border border-zinc-300 bg-snow shadow-raised">
              {!groups.length && <p className="p-3 text-xs text-zinc-500">Nothing to add yet.</p>}
              {groups.map((g) => (
                <div key={g.label}>
                  <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    {g.label}
                  </p>
                  {g.items.map((it) => (
                    <button
                      key={`${it.kind}:${it.ref}`}
                      type="button"
                      onClick={() => add(it.kind, it.ref)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-start hover:bg-zinc-100"
                    >
                      <it.Icon className="size-4 shrink-0 text-zinc-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{it.name}</span>
                        <span className="block text-[11px] text-zinc-500">{it.info}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
        <Button
          icon={Plus}
          className="relative z-0 w-full"
          onClick={() => setMenu(!menu)}
          aria-expanded={menu}
        >
          Add a source
        </Button>
      </div>
    </div>
  );
}

/** A column name as SQL writes it: bare when plain, quoted otherwise. */
const ident = (c: string) => (/^[a-z_][a-z0-9_]*$/.test(c) ? c : `"${c.replaceAll('"', '""')}"`);

/** A look at one source: its properties (pick columns to read) and its rows, through the same query runner as the editor. */
function SourcePreview({
  tenantId,
  projectKey,
  input,
  label,
  defaults,
  onInsert,
  onClose,
}: {
  tenantId: string;
  projectKey: string;
  input: DatasetInputRef;
  label: string;
  defaults?: Record<string, string>;
  onInsert?(sql: string): void;
  onClose(): void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<'data' | 'properties'>('properties');
  const [off, setOff] = useState<Set<string>>(new Set());
  const [find, setFind] = useState('');
  const over = (sql: string, limit: number) =>
    api.runSql(tenantId, projectKey, {
      source: { type: 'local', sql, inputs: [input] },
      limit,
      params: {},
      parameters: [],
    });
  const rows = useQuery({
    queryKey: ['source-preview', tenantId, projectKey, input],
    queryFn: () => over(`select * from ${input.as}`, 50),
    retry: false,
  });
  const total = useQuery({
    queryKey: ['source-count', tenantId, projectKey, input],
    queryFn: async () =>
      Number((await over(`select count(*) as n from ${input.as}`, 1)).rows[0]?.n ?? 0),
    retry: false,
  });
  const r = rows.data;
  const cols = r?.columns ?? [];
  const chosen = cols.filter((c) => !off.has(c.name));
  const shown = cols.filter((c) => c.name.toLowerCase().includes(find.trim().toLowerCase()));
  const toggle = (name: string) =>
    setOff((cur) =>
      cur.has(name) ? new Set([...cur].filter((x) => x !== name)) : new Set(cur).add(name),
    );
  const all = chosen.length === cols.length;
  const query = all
    ? `select * from ${input.as}`
    : `select ${chosen.map((c) => ident(c.name)).join(', ')}\nfrom ${input.as}`;
  const what =
    input.kind === 'form'
      ? 'submissions'
      : input.kind === 'entity'
        ? 'entities'
        : input.kind === 'entity_types'
          ? 'entity types'
          : 'rows';
  return (
    <Dialog
      open
      onClose={onClose}
      wide="full"
      title={<span className="font-mono">{input.as}</span>}
      description={label}
      footer={
        <>
          <Button
            variant="secondary"
            icon={Copy}
            onClick={() =>
              void navigator.clipboard.writeText(input.as).then(() => toast('Name copied'))
            }
          >
            Copy name
          </Button>
          {onInsert && (
            <Button
              variant="secondary"
              icon={Play}
              disabled={!chosen.length}
              onClick={() => onInsert(query)}
            >
              {all ? 'Use in query' : `Use in query · ${chosen.length} of ${cols.length} columns`}
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="-m-1 flex min-h-[320px] flex-col">
        <div className="mb-3 flex gap-1 border-b border-zinc-200" role="tablist">
          {(
            [
              ['properties', 'Properties', AlignLeft],
              ['data', 'Data', Table2],
            ] as const
          ).map(([t, name, Icon]) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cx(
                '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
                tab === t
                  ? 'border-accent-600 font-medium text-ink'
                  : 'border-transparent text-zinc-600 hover:text-ink',
              )}
            >
              <Icon className="size-4" />
              {name}
            </button>
          ))}
        </div>
        {rows.isPending ? (
          <Loading />
        ) : rows.error ? (
          <ErrorNotice error={rows.error} />
        ) : !r ? null : tab === 'data' ? (
          !r.rows.length ? (
            <div className="grid flex-1 place-items-center border border-dashed border-zinc-300 bg-canvas p-10 text-center">
              <div>
                <Table2 className="mx-auto size-8 text-zinc-300" />
                <p className="mt-2 font-medium">No {what} yet</p>
                <p className="mt-0.5 text-sm text-zinc-500">
                  The {cols.length} columns are ready, so you can already write queries over them.
                </p>
                <button
                  type="button"
                  onClick={() => setTab('properties')}
                  className="mt-3 text-sm text-accent-600 hover:underline"
                >
                  See the columns
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-zinc-500">
                {total.data !== undefined && total.data > r.rows.length
                  ? `First ${r.rows.length} of ${total.data.toLocaleString()} rows`
                  : `${r.rows.length.toLocaleString()} row${r.rows.length === 1 ? '' : 's'}`}
              </p>
              <div className="max-h-[55vh] overflow-auto border border-zinc-200">
                <table className="min-w-full text-start text-xs">
                  <thead className="sticky top-0 bg-zinc-100">
                    <tr>
                      {cols.map((c) => (
                        <th
                          key={c.name}
                          className="whitespace-nowrap px-2.5 py-1.5 text-start font-medium"
                        >
                          {c.name} <span className="font-normal text-zinc-500">{c.type}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row, i) => (
                      <tr key={i} className="border-t border-zinc-100">
                        {cols.map((c) => (
                          <td
                            key={c.name}
                            className="max-w-64 truncate whitespace-nowrap px-2.5 py-1.5"
                          >
                            {row[c.name] === null || row[c.name] === undefined ? (
                              <span className="text-zinc-400">null</span>
                            ) : typeof row[c.name] === 'object' ? (
                              JSON.stringify(row[c.name])
                            ) : (
                              String(row[c.name])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {(
                [
                  [
                    'Name in query',
                    <span key="n" className="font-mono">
                      {input.as}
                    </span>,
                    Braces,
                  ],
                  ['Source', label, ICON[input.kind]],
                  [
                    what.replace(/^./, (c) => c.toUpperCase()),
                    total.data === undefined ? '…' : total.data.toLocaleString(),
                    Hash,
                  ],
                  ['Columns', cols.length, Columns3],
                ] as const
              ).map(([k, v, Icon]) => (
                <div
                  key={k}
                  className="flex min-w-0 items-center gap-3 border border-zinc-200 bg-snow p-3"
                >
                  <span className="grid size-9 shrink-0 place-items-center bg-accent-50 text-accent-600">
                    <Icon className="size-4.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</p>
                    <p className="truncate text-sm font-medium">{v}</p>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <Input
                  icon={Search}
                  aria-label="Find a column"
                  placeholder="Find a column"
                  className="max-w-xs"
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                />
                {onInsert && (
                  <span className="ms-auto flex items-center gap-3 text-xs text-zinc-500">
                    {chosen.length} of {cols.length} selected
                    <button
                      type="button"
                      className="text-accent-600 hover:underline"
                      onClick={() => setOff(all ? new Set(cols.map((c) => c.name)) : new Set())}
                    >
                      {all ? 'Clear all' : 'Select all'}
                    </button>
                  </span>
                )}
              </div>
              <div className="max-h-[42vh] overflow-auto border border-zinc-200">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-zinc-100 text-xs text-zinc-600">
                    <tr>
                      {onInsert && (
                        <th className="w-10 py-1.5 ps-3 text-start align-middle">
                          <input
                            type="checkbox"
                            aria-label="Select all columns"
                            checked={all}
                            onChange={() =>
                              setOff(all ? new Set(cols.map((c) => c.name)) : new Set())
                            }
                            className="block size-4 accent-[var(--brand-600)]"
                          />
                        </th>
                      )}
                      <th className="px-3 py-1.5 text-start font-medium">Name</th>
                      <th className="px-3 py-1.5 text-start font-medium">Type</th>
                      <th className="px-3 py-1.5 text-start font-medium">Default</th>
                      <th className="px-3 py-1.5 text-start font-medium">Example</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => {
                      const example = r.rows
                        .map((row) => row[c.name])
                        .find((x) => x !== null && x !== undefined && x !== '');
                      return (
                        <tr
                          key={c.name}
                          className={cx(
                            'border-t border-zinc-100',
                            onInsert && 'cursor-pointer hover:bg-zinc-50',
                            off.has(c.name) && 'text-zinc-400',
                          )}
                          onClick={() => onInsert && toggle(c.name)}
                        >
                          {onInsert && (
                            <td className="ps-3 align-middle">
                              <input
                                type="checkbox"
                                aria-label={`Include ${c.name}`}
                                checked={!off.has(c.name)}
                                onChange={() => toggle(c.name)}
                                onClick={(e) => e.stopPropagation()}
                                className="block size-4 accent-[var(--brand-600)]"
                              />
                            </td>
                          )}
                          <td className="px-3 py-1.5 font-mono text-[13px]">{c.name}</td>
                          <td className="px-3 py-1.5">
                            <span className="bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
                              {c.type}
                            </span>
                          </td>
                          <td className="max-w-48 truncate px-3 py-1.5 text-zinc-600">
                            {defaults?.[c.name] ?? <span className="text-zinc-300">—</span>}
                          </td>
                          <td className="max-w-64 truncate px-3 py-1.5 text-zinc-600">
                            {example === undefined ? (
                              <span className="text-zinc-300">—</span>
                            ) : typeof example === 'object' ? (
                              JSON.stringify(example)
                            ) : (
                              String(example)
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!shown.length && (
                  <p className="p-4 text-center text-sm text-zinc-500">No column matches.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** The text a version holds, for reading and comparing: its query or code. */
const codeOf = (src: DatasetSource) =>
  src.type === 'script' ? src.code : src.type === 'rows' ? '' : src.sql;
const langOf = (src: DatasetSource) =>
  src.type === 'script'
    ? (LANGS.find((l) => l.id === src.language)?.label ?? src.language)
    : src.type === 'rows'
      ? 'Rows'
      : 'SQL';
const inputsOf = (src: DatasetSource) =>
  src.type === 'local' || src.type === 'script'
    ? src.inputs.map((i) => `${i.as} (${i.ref})`).join(', ')
    : src.type === 'connection'
      ? src.connection
      : '';

/** Earlier saves of a dataset: read what changed, and bring one back into the editor. */
function HistoryDialog({
  tenantId,
  projectKey,
  datasetKey,
  draft,
  onClose,
  onRestore,
}: {
  tenantId: string;
  projectKey: string;
  datasetKey: string;
  draft: Draft;
  onClose(): void;
  onRestore(v: DatasetVersionDto): void;
}) {
  const versions = useQuery({
    queryKey: ['dataset-versions', tenantId, projectKey, datasetKey],
    queryFn: () => api.datasetVersions(tenantId, projectKey, datasetKey),
  });
  const [picked, setPicked] = useState<number | null>(null);
  const list = versions.data ?? [];
  const v = list.find((x) => x.version === (picked ?? list[0]?.version));
  const latest = list[0];
  const current = sourceOf(draft);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const rows: [string, string, string][] = v
    ? [
        ['Name', v.name, draft.name],
        ['Language', langOf(v.source), langOf(current)],
        ['Sources', inputsOf(v.source) || 'None', inputsOf(current) || 'None'],
        ['Description', v.description || 'None', draft.description || 'None'],
        [
          'Expected refresh',
          formatMinutes(v.freshnessMinutes),
          formatMinutes(toMinutes(draft.freshness)),
        ],
      ]
    : [];
  return (
    <Dialog
      open
      onClose={onClose}
      wide="full"
      title="Version history"
      description="Every save that changed the dataset is kept here"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {v && (
            <Button
              icon={History}
              disabled={v === latest && JSON.stringify(fromDataset(v)) === JSON.stringify(draft)}
              onClick={() => onRestore(v)}
            >
              Restore version {v.version}
            </Button>
          )}
        </>
      }
    >
      {versions.isPending ? (
        <Loading />
      ) : versions.error ? (
        <ErrorNotice error={versions.error} />
      ) : (
        <div className="grid min-h-[340px] gap-4 md:grid-cols-[14rem_1fr]">
          <ul className="max-h-[55vh] space-y-1 overflow-y-auto">
            {list.map((x) => (
              <li key={x.version}>
                <button
                  type="button"
                  onClick={() => setPicked(x.version)}
                  className={cx(
                    'w-full border px-3 py-2 text-start',
                    v?.version === x.version
                      ? 'border-accent-600 bg-accent-50'
                      : 'border-zinc-200 hover:bg-zinc-50',
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    Version {x.version}
                    {x === latest && (
                      <span className="bg-zinc-100 px-1.5 text-[11px] font-normal text-zinc-600">
                        Latest
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-zinc-500">{when(x.savedAt)}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {x.savedBy ?? 'Unknown'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {v && (
            <div className="min-w-0 space-y-3">
              <div className="overflow-hidden border border-zinc-200 text-sm">
                <div className="grid grid-cols-[8rem_1fr_1fr] bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600">
                  <span />
                  <span>Version {v.version}</span>
                  <span>In the editor now</span>
                </div>
                {rows.map(([k, a, b]) => (
                  <div
                    key={k}
                    className={cx(
                      'grid grid-cols-[8rem_1fr_1fr] gap-2 border-t border-zinc-100 px-3 py-1.5',
                      a !== b && 'bg-amber-50',
                    )}
                  >
                    <span className="text-zinc-500">{k}</span>
                    <span className="min-w-0 truncate" title={a}>
                      {a}
                    </span>
                    <span className="min-w-0 truncate" title={b}>
                      {b}
                    </span>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {[
                  [`Version ${v.version}`, codeOf(v.source)],
                  ['In the editor now', draft.sql],
                ].map(([title, code]) => (
                  <div key={title} className="min-w-0">
                    <p className="mb-1 text-xs font-medium text-zinc-600">{title}</p>
                    <pre className="max-h-[32vh] overflow-auto border border-zinc-200 bg-canvas p-3 font-mono text-xs">
                      {code || ' '}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

const SQL_WORDS = [
  'and',
  'or',
  'not',
  'like',
  'ilike',
  'in',
  'is null',
  'is not null',
  'between',
  'true',
  'false',
];

/** A SQL condition on the rows, as a database tool's filter bar: typed here, applied with Enter, columns offered with Ctrl+Space. */
function FilterBar({
  value,
  columns,
  disabled,
  onApply,
}: {
  value: string;
  columns: string[];
  disabled?: boolean;
  onApply(expr: string): void;
}) {
  const [text, setText] = useState(value);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setText(value), [value]);
  // The word being typed, up to the caret.
  const upto = text.slice(0, at);
  const word = /[A-Za-z_][\w"]*$/.exec(upto)?.[0] ?? '';
  const options = [
    ...columns.map((c) => ({ label: c, insert: ident(c), col: true })),
    ...SQL_WORDS.map((w) => ({ label: w, insert: w, col: false })),
  ]
    .filter(
      (o) =>
        o.label.toLowerCase().startsWith(word.toLowerCase()) &&
        o.label.toLowerCase() !== word.toLowerCase(),
    )
    .slice(0, 12);
  const pick = (o: { insert: string }) => {
    const next = `${upto.slice(0, upto.length - word.length)}${o.insert} ${text.slice(at)}`;
    const caret = upto.length - word.length + o.insert.length + 1;
    setText(next);
    setOpen(false);
    requestAnimationFrame(() => input.current?.setSelectionRange(caret, caret));
  };
  const dirty = text.trim() !== value.trim();
  return (
    <div className="relative flex items-center gap-2 border-b border-zinc-200 px-2 py-1.5">
      <Filter className="size-4 shrink-0 text-zinc-400" aria-hidden />
      <input
        ref={input}
        aria-label="Filter the rows with a SQL condition"
        placeholder="Enter a SQL expression to filter results (use Ctrl+Space)"
        value={text}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => (
          setText(e.target.value),
          setAt(e.target.selectionStart ?? e.target.value.length),
          setOpen(true),
          setActive(0)
        )}
        onKeyUp={(e) => setAt(e.currentTarget.selectionStart ?? text.length)}
        onClick={(e) => setAt(e.currentTarget.selectionStart ?? text.length)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === ' ' && e.ctrlKey) {
            e.preventDefault();
            setAt(e.currentTarget.selectionStart ?? text.length);
            setOpen(true);
            setActive(0);
          } else if (open && options.length && e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((active + 1) % options.length);
          } else if (open && options.length && e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((active - 1 + options.length) % options.length);
          } else if (open && options.length && (e.key === 'Tab' || e.key === 'Enter') && word) {
            e.preventDefault();
            pick(options[Math.min(active, options.length - 1)]!);
          } else if (e.key === 'Enter') {
            setOpen(false);
            onApply(text);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-zinc-400"
      />
      {text && (
        <button
          type="button"
          aria-label="Clear the filter"
          onClick={() => (setText(''), value && onApply(''))}
          className="text-zinc-400 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      )}
      {dirty && (
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onApply(text)}>
          Filter
        </Button>
      )}
      {open && options.length > 0 && (
        <ul
          role="listbox"
          className="absolute start-8 top-full z-30 max-h-56 w-64 overflow-auto border border-zinc-300 bg-snow py-1 text-sm shadow-lg"
        >
          {options.map((o, i) => (
            <li key={o.label} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => (e.preventDefault(), pick(o))}
                className={cx(
                  'flex w-full items-center gap-2 px-3 py-1 text-start',
                  i === active && 'bg-zinc-100',
                )}
              >
                <span className={cx('font-mono text-[13px]', !o.col && 'text-zinc-500')}>
                  {o.label}
                </span>
                {o.col && <span className="ms-auto text-[11px] text-zinc-400">column</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Op = string;
const OPERATORS: Record<ColumnKind, [Op, string][]> = {
  text: [
    ['=', 'equals'],
    ['<>', 'is not'],
    ['contains', 'contains'],
    ['notcontains', 'does not contain'],
    ['starts', 'starts with'],
    ['ends', 'ends with'],
    ['like', 'like (use %)'],
    ['notlike', 'not like (use %)'],
    ['in', 'is one of (a, b, c)'],
    ['notin', 'is none of (a, b, c)'],
    ['null', 'is empty'],
    ['notnull', 'is not empty'],
  ],
  number: [
    ['=', '='],
    ['<>', '≠'],
    ['>', '>'],
    ['>=', '≥'],
    ['<', '<'],
    ['<=', '≤'],
    ['between', 'between'],
    ['in', 'is one of (1, 2, 3)'],
    ['notin', 'is none of (1, 2, 3)'],
    ['null', 'is empty'],
    ['notnull', 'is not empty'],
  ],
  date: [
    ['=', 'on'],
    ['<>', 'not on'],
    ['>', 'after'],
    ['>=', 'on or after'],
    ['<', 'before'],
    ['<=', 'on or before'],
    ['between', 'between'],
    ['null', 'is empty'],
    ['notnull', 'is not empty'],
  ],
  flag: [
    ['=', 'is'],
    ['null', 'is empty'],
    ['notnull', 'is not empty'],
  ],
};

const lit = (v: string) => `'${v.replaceAll("'", "''")}'`;
/** A value as SQL: numbers as they are, anything else in quotes. */
const sqlValue = (kind: ColumnKind, v: string) =>
  kind === 'number' && v.trim() !== '' && Number.isFinite(Number(v)) ? v.trim() : lit(v);

/** The SQL condition for one test on a column. */
function conditionOf(name: string, kind: ColumnKind, op: Op, val: string, val2 = ''): string {
  const col = ident(name);
  switch (op) {
    case 'null':
      return `${col} is null`;
    case 'notnull':
      return `${col} is not null`;
    case 'contains':
      return `${col} ilike ${lit(`%${val}%`)}`;
    case 'notcontains':
      return `${col} not ilike ${lit(`%${val}%`)}`;
    case 'starts':
      return `${col} ilike ${lit(`${val}%`)}`;
    case 'ends':
      return `${col} ilike ${lit(`%${val}`)}`;
    case 'like':
      return `${col} ilike ${lit(val)}`;
    case 'notlike':
      return `${col} not ilike ${lit(val)}`;
    case 'in':
    case 'notin': {
      const list = val
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => sqlValue(kind, x));
      return `${col} ${op === 'notin' ? 'not ' : ''}in (${list.join(', ')})`;
    }
    case 'between':
      return `${col} between ${sqlValue(kind, val)} and ${sqlValue(kind, val2)}`;
    default:
      if (kind === 'flag')
        return `${col} ${op} ${/^(true|yes|1)$/i.test(val) || val === '' ? 'true' : 'false'}`;
      return `${col} ${op} ${sqlValue(kind, val)}`;
  }
}

/** The funnel in a column heading. */
function ColumnFilterButton({
  name,
  onOpen,
}: {
  name: string;
  onOpen(left: number, top: number): void;
}) {
  return (
    <button
      type="button"
      aria-label={`Filter ${name}`}
      title={`Filter ${name}`}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onOpen(Math.min(r.left, window.innerWidth - 270), r.bottom + 4);
      }}
      className="me-1 shrink-0 p-1 text-zinc-400 opacity-0 hover:text-ink focus-visible:opacity-100 group-hover/h:opacity-100"
    >
      <Filter className="size-3.5" />
    </button>
  );
}

/** What gets a window of its own outside the editor still wears the project's colour. */
const brandVars = (color: string) =>
  ({ '--brand-600': color, '--brand-contrast': contrastOn(color) }) as React.CSSProperties;

/** Pick a test and a value for one column, and it is added to the filter. */
function ColumnFilterPop({
  name,
  kind,
  left,
  top,
  onApply,
  onClose,
}: {
  name: string;
  kind: ColumnKind;
  left: number;
  top: number;
  onApply(condition: string): void;
  onClose(): void;
}) {
  const { project } = useProject();
  const [op, setOp] = useState<Op>(OPERATORS[kind][0]![0]);
  const [val, setVal] = useState('');
  const [val2, setVal2] = useState('');
  const noValue = op === 'null' || op === 'notnull';
  const input =
    kind === 'date' && op !== 'in'
      ? 'date'
      : kind === 'number' && op !== 'in' && op !== 'notin'
        ? 'number'
        : 'text';
  const apply = () => {
    if (!noValue && kind !== 'flag' && (!val.trim() || (op === 'between' && !val2.trim()))) return;
    onApply(conditionOf(name, kind, op, val, val2));
    onClose();
  };
  const field = 'h-8 w-full border border-zinc-300 bg-snow px-2 text-sm';
  return createPortal(
    <div
      className="brand-scope fixed inset-0 z-[60]"
      style={brandVars(project.color)}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label={`Filter ${name}`}
        style={{ left, top }}
        className="fixed w-64 space-y-2 border border-zinc-300 bg-snow p-3 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="truncate font-mono text-xs text-zinc-600">{name}</div>
        <select
          aria-label="Test"
          value={op}
          onChange={(e) => setOp(e.target.value)}
          className={field}
        >
          {OPERATORS[kind].map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        {!noValue &&
          (kind === 'flag' ? (
            <select
              aria-label="Value"
              value={val || 'true'}
              onChange={(e) => setVal(e.target.value)}
              className={field}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : (
            <>
              <input
                autoFocus
                aria-label="Value"
                type={input}
                step="any"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                className={field}
              />
              {op === 'between' && (
                <input
                  aria-label="Up to"
                  type={input}
                  step="any"
                  placeholder="and"
                  value={val2}
                  onChange={(e) => setVal2(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && apply()}
                  className={field}
                />
              )}
            </>
          ))}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={apply}>
            Filter
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type MenuTarget = {
  x: number;
  y: number;
  name: string;
  kind: ColumnKind;
  cell?: { value: unknown };
};

/** The right-click menu of a cell or a column heading, as in a database tool: order, filter by this value, copy. */
function CellMenu({
  at,
  onClose,
  onSort,
  onFilterBy,
  onAdd,
  onClear,
  canClear,
}: {
  at: MenuTarget;
  onClose(): void;
  onSort(dir: 1 | -1): void;
  onFilterBy(): void;
  onAdd(condition: string): void;
  onClear(): void;
  canClear: boolean;
}) {
  const { project } = useProject();
  const { name, kind, cell } = at;
  const empty = cell && (cell.value === null || cell.value === undefined || cell.value === '');
  const text =
    cell && !empty
      ? typeof cell.value === 'object'
        ? JSON.stringify(cell.value)
        : String(cell.value)
      : '';
  const tests: [string, Op][] =
    kind === 'text'
      ? [
          ['=', '='],
          ['<>', '<>'],
          ['>', '>'],
          ['<', '<'],
          ['LIKE', 'contains'],
          ['ILIKE', 'like'],
        ]
      : kind === 'flag'
        ? [
            ['=', '='],
            ['<>', '<>'],
          ]
        : [
            ['=', '='],
            ['<>', '<>'],
            ['>', '>'],
            ['>=', '>='],
            ['<', '<'],
            ['<=', '<='],
          ];
  const cellValueSql = (v: string) =>
    kind === 'flag' ? (/^(true|yes|1)$/i.test(v) ? 'true' : 'false') : sqlValue(kind, v);
  const condition = (op: Op) =>
    op === 'contains'
      ? `${ident(name)} like ${lit(`%${text}%`)}`
      : op === 'like'
        ? `${ident(name)} ilike ${lit(text)}`
        : `${ident(name)} ${op} ${cellValueSql(text)}`;
  const left = at.x > window.innerWidth - 560;
  const item =
    'flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent';
  const run = (fn: () => void) => () => (onClose(), fn());
  return createPortal(
    <div
      className="brand-scope fixed inset-0 z-[60]"
      style={brandVars(project.color)}
      onMouseDown={onClose}
      onContextMenu={(e) => (e.preventDefault(), onClose())}
    >
      <div
        role="menu"
        style={{
          left: Math.min(at.x, window.innerWidth - 300),
          top: Math.min(at.y, window.innerHeight - 340),
        }}
        className="fixed w-72 border border-zinc-300 bg-snow py-1 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button role="menuitem" className={item} onClick={run(() => onSort(1))}>
          <ArrowUp className="size-4 text-accent-700" /> Order by{' '}
          <span className="truncate font-mono text-[13px]">{name}</span> ASC
        </button>
        <button role="menuitem" className={item} onClick={run(() => onSort(-1))}>
          <ArrowDown className="size-4 text-accent-700" /> Order by{' '}
          <span className="truncate font-mono text-[13px]">{name}</span> DESC
        </button>
        <button role="menuitem" className={item} onClick={run(onFilterBy)}>
          <Filter className="size-4 text-accent-700" /> Filter by value…
        </button>
        <div className="my-1 border-t border-zinc-200" />
        {cell && !empty && (
          <div className="group/sub relative">
            <button role="menuitem" aria-haspopup="menu" className={item}>
              <Filter className="size-4 text-accent-700" /> Cell value
              <ChevronRight className="ms-auto size-4 text-zinc-400" />
            </button>
            <div
              role="menu"
              className={cx(
                'invisible absolute top-0 w-80 border border-zinc-300 bg-snow py-1 shadow-lg group-hover/sub:visible group-focus-within/sub:visible',
                left ? 'end-full' : 'start-full',
              )}
            >
              {tests.map(([label, op]) => {
                const sql = condition(op);
                return (
                  <button
                    key={label}
                    role="menuitem"
                    className={item}
                    onClick={run(() => onAdd(sql))}
                    title={sql}
                  >
                    <Filter className="size-4 shrink-0 text-accent-700" />
                    <span className="truncate font-mono text-[13px]">{sql}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <button
          role="menuitem"
          className={item}
          onClick={run(() => onAdd(conditionOf(name, kind, 'null', '')))}
        >
          <Filter className="size-4 text-accent-700" />{' '}
          <span className="truncate font-mono text-[13px]">{name} IS NULL</span>
        </button>
        <button
          role="menuitem"
          className={item}
          onClick={run(() => onAdd(conditionOf(name, kind, 'notnull', '')))}
        >
          <Filter className="size-4 text-accent-700" />{' '}
          <span className="truncate font-mono text-[13px]">{name} IS NOT NULL</span>
        </button>
        <div className="my-1 border-t border-zinc-200" />
        {cell && !empty && (
          <button
            role="menuitem"
            className={item}
            onClick={run(() => void navigator.clipboard.writeText(text))}
          >
            <Copy className="size-4 text-zinc-500" /> Copy value
          </button>
        )}
        <button role="menuitem" className={item} disabled={!canClear} onClick={run(onClear)}>
          <X className="size-4 text-zinc-500" /> Remove all filters and ordering
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** A query that failed, as the database itself reported it: its own words, its code, and the spot in the SQL it points at. */
function QueryError({ error }: { error: unknown }) {
  const problem = error instanceof ApiError ? error.problem : null;
  // Anything but a failed query (the network, a refused request) is shown as before.
  if (!problem || problem.title !== 'The query failed') return <ErrorNotice error={error} />;
  const d = problem.sql;
  const message = problem.detail ?? problem.title;
  // The SQL as it ran, cut to the line the database points at and the one before it, with a caret under the spot.
  let where: { n: number; line: string; before?: string; col: number } | null = null;
  if (d?.text && d.position) {
    const upto = d.text.slice(0, d.position - 1).split('\n');
    const lines = d.text.split('\n');
    const n = upto.length;
    where = { n, line: lines[n - 1] ?? '', before: n > 1 ? lines[n - 2] : undefined, col: upto[upto.length - 1]!.length };
  }
  return (
    <div role="alert" className="mb-3 shrink-0 border border-red-300 bg-red-50 text-sm text-red-900">
      <div className="flex items-center gap-2 border-b border-red-200 px-3 py-2">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <b className="font-semibold">The query failed</b>
        {d?.code && <span className="ms-auto bg-red-100 px-1.5 py-0.5 font-mono text-xs" title="The database's error code">{d.code}</span>}
      </div>
      <div className="space-y-2 px-3 py-2.5">
        <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-5">{message}</pre>
        {where && (
          <pre className="overflow-x-auto border border-red-200 bg-white/70 px-2 py-1.5 font-mono text-xs leading-5 text-zinc-800">
            {where.before !== undefined && <div className="text-zinc-400">{`${where.n - 1} | ${where.before}`}</div>}
            <div>{`${where.n} | ${where.line}`}</div>
            <div className="text-red-700">{`${' '.repeat(String(where.n).length)} | ${' '.repeat(where.col)}^`}</div>
          </pre>
        )}
        {d?.detail && <p className="font-mono text-xs"><span className="text-red-700">DETAIL</span> {d.detail}</p>}
        {d?.hint && <p className="font-mono text-xs"><span className="text-red-700">HINT</span> {d.hint}</p>}
      </div>
    </div>
  );
}
