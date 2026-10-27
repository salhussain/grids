import { deflateSync, crc32 } from 'node:zlib';
import { uuidv7 } from '@grids/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './harness.js';

// The default Submission record: every form has it, and it is made from the form itself.
let h: Awaited<ReturnType<typeof startHarness>>;
let tenantId: string;
let admin: string;
let key: string;
let facility: { id: string };
let form: { key: string; name: string; draft: unknown; groupId: string | null; settings: Record<string, unknown> };

const api = (who: string) => {
  const base = `/tenants/${tenantId}/projects`;
  return {
    get: (url = '') => h.call(who, 'GET', `${base}${url}`),
    post: (url: string, body?: unknown) => h.call(who, 'POST', `${base}${url}`, body),
    put: (url: string, body?: unknown) => h.call(who, 'PUT', `${base}${url}`, body),
  };
};

beforeAll(async () => {
  h = await startHarness();
  tenantId = await h.activeTenant('Island Records', 'business');
  admin = await h.join(tenantId, 'admin@ir.org', { role: 'org_admin' });
  key = (await h.call(admin, 'POST', `/tenants/${tenantId}/projects`, { name: 'Surveillance', template: 'health-surveillance' })).body.key;
  facility = (await api(admin).get(`/${key}/entities?type=facility&pageSize=5`)).body.items[0];
  form = (await api(admin).get(`/${key}/forms`)).body.find((f: { key: string }) => f.key === 'weekly_report');
}, 180_000);
afterAll(async () => h?.stop());

const save = (settings: object) => api(admin).put(`/${key}/forms/weekly_report`, { key: form.key, name: form.name, subjectType: 'facility', definition: form.draft, groupId: form.groupId, settings });
const answers = { malaria: 1, ili: 2, diarrhoea: 0, measles: 0, deaths: 0, outbreak: false, stockout: 0 };

describe('the default submission record', () => {
  let id: string;
  it('is made for any submission, as a PDF or a Word file, without anyone writing it', async () => {
    id = uuidv7();
    const sent = await api(admin).post(`/${key}/forms/weekly_report/submissions`, { id, version: 1, entityId: facility.id, collectedAt: new Date().toISOString(), answers });
    expect(sent.status).toBe(201);
    for (const [format, magic] of [['pdf', '%PDF'], ['docx', 'PK']] as const) {
      const r = await h.app.inject({ method: 'GET', url: `/tenants/${tenantId}/projects/${key}/forms/weekly_report/submissions/${id}/documents/submission?format=${format}`, headers: { authorization: `Bearer ${admin}` } });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-disposition']).toContain('submission-record');
      expect(r.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
      expect(r.rawPayload.length).toBeGreaterThan(500);
    }
  });

  it('can be set up, and the form’s own documents cannot take its key', async () => {
    expect((await save({ record: { group: false, details: false, blank: true } })).status).toBe(200);
    const doc = { id: 'submission', name: 'Mine', description: '', paper: 'a4', orientation: 'portrait', header: '', footer: '', body: 'Hello' };
    expect((await save({ documents: [doc] })).status).toBe(400);
    expect((await save({ documents: [{ ...doc, id: 'mine' }] })).status).toBe(200);
  });

  it('can be attached to an email by the workflow', async () => {
    const wf = { enabled: true, stages: [], graph: undefined };
    const r = await save({ workflow: { ...wf, stages: [{ key: 'review', name: 'Review', approvers: { role: 'manager', group: null, users: [] } }] } });
    expect(r.status).toBe(200);
  });
});

/** A small solid-colour PNG, made here so the test needs no files. */
function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

describe('how a document looks', () => {
  let sub: string;
  const upload = async (bytes: Buffer, name: string) => {
    const r = await h.app.inject({ method: 'PUT', url: `/tenants/${tenantId}/projects/${key}/forms/weekly_report/attachments?name=${name}&type=image/png`, headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/octet-stream' }, payload: bytes });
    expect(r.statusCode).toBe(201);
    return r.json().id as string;
  };
  const make = async (docId: string, format: 'pdf' | 'docx') => {
    const r = await h.app.inject({ method: 'GET', url: `/tenants/${tenantId}/projects/${key}/forms/weekly_report/submissions/${sub}/documents/${docId}?format=${format}`, headers: { authorization: `Bearer ${admin}` } });
    expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
    return r.rawPayload;
  };

  it('draws a logo, a watermark and a background, in a form-style record, in both formats', async () => {
    sub = uuidv7();
    expect((await api(admin).post(`/${key}/forms/weekly_report/submissions`, { id: sub, version: 1, entityId: facility.id, collectedAt: new Date().toISOString(), answers })).status).toBe(201);
    const plainPdf = await make('submission', 'pdf');
    const logo = await upload(png(40, 20, [200, 30, 30]), 'logo.png');
    const back = await upload(png(60, 85, [235, 240, 250]), 'letterhead.png');
    const design = { logo: { image: logo, align: 'right', pages: 'all', width: 35 }, watermark: { kind: 'text', text: 'DRAFT', opacity: 15, angle: -40, image: null }, background: { image: back } };
    expect((await save({ record: { layout: 'form', colors: true, header: true, notes: true, group: true, details: true, blank: true, design } })).status).toBe(200);
    for (const format of ['pdf', 'docx'] as const) {
      const bytes = await make('submission', format);
      expect(bytes.subarray(0, format === 'pdf' ? 4 : 2).toString('latin1')).toBe(format === 'pdf' ? '%PDF' : 'PK');
      if (format === 'pdf') expect(bytes.length).toBeGreaterThan(plainPdf.length); // the pictures are in it
    }
  });

  it('puts answers where they were placed on a picture, as a PDF or a Word file', async () => {
    const back = await upload(png(60, 85, [250, 245, 230]), 'certificate.png');
    const doc = { id: 'cert', formats: ['pdf', 'docx'], name: 'Certificate', description: '', paper: 'a4', orientation: 'landscape', header: '', footer: '', body: '', mode: 'placed',
      design: { logo: { image: null, align: 'left', pages: 'first', width: 40 }, watermark: { kind: 'none', text: '', image: null, opacity: 12, angle: -35 }, background: { image: back } },
      fields: [{ id: 'a', key: 'malaria', x: 20, y: 30, width: 30, size: 18, align: 'center', bold: true }, { id: 'b', key: '_submitted_by', x: 60, y: 70, width: 30, size: 12, align: 'left', bold: false }] };
    expect((await save({ documents: [doc] })).status).toBe(200);
    for (const format of ['pdf', 'docx'] as const) expect((await make('cert', format)).length).toBeGreaterThan(500);
    expect((await save({ documents: [{ ...doc, fields: [{ ...doc.fields[0], key: 'nope' }] }] })).status).toBe(400);
  });

  it('gives each page of a placed document its own background and answers', async () => {
    const one = await upload(png(60, 85, [250, 245, 230]), 'page-one.png');
    const two = await upload(png(60, 85, [230, 245, 250]), 'page-two.png');
    const doc = { id: 'pack', formats: ['pdf', 'docx'], name: 'Pack', description: '', paper: 'a4', orientation: 'portrait', header: '', footer: '', body: '', mode: 'placed', pages: 3,
      design: { logo: { image: null, align: 'left', pages: 'first', width: 40 }, watermark: { kind: 'none', text: '', image: null, opacity: 12, angle: -35 }, background: { image: one, pages: [null, two] } },
      fields: [{ id: 'a', key: 'malaria', page: 1, x: 20, y: 30, width: 30, size: 18, align: 'center', bold: true }, { id: 'b', key: '_submitted_by', page: 3, x: 60, y: 70, width: 30, size: 12, align: 'left', bold: false }] };
    expect((await save({ documents: [doc] })).status).toBe(200);
    const pdf = await make('pack', 'pdf');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(3);
    expect((await make('pack', 'docx')).length).toBeGreaterThan(500);
  });
});

describe('drafts, publishing and history', () => {
  const doc = (over: object = {}) => ({ id: 'letter', name: 'Letter', description: '', visibility: 'internal', paper: 'a4', orientation: 'portrait', header: '', footer: '', body: 'Cases: ${malaria}', mode: 'flow', fields: [], ...over });
  const settings = async () => ((await api(admin).get(`/${key}/forms`)).body.find((f: { key: string }) => f.key === 'weekly_report') as { settings: { documents: { id: string }[]; documentDraft: { documents: { id: string; body: string }[] } | null } }).settings;
  const record = { layout: 'table', colors: false, header: true, notes: false, group: true, details: true, blank: false };

  it('keeps edits apart from the published documents until they are published', async () => {
    const draft = { documents: [doc()], record: { ...record, design: undefined }, documentId: 'letter' };
    expect((await api(admin).put(`/${key}/forms/weekly_report/documents/draft`, draft)).status).toBe(204);
    const s = await settings();
    expect(s.documentDraft?.documents.map((d) => d.id)).toEqual(['letter']);
    expect(s.documents.some((d) => d.id === 'letter')).toBe(false);
    expect((await api(admin).post(`/${key}/forms/weekly_report/documents/publish`)).status).toBe(204);
    const after = await settings();
    expect(after.documentDraft).toBeNull();
    expect(after.documents.map((d) => d.id)).toContain('letter');
  });

  it('records who saved and published, newest first', async () => {
    const r = await api(admin).get(`/${key}/forms/weekly_report/documents/letter/revisions`);
    expect(r.status).toBe(200);
    expect(r.body.map((x: { action: string }) => x.action)).toEqual(['published', 'saved']);
    expect(r.body[0].actorName).toBeTruthy();
  });

  it('publishes or discards one document at a time', async () => {
    const url = `/${key}/forms/weekly_report/documents`;
    const a = doc({ id: 'memo_a', name: 'Memo A' });
    const b = doc({ id: 'memo_b', name: 'Memo B' });
    const base = (await settings()).documents;
    await api(admin).put(`${url}/draft`, { documents: [...base, a, b], record: { ...record, design: undefined }, documentId: 'memo_a' });
    expect((await api(admin).post(`${url}/publish?document=memo_a`)).status).toBe(204);
    let s = await settings();
    expect(s.documents.map((d) => d.id)).toContain('memo_a');
    expect(s.documents.map((d) => d.id)).not.toContain('memo_b');
    expect(s.documentDraft?.documents.map((d) => d.id)).toContain('memo_b');
    expect((await api(admin).post(`${url}/discard?document=memo_b`)).status).toBe(204);
    s = await settings();
    expect(s.documentDraft).toBeNull();
    expect(s.documents.map((d) => d.id)).toContain('memo_a');
  });

  it('can be discarded', async () => {
    await api(admin).put(`/${key}/forms/weekly_report/documents/draft`, { documents: [doc({ body: 'changed' })], record: { ...record, design: undefined }, documentId: 'letter' });
    expect((await api(admin).post(`/${key}/forms/weekly_report/documents/discard`)).status).toBe(204);
    expect((await settings()).documentDraft).toBeNull();
  });

  it('keeps internal documents out of emails', async () => {
    const wf = { enabled: true, stages: [] };
    const node = (id: string) => ({ id, type: 'notify', name: 'Tell them', to: { submitter: true, approvers: null, emails: [], questions: [] }, subject: 'Hello', body: '', attachments: [], attachQuestions: [], documents: [{ id: 'letter', format: 'pdf' }] });
    const graph = { nodes: [{ id: 'start', type: 'start', name: '' }, node('n1'), { id: 'end', type: 'end', name: '', outcome: 'approved' }], edges: [{ id: 'e1', from: 'start', to: 'n1', handle: 'next' }, { id: 'e2', from: 'n1', to: 'end', handle: 'next' }] };
    const r = await save({ documents: [doc({ visibility: 'internal' })], workflow: { ...wf, graph } });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('internal');
    const ok = await save({ documents: [doc({ visibility: 'email' })], workflow: { ...wf, graph } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});
