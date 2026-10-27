import { DEFAULT_DESIGN, SUBMISSION_FIELD_KEYS, SUBMISSION_RECORD, type DocumentDesign, type DocumentTemplate, type FormDefinition, type PlacedField, type Question, type RecordFooterItem, type RecordOptions } from '@grids/schema';

/**
 * Documents made from a submission. A template is the same small Markdown subset as an email message
 * (headings, **bold**, *italic*, [links](https://…), lists) plus:
 *
 *   ${question}                       an answer, as people read it (choices by their labels, Yes/No, dates…)
 *   ${_submitted_at}                  details of the submission itself (see SUBMISSION_FIELDS)
 *   | a | b |  with a |---|---| line   a table
 *   [[each members]] … [[end]]        repeats a block for every row of a repeating section (${_row} is the row's number)
 *   [[each items]]| ${x} | ${y} |     in a table, repeats that one row
 *
 * It is turned into plain blocks, which the PDF writer, the Word writer and the preview all draw from.
 */

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  href?: string;
  /** A stored picture (a signature, a photo) shown here instead of text; the id of the stored file. */
  image?: string;
}
export type DocBlock =
  /** `fill` makes it a band of that colour (a hex) with white text. */
  | { kind: 'heading'; level: 1 | 2 | 3; runs: Run[]; fill?: string }
  | { kind: 'paragraph'; lines: Run[][] }
  | { kind: 'list'; ordered: boolean; items: Run[][] }
  | { kind: 'table'; header: Run[][] | null; rows: Run[][][] }
  /** A question as the form shows it: its label, its help text, and the answer in a box (`shade` is the box's fill). */
  | { kind: 'field'; label: Run[]; hint?: Run[]; answer: Run[]; shade?: string }
  /** One of the form's notes, set apart (`tint` is the colour of its edge). */
  | { kind: 'note'; runs: Run[]; tint?: string };
/** An answer at a spot on the page (percent of the page's width and height). */
export interface Placed {
  id: string;
  x: number;
  y: number;
  width: number;
  size: number;
  align: PlacedField['align'];
  bold: boolean;
  page: number;
  runs: Run[];
}
export interface BuiltDocument {
  blocks: DocBlock[];
  header: Run[];
  footer: Run[];
  /** "Page 1 of 3" beside the footer. */
  pageNumbers: boolean;
  /** Pages of a document of placed answers. */
  pages: number;
  /** The logo, watermark and background picture. */
  design: DocumentDesign;
  /** `placed`: nothing flows; only `placed` is drawn, over the background. */
  mode: 'flow' | 'placed';
  placed: Placed[];
}

export interface DocData {
  /** The answers (and calculations); a repeating section is a list of rows under its key. */
  values: Record<string, unknown>;
  /** Details of the submission: `_submitted_at` and the rest of `SUBMISSION_FIELDS`. */
  details: Record<string, string>;
  /** Names of entities, by id (the answer to an entity question is an id). */
  names?: Record<string, string>;
  /** Where dates and times are shown; UTC when absent. */
  timezone?: string;
  /** The colour used where a document asks for colours (a hex); the app's blue when absent. */
  accent?: string;
}

type Row = Record<string, unknown>;

const questionMap = (def: FormDefinition) => new Map(def.sections.flatMap((s) => s.questions).map((q) => [q.key, q]));

const when = (iso: string, zone: string, time: boolean) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', ...(time && { timeStyle: 'short' }), timeZone: time ? zone : 'UTC' }).format(d);
  } catch {
    return iso;
  }
};

/** An answer as people read it. */
export function formatAnswer(q: Question | undefined, v: unknown, data: Pick<DocData, 'names' | 'timezone'> = {}): string {
  if (v === null || v === undefined || v === '') return '';
  const zone = data.timezone ?? 'UTC';
  const label = (x: unknown) => q?.options?.find((o) => o.value === x)?.label ?? String(x);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) {
    if (!v.length) return '';
    if (q?.type === 'image' || q?.type === 'file') return `${v.length} ${q.type === 'image' ? 'photo' : 'file'}${v.length === 1 ? '' : 's'} attached`;
    return v.map((x) => (q?.type === 'entity' && typeof x === 'string' ? (data.names?.[x] ?? x) : label(x))).join(', ');
  }
  switch (q?.type) {
    case 'select':
      return label(v);
    case 'date':
      return typeof v === 'string' ? when(`${v}T00:00:00Z`, 'UTC', false) : String(v);
    case 'datetime':
      return typeof v === 'string' ? when(v, zone, true) : String(v);
    case 'entity':
      return typeof v === 'string' ? (data.names?.[v] ?? v) : String(v);
    case 'image':
    case 'file':
      return '1 attached';
    case 'signature':
      return 'Signed';
    case 'rating':
      return `${v} / ${q.max ?? 5}`;
    case 'geopoint': {
      const p = v as { lat?: number; lon?: number };
      return typeof p === 'object' && p ? `${p.lat}, ${p.lon}` : String(v);
    }
    default:
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}

const TOKEN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\)|\$\{[a-z_][a-z0-9_]*\})/g;
const SAFE_URL = /^(https?:\/\/[^\s"<>]+|mailto:[^\s"<>]+)$/i;
const EACH = /^\s*\[\[each\s+([a-z][a-z0-9_]*)\]\]\s*/;
const END = /^\s*\[\[end\]\]\s*$/;

class Builder {
  private readonly questions: Map<string, Question>;
  constructor(
    def: FormDefinition,
    private readonly data: DocData,
  ) {
    this.questions = questionMap(def);
  }

  /** What `${key}` is here: this row's answer if inside a repeat, else the form's answer, else a detail of the submission. */
  private lookup(key: string, scope: Row): string {
    if (key in this.data.details) return this.data.details[key] ?? '';
    if (key === '_row') return String(scope._row ?? '');
    const v = key in scope ? scope[key] : this.data.values[key];
    return formatAnswer(this.questions.get(key), v, this.data);
  }

  runs(text: string, scope: Row, style: Pick<Run, 'bold' | 'italic'> = {}): Run[] {
    const out: Run[] = [];
    for (const part of text.split(TOKEN)) {
      let m: RegExpExecArray | null;
      if (!part) continue;
      if ((m = /^\*\*([^*\n]+)\*\*$/.exec(part))) out.push(...this.runs(m[1]!, scope, { ...style, bold: true }));
      else if ((m = /^\*([^*\n]+)\*$/.exec(part))) out.push(...this.runs(m[1]!, scope, { ...style, italic: true }));
      else if ((m = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/.exec(part))) {
        if (SAFE_URL.test(m[2]!)) out.push(...this.runs(m[1]!, scope, style).map((r) => ({ ...r, href: m![2]! })));
        else out.push({ text: part, ...style });
      } else if ((m = /^\$\{([a-z_][a-z0-9_]*)\}$/.exec(part))) {
        const q = this.questions.get(m[1]!);
        const raw = m[1]! in scope ? scope[m[1]!] : this.data.values[m[1]!];
        if ((q?.type === 'signature' || q?.type === 'image') && (typeof raw === 'string' || Array.isArray(raw))) {
          // A signature or a photo is drawn, not described.
          for (const id of (Array.isArray(raw) ? raw : [raw]).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x))) out.push({ text: '', image: id });
          continue;
        }
        const text = this.lookup(m[1]!, scope);
        if (text) out.push({ text, ...style });
      } else out.push({ text: part, ...style });
    }
    return out;
  }

  rowsOf(key: string, scope: Row): Row[] {
    const v = key in scope ? scope[key] : this.data.values[key];
    return Array.isArray(v) ? v.filter((r): r is Row => typeof r === 'object' && r !== null && !Array.isArray(r)) : [];
  }

  /** The line after `[[each …]]` that closes it (nesting counted), or -1. */
  private closing(lines: string[], from: number): number {
    let depth = 0;
    for (let i = from; i < lines.length; i++) {
      if (EACH.test(lines[i]!) && !lines[i]!.replace(EACH, '').trim().startsWith('|')) depth++;
      else if (END.test(lines[i]!) && --depth === 0) return i;
    }
    return -1;
  }

  blocks(lines: string[], scope: Row): DocBlock[] {
    const out: DocBlock[] = [];
    let para: Run[][] | null = null;
    let list: { ordered: boolean; items: Run[][] } | null = null;
    const flush = () => {
      para = null;
      list = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trimEnd();
      let m: RegExpExecArray | null;
      const each = EACH.exec(line);
      if (each && !line.replace(EACH, '').trim().startsWith('|')) {
        flush();
        const end = this.closing(lines, i);
        const inner = lines.slice(i + 1, end < 0 ? lines.length : end);
        this.rowsOf(each[1]!, scope).forEach((row, n) => out.push(...this.blocks(inner, { ...scope, ...row, _row: n + 1 })));
        i = end < 0 ? lines.length : end;
      } else if (!line.trim()) flush();
      else if (line.replace(EACH, '').trimStart().startsWith('|')) {
        flush();
        const rows: { each: string | null; cells: string[] }[] = [];
        let j = i;
        for (; j < lines.length && lines[j]!.replace(EACH, '').trimStart().startsWith('|'); j++) {
          const raw = lines[j]!;
          const e = EACH.exec(raw);
          const cells = raw.replace(EACH, '').trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
          rows.push({ each: e ? e[1]! : null, cells });
        }
        i = j - 1;
        const sep = rows.findIndex((r) => r.cells.every((c) => /^:?-{2,}:?$/.test(c)));
        const head = sep > 0 ? rows.slice(0, sep) : [];
        const body = sep >= 0 ? rows.slice(sep + 1) : rows;
        out.push({
          kind: 'table',
          header: head.length ? head[0]!.cells.map((c) => this.runs(c, scope, { bold: true })) : null,
          rows: body.flatMap((r) =>
            r.each ? this.rowsOf(r.each, scope).map((row, n) => r.cells.map((c) => this.runs(c, { ...scope, ...row, _row: n + 1 }))) : [r.cells.map((c) => this.runs(c, scope))],
          ),
        });
      } else if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
        flush();
        out.push({ kind: 'heading', level: m[1]!.length as 1 | 2 | 3, runs: this.runs(m[2]!, scope) });
      } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line)) || (m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
        const ordered = /^\s*\d/.test(line);
        if (!list || list.ordered !== ordered) {
          para = null;
          list = { ordered, items: [] };
          out.push({ kind: 'list', ordered, items: list.items });
        }
        list.items.push(this.runs(m![1]!, scope));
      } else {
        list = null;
        if (!para) {
          para = [];
          out.push({ kind: 'paragraph', lines: para });
        }
        para.push(this.runs(line, scope));
      }
    }
    return out;
  }
}

type TemplateIn = Pick<DocumentTemplate, 'body' | 'header' | 'footer'> & Partial<Pick<DocumentTemplate, 'design' | 'mode' | 'fields' | 'pages'>>;

/** The document a template makes for one submission. */
export function buildDocument(template: TemplateIn, def: FormDefinition, data: DocData): BuiltDocument {
  const b = new Builder(def, data);
  const mode = template.mode ?? 'flow';
  const base = { design: template.design ?? DEFAULT_DESIGN, mode };
  // A page that is only answers in their places has no flowing text, header or footer.
  if (mode === 'placed')
    return { ...base, blocks: [], header: [], footer: [], pageNumbers: false, pages: template.pages ?? 1, placed: (template.fields ?? []).map((f) => ({ id: f.id, page: f.page ?? 1, x: f.x, y: f.y, width: f.width, size: f.size, align: f.align, bold: f.bold, runs: b.runs(`\${${f.key}}`, {}) })) };
  return { ...base, blocks: b.blocks(template.body.replace(/\r\n?/g, '\n').split('\n'), {}), header: b.runs(template.header, {}), footer: b.runs(template.footer, {}), pageNumbers: true, pages: 1, placed: [] };
}

/** A colour mixed with white: `t` is how much of the colour stays (0 to 1). */
export function tint(hex: string, t: number): string {
  const n = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '0f62fe';
  const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  return `#${c.map((v) => Math.round(255 - (255 - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The default Submission record: every question with its answer, made from the form itself (so there is no text
 * to keep up to date). Questions with no answer are left out unless `blank`; a repeating section lists each row.
 * As a table, each section is a Question and Answer table; as the form, each question follows the one before it
 * with its answer in a box, with the form's notes and help text if asked, and the accent colour if asked.
 */
export function buildRecord(def: FormDefinition, data: DocData, opts: RecordOptions): BuiltDocument {
  const b = new Builder(def, data);
  const accent = data.accent && /^#[0-9a-f]{6}$/i.test(data.accent) ? data.accent : '#0f62fe';
  const fill = opts.colors ? accent : undefined;
  const shade = opts.colors ? tint(accent, 0.07) : undefined;
  const blocks: DocBlock[] = [];
  const d = data.details;
  if (opts.project && d._project_name) blocks.push({ kind: 'paragraph', lines: [[{ text: d._project_name, bold: true }]] });
  if (opts.header) {
    blocks.push({ kind: 'heading', level: 1, runs: [{ text: def.title }], ...(fill && { fill }) });
    if (def.description.trim()) blocks.push({ kind: 'paragraph', lines: [[{ text: def.description.trim() }]] });
  }
  if (opts.details) {
    const line = [`Sent${d._submitted_by ? ` by ${d._submitted_by}` : ''}${d._submitted_at ? ` on ${d._submitted_at}` : ''}`, d._status].filter(Boolean).join(' · ');
    if (line !== 'Sent') blocks.push({ kind: 'paragraph', lines: [[{ text: line, italic: true }]] });
  }
  const table = (rows: Run[][][]): DocBlock => ({ kind: 'table', header: [[{ text: 'Question', bold: true }], [{ text: 'Answer', bold: true }]], rows });
  /** The questions of one section (or one row of a repeating one), in the form's order. */
  const items = (qs: Question[], scope: Row): DocBlock[] => {
    const out: DocBlock[] = [];
    let rows: Run[][][] = [];
    const flush = () => {
      if (rows.length) out.push(table(rows));
      rows = [];
    };
    for (const q of qs) {
      if (q.type === 'note') {
        if (opts.notes && q.label.trim()) {
          flush();
          out.push({ kind: 'note', runs: [{ text: q.label.trim() }], tint: accent });
        }
        continue;
      }
      const answer = b.runs(`\${${q.key}}`, scope);
      if (!answer.length && !opts.blank) continue;
      const shown = answer.length ? answer : [{ text: 'No answer', italic: true }];
      if (opts.layout === 'form') out.push({ kind: 'field', label: [{ text: q.label || q.key }], ...(opts.notes && q.hint?.trim() && { hint: [{ text: q.hint.trim() }] }), answer: shown, ...(shade && { shade }) });
      else rows.push([[{ text: q.label || q.key }], shown]);
    }
    flush();
    return out;
  };
  const heading = (text: string, level: 2 | 3): DocBlock => ({ kind: 'heading', level, runs: [{ text }], ...(fill && level === 2 && { fill }) });
  for (const s of def.sections) {
    if (s.repeat) {
      const label = s.repeat.itemLabel || 'Item';
      const rows = b.rowsOf(s.key, {});
      blocks.push(heading(s.title || label, 2));
      if (!rows.length) blocks.push({ kind: 'paragraph', lines: [[{ text: 'None.', italic: true }]] });
      rows.forEach((row, n) => {
        const found = items(s.questions, { ...row, _row: n + 1 });
        blocks.push(heading(`${label} ${n + 1}`, 3));
        if (found.length) blocks.push(...found);
        else blocks.push({ kind: 'paragraph', lines: [[{ text: 'No answers.', italic: true }]] });
      });
      continue;
    }
    const found = items(s.questions, {});
    if (!found.length) continue;
    if (opts.group && s.title) blocks.push(heading(s.title, 2));
    // Without section headings, the questions read as one list: tables run on into one.
    const last = blocks[blocks.length - 1];
    if (!opts.group && last?.kind === 'table' && found[0]?.kind === 'table') {
      last.rows.push(...found[0].rows);
      blocks.push(...found.slice(1));
    } else blocks.push(...found);
  }
  const FOOTER: Record<RecordFooterItem, string> = {
    submission_id: 'Submission ${_submission_id}',
    submitted_at: 'Sent ${_submitted_at}',
    submitted_by: 'By ${_submitted_by}',
    printed_at: 'Printed ${_printed_at}',
    project: 'Project: ${_project_name}',
    form: '${_form_name}',
  };
  const footer = opts.pageFooter ? opts.footerItems.map((i) => FOOTER[i]).join('  ·  ') : '';
  return { blocks, header: opts.pageHeader ? b.runs(SUBMISSION_RECORD.header, {}) : [], footer: b.runs(footer, {}), pageNumbers: opts.pageNumbers, pages: 1, design: opts.design, mode: 'flow', placed: [] };
}

/** The record as text a person can edit (what "Duplicate to customise" starts from). Every question, whether answered or not. */
export function recordMarkdown(def: FormDefinition, opts: RecordOptions): string {
  const cell = (t: string) => (t || '').replace(/\|/g, '/').replace(/\n/g, ' ');
  const rows = (qs: Question[]) => ['| Question | Answer |', '|---|---|', ...qs.filter((q) => q.type !== 'note').map((q) => `| ${cell(q.label || q.key)} | \${${q.key}} |`)].join('\n');
  const out: string[] = [`# \${_form_name}`];
  if (opts.details) out.push('Sent by ${_submitted_by} on ${_submitted_at} · ${_status}');
  for (const s of def.sections) {
    if (s.repeat) out.push(`## ${cell(s.title || s.repeat.itemLabel || 'Items')}`, `[[each ${s.key}]]\n### ${cell(s.repeat.itemLabel || 'Item')} \${_row}\n\n${rows(s.questions)}\n[[end]]`);
    else {
      if (opts.group && s.title) out.push(`## ${cell(s.title)}`);
      out.push(rows(s.questions));
    }
  }
  return out.join('\n\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const runsHtml = (runs: Run[]) =>
  runs
    .map((r) => {
      if (r.image) return '<span style="display:inline-block;border:1px dashed #999;color:#999;padding:2px 14px;font-size:12px">picture</span>';
      let h = esc(r.text);
      if (r.bold) h = `<strong>${h}</strong>`;
      if (r.italic) h = `<em>${h}</em>`;
      return r.href ? `<a href="${esc(r.href)}">${h}</a>` : h;
    })
    .join('');

/** A built document as HTML, in parts: the header, each block, the footer. The preview lays these out page by page. */
export interface HtmlBlock {
  html: string;
  /** A row of a table: `html` is the `<tr>`; rows with the same id belong to one table, which repeats `head` on each page. */
  table?: { id: number; head: string };
}

/** Blocks as HTML; the rows of one table that sit together make one table. */
export function renderBlocks(blocks: HtmlBlock[]): string {
  let out = '';
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (!b.table) {
      out += b.html;
      continue;
    }
    let rows = '';
    while (i < blocks.length && blocks[i]!.table?.id === b.table.id) rows += blocks[i++]!.html;
    i--;
    out += `<table style="border-collapse:collapse;width:100%;margin:0 0 10px">${b.table.head}${rows}</table>`;
  }
  return out;
}

export function documentToHtmlParts(doc: BuiltDocument): { header: string; blocks: HtmlBlock[]; footer: string; pageNumbers: boolean } {
  let tableId = 0;
  const blocks = doc.blocks
    .flatMap((b): HtmlBlock[] => {
      const one = (html: string): HtmlBlock[] => [{ html }];
      if (b.kind === 'heading') return one(b.fill ? `<h${b.level} style="margin:16px 0 8px;background:${b.fill};color:#fff;padding:6px 10px">${runsHtml(b.runs)}</h${b.level}>` : `<h${b.level} style="margin:16px 0 8px">${runsHtml(b.runs)}</h${b.level}>`);
      if (b.kind === 'field') return one(`<div style="margin:0 0 10px"><div style="font-size:12px;font-weight:600;color:#3f3f46">${runsHtml(b.label)}</div>${b.hint ? `<div style="font-size:11px;color:#71717a;margin-bottom:2px">${runsHtml(b.hint)}</div>` : ''}<div style="border:1px solid #bbb;padding:5px 8px;min-height:1.6em${b.shade ? `;background:${b.shade}` : ''}">${runsHtml(b.answer)}</div></div>`);
      if (b.kind === 'note') return one(`<p style="margin:0 0 10px;padding:6px 10px;border-left:3px solid ${b.tint ?? '#999'};background:#f6f6f8;font-style:italic">${runsHtml(b.runs)}</p>`);
      if (b.kind === 'paragraph') return one(`<p style="margin:0 0 10px">${b.lines.map(runsHtml).join('<br>')}</p>`);
      if (b.kind === 'list') return one(`<${b.ordered ? 'ol' : 'ul'} style="margin:0 0 10px;padding-left:22px">${b.items.map((i) => `<li>${runsHtml(i)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`);
      const cell = (tag: string) => (c: Run[]) => `<${tag} style="border:1px solid #bbb;padding:4px 8px;text-align:left">${runsHtml(c)}</${tag}>`;
      const id = tableId++;
      const head = b.header ? `<tr>${b.header.map(cell('th')).join('')}</tr>` : '';
      return b.rows.map((r) => ({ html: `<tr>${r.map(cell('td')).join('')}</tr>`, table: { id, head } }));
    });
  return {
    header: doc.header.length ? `<div style="color:#666;font-size:12px;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:14px">${runsHtml(doc.header)}</div>` : '',
    blocks,
    footer: doc.footer.length ? `<div style="color:#666;font-size:12px">${runsHtml(doc.footer)}</div>` : '',
    pageNumbers: doc.pageNumbers,
  };
}

/** A built document as one piece of HTML. */
export function documentToHtml(doc: BuiltDocument): string {
  const p = documentToHtmlParts(doc);
  return `${p.header}${renderBlocks(p.blocks)}${p.footer ? `<div style="border-top:1px solid #ddd;padding-top:6px;margin-top:18px">${p.footer}</div>` : ''}`;
}

/** Everything wrong with a template, in words. */
export function lintDocument(template: Pick<DocumentTemplate, 'name' | 'body' | 'header' | 'footer'>, def: FormDefinition): string[] {
  const problems: string[] = [];
  const name = template.name || 'A document';
  const keys = new Set(questionsKeys(def));
  const repeating = new Set(def.sections.filter((s) => s.repeat).map((s) => s.key));
  const known = (k: string) => keys.has(k) || SUBMISSION_FIELD_KEYS.has(k) || k === '_row' || repeating.has(k);
  for (const text of [template.body, template.header, template.footer])
    for (const m of text.matchAll(/\$\{([a-z_][a-z0-9_]*)\}/g)) if (!known(m[1]!)) problems.push(`${name}: unknown question \${${m[1]}}`);
  for (const m of template.body.matchAll(/\[\[each\s+([a-z][a-z0-9_]*)\]\]/g)) if (!repeating.has(m[1]!)) problems.push(`${name}: "${m[1]}" is not a repeating section, so it cannot be repeated`);
  for (const f of 'fields' in template ? ((template as Partial<DocumentTemplate>).fields ?? []) : []) if (!known(f.key)) problems.push(`${name}: the placed answer \${${f.key}} is not a question of the form`);
  const opens = template.body.split('\n').filter((l) => EACH.test(l) && !l.replace(EACH, '').trim().startsWith('|')).length;
  const closes = template.body.split('\n').filter((l) => END.test(l)).length;
  if (opens !== closes) problems.push(`${name}: every [[each …]] needs an [[end]] after it`);
  return [...new Set(problems)];
}

const questionsKeys = (def: FormDefinition) => def.sections.flatMap((s) => s.questions.map((q) => q.key));

/** The stored pictures a built document shows (to be fetched before it is written). */
export function imagesIn(doc: BuiltDocument): string[] {
  const ids = new Set<string>();
  const take = (runs: Run[]) => runs.forEach((r) => r.image && ids.add(r.image));
  take(doc.header);
  take(doc.footer);
  const d = doc.design;
  for (const id of [d.logo.image, d.watermark.kind === 'image' ? d.watermark.image : null, d.background.image, ...d.background.pages]) if (id) ids.add(id);
  for (const f of doc.placed) take(f.runs);
  for (const b of doc.blocks) {
    if (b.kind === 'field') {
      take(b.label);
      take(b.answer);
    } else if (b.kind === 'note') take(b.runs);
    else if (b.kind === 'heading') take(b.runs);
    else if (b.kind === 'paragraph') b.lines.forEach(take);
    else if (b.kind === 'list') b.items.forEach(take);
    else [...(b.header ?? []), ...b.rows.flat()].forEach(take);
  }
  return [...ids];
}
