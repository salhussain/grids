import { importPKCS8, SignJWT } from 'jose';
import type { Driver } from './types.js';
import { cut, httpJson, sleep } from './util.js';

const tokens = new Map<string, { token: string; until: number }>();

/** An access token for the service account (read-only scope), cached until shortly before it expires. */
async function accessToken(serviceAccount: string, timeoutMs: number): Promise<string> {
  let key: { client_email: string; private_key: string; token_uri?: string };
  try {
    key = JSON.parse(serviceAccount);
  } catch {
    throw new Error('The service account must be the JSON key file’s contents');
  }
  const hit = tokens.get(key.client_email);
  if (hit && hit.until > Date.now()) return hit.token;
  const uri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/bigquery.readonly' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(key.client_email)
    .setSubject(key.client_email)
    .setAudience(uri)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(await importPKCS8(key.private_key, 'RS256'));
  const { body } = await httpJson(
    uri,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    },
    timeoutMs,
  );
  tokens.set(key.client_email, { token: body.access_token, until: Date.now() + 50 * 60_000 });
  return body.access_token;
}

const cellOf = (v: unknown, type: string): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  switch (type) {
    case 'INTEGER':
    case 'INT64':
    case 'FLOAT':
    case 'FLOAT64':
    case 'NUMERIC':
    case 'BIGNUMERIC': {
      const n = Number(v);
      return Number.isSafeInteger(n) || !Number.isInteger(n) ? n : v;
    }
    case 'BOOLEAN':
    case 'BOOL':
      return v === 'true';
    case 'TIMESTAMP':
      return new Date(Number(v) * 1000).toISOString();
    default:
      return v;
  }
};

/**
 * BigQuery over its REST API. The target is the project id; `serviceAccount` holds the JSON key
 * (a {{VARIABLE}}); `dataset` is the default dataset, used for unqualified table names and the browser.
 */
export const bigquery: Driver = {
  label: 'BigQuery',
  testQuery: 'select 1',
  quote: (id) => `\`${id.replace(/`/g, '\\`')}\``,
  catalogSql: (cfg) => {
    if (!cfg.options.dataset) throw new Error('Set the connection’s default dataset to browse its tables');
    return `select table_schema, table_name, column_name, data_type from \`${cfg.target}.${cfg.options.dataset}\`.INFORMATION_SCHEMA.COLUMNS order by table_name, ordinal_position`;
  },
  async query(cfg, sql, opts) {
    if (!cfg.options.serviceAccount) throw new Error('Set the connection’s serviceAccount option');
    const token = await accessToken(cfg.options.serviceAccount, opts.timeoutMs);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(cfg.target)}`;
    const deadline = Date.now() + opts.timeoutMs;
    let { body } = await httpJson(
      `${base}/queries`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: sql,
          useLegacySql: false,
          maxResults: opts.limit + 1,
          timeoutMs: Math.min(opts.timeoutMs, 20_000),
          ...(cfg.options.dataset ? { defaultDataset: { projectId: cfg.target, datasetId: cfg.options.dataset } } : {}),
        }),
      },
      opts.timeoutMs,
    );
    while (!body.jobComplete && Date.now() < deadline) {
      await sleep(500);
      const ref = body.jobReference as { jobId: string; location?: string };
      ({ body } = await httpJson(
        `${base}/queries/${ref.jobId}?maxResults=${opts.limit + 1}${ref.location ? `&location=${ref.location}` : ''}`,
        { headers },
        Math.max(1000, deadline - Date.now()),
      ));
    }
    if (!body.jobComplete) throw new Error('The query did not finish in time');
    const fields = (body.schema?.fields ?? []) as { name: string; type: string }[];
    const rows = ((body.rows ?? []) as { f: { v: unknown }[] }[]).map((r) => r.f.map((c, i) => cellOf(c.v, fields[i]!.type)));
    const out = cut(rows, opts.limit);
    // More pages exist than the one fetched.
    return { columns: fields.map((f) => ({ name: f.name, type: f.type.toLowerCase() })), ...out, truncated: out.truncated || !!body.pageToken };
  },
};
