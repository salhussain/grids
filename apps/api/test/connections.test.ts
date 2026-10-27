import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@grids/db';
import { startHarness } from './harness.js';

// External connections and the encrypted variables they refer to.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let member: string;
let upstream: Server;
let base: string;
let seen: Record<string, string | string[] | undefined> = {};

beforeAll(async () => {
  upstream = createServer((req, res) => {
    seen = req.headers;
    res.statusCode = req.headers.authorization === 'Bearer s3cret-token' ? 200 : 401;
    res.end('{}');
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  h = await startHarness();
  tenantId = await h.activeTenant('Conn Org', 'business');
  admin = await h.join(tenantId, 'admin@conn.org', { role: 'org_admin' });
  member = await h.join(tenantId, 'member@conn.org');
  await h.call(admin, 'POST', `/tenants/${tenantId}/projects`, { name: 'Alpha' });
}, 180_000);
afterAll(async () => {
  await h?.stop();
  upstream?.close();
});

const url = (sub: string) => `/tenants/${tenantId}/projects/alpha${sub}`;

describe('variables', () => {
  it('are write-only: the value is never returned and is stored encrypted', async () => {
    expect([403, 404]).toContain(
      (await h.call(member, 'POST', url('/variables'), { key: 'API_TOKEN', value: 'x' })).status,
    );
    const made = await h.call(admin, 'POST', url('/variables'), {
      key: 'API_TOKEN',
      value: 's3cret-token',
      description: 'Upstream',
    });
    expect(made.status).toBe(200);
    expect(JSON.stringify(made.body)).not.toContain('s3cret');
    expect(JSON.stringify((await h.call(admin, 'GET', url('/variables'))).body)).not.toContain(
      's3cret',
    );
    expect(
      (await h.call(admin, 'POST', url('/variables'), { key: 'API_TOKEN', value: 'again' })).status,
    ).toBe(409);
    expect(
      (await h.call(admin, 'POST', url('/variables'), { key: 'lower', value: 'x' })).status,
    ).toBe(400);
    const raw = await withTenant(h.dbs.cellApp, tenantId, (tx) =>
      tx
        .selectFrom('project_variable')
        .select('value_enc')
        .where('key', '=', 'API_TOKEN')
        .executeTakeFirstOrThrow(),
    );
    expect(raw.value_enc).toMatch(/^v1\./);
    expect(raw.value_enc).not.toContain('s3cret');
  });

  it('keep their value when edited without one, and replace it when given one', async () => {
    const ok = await h.call(admin, 'PUT', url('/variables/API_TOKEN'), {
      key: 'API_TOKEN',
      value: '',
      description: 'Edited',
    });
    expect(ok.body[0]).toMatchObject({ key: 'API_TOKEN', description: 'Edited' });
    expect(
      (await h.call(admin, 'POST', url('/variables'), { key: 'NEW_ONE', value: '' })).status,
    ).toBe(400);
  });
});

describe('connections', () => {
  it('refuse credentials written into the connection itself', async () => {
    const bad = (body: object) =>
      h.call(admin, 'POST', url('/connections'), { key: 'c', name: 'C', ...body });
    expect(
      (
        await bad({
          kind: 'http',
          target: base,
          headers: [{ name: 'Authorization', value: 'Bearer abc' }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await bad({ kind: 'postgres', target: 'postgres://u:hunter2@db.example/app' })).status,
    ).toBe(400);
    expect((await bad({ kind: 'http', target: 'ftp://x' })).status).toBe(400);
  });

  it('are tested with their variables filled in, and the outcome is remembered', async () => {
    const input = {
      key: 'upstream',
      name: 'Upstream',
      kind: 'http',
      target: base,
      test: '/health',
      headers: [{ name: 'Authorization', value: 'Bearer {{API_TOKEN}}' }],
    };
    const saved = await h.call(admin, 'POST', url('/connections'), input);
    expect(saved.status).toBe(200);
    expect(saved.body[0]).toMatchObject({ key: 'upstream', lastTest: null });

    const res = await h.call(admin, 'POST', url('/connections/upstream/test'));
    expect(res.body).toMatchObject({ ok: true });
    expect(seen.authorization).toBe('Bearer s3cret-token');
    expect(res.body.message).not.toContain('s3cret');
    expect((await h.call(admin, 'GET', url('/connections'))).body[0].lastTest).toMatchObject({
      ok: true,
    });

    // A draft is tried without saving it; a missing variable is explained.
    const draft = await h.call(admin, 'POST', url('/connection-test'), {
      ...input,
      headers: [{ name: 'Authorization', value: 'Bearer {{MISSING}}' }],
    });
    expect(draft.body).toMatchObject({ ok: false, message: expect.stringContaining('MISSING') });
    // Without the token the upstream answers 401, which is reported as a failure.
    const rejected = await h.call(admin, 'POST', url('/connection-test'), {
      ...input,
      headers: [{ name: 'X-Other', value: 'nope' }],
    });
    expect(rejected.body).toMatchObject({ ok: false, message: expect.stringContaining('401') });
  });

  it('keep the variables they use from being deleted', async () => {
    const vars = (await h.call(admin, 'GET', url('/variables'))).body;
    expect(vars[0]).toMatchObject({ key: 'API_TOKEN', usedBy: ['upstream'] });
    expect((await h.call(admin, 'DELETE', url('/variables/API_TOKEN'))).status).toBe(409);
    expect((await h.call(admin, 'DELETE', url('/connections/upstream'))).status).toBe(200);
    expect((await h.call(admin, 'DELETE', url('/variables/API_TOKEN'))).status).toBe(200);
  });
});

describe('file connections', () => {
  let files: Server;
  let root: string;
  let s3seen: Record<string, string | string[] | undefined> = {};
  beforeAll(async () => {
    files = createServer((req, res) => {
      if (req.url === '/people.csv') {
        res.setHeader('content-type', 'text/csv');
        return void res.end(
          '﻿name;age;note\r\nAda;36;"likes ""math"";\nlogic"\r\n;;\r\nGrace;45;\r\n',
        );
      }
      if (req.url === '/moved') return void res.writeHead(302, { location: '/people.csv' }).end();
      if (req.url === '/private/data.csv' || req.url === '/bucket/folder/my%20file.csv') {
        s3seen = req.headers;
        if (!String(req.headers.authorization).startsWith('AWS4-HMAC-SHA256 Credential=AKID/'))
          return void res.writeHead(403).end();
        return void res.end('a,b\n1,2\n');
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => files.listen(0, '127.0.0.1', r));
    root = `http://127.0.0.1:${(files.address() as { port: number }).port}`;
    await h.call(admin, 'POST', url('/variables'), { key: 'S3_SECRET', value: 'shh-secret-key' });
  });
  afterAll(() => void files?.close());
  const draft = (body: object) =>
    h.call(admin, 'POST', url('/connection-test'), { key: 'f', name: 'F', ...body });

  it('read a CSV from a public URL, following redirects, and preview it', async () => {
    for (const path of ['/people.csv', '/moved']) {
      const r = await draft({ kind: 'file', target: `${root}${path}` });
      expect(r.body).toMatchObject({
        ok: true,
        preview: {
          format: 'csv',
          total: 2,
          columns: ['name', 'age', 'note'],
          rows: [
            ['Ada', '36', 'likes "math";\nlogic'],
            ['Grace', '45', ''],
          ],
        },
      });
    }
    expect((await draft({ kind: 'file', target: `${root}/nothing.csv` })).body).toMatchObject({
      ok: false,
      message: expect.stringContaining('404'),
    });
  });

  it('read from an S3-compatible store with a signed request', async () => {
    const input = {
      kind: 's3',
      target: 's3://private/data.csv',
      options: { endpoint: root, accessKeyId: 'AKID', secretAccessKey: '{{S3_SECRET}}' },
    };
    const ok = await draft(input);
    expect(ok.body).toMatchObject({ ok: true, preview: { columns: ['a', 'b'], total: 1 } });
    expect(String(s3seen.authorization)).toMatch(
      /SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(JSON.stringify(ok.body)).not.toContain('shh-secret');
    // A key with spaces is encoded the same way in the URL and in the signature.
    expect(
      (await draft({ ...input, target: 's3://bucket/folder/my file.csv' })).body,
    ).toMatchObject({ ok: true });
    // Without keys the object is requested anonymously (and refused here).
    expect(
      (await draft({ kind: 's3', target: 's3://private/data.csv', options: { endpoint: root } }))
        .body,
    ).toMatchObject({ ok: false, message: expect.stringContaining('403') });
  });

  it('keep credentials in variables, and track which variables a file connection uses', async () => {
    const bad = (body: object) =>
      h.call(admin, 'POST', url('/connections'), { key: 'f', name: 'F', ...body });
    expect(
      (await bad({ kind: 's3', target: 's3://b/k.csv', options: { secretAccessKey: 'plain' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await bad({
          kind: 'azure_blob',
          target: 'https://a.blob.core.windows.net/c/f.csv?sv=1&sig=abc',
        })
      ).status,
    ).toBe(400);
    expect((await bad({ kind: 'gcs', target: 'https://not-gs/x' })).status).toBe(400);
    const saved = await bad({
      kind: 's3',
      target: 's3://b/k.csv',
      options: { secretAccessKey: '{{S3_SECRET}}', accessKeyId: 'AKID' },
    });
    expect(saved.status).toBe(200);
    expect(saved.body[0]).toMatchObject({
      kind: 's3',
      options: { secretAccessKey: '{{S3_SECRET}}' },
    });
    expect(
      (await h.call(admin, 'GET', url('/variables'))).body.find(
        (v: { key: string }) => v.key === 'S3_SECRET',
      ),
    ).toMatchObject({ usedBy: ['f'] });
  });
});
