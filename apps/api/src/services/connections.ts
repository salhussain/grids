import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readCatalog, runDatabaseQuery, testDatabase, type Catalog, type DriverConfig, type QueryResult, type Row } from '@grids/data';
import {
  isDatabaseKind,
  isFileKind,
  SECRET_OPTIONS,
  uuidv7,
  type ConnectionDto,
  type ConnectionInput,
  type TestResult,
  type VariableDto,
  type VariableInput,
} from '@grids/schema';
import type { z } from 'zod';
import { badRequest, conflict, notFound } from '../errors.js';
import { fetchFile, parseTable, previewOf, type FileSpec } from './filesource.js';
import { audit, type Actor, type ServiceContext } from './context.js';
import { isPrivateAddress, readText, safeFetch } from './safe-fetch.js';
import type { ProjectService } from './projects.js';
import { decryptSecret, encryptSecret } from './secrets.js';
import { iso, isUniqueViolation } from './util.js';

const PLACEHOLDER = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;
/** Headers that carry credentials: their value must come from a variable. */
const SENSITIVE_HEADER =
  /^(authorization|proxy-authorization|cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token)$/i;

export const placeholdersIn = (text: string): string[] => [
  ...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]!)),
];

/** The variables a connection refers to. */
const refsOf = (c: {
  target: string;
  headers: { value: string }[];
  test: string;
  options?: Record<string, string>;
}) => [
  ...new Set(
    [c.target, c.test, ...c.headers.map((h) => h.value), ...Object.values(c.options ?? {})].flatMap(
      placeholdersIn,
    ),
  ),
];

type Kind = ConnectionDto['kind'];
type Draft = {
  kind: Kind;
  target: string;
  headers: { name: string; value: string }[];
  test: string;
  options: Record<string, string>;
};

/** External connections and encrypted variables of a project. */
export class ConnectionService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
  ) {}

  // ------------------------------------------------------------ variables

  async variables(actor: Actor, tenantId: string, project: string): Promise<VariableDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    return this.projects.cellTx(tenantId, (tx) => this.listVariables(tx, a.project.id));
  }

  private async listVariables(tx: Tx, projectId: string): Promise<VariableDto[]> {
    const vars = await tx
      .selectFrom('project_variable')
      .select(['key', 'description', 'updated_at'])
      .where('project_id', '=', projectId)
      .orderBy('key')
      .execute();
    const conns = await tx
      .selectFrom('project_connection')
      .select(['key', 'target', 'headers', 'test', 'options'])
      .where('project_id', '=', projectId)
      .execute();
    return vars.map((v) => ({
      key: v.key,
      description: v.description,
      usedBy: conns.filter((c) => refsOf(c).includes(v.key)).map((c) => c.key),
      updatedAt: iso(v.updated_at),
    }));
  }

  async setVariable(
    actor: Actor,
    tenantId: string,
    project: string,
    input: z.output<typeof VariableInput>,
    existing?: string,
  ): Promise<VariableDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    if (existing && existing !== input.key) throw badRequest('A variable cannot be renamed');
    const out = await this.projects.cellTx(tenantId, async (tx) => {
      const cur = await tx
        .selectFrom('project_variable')
        .select('id')
        .where('project_id', '=', a.project.id)
        .where('key', '=', input.key)
        .executeTakeFirst();
      if (existing && !cur) throw notFound('Variable');
      if (!existing && cur)
        throw conflict('Name taken', `A variable named ${input.key} already exists.`);
      if (!cur && !input.value) throw badRequest('Enter a value');
      if (cur) {
        await tx
          .updateTable('project_variable')
          .set({
            description: input.description,
            updated_by: actor.id,
            updated_at: this.ctx.now(),
            ...(input.value ? { value_enc: encryptSecret(this.ctx.secretsKey, input.value) } : {}),
          })
          .where('id', '=', cur.id)
          .execute();
      } else {
        await tx
          .insertInto('project_variable')
          .values({
            id: uuidv7(),
            tenant_id: tenantId,
            project_id: a.project.id,
            key: input.key,
            description: input.description,
            value_enc: encryptSecret(this.ctx.secretsKey, input.value),
            updated_by: actor.id,
          })
          .execute();
      }
      return this.listVariables(tx, a.project.id);
    });
    // The value is never logged.
    await audit(this.ctx, actor.id, tenantId, existing ? 'variable.update' : 'variable.create', {
      project: a.project.key,
      key: input.key,
      valueChanged: !existing || !!input.value,
    });
    return out;
  }

  async removeVariable(
    actor: Actor,
    tenantId: string,
    project: string,
    key: string,
  ): Promise<VariableDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const out = await this.projects.cellTx(tenantId, async (tx) => {
      const list = await this.listVariables(tx, a.project.id);
      const v = list.find((x) => x.key === key);
      if (!v) throw notFound('Variable');
      if (v.usedBy.length)
        throw conflict(
          'Variable in use',
          `${key} is used by ${v.usedBy.join(', ')}. Change those connections first.`,
        );
      await tx
        .deleteFrom('project_variable')
        .where('project_id', '=', a.project.id)
        .where('key', '=', key)
        .execute();
      return list.filter((x) => x.key !== key);
    });
    await audit(this.ctx, actor.id, tenantId, 'variable.delete', { project: a.project.key, key });
    return out;
  }

  /** Decrypted variables by name (only for the placeholders asked for): used when a connection is exercised. */
  async resolve(tx: Tx, projectId: string, names: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!names.length) return out;
    const rows = await tx
      .selectFrom('project_variable')
      .select(['key', 'value_enc'])
      .where('project_id', '=', projectId)
      .where('key', 'in', names)
      .execute();
    for (const r of rows) out.set(r.key, decryptSecret(this.ctx.secretsKey, r.value_enc));
    const missing = names.filter((n) => !out.has(n));
    if (missing.length) throw badRequest(`Variable ${missing.join(', ')} is not set`);
    return out;
  }

  // ------------------------------------------------------------ connections

  private toDto = (c: {
    key: string;
    name: string;
    description: string;
    kind: Kind;
    target: string;
    headers: { name: string; value: string }[];
    options: Record<string, string>;
    test: string;
    last_test: Record<string, unknown> | null;
    updated_at: Date;
  }): ConnectionDto => ({
    key: c.key,
    name: c.name,
    description: c.description,
    kind: c.kind,
    target: c.target,
    headers: c.headers,
    test: c.test,
    options: c.options,
    lastTest: (c.last_test as TestResult | null) ?? null,
    updatedAt: iso(c.updated_at),
  });

  async connections(actor: Actor, tenantId: string, project: string): Promise<ConnectionDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    return this.projects.cellTx(tenantId, (tx) => this.listConnections(tx, a.project.id));
  }

  private async listConnections(tx: Tx, projectId: string): Promise<ConnectionDto[]> {
    const rows = await tx
      .selectFrom('project_connection')
      .selectAll()
      .where('project_id', '=', projectId)
      .orderBy('name')
      .execute();
    return rows.map(this.toDto);
  }

  async saveConnection(
    actor: Actor,
    tenantId: string,
    project: string,
    input: z.output<typeof ConnectionInput>,
    existing?: string,
  ): Promise<ConnectionDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    this.check(input);
    if (existing && existing !== input.key) throw badRequest('A connection key cannot be changed');
    try {
      const out = await this.projects.cellTx(tenantId, async (tx) => {
        const values = {
          name: input.name,
          description: input.description,
          kind: input.kind,
          target: input.target,
          headers: JSON.stringify(
            input.kind === 'http' || input.kind === 'file' ? input.headers : [],
          ),
          options: JSON.stringify(isFileKind(input.kind) || isDatabaseKind(input.kind) ? input.options : {}),
          test: input.test,
          updated_at: this.ctx.now(),
        };
        if (existing) {
          const r = await tx
            .updateTable('project_connection')
            .set({ ...values, last_test: null })
            .where('project_id', '=', a.project.id)
            .where('key', '=', existing)
            .executeTakeFirst();
          if (!r.numUpdatedRows) throw notFound('Connection');
        } else {
          await tx
            .insertInto('project_connection')
            .values({
              id: uuidv7(),
              tenant_id: tenantId,
              project_id: a.project.id,
              key: input.key,
              ...values,
            })
            .execute();
        }
        return this.listConnections(tx, a.project.id);
      });
      await audit(
        this.ctx,
        actor.id,
        tenantId,
        existing ? 'connection.update' : 'connection.create',
        { project: a.project.key, key: input.key },
      );
      return out;
    } catch (e) {
      if (isUniqueViolation(e))
        throw conflict('Key taken', `A connection with key "${input.key}" already exists.`);
      throw e;
    }
  }

  async removeConnection(
    actor: Actor,
    tenantId: string,
    project: string,
    key: string,
  ): Promise<ConnectionDto[]> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const out = await this.projects.cellTx(tenantId, async (tx) => {
      const r = await tx
        .deleteFrom('project_connection')
        .where('project_id', '=', a.project.id)
        .where('key', '=', key)
        .executeTakeFirst();
      if (!r.numDeletedRows) throw notFound('Connection');
      return this.listConnections(tx, a.project.id);
    });
    await audit(this.ctx, actor.id, tenantId, 'connection.delete', { project: a.project.key, key });
    return out;
  }

  // ------------------------------------------------------------ testing

  /** Tries the saved connection and remembers the outcome. */
  async testSaved(
    actor: Actor,
    tenantId: string,
    project: string,
    key: string,
  ): Promise<TestResult> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    const row = await this.projects.cellTx(tenantId, (tx) =>
      tx
        .selectFrom('project_connection')
        .selectAll()
        .where('project_id', '=', a.project.id)
        .where('key', '=', key)
        .executeTakeFirst(),
    );
    if (!row) throw notFound('Connection');
    const result = await this.run(tenantId, a.project.id, {
      kind: row.kind,
      target: row.target,
      headers: row.headers,
      test: row.test,
      options: row.options,
    });
    await this.projects.cellTx(tenantId, (tx) =>
      tx
        .updateTable('project_connection')
        .set({ last_test: JSON.stringify(result) })
        .where('id', '=', row.id)
        .execute(),
    );
    return result;
  }

  /** Tries what is in the form, saved or not. */
  async testDraft(
    actor: Actor,
    tenantId: string,
    project: string,
    input: z.output<typeof ConnectionInput>,
  ): Promise<TestResult> {
    const a = await this.projects.access(actor, tenantId, project, 'manager');
    this.check(input);
    return this.run(tenantId, a.project.id, input);
  }

  private check(input: z.output<typeof ConnectionInput>) {
    if (isFileKind(input.kind)) return this.checkFile(input);
    if (input.kind === 'http') {
      if (!/^(https?:\/\/|\{\{)/i.test(input.target))
        throw badRequest('The address must start with http:// or https://, or be a {{VARIABLE}}');
      for (const h of input.headers)
        if (SENSITIVE_HEADER.test(h.name) && h.value && !placeholdersIn(h.value).length)
          throw badRequest(`${h.name} carries a credential: put it in a variable and use {{NAME}}`);
    } else this.checkDatabase(input);
  }

  private checkDatabase(input: z.output<typeof ConnectionInput>) {
    const { kind, target } = input;
    const schemes: Record<string, [RegExp, string]> = {
      postgres: [/^postgres(ql)?:\/\//i, 'postgres://user:{{DB_PASSWORD}}@host:5432/db'],
      redshift: [/^postgres(ql)?:\/\//i, 'postgres://user:{{DB_PASSWORD}}@cluster.region.redshift.amazonaws.com:5439/db'],
      mysql: [/^mysql:\/\//i, 'mysql://user:{{DB_PASSWORD}}@host:3306/db'],
      mariadb: [/^mysql:\/\//i, 'mysql://user:{{DB_PASSWORD}}@host:3306/db'],
      mssql: [/^mssql:\/\//i, 'mssql://user:{{DB_PASSWORD}}@host:1433/db'],
      oracle: [/^oracle:\/\//i, 'oracle://user:{{DB_PASSWORD}}@host:1521/service_name'],
      clickhouse: [/^https?:\/\//i, 'https://user:{{DB_PASSWORD}}@host:8443/db'],
    };
    const scheme = schemes[kind];
    if (scheme) {
      if (!scheme[0].test(target) && !/^\{\{/.test(target)) throw badRequest(`Use a connection string like ${scheme[1]}`);
      const m = target.match(/^[a-z]+:\/\/[^:@/]*:([^@]*)@/i);
      if (m && !/^\{\{[^}]+\}\}$/.test(m[1]!.trim()))
        throw badRequest(`The password belongs in a variable: use ${scheme[1]}`);
    } else if (kind === 'snowflake') {
      if (!/^[a-z0-9._-]+$/i.test(target) && !/^\{\{/.test(target)) throw badRequest('Use the account, such as xy12345.eu-west-1');
    } else if (!/^[a-z][a-z0-9-]{4,}$/.test(target) && !/^\{\{/.test(target)) throw badRequest('Use the Google Cloud project id');
    for (const k of SECRET_OPTIONS) {
      const v = input.options[k];
      if (v && !/^\{\{[^}]+\}\}$/.test(v)) throw badRequest(`${k} is a credential: put it in a variable and use {{NAME}}`);
    }
  }

  private checkFile(input: z.output<typeof ConnectionInput>) {
    const t = input.target;
    const ok = {
      file: /^https?:\/\//i,
      s3: /^s3:\/\/[^/]+\/.+/i,
      azure_blob: /^https?:\/\//i,
      gcs: /^gs:\/\/[^/]+\/.+/i,
      gdrive: /\S/,
    }[input.kind as 'file'];
    const hint = {
      file: 'The address must start with http:// or https://',
      s3: 'Use s3://bucket/path/to/file.csv',
      azure_blob: 'Use https://account.blob.core.windows.net/container/file.csv',
      gcs: 'Use gs://bucket/path/to/file.csv',
      gdrive: 'Paste the file’s Google Drive link or id',
    }[input.kind as 'file'];
    if (!ok.test(t)) throw badRequest(hint);
    // A signed link carries its credential in the query string: it belongs in a variable too.
    if (
      /^https?:/i.test(t) &&
      !placeholdersIn(t).length &&
      /[?&](sig|signature|x-amz-signature|x-goog-signature|token|access_token|key)=/i.test(t)
    )
      throw badRequest(
        'The link carries a credential: put it in a variable, e.g. https://…/file.csv?{{SAS_TOKEN}}',
      );
    for (const k of SECRET_OPTIONS) {
      const v = input.options[k];
      if (v && !/^\{\{[^}]+\}\}$/.test(v))
        throw badRequest(`${k} is a credential: put it in a variable and use {{NAME}}`);
    }
    for (const h of input.headers)
      if (SENSITIVE_HEADER.test(h.name) && h.value && !placeholdersIn(h.value).length)
        throw badRequest(`${h.name} carries a credential: put it in a variable and use {{NAME}}`);
  }

  private async run(tenantId: string, projectId: string, c: Draft): Promise<TestResult> {
    const started = Date.now();
    const done = (ok: boolean, message: string): TestResult => ({
      ok,
      message,
      ms: Date.now() - started,
      at: this.ctx.now().toISOString(),
    });
    let secrets = new Map<string, string>();
    // Whatever a variable holds must not appear in what is reported back.
    const redact = (text: string) =>
      [...secrets.values()]
        .filter((v) => v.length >= 3)
        .reduce((t, v) => t.split(v).join('•••'), text);
    try {
      secrets = await this.projects.cellTx(tenantId, (tx) =>
        this.resolve(tx, projectId, refsOf(c)),
      );
      const fill = (text: string) =>
        text.replace(PLACEHOLDER, (_, n: string) => secrets.get(n) ?? '');
      if (isFileKind(c.kind)) {
        const spec: FileSpec = {
          kind: c.kind as FileSpec['kind'],
          target: fill(c.target),
          headers: c.headers.map((h) => ({ name: h.name, value: fill(h.value) })),
          options: Object.fromEntries(Object.entries(c.options).map(([k, v]) => [k, fill(v)])),
        };
        const file = await fetchFile(spec, (host) => this.assertReachable(host), this.ctx.now());
        const table = await parseTable(file, spec.options);
        const preview = previewOf(table);
        return {
          ...done(
            true,
            `Read ${file.name || 'the file'}: ${table.rows.length} row${table.rows.length === 1 ? '' : 's'}, ${table.columns.length} column${table.columns.length === 1 ? '' : 's'} (${table.format.toUpperCase()})`,
          ),
          preview,
        };
      }
      if (c.kind === 'http') {
        const base = new URL(fill(c.target));
        // A path is added to the base address (so /v1 + /forecast keeps the /v1), a full address is used as is.
        const path = fill(c.test);
        const url = !path ? base : /^https?:\/\//i.test(path) ? new URL(path) : new URL(`${base.origin}${base.pathname.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
        if (url.origin !== base.origin)
          return done(false, 'The test path must stay on the same host');
        await this.assertReachable(url.hostname);
        const res = await safeFetch(url, {
          headers: Object.fromEntries(c.headers.map((h) => [h.name, fill(h.value)])),
          signal: AbortSignal.timeout(10_000),
          redirect: 'manual',
        });
        await res.body?.cancel().catch(() => {});
        return done(
          res.status < 300,
          `${url.host}${url.pathname} answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${res.status >= 300 && res.headers.get('location') ? `, redirecting to ${new URL(res.headers.get('location')!, url).host}. Use the final address` : ''}`,
        );
      }
      const cfg = this.driverConfig(c, fill);
      const host = this.hostOf(cfg);
      if (host) await this.assertReachable(host);
      const rows = await testDatabase(cfg, c.test);
      return done(true, `Connected to ${host ?? c.kind}. The query returned ${rows} row${rows === 1 ? '' : 's'}`);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : '';
      return done(false, redact(`${text}${cause}`).slice(0, 300));
    }
  }

  private driverConfig(c: Draft, fill: (t: string) => string): DriverConfig {
    return {
      kind: c.kind as DriverConfig['kind'],
      target: fill(c.target),
      options: Object.fromEntries(Object.entries(c.options).map(([k, v]) => [k, fill(v)])),
    };
  }

  /** The server a database connection talks to, when it is one we should not let reach into our network. */
  private hostOf(cfg: DriverConfig): string | null {
    if (cfg.kind === 'snowflake' || cfg.kind === 'bigquery') return null; // fixed public services
    try {
      return new URL(cfg.target).hostname;
    } catch {
      throw new Error('The connection string is not a valid address');
    }
  }

  /**
   * A saved connection ready to use: variables filled in, the host checked. `redact` removes secret
   * values from any text that is shown to a person.
   */
  async open(
    tenantId: string,
    projectId: string,
    key: string,
  ): Promise<{
    kind: Kind;
    name: string;
    spec: { kind: Kind; target: string; headers: { name: string; value: string }[]; options: Record<string, string>; test: string };
    redact: (text: string) => string;
  }> {
    const row = await this.projects.cellTx(tenantId, (tx) =>
      tx.selectFrom('project_connection').selectAll().where('project_id', '=', projectId).where('key', '=', key).executeTakeFirst(),
    );
    if (!row) throw notFound('Connection');
    const secrets = await this.projects.cellTx(tenantId, (tx) => this.resolve(tx, projectId, refsOf(row)));
    const fill = (text: string) => text.replace(PLACEHOLDER, (_, n: string) => secrets.get(n) ?? '');
    const redact = (text: string) =>
      [...secrets.values()].filter((v) => v.length >= 3).reduce((t, v) => t.split(v).join('•••'), text);
    const spec = {
      kind: row.kind,
      target: fill(row.target),
      headers: row.headers.map((h) => ({ name: h.name, value: fill(h.value) })),
      options: Object.fromEntries(Object.entries(row.options).map(([k, v]) => [k, fill(v)])),
      test: fill(row.test),
    };
    if (isDatabaseKind(spec.kind)) {
      const host = this.hostOf(this.driverConfig(spec, (t) => t));
      if (host) await this.assertReachable(host);
    }
    return { kind: row.kind, name: row.name, spec, redact };
  }

  /** Runs a read-only query on a database connection. */
  async query(tenantId: string, projectId: string, key: string, sql: string, limit: number): Promise<QueryResult> {
    const c = await this.open(tenantId, projectId, key);
    if (!isDatabaseKind(c.kind)) throw badRequest(`${c.name} is not a database`, 'SQL runs on database connections.');
    try {
      return await runDatabaseQuery(this.driverConfig(c.spec, (t) => t), sql, { limit, timeoutMs: 60_000 });
    } catch (e) {
      throw badRequest('The query failed', c.redact(failure(e)), this.diagnostics(c.kind, c.redact, sql, e));
    }
  }

  /** The tables and columns of a database connection. */
  async catalog(tenantId: string, projectId: string, key: string): Promise<Catalog & { dialect: string }> {
    const c = await this.open(tenantId, projectId, key);
    if (!isDatabaseKind(c.kind)) throw badRequest(`${c.name} is not a database`);
    try {
      return { ...(await readCatalog(this.driverConfig(c.spec, (t) => t))), dialect: c.kind };
    } catch (e) {
      throw badRequest('The tables could not be listed', c.redact(failure(e)));
    }
  }

  /**
   * The rows a connection provides as a table of a local dataset: a file's rows, an API response's
   * rows, or what a query returns on a database.
   */
  async rowsOf(
    tenantId: string,
    projectId: string,
    key: string,
    opts: { sql?: string; endpoint?: string; path?: string },
    limit: number,
  ): Promise<Row[]> {
    const c = await this.open(tenantId, projectId, key);
    try {
      if (isDatabaseKind(c.kind)) {
        if (!opts.sql?.trim()) throw new Error(`Write the query to run on ${c.name}`);
        return (await runDatabaseQuery(this.driverConfig(c.spec, (t) => t), opts.sql, { limit, timeoutMs: 60_000 })).rows;
      }
      if (isFileKind(c.kind)) {
        const spec: FileSpec = { kind: c.kind as FileSpec['kind'], target: c.spec.target, headers: c.spec.headers, options: c.spec.options };
        const table = await parseTable(await fetchFile(spec, (host) => this.assertReachable(host), this.ctx.now()), spec.options);
        return table.rows.slice(0, limit).map((r) => Object.fromEntries(table.columns.map((name, i) => [name, r[i]!])));
      }
      const base = new URL(c.spec.target);
      const endpoint = opts.endpoint ?? '';
      const url = !endpoint ? base : new URL(`${base.origin}${base.pathname.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`);
      if (url.origin !== base.origin) throw new Error('The endpoint must stay on the same host');
      await this.assertReachable(url.hostname);
      const res = await safeFetch(url, {
        headers: Object.fromEntries(c.spec.headers.map((h) => [h.name, h.value])),
        signal: AbortSignal.timeout(30_000),
        redirect: 'manual',
      });
      if (res.status >= 300) throw new Error(`${url.host}${url.pathname} answered ${res.status}`);
      let body: unknown;
      try {
        body = JSON.parse(await readText(res));
      } catch {
        throw new Error('The response is not JSON');
      }
      for (const part of (opts.path ?? '').split('.').filter(Boolean))
        body = body && typeof body === 'object' ? (body as Record<string, unknown>)[part] : undefined;
      const list = Array.isArray(body) ? body : body === undefined || body === null ? [] : [body];
      return list.slice(0, limit).map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Row) : { value: x }));
    } catch (e) {
      throw badRequest(`${c.name} could not be read`, c.redact(failure(e)));
    }
  }

  /** The database's error details for the editor to point at: code, hint, and where in the SQL it went wrong. */
  private diagnostics(kind: string, redact: (t: string) => string, sql: string, e: unknown): Record<string, unknown> {
    const d = (e instanceof Error && e.cause instanceof Error && ('code' in e.cause || 'position' in e.cause) ? e.cause : e) as { code?: unknown; position?: unknown; hint?: unknown; detail?: unknown };
    const num = Number(d.position);
    // The driver wraps the query as `select * from (<sql>) as _q limit n`, so a position counts that prefix too (Postgres).
    const lead = sql.length - sql.trimStart().length;
    const wrapped = (['postgres', 'redshift'].includes(kind) ? num - 'select * from ('.length : num) + lead;
    const out: Record<string, unknown> = {};
    if (typeof d.code === 'string' && /^[0-9A-Z]{5}$/.test(d.code)) out.code = d.code;
    if (Number.isFinite(wrapped) && wrapped >= 1 && wrapped <= sql.length) out.position = Math.round(wrapped);
    if (typeof d.hint === 'string') out.hint = redact(d.hint).slice(0, 300);
    if (typeof d.detail === 'string') out.detail = redact(d.detail).slice(0, 300);
    out.text = redact(sql).slice(0, 4000);
    return out;
  }

  /** Blocks private and internal hosts (see `allowPrivateConnections`). */
  async guard(host: string) {
    await this.assertReachable(host);
  }

  /** Outside the platform's own network, unless the deployment allows it. */
  private async assertReachable(host: string) {
    if (this.ctx.allowPrivateConnections) return;
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (addrs.some((x) => isPrivateAddress(x.address)))
      throw new Error('Connections to private or internal addresses are not allowed here');
  }
}

const failure = (e: unknown): string => {
  const text = e instanceof Error ? e.message : String(e);
  const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : '';
  return `${text}${cause}`.slice(0, 500);
};

type Tx = Parameters<Parameters<ProjectService['cellTx']>[1]>[0];
