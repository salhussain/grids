import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DATABASE_KINDS,
  isDatabaseKind,
  isFileKind,
  type ConnectionDto,
  type ConnectionInput,
  type ConnectionKind,
  type ConnectionOptions,
  type TestResult,
  type VariableDto,
} from '@grids/schema';
import {
  Button,
  confirmDialog,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
  Input,
  Panel,
  SectionHead,
  Select,
  Table,
  Td,
  Textarea,
  cx,
  relTime,
  useToast,
  Listbox,
} from '@grids/ui';
import {
  CircleCheck,
  CircleX,
  Database,
  FileSpreadsheet,
  FileText,
  Globe,
  Hash,
  Loader2,
  KeyRound,
  Lock,
  Pencil,
  Play,
  Plug,
  Plus,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { useProject } from './context';
import { ChoiceCards } from './fields';
import { BRAND_ICON } from './DbIcons';

/** The name, mark and description of each kind of connection. */
export const KIND = {
  http: { label: 'API', icon: Globe, text: 'A web API reached over HTTP or HTTPS' },
  postgres: { icon: BRAND_ICON.postgres, label: 'PostgreSQL', text: 'A PostgreSQL database' },
  redshift: { icon: BRAND_ICON.redshift, label: 'Amazon Redshift', text: 'An Amazon Redshift cluster' },
  mysql: { icon: BRAND_ICON.mysql, label: 'MySQL', text: 'A MySQL database' },
  mariadb: { icon: BRAND_ICON.mariadb, label: 'MariaDB', text: 'A MariaDB database' },
  mssql: { icon: BRAND_ICON.mssql, label: 'SQL Server', text: 'Microsoft SQL Server or Azure SQL' },
  oracle: { icon: BRAND_ICON.oracle, label: 'Oracle', text: 'An Oracle database' },
  clickhouse: { icon: BRAND_ICON.clickhouse, label: 'ClickHouse', text: 'A ClickHouse server' },
  snowflake: { icon: BRAND_ICON.snowflake, label: 'Snowflake', text: 'A Snowflake account' },
  bigquery: { icon: BRAND_ICON.bigquery, label: 'BigQuery', text: 'A Google BigQuery project' },
  file: { label: 'Web file', icon: BRAND_ICON.file, text: 'A CSV or Excel file at a web link' },
  s3: { label: 'Amazon S3', icon: BRAND_ICON.s3, text: 'A file in S3 or an S3-compatible store' },
  azure_blob: { label: 'Azure Blob', icon: BRAND_ICON.azure_blob, text: 'A file in Azure Blob Storage' },
  gcs: {
    label: 'Google Cloud Storage',
    icon: BRAND_ICON.gcs,
    text: 'A file in a Google Cloud Storage bucket',
  },
  gdrive: { label: 'Google Drive', icon: BRAND_ICON.gdrive, text: 'A file in Google Drive' },
} as const;

type OptionField = {
  key: keyof ConnectionOptions;
  label: string;
  intro: string;
  placeholder?: string;
  secret?: boolean;
};
const FILE_HOSTS: Record<
  string,
  { address: string; placeholder: string; intro: string; options: OptionField[] }
> = {
  file: {
    address: 'File address',
    placeholder: 'https://example.com/data.csv',
    intro:
      'A public link, or a signed link (Azure SAS, S3 presigned). Private links: add a header below',
    options: [],
  },
  s3: {
    address: 'File address',
    placeholder: 's3://my-bucket/folder/data.csv',
    intro: 'Leave the keys empty for a public file',
    options: [
      { key: 'region', label: 'Region', intro: 'Default us-east-1', placeholder: 'eu-west-1' },
      {
        key: 'endpoint',
        label: 'Endpoint',
        intro: 'Only for R2, MinIO, Wasabi… (empty for AWS)',
        placeholder: 'https://s3.example.com',
      },
      { key: 'accessKeyId', label: 'Access key id', intro: 'Not a secret', placeholder: 'AKIA…' },
      {
        key: 'secretAccessKey',
        label: 'Secret access key',
        intro: 'A variable',
        placeholder: '{{S3_SECRET}}',
        secret: true,
      },
      {
        key: 'sessionToken',
        label: 'Session token',
        intro: 'Temporary credentials only. A variable',
        placeholder: '{{S3_SESSION}}',
        secret: true,
      },
    ],
  },
  azure_blob: {
    address: 'Blob address',
    placeholder: 'https://account.blob.core.windows.net/container/data.csv',
    intro: 'Leave the credentials empty for a public container',
    options: [
      {
        key: 'sasToken',
        label: 'SAS token',
        intro: 'A variable',
        placeholder: '{{AZURE_SAS}}',
        secret: true,
      },
      {
        key: 'accountKey',
        label: 'Account key',
        intro: 'Instead of a SAS token. A variable',
        placeholder: '{{AZURE_KEY}}',
        secret: true,
      },
      {
        key: 'token',
        label: 'Access token',
        intro: 'Microsoft Entra ID bearer token. A variable',
        placeholder: '{{AZURE_TOKEN}}',
        secret: true,
      },
    ],
  },
  gcs: {
    address: 'Object address',
    placeholder: 'gs://my-bucket/folder/data.csv',
    intro: 'Leave the credentials empty for a public object',
    options: [
      {
        key: 'serviceAccount',
        label: 'Service account key',
        intro: 'The JSON key file, in a variable',
        placeholder: '{{GCP_KEY}}',
        secret: true,
      },
      {
        key: 'token',
        label: 'Access token',
        intro: 'Instead of a service account. A variable',
        placeholder: '{{GCP_TOKEN}}',
        secret: true,
      },
    ],
  },
  gdrive: {
    address: 'File link or id',
    placeholder: 'https://drive.google.com/file/d/…/view',
    intro: 'A Sheet is read as CSV (first tab). Public files need no credentials',
    options: [
      {
        key: 'apiKey',
        label: 'API key',
        intro: 'For files shared with anyone. A variable',
        placeholder: '{{DRIVE_KEY}}',
        secret: true,
      },
      {
        key: 'serviceAccount',
        label: 'Service account key',
        intro: 'For private files shared with it. A variable',
        placeholder: '{{GCP_KEY}}',
        secret: true,
      },
      {
        key: 'token',
        label: 'Access token',
        intro: 'OAuth token of a user. A variable',
        placeholder: '{{DRIVE_TOKEN}}',
        secret: true,
      },
    ],
  },
};
const conn = (scheme: string, port: number, db = 'db') =>
  `${scheme}://user:{{DB_PASSWORD}}@host:${port}/${db}`;
const PASSWORD_INTRO = 'Put the password in a variable, e.g. {{DB_PASSWORD}}';
/** The databases: how each is addressed and what else it needs. Their drivers are in @grids/data. */
const DB_HOSTS: Record<
  string,
  { address: string; placeholder: string; intro: string; options: OptionField[] }
> = {
  postgres: {
    address: 'Connection string',
    placeholder: conn('postgres', 5432),
    intro: PASSWORD_INTRO,
    options: [
      {
        key: 'schema',
        label: 'Default schema',
        intro: 'Where unqualified table names are looked up. (default: public)',
        placeholder: 'samples',
      },
    ],
  },
  redshift: {
    address: 'Connection string',
    placeholder: conn('postgres', 5439),
    intro: PASSWORD_INTRO,
    options: [
      {
        key: 'schema',
        label: 'Default schema',
        intro: 'Where unqualified table names are looked up. (default: public)',
        placeholder: 'samples',
      },
    ],
  },
  mysql: {
    address: 'Connection string',
    placeholder: conn('mysql', 3306),
    intro: PASSWORD_INTRO,
    options: [],
  },
  mariadb: {
    address: 'Connection string',
    placeholder: conn('mysql', 3306),
    intro: PASSWORD_INTRO,
    options: [],
  },
  mssql: {
    address: 'Connection string',
    placeholder: conn('mssql', 1433),
    intro: `${PASSWORD_INTRO}. Add ?trustServerCertificate=true for a self-signed certificate`,
    options: [],
  },
  oracle: {
    address: 'Connection string',
    placeholder: conn('oracle', 1521, 'service_name'),
    intro: PASSWORD_INTRO,
    options: [],
  },
  clickhouse: {
    address: 'Server address',
    placeholder: conn('https', 8443),
    intro: `The HTTP(S) interface. ${PASSWORD_INTRO}`,
    options: [],
  },
  snowflake: {
    address: 'Account',
    placeholder: 'xy12345.eu-west-1',
    intro: 'Your account identifier, as in the Snowflake URL',
    options: [
      {
        key: 'token',
        label: 'Access token',
        intro: 'OAuth, programmatic access or key-pair token. A variable',
        placeholder: '{{SNOWFLAKE_TOKEN}}',
        secret: true,
      },
      {
        key: 'tokenType',
        label: 'Token type',
        intro: 'Default PROGRAMMATIC_ACCESS_TOKEN. Or OAUTH, KEYPAIR_JWT',
        placeholder: 'PROGRAMMATIC_ACCESS_TOKEN',
      },
      {
        key: 'warehouse',
        label: 'Warehouse',
        intro: 'Runs the queries',
        placeholder: 'COMPUTE_WH',
      },
      {
        key: 'database',
        label: 'Database',
        intro: 'Also used to list the tables',
        placeholder: 'ANALYTICS',
      },
      {
        key: 'schema',
        label: 'Schema',
        intro: 'Default for unqualified names',
        placeholder: 'PUBLIC',
      },
      { key: 'role', label: 'Role', intro: 'Optional', placeholder: 'REPORTER' },
    ],
  },
  bigquery: {
    address: 'Project id',
    placeholder: 'my-project-123',
    intro: 'The Google Cloud project that runs the queries',
    options: [
      {
        key: 'serviceAccount',
        label: 'Service account key',
        intro: 'The JSON key file, in a variable',
        placeholder: '{{BIGQUERY_KEY}}',
        secret: true,
      },
      {
        key: 'dataset',
        label: 'Default dataset',
        intro: 'For unqualified names, and to list the tables',
        placeholder: 'sales',
      },
    ],
  },
};
const FORMATS = [
  ['', 'Detect'],
  ['csv', 'CSV'],
  ['tsv', 'TSV (tab separated)'],
  ['xlsx', 'Excel (.xlsx)'],
] as const;

const snake = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

function Outcome({ r }: { r: TestResult | null }) {
  if (!r) return <span className="text-zinc-400">Not tested</span>;
  const Icon = r.ok ? CircleCheck : CircleX;
  return (
    <span
      className={cx('inline-flex items-start gap-1.5', r.ok ? 'text-emerald-700' : 'text-red-700')}
      title={r.message}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>
        {r.ok ? 'Works' : 'Failed'} <span className="text-zinc-500">· {relTime(r.at)}</span>
        {!r.ok && <span className="block max-w-xs truncate text-xs">{r.message}</span>}
      </span>
    </span>
  );
}

/** External APIs and databases the project can read from. Secrets live in Variables and are referred to as {{NAME}}. */
export function ConnectionsTab() {
  const { tenantId, project, can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<ConnectionDto | 'new' | null>(null);
  const key = ['connections', tenantId, project.key];
  const list = useQuery({ queryKey: key, queryFn: () => api.connections(tenantId, project.key) });
  const set = (data: ConnectionDto[]) => (
    qc.setQueryData(key, data),
    void qc.invalidateQueries({ queryKey: ['variables', tenantId, project.key] })
  );
  const remove = useMutation({
    mutationFn: (k: string) => api.deleteConnection(tenantId, project.key, k),
    onSuccess: (d) => (set(d), toast('Connection removed')),
  });
  const test = useMutation({
    mutationFn: (k: string) => api.testConnection(tenantId, project.key, k),
    onSuccess: (r) => (
      void qc.invalidateQueries({ queryKey: key }),
      toast(r.ok ? 'Connection works' : `Connection failed: ${r.message}`)
    ),
  });
  const manage = can('manager');
  return (
    <>
      <SectionHead
        title="Connections"
        description="APIs, databases and CSV or Excel files this project can read. Keep passwords and tokens in Variables."
        actions={
          manage ? (
            <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
              Add connection
            </Button>
          ) : undefined
        }
      />
      <ErrorNotice error={remove.error ?? test.error} />
      {(
        <Panel flush>
          <Table head={['Connection', 'Address', 'Status', '']} empty={list.data ? <Empty icon={Plug} title="No connections yet">Connect an API, a database or a file, then test it.</Empty> : undefined}>
            {list.data?.map((c) => {
              const K = KIND[c.kind];
              return (
                <tr key={c.key} className="border-t border-zinc-100">
                  <Td>
                    <span className="flex items-center gap-2 font-medium">
                      <K.icon className="size-4 text-zinc-500" /> {c.name}
                    </span>
                    <span className="ms-6 font-mono text-[11px] text-zinc-500">{c.key}</span>
                  </Td>
                  <Td className="max-w-xs font-mono text-xs text-zinc-600">
                    <span className="block truncate" title={c.target}>
                      {c.target}
                    </span>
                  </Td>
                  <Td>
                    <Outcome r={c.lastTest} />
                  </Td>
                  <Td>
                    {manage && (
                      <span className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          aria-label={`Test ${c.name}`}
                          title="Test connection"
                          disabled={test.isPending && test.variables === c.key}
                          className="p-1 text-zinc-500 hover:text-ink disabled:opacity-60"
                          onClick={() => test.mutate(c.key)}
                        >
                          {test.isPending && test.variables === c.key ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Play className="size-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label={`Edit ${c.name}`}
                          className="p-1 text-zinc-500 hover:text-ink"
                          onClick={() => setEditing(c)}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${c.name}`}
                          title="Delete"
                          className="p-1 text-zinc-500 hover:text-red-700"
                          onClick={async () =>
                            (await confirmDialog(`Delete the connection “${c.name}”?`)) &&
                            remove.mutate(c.key)
                          }
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        </Panel>
      )}
      {editing && (
        <ConnectionDialog
          connection={editing === 'new' ? null : editing}
          onSaved={set}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ConnectionDialog({
  connection,
  onSaved,
  onClose,
}: {
  connection: ConnectionDto | null;
  onSaved(d: ConnectionDto[]): void;
  onClose(): void;
}) {
  const { tenantId, project } = useProject();
  const isNew = !connection;
  const [f, setF] = useState<ConnectionInput>({
    key: connection?.key ?? '',
    name: connection?.name ?? '',
    description: connection?.description ?? '',
    kind: connection?.kind ?? 'http',
    target: connection?.target ?? '',
    headers: connection?.headers ?? [],
    test: connection?.test ?? '',
    options: connection?.options ?? {},
  });
  const [keyEdited, setKeyEdited] = useState(!isNew);
  const [result, setResult] = useState<TestResult | null>(null);
  const vars = useQuery({
    queryKey: ['variables', tenantId, project.key],
    queryFn: () => api.variables(tenantId, project.key),
  });
  const patch = (p: Partial<ConnectionInput>) => (setF({ ...f, ...p }), setResult(null));
  const save = useMutation({
    mutationFn: () => api.saveConnection(tenantId, project.key, f, connection?.key),
    onSuccess: (d) => (onSaved(d), onClose()),
  });
  const test = useMutation({
    mutationFn: () => api.testConnectionDraft(tenantId, project.key, f),
    onSuccess: setResult,
  });
  const [step, setStep] = useState<'type' | 'details'>(isNew ? 'type' : 'details');
  const http = f.kind === 'http';
  const file = isFileKind(f.kind);
  const dbKind = isDatabaseKind(f.kind);
  const host = FILE_HOSTS[f.kind] ?? DB_HOSTS[f.kind];
  const setOption = (k: keyof ConnectionOptions, v: string) =>
    patch({ options: { ...f.options, [k]: v } });
  const headers = f.headers ?? [];
  const valid = !!f.key && !!f.name.trim() && !!f.target.trim();
  if (step === 'type')
    return (
      <Dialog open wide onClose={onClose} title="Add connection" description="What does it connect to? Choose one, then fill in its details." footer={<Button variant="secondary" icon={X} onClick={onClose}>Cancel</Button>}>
        <div className="space-y-5">
          {(
            [
              ['A web API', ['http']],
              ['A database', DATABASE_KINDS],
              ['A CSV or Excel file', ['file', 's3', 'azure_blob', 'gcs', 'gdrive']],
            ] as const
          ).map(([title, kinds]) => (
            <section key={title}>
              <h3 className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">{title}</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {kinds.map((k) => {
                  const K = KIND[k as ConnectionKind];
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => (setF({ ...f, kind: k as ConnectionKind, target: '', test: '', headers: [], options: {} }), setResult(null), setStep('details'))}
                      className="flex items-center gap-3 border border-zinc-200 bg-snow px-3 py-3 text-start hover:border-accent-600 hover:bg-accent-50 focus-visible:outline-2 focus-visible:outline-accent-600"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center">
                        <K.icon className="size-5" />
                      </span>
                      <span className="min-w-0">
                        <b className="block truncate text-sm font-medium">{K.label}</b>
                        <span className="block truncate text-xs text-zinc-500">{K.text}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </Dialog>
    );
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Add connection' : `Edit ${connection.name}`}
      description={isNew ? `${KIND[f.kind].label}: ${KIND[f.kind].text}` : 'An API, a database or a CSV or Excel file to read from.'}
      footer={
        <>
          <Button
            variant="secondary"
            icon={Play}
            className="me-auto"
            disabled={!f.target.trim()}
            loading={test.isPending}
            onClick={() => test.mutate()}
          >
            Test connection
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
            {isNew ? 'Add connection' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error ?? test.error} />
        {result && (
          <div
            role="status"
            className={cx(
              'flex items-start gap-2.5 border px-3 py-2.5 text-sm',
              result.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-900',
            )}
          >
            {result.ok ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleX className="mt-0.5 size-4 shrink-0" />
            )}
            <span>
              {result.message} <span className="opacity-70">· {result.ms} ms</span>
            </span>
          </div>
        )}
        {result?.preview && <PreviewTable p={result.preview} />}
        {isNew ? (
          <div className="flex items-center gap-3 border border-zinc-200 bg-zinc-50 px-3 py-2.5">
            {(() => {
              const K = KIND[f.kind];
              return (
                <>
                  <span className="flex size-9 shrink-0 items-center justify-center">
                    <K.icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-sm font-medium">{K.label}</b>
                    <span className="block truncate text-xs text-zinc-500">{K.text}</span>
                  </span>
                </>
              );
            })()}
            <button type="button" onClick={() => setStep('type')} className="text-sm font-medium text-accent-700 hover:underline">
              Change
            </button>
          </div>
        ) : (
          <>
        <ChoiceCards
          label="Type"
          intro="What it connects to"
          value={file ? 'file' : dbKind ? 'database' : 'http'}
          onChange={(g) =>
            !((g === 'file' && file) || (g === 'database' && dbKind)) &&
            patch({
              kind: g === 'database' ? 'postgres' : g,
              target: '',
              test: '',
              headers: [],
              options: {},
            })
          }
          options={{
            http: KIND.http,
            database: {
              label: 'Database',
              icon: Database,
              text: 'PostgreSQL, MySQL, SQL Server, BigQuery…',
            },
            file: { label: 'File', icon: FileSpreadsheet, text: 'A CSV or Excel file' },
          }}
        />
        {dbKind && (
          <Field label="Database type" intro="Datasets run SQL on it, read-only">
            <Listbox
              searchable
              label="Database type"
              value={f.kind}
              onChange={(k) => patch({ kind: k as ConnectionKind, target: '', test: '', options: {} })}
              options={DATABASE_KINDS.map((k) => ({ value: k, label: KIND[k].label, icon: KIND[k].icon }))}
            />
          </Field>
        )}
        {file && (
          <Field label="Hosted on" intro="Where the file lives">
            <Listbox
              label="Hosted on"
              value={f.kind}
              onChange={(k) => patch({ kind: k as ConnectionKind, target: '', headers: [], options: {} })}
              options={(['file', 's3', 'azure_blob', 'gcs', 'gdrive'] as const).map((k) => ({ value: k, label: k === 'file' ? 'A web link (public or signed)' : KIND[k].label, icon: KIND[k].icon }))}
            />
          </Field>
        )}
          </>
        )}
        <div className="space-y-4">
          <Field label="Name" required intro="What people see, e.g. Weather service">
            <Input
              icon={Type}
              autoFocus
              value={f.name}
              onChange={(e) => {
                patch({
                  name: e.target.value,
                  ...(keyEdited ? {} : { key: snake(e.target.value) }),
                });
              }}
            />
          </Field>
          <Field label="Key" intro={isNew ? 'Used to refer to it' : 'Fixed once created'}>
            <Input
              icon={Hash}
              className="font-mono"
              value={f.key}
              disabled={!isNew}
              onChange={(e) => (setKeyEdited(true), patch({ key: snake(e.target.value) }))}
            />
          </Field>
        </div>
        <Field
          label={host ? host.address : 'Base address'}
          required
          intro={host ? host.intro : 'Where requests go, e.g. https://api.example.com/v1'}
        >
          <Input
            icon={file ? FileSpreadsheet : http ? Globe : Database}
            className="font-mono"
            value={f.target}
            placeholder={host ? host.placeholder : 'https://api.example.com'}
            onChange={(e) => patch({ target: e.target.value })}
          />
        </Field>
        {host && host.options.length > 0 && (
          <div className="space-y-4">
            {host.options.map((o) => (
              <Field key={o.key} label={o.label} intro={o.intro}>
                <Input
                  icon={o.secret ? Lock : KeyRound}
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={o.placeholder}
                  value={f.options?.[o.key] ?? ''}
                  onChange={(e) => setOption(o.key, e.target.value)}
                />
              </Field>
            ))}
          </div>
        )}
        {file && (
          <div className="space-y-4">
            <Field label="Format" intro="Detected from the file when empty">
              <Select
                icon={FileSpreadsheet}
                value={f.options?.format ?? ''}
                onChange={(e) => setOption('format', e.target.value)}
              >
                {FORMATS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sheet" intro="Excel only: a name or number. Default the first">
              <Input
                icon={Hash}
                value={f.options?.sheet ?? ''}
                placeholder="1"
                onChange={(e) => setOption('sheet', e.target.value)}
              />
            </Field>
          </div>
        )}
        {(http || f.kind === 'file') && (
          <Field
            label="Headers"
            intro="Sent with every request. Use {{NAME}} for secrets, e.g. Bearer {{API_TOKEN}}"
          >
            <div className="space-y-2">
              {headers.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label="Header name"
                    placeholder="Authorization"
                    className="w-48"
                    value={h.name}
                    onChange={(e) =>
                      patch({
                        headers: headers.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <Input
                    aria-label="Header value"
                    placeholder="Bearer {{API_TOKEN}}"
                    className="min-w-0 flex-1 font-mono"
                    value={h.value}
                    onChange={(e) =>
                      patch({
                        headers: headers.map((x, j) =>
                          j === i ? { ...x, value: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    aria-label="Remove header"
                    className="p-1 text-zinc-500 hover:text-red-700"
                    onClick={() => patch({ headers: headers.filter((_, j) => j !== i) })}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <Button
                size="sm"
                icon={Plus}
                className="w-full"
                onClick={() => patch({ headers: [...headers, { name: '', value: '' }] })}
              >
                Add header
              </Button>
            </div>
          </Field>
        )}
        {http && (
          <Field
            label="Test path"
            intro="Requested when you test, e.g. /health. Empty uses the base address"
          >
            <Input
              icon={Play}
              className="font-mono"
              value={f.test ?? ''}
              placeholder="/health"
              onChange={(e) => patch({ test: e.target.value })}
            />
          </Field>
        )}
        <Field label="Description" intro="What it is used for">
          <Textarea
            value={f.description ?? ''}
            onChange={(e) => patch({ description: e.target.value })}
            className="min-h-16"
          />
        </Field>
        {(vars.data?.length ?? 0) > 0 && (
          <p className="text-xs text-zinc-500">
            Variables you can use:{' '}
            {vars.data!.map((v) => (
              <code
                key={v.key}
                className="me-1.5 bg-zinc-100 px-1 font-mono"
              >{`{{${v.key}}}`}</code>
            ))}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function PreviewTable({ p }: { p: NonNullable<TestResult['preview']> }) {
  return (
    <div className="overflow-x-auto border border-zinc-200">
      <table className="w-full text-left text-xs">
        <thead className="bg-zinc-50 text-zinc-600">
          <tr>
            {p.columns.map((c, i) => (
              <th key={i} className="whitespace-nowrap px-2.5 py-1.5 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r, i) => (
            <tr key={i} className="border-t border-zinc-100">
              {r.map((v, j) => (
                <td key={j} className="max-w-48 truncate whitespace-nowrap px-2.5 py-1.5">
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {p.total > p.rows.length && (
        <p className="border-t border-zinc-100 px-2.5 py-1.5 text-zinc-500">
          First {p.rows.length} of {p.total} rows
        </p>
      )}
    </div>
  );
}

/** Secrets of the project: replaceable, never shown again once saved. */
export function VariablesTab() {
  const { tenantId, project, can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<VariableDto | 'new' | null>(null);
  const key = ['variables', tenantId, project.key];
  const list = useQuery({ queryKey: key, queryFn: () => api.variables(tenantId, project.key) });
  const remove = useMutation({
    mutationFn: (k: string) => api.deleteVariable(tenantId, project.key, k),
    onSuccess: (d) => (qc.setQueryData(key, d), toast('Variable removed')),
  });
  const manage = can('manager');
  return (
    <>
      <SectionHead
        title="Variables"
        description="Passwords, tokens and keys your connections use. They are stored encrypted. You can replace a value but never read it back."
        actions={
          manage ? (
            <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
              Add variable
            </Button>
          ) : undefined
        }
      />
      <ErrorNotice error={remove.error} />
      {(
        <Panel flush>
          <Table head={['Name', 'Value', 'Used by', 'Updated', '']} empty={list.data ? <Empty icon={KeyRound} title="No variables yet">Store a secret once, then refer to it from a connection as {'{{NAME}}'}.</Empty> : undefined}>
            {list.data?.map((v) => (
              <tr key={v.key} className="border-t border-zinc-100">
                <Td>
                  <span className="font-mono text-sm font-medium">{v.key}</span>
                  {v.description && (
                    <span className="block text-xs text-zinc-500">{v.description}</span>
                  )}
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5 text-zinc-500">
                    <Lock className="size-3.5" /> <span className="tracking-widest">••••••••</span>
                  </span>
                </Td>
                <Td className="text-zinc-600">
                  {v.usedBy.length ? (
                    v.usedBy.join(', ')
                  ) : (
                    <span className="text-zinc-400">Nothing</span>
                  )}
                </Td>
                <Td className="text-zinc-500">{relTime(v.updatedAt)}</Td>
                <Td>
                  {manage && (
                    <span className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        aria-label={`Edit ${v.key}`}
                        title="Replace the value or edit the description"
                        className="p-1 text-zinc-500 hover:text-ink"
                        onClick={() => setEditing(v)}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${v.key}`}
                        title={v.usedBy.length ? 'In use' : 'Delete'}
                        className="p-1 text-zinc-500 hover:text-red-700 disabled:opacity-40"
                        disabled={v.usedBy.length > 0}
                        onClick={async () =>
                          (await confirmDialog(
                            `Delete the variable ${v.key}? Its value cannot be recovered.`,
                          )) && remove.mutate(v.key)
                        }
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
      {editing && (
        <VariableDialog
          variable={editing === 'new' ? null : editing}
          onSaved={(d) => qc.setQueryData(key, d)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function VariableDialog({
  variable,
  onSaved,
  onClose,
}: {
  variable: VariableDto | null;
  onSaved(d: VariableDto[]): void;
  onClose(): void;
}) {
  const { tenantId, project } = useProject();
  const isNew = !variable;
  const [f, setF] = useState({
    key: variable?.key ?? '',
    value: '',
    description: variable?.description ?? '',
  });
  const save = useMutation({
    mutationFn: () => api.saveVariable(tenantId, project.key, f, variable?.key),
    onSuccess: (d) => (onSaved(d), onClose()),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Add variable' : `Edit ${variable.key}`}
      description="Stored encrypted. Once saved the value cannot be viewed, only replaced."
      footer={
        <>
          <Button variant="secondary" icon={X} onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!f.key || (isNew && !f.value)}
          >
            {isNew ? 'Add variable' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice error={save.error} />
        <Field
          label="Name"
          required
          intro="Capital letters, digits and underscores, e.g. API_TOKEN"
        >
          <Input
            icon={Hash}
            autoFocus={isNew}
            className="font-mono"
            value={f.key}
            disabled={!isNew}
            onChange={(e) =>
              setF({ ...f, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })
            }
          />
        </Field>
        <Field
          label={isNew ? 'Value' : 'New value'}
          required={isNew}
          intro={
            isNew ? 'Kept encrypted, never shown again' : 'Leave empty to keep the current value'
          }
        >
          <Input
            icon={Lock}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            placeholder={isNew ? '' : '••••••••'}
            value={f.value}
            onChange={(e) => setF({ ...f, value: e.target.value })}
          />
        </Field>
        <Field label="Description" intro="What it is for">
          <Input
            icon={FileText}
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}
