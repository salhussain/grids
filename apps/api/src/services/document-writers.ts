import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, FrameAnchorType, Header, HeadingLevel, HorizontalPositionRelativeFrom, ImageRun, LevelFormat, Packer, PageNumber, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalPositionRelativeFrom, WidthType, HorizontalPositionAlign, VerticalPositionAlign } from 'docx';
import { tint, type BuiltDocument, type DocBlock, type Run } from '@grids/forms';
import type { DocumentTemplate } from '@grids/schema';

type Page = Pick<DocumentTemplate, 'name' | 'paper' | 'orientation'>;
/** The stored pictures a document shows, by id. */
export type Images = Map<string, { content: Buffer; contentType: string }>;

/** A picture's size in pixels, for the formats the writers can place (PNG and JPEG); null otherwise. */
function pictureSize(b: Buffer): { width: number; height: number; kind: 'png' | 'jpg' } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { kind: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { kind: 'jpg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}
const MAX_W = 200;
const MAX_H = 80;

// ---------------------------------------------------------------- PDF

/** The built-in fonts cover Western European text; anything else would print as noise, so it becomes "?". */
const latin = (s: string) => s.replace(/[^ -~\u00a0-ÿ–—‘’“”•…€\n]/g, '?');
const fontFor = (r: Run) => (r.bold && r.italic ? 'Helvetica-BoldOblique' : r.bold ? 'Helvetica-Bold' : r.italic ? 'Helvetica-Oblique' : 'Helvetica');
const plain = (runs: Run[]) => runs.map((r) => r.text).join('');

/** One paragraph of mixed styles, flowing from the current position. */
function writeRuns(pdf: PDFKit.PDFDocument, runs: Run[], size: number, images: Images, extra: PDFKit.Mixins.TextOptions = {}): void {
  // Pictures sit on their own line, between the text before and after them.
  if (runs.some((r) => r.image)) {
    let run: Run[] = [];
    const flush = (): void => {
      if (run.length) writeRuns(pdf, run, size, images, extra);
      run = [];
    };
    for (const r of runs) {
      if (!r.image) run.push(r);
      else {
        flush();
        const pic = images.get(r.image);
        const dim = pic && pictureSize(pic.content);
        if (pic && dim) {
          // Kept at its own size unless that is bigger than the space for it.
          const k = Math.min(1, MAX_W / dim.width, MAX_H / dim.height);
          const w = Math.max(1, Math.round(dim.width * k));
          const h = Math.max(1, Math.round(dim.height * k));
          if (pdf.y + h > pdf.page.height - pdf.page.margins.bottom) pdf.addPage();
          pdf.image(pic.content, pdf.x, pdf.y, { width: w, height: h });
          pdf.y += h + 4;
        } else writeRuns(pdf, [{ text: '(picture)', italic: true }], size, images, extra);
      }
    }
    return flush();
  }
  const parts = runs.filter((r) => r.text);
  if (!parts.length) return void pdf.moveDown(0.6);
  parts.forEach((r, i) => {
    pdf
      .font(fontFor(r))
      .fontSize(size)
      .fillColor(r.href ? '#0f62fe' : '#18181b')
      .text(latin(r.text), { ...extra, continued: i < parts.length - 1, ...(r.href && { link: r.href, underline: true }), ...(i > 0 && { indent: 0 }) });
  });
}

const MM = 72 / 25.4;
const hexOf = (c: string) => c.replace('#', '').toUpperCase();

export function toPdf(doc: BuiltDocument, page: Page, images: Images = new Map()): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const placed = doc.mode === 'placed';
    // A page of answers in their places has no margins: positions are measured from the paper's corner.
    const margin = placed ? { top: 0, bottom: 0, left: 0, right: 0 } : { top: 70, bottom: 70, left: 56, right: 56 };
    const pdf = new PDFDocument({ size: page.paper === 'letter' ? 'LETTER' : 'A4', layout: page.orientation, margins: margin, bufferPages: true, info: { Title: latin(page.name) } });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    const W = pdf.page.width;
    const H = pdf.page.height;
    const width = W - margin.left - margin.right;
    const design = doc.design;
    const picture = (id: string | null) => {
      const pic = id ? images.get(id) : undefined;
      const dim = pic && pictureSize(pic.content);
      return pic && dim ? { pic, dim } : null;
    };
    const logo = picture(design.logo.image);
    // The logo is as wide as asked, but never taller than the strip it sits in.
    const logoBox = logo && (() => {
      const cap = design.logo.pages === 'all' ? 40 : 110;
      const k = Math.min((design.logo.width * MM) / logo.dim.width, cap / logo.dim.height);
      const w = logo.dim.width * k;
      const h = logo.dim.height * k;
      const x = design.logo.align === 'center' ? (W - w) / 2 : design.logo.align === 'right' ? W - Math.max(margin.left, 24) - w : Math.max(margin.left, 24);
      return { x, y: design.logo.pages === 'all' ? 16 : 24, w, h };
    })();

    /** What goes behind every page: the picture, then the watermark; and the logo where it belongs. Returns the space the logo took. */
    let pageNo = 0;
    const dressPage = (first: boolean): number => {
      const [sx, sy] = [pdf.x, pdf.y];
      const bg = picture(design.background.pages[pageNo] ?? design.background.image);
      if (bg) pdf.image(bg.pic.content, 0, 0, { cover: [W, H], align: 'center', valign: 'center' });
      const wm = design.watermark;
      if (wm.kind === 'text' && wm.text.trim()) {
        const text = latin(wm.text.trim());
        pdf.save();
        pdf.font('Helvetica-Bold').fontSize(100);
        const size = Math.max(14, Math.min(130, (100 * 0.72 * Math.min(W, H)) / Math.max(1, pdf.widthOfString(text))));
        pdf.fontSize(size).fillColor('#000').opacity(wm.opacity / 100);
        pdf.rotate(wm.angle, { origin: [W / 2, H / 2] });
        pdf.text(text, (W - pdf.widthOfString(text)) / 2, H / 2 - size / 2, { lineBreak: false });
        pdf.restore();
      } else if (wm.kind === 'image') {
        const img = picture(wm.image);
        if (img) {
          const k = Math.min((W * 0.6) / img.dim.width, (H * 0.6) / img.dim.height);
          const [w, h] = [img.dim.width * k, img.dim.height * k];
          pdf.save();
          pdf.opacity(wm.opacity / 100);
          pdf.image(img.pic.content, (W - w) / 2, (H - h) / 2, { width: w, height: h });
          pdf.restore();
        }
      }
      let used = 0;
      if (logoBox && logo && (first || design.logo.pages === 'all')) {
        pdf.image(logo.pic.content, logoBox.x, logoBox.y, { width: logoBox.w, height: logoBox.h });
        used = logoBox.y + logoBox.h + 12;
      }
      pdf.x = sx;
      pdf.y = sy;
      return used;
    };
    pdf.on('pageAdded', () => {
      pageNo++;
      dressPage(false);
    });
    const pushed = dressPage(true);
    if (!placed && design.logo.pages === 'first' && pushed > pdf.y) pdf.y = pushed;
    const room = (h: number) => {
      if (pdf.y + h > H - margin.bottom) pdf.addPage();
    };

    if (placed) {
      for (const f of doc.placed.slice().sort((a, b) => a.page - b.page)) {
        while (pageNo + 1 < Math.min(f.page, doc.pages)) pdf.addPage();
        const [x, y, w] = [(f.x / 100) * W, (f.y / 100) * H, (f.width / 100) * W];
        const pics = f.runs.flatMap((r) => (r.image ? [picture(r.image)] : [])).filter((x): x is NonNullable<typeof x> => !!x);
        if (pics.length) {
          // Pictures share the box side by side, none taller than the height asked for.
          const gap = 6;
          const each = (w - gap * (pics.length - 1)) / pics.length;
          const items = pics.map((p) => {
            const k = Math.min(each / p.dim.width, (f.size * 3) / p.dim.height);
            return { p, w: p.dim.width * k, h: p.dim.height * k };
          });
          const total = items.reduce((n, i) => n + i.w, 0) + gap * (items.length - 1);
          let cx = x + (f.align === 'center' ? (w - total) / 2 : f.align === 'right' ? w - total : 0);
          for (const it of items) {
            pdf.image(it.p.pic.content, cx, y, { width: it.w, height: it.h });
            cx += it.w + gap;
          }
        } else {
          pdf.font(f.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(f.size).fillColor('#18181b').text(latin(plain(f.runs)), x, y, { width: w, align: f.align, height: Math.max(f.size * 1.4, H - y - 2), ellipsis: true });
        }
      }
      while (pageNo + 1 < doc.pages) pdf.addPage();
    }

    for (const b of placed ? [] : doc.blocks) {
      if (b.kind === 'heading') {
        const size = b.level === 1 ? 20 : b.level === 2 ? 16 : 13;
        if (b.fill) {
          const h = size + 14;
          room(h + 12);
          const y0 = pdf.y + 4;
          pdf.rect(margin.left, y0, width, h).fill(b.fill);
          pdf.font('Helvetica-Bold').fontSize(size).fillColor('#ffffff').text(latin(plain(b.runs)), margin.left + 10, y0 + 7, { width: width - 20, lineBreak: false });
          pdf.x = margin.left;
          pdf.y = y0 + h + 8;
        } else {
          pdf.moveDown(0.5);
          writeRuns(pdf, b.runs.map((r) => ({ ...r, bold: true })), size, images);
          pdf.moveDown(0.4);
        }
      } else if (b.kind === 'field') {
        const label = latin(plain(b.label));
        const hint = b.hint ? latin(plain(b.hint)) : '';
        const pic = b.answer.find((r) => r.image)?.image ? picture(b.answer.find((r) => r.image)!.image!) : null;
        const text = latin(plain(b.answer));
        pdf.font('Helvetica-Bold').fontSize(10);
        const lh = pdf.heightOfString(label, { width }) + 2;
        pdf.font('Helvetica').fontSize(9);
        const hh = hint ? pdf.heightOfString(hint, { width }) + 2 : 0;
        pdf.font('Helvetica').fontSize(11);
        const k = pic ? Math.min(1, MAX_W / pic.dim.width, MAX_H / pic.dim.height) : 1;
        const ah = (pic ? pic.dim.height * k : pdf.heightOfString(text || ' ', { width: width - 16 })) + 12;
        room(lh + hh + ah + 10);
        pdf.font('Helvetica-Bold').fontSize(10).fillColor('#3f3f46').text(label, margin.left, pdf.y, { width });
        if (hint) pdf.font('Helvetica').fontSize(9).fillColor('#71717a').text(hint, margin.left, pdf.y, { width });
        const y0 = pdf.y + 2;
        if (b.shade) pdf.rect(margin.left, y0, width, ah).fill(b.shade);
        pdf.rect(margin.left, y0, width, ah).lineWidth(0.5).strokeColor('#a1a1aa').stroke();
        if (pic) pdf.image(pic.pic.content, margin.left + 8, y0 + 6, { width: pic.dim.width * k, height: pic.dim.height * k });
        else pdf.font('Helvetica').fontSize(11).fillColor('#18181b').text(text, margin.left + 8, y0 + 6, { width: width - 16 });
        pdf.x = margin.left;
        pdf.y = y0 + ah + 10;
      } else if (b.kind === 'note') {
        const text = latin(plain(b.runs));
        pdf.font('Helvetica-Oblique').fontSize(10);
        const h = pdf.heightOfString(text, { width: width - 20 }) + 12;
        room(h + 10);
        const y0 = pdf.y;
        pdf.rect(margin.left, y0, width, h).fill('#f6f6f8');
        pdf.rect(margin.left, y0, 3, h).fill(b.tint ?? '#999999');
        pdf.font('Helvetica-Oblique').fontSize(10).fillColor('#3f3f46').text(text, margin.left + 12, y0 + 6, { width: width - 20 });
        pdf.x = margin.left;
        pdf.y = y0 + h + 10;
      } else if (b.kind === 'paragraph') {
        b.lines.forEach((l, i) => (i > 0 && pdf.text('', { continued: false }), writeRuns(pdf, l, 11, images, { lineGap: 2 })));
        pdf.moveDown(0.7);
      } else if (b.kind === 'list') {
        b.items.forEach((item, n) => {
          writeRuns(pdf, [{ text: b.ordered ? `${n + 1}.  ` : '•  ' }, ...item], 11, images, { lineGap: 2, indent: 12 });
        });
        pdf.moveDown(0.7);
      } else drawTable(pdf, b, width, margin.left, margin.bottom);
    }

    // The header and footer go on every page, now that the pages are known (a page of placed answers has none).
    if (!placed) {
      const { start, count } = pdf.bufferedPageRange();
      const headerY = logoBox && design.logo.pages === 'all' ? 58 : 30;
      for (let i = start; i < start + count; i++) {
        pdf.switchToPage(i);
        const savedBottom = pdf.page.margins.bottom;
        pdf.page.margins.bottom = 0; // writing below the margin must not start a new page
        pdf.font('Helvetica').fontSize(9).fillColor('#71717a');
        if (doc.header.length) pdf.text(latin(plain(doc.header)), margin.left, headerY, { width, lineBreak: false });
        const foot = [doc.footer.length ? latin(plain(doc.footer)) : '', doc.pageNumbers ? `Page ${i - start + 1} of ${count}` : ''].filter(Boolean).join('    ');
        if (foot) pdf.text(foot, margin.left, pdf.page.height - 40, { width, align: 'right', lineBreak: false });
        pdf.page.margins.bottom = savedBottom;
      }
    }
    pdf.end();
  });
}

function drawTable(pdf: PDFKit.PDFDocument, t: Extract<DocBlock, { kind: 'table' }>, width: number, left: number, bottomMargin: number) {
  const rows = [...(t.header ? [{ cells: t.header, head: true }] : []), ...t.rows.map((cells) => ({ cells, head: false }))];
  const cols = Math.max(1, ...rows.map((r) => r.cells.length));
  const colW = width / cols;
  const pad = 5;
  for (const row of rows) {
    const texts = Array.from({ length: cols }, (_, c) => latin(plain(row.cells[c] ?? [])));
    pdf.font(row.head ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
    const h = Math.max(...texts.map((x) => pdf.heightOfString(x, { width: colW - pad * 2 }))) + pad * 2;
    if (pdf.y + h > pdf.page.height - bottomMargin) pdf.addPage();
    const y = pdf.y;
    texts.forEach((x, c) => {
      pdf.rect(left + c * colW, y, colW, h).lineWidth(0.5).strokeColor('#a1a1aa').stroke();
      if (row.head) pdf.rect(left + c * colW, y, colW, h).fillOpacity(0.06).fill('#000').fillOpacity(1);
      pdf.fillColor('#18181b').font(row.head ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(x, left + c * colW + pad, y + pad, { width: colW - pad * 2 });
    });
    pdf.x = left;
    pdf.y = y + h;
  }
  pdf.moveDown(0.8);
}

// ---------------------------------------------------------------- Word

const textRuns = (runs: Run[], size?: number, bold?: boolean, images: Images = new Map()) =>
  runs
    .filter((r) => r.text || r.image)
    .map((r) => {
      if (r.image) {
        const pic = images.get(r.image);
        const size = pic && pictureSize(pic.content);
        if (!pic || !size) return new TextRun({ text: '(picture)', italics: true });
        const k = Math.min(1, MAX_W / size.width, MAX_H / size.height);
        return new ImageRun({ type: size.kind, data: pic.content, transformation: { width: Math.max(1, Math.round(size.width * k)), height: Math.max(1, Math.round(size.height * k)) } });
      }
      const run = new TextRun({ text: r.text, bold: bold || r.bold, italics: r.italic, ...(size && { size }), ...(r.href && { color: '0F62FE', underline: {} }) });
      return r.href ? new ExternalHyperlink({ link: r.href, children: [run] }) : run;
    });

/** The paper's size in twips (a twentieth of a point), as Word measures it. */
const paperTwips = (page: Page) => {
  const [w, h] = page.paper === 'letter' ? [12240, 15840] : [11906, 16838];
  return page.orientation === 'landscape' ? { width: h, height: w } : { width: w, height: h };
};
const PX = 96 / 25.4;

export async function toDocx(doc: BuiltDocument, page: Page, images: Images = new Map()): Promise<Buffer> {
  let lists = 0;
  const placed = doc.mode === 'placed';
  const paper = paperTwips(page);
  const pxWide = Math.round((paper.width / 1440) * 96);
  const pxHigh = Math.round((paper.height / 1440) * 96);
  const design = doc.design;
  const picture = (id: string | null) => {
    const pic = id ? images.get(id) : undefined;
    const dim = pic && pictureSize(pic.content);
    return pic && dim ? { pic, dim } : null;
  };
  const children: (Paragraph | Table)[] = [];
  const spacer = (after = 140) => new Paragraph({ spacing: { after }, children: [] });

  const logo = picture(design.logo.image);
  const logoPara = () => {
    if (!logo) return null;
    const w = Math.round(design.logo.width * PX);
    const h = Math.round((w * logo.dim.height) / logo.dim.width);
    return new Paragraph({ alignment: design.logo.align === 'center' ? AlignmentType.CENTER : design.logo.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 120 }, children: [new ImageRun({ type: logo.dim.kind, data: logo.pic.content, transformation: { width: w, height: h } })] });
  };
  if (logo && design.logo.pages === 'first' && !placed) children.push(logoPara()!);

  for (const b of placed ? [] : doc.blocks) {
    if (b.kind === 'heading') {
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][b.level - 1]!;
      if (b.fill) children.push(new Paragraph({ heading: level, spacing: { before: 200, after: 120 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: hexOf(b.fill) }, children: b.runs.filter((r) => r.text).map((r) => new TextRun({ text: ` ${r.text}`, bold: true, color: 'FFFFFF' })) }));
      else children.push(new Paragraph({ heading: level, spacing: { before: 200, after: 100 }, children: textRuns(b.runs, undefined, true, images) }));
    } else if (b.kind === 'field') {
      children.push(new Paragraph({ keepNext: true, spacing: { before: 60, after: b.hint ? 0 : 40 }, children: textRuns(b.label, 20, true, images) }));
      if (b.hint) children.push(new Paragraph({ keepNext: true, spacing: { after: 40 }, children: textRuns(b.hint, 18, false, images).map((r) => r) }));
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({ children: [new TableCell({ margins: { top: 80, bottom: 80, left: 120, right: 120 }, ...(b.shade && { shading: { type: ShadingType.CLEAR, color: 'auto', fill: hexOf(b.shade) } }), children: [new Paragraph({ children: textRuns(b.answer, undefined, false, images) })] })] })],
        }),
        spacer(80),
      );
    } else if (b.kind === 'note') {
      children.push(new Paragraph({ spacing: { before: 60, after: 160 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F6F6F8' }, border: { left: { style: BorderStyle.SINGLE, size: 24, color: hexOf(b.tint ?? '#999999'), space: 8 } }, children: b.runs.filter((r) => r.text).map((r) => new TextRun({ text: r.text, italics: true })) }));
    } else if (b.kind === 'paragraph')
      children.push(new Paragraph({ spacing: { after: 140 }, children: b.lines.flatMap((l, i) => (i ? [new TextRun({ break: 1 }), ...textRuns(l, undefined, undefined, images)] : textRuns(l, undefined, undefined, images))) }));
    else if (b.kind === 'list') {
      const instance = ++lists;
      b.items.forEach((item) => children.push(new Paragraph({ children: textRuns(item, undefined, undefined, images), ...(b.ordered ? { numbering: { reference: 'ordered', level: 0, instance } } : { bullet: { level: 0 } }) })));
      children.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
    } else {
      const cell = (runs: Run[], head: boolean) => new TableCell({ margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: textRuns(runs, undefined, head, images) })] });
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [...(b.header ? [new TableRow({ tableHeader: true, children: b.header.map((c) => cell(c, true)) })] : []), ...b.rows.map((r) => new TableRow({ children: r.map((c) => cell(c, false)) }))],
        }),
        spacer(),
      );
    }
  }

  // Answers in their places: each is a frame fixed to the paper's corner.
  const pageChildren: (Paragraph | Table)[][] = Array.from({ length: placed ? Math.max(1, doc.pages) : 0 }, () => []);
  if (placed) {
    for (const f of doc.placed) {
      const into = pageChildren[Math.min(Math.max(f.page, 1), pageChildren.length) - 1]!;
      const pics = f.runs.flatMap((r) => (r.image ? [picture(r.image)] : [])).filter((x): x is NonNullable<typeof x> => !!x);
      const w = Math.round((f.width / 100) * paper.width);
      const frame = { type: 'absolute' as const, position: { x: Math.round((f.x / 100) * paper.width), y: Math.round((f.y / 100) * paper.height) }, width: w, height: pics.length ? Math.round(f.size * 60) : Math.round(f.size * 24), anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE } };
      const align = f.align === 'center' ? AlignmentType.CENTER : f.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT;
      if (pics.length) {
        const each = ((w / 1440) * 96 - 8 * (pics.length - 1)) / pics.length;
        const runs = pics.map((pic) => {
          const k = Math.min(each / pic.dim.width, ((f.size * 3) / 72) * 96 / pic.dim.height);
          return new ImageRun({ type: pic.dim.kind, data: pic.pic.content, transformation: { width: Math.max(1, Math.round(pic.dim.width * k)), height: Math.max(1, Math.round(pic.dim.height * k)) } });
        });
        into.push(new Paragraph({ frame, alignment: align, children: runs }));
      } else into.push(new Paragraph({ frame, alignment: align, children: [new TextRun({ text: f.runs.map((r) => r.text).join(''), size: f.size * 2, bold: f.bold })] }));
    }
    for (const c of pageChildren) c.push(new Paragraph({ children: [] }));
  }

  // Behind every page: the picture, then the watermark. They live in the header, so they repeat on each page.
  const behindFor = (pageIndex: number): Paragraph[] => {
  const behind: Paragraph[] = [];
  const bg = picture(design.background.pages[pageIndex] ?? design.background.image);
  if (bg)
    behind.push(
      new Paragraph({
        children: [new ImageRun({ type: bg.dim.kind, data: bg.pic.content, transformation: { width: pxWide, height: pxHigh }, floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 }, behindDocument: true, allowOverlap: true } })],
      }),
    );
  const wm = design.watermark;
  if (wm.kind === 'image') {
    const img = picture(wm.image);
    if (img) {
      const k = Math.min((pxWide * 0.6) / img.dim.width, (pxHigh * 0.6) / img.dim.height);
      behind.push(
        new Paragraph({
          children: [new ImageRun({ type: img.dim.kind, data: img.pic.content, transformation: { width: Math.round(img.dim.width * k), height: Math.round(img.dim.height * k) }, floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, align: HorizontalPositionAlign.CENTER }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, align: VerticalPositionAlign.CENTER }, behindDocument: true, allowOverlap: true } })],
        }),
      );
    }
  } else if (wm.kind === 'text' && wm.text.trim()) {
    // Word has no tilted text we can place here, so it sits upright, centred, in a pale grey.
    behind.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        frame: { type: 'absolute', position: { x: 0, y: Math.round(paper.height / 2 - 700) }, width: paper.width, height: 1400, anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE } },
        children: [new TextRun({ text: wm.text.trim(), bold: true, size: 120, color: hexOf(tint('#000000', wm.opacity / 100)) })],
      }),
    );
  }
  return behind;
  };
  const headerFor = (pageIndex: number) => [...behindFor(pageIndex), ...(logo && design.logo.pages === 'all' && !placed ? [logoPara()!] : []), ...(doc.header.length ? [new Paragraph({ children: textRuns(doc.header, 18) })] : [])];

  const file = new Document({
    title: page.name,
    numbering: { config: [{ reference: 'ordered', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }] }] },
    sections: (placed ? pageChildren : [children]).map((kids, i) => {
      const header = headerFor(i);
      return {
        properties: { page: { size: { width: page.paper === 'letter' ? 12240 : 11906, height: page.paper === 'letter' ? 15840 : 16838, orientation: page.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, ...(placed && { margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 } }) } },
        headers: header.length ? { default: new Header({ children: header }) } : undefined,
        footers: placed || (!doc.footer.length && !doc.pageNumbers) ? undefined : { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [...textRuns(doc.footer, 18), ...(doc.pageNumbers ? [new TextRun({ text: doc.footer.length ? '    Page ' : 'Page ', size: 18 }), new TextRun({ children: [PageNumber.CURRENT], size: 18 }), new TextRun({ text: ' of ', size: 18 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18 })] : [])] })] }) },
        children: kids,
      };
    }),
  });
  return Packer.toBuffer(file);
}

// ---------------------------------------------------------------- Excel

const flat = (runs: Run[]) => runs.map((r) => (r.image ? '(picture)' : r.text)).join('');
const NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * A spreadsheet: headings and text become rows, lists become rows, and every table is a table with its header row.
 * Numbers in table cells are kept as numbers, so they can be added up.
 */
export async function toXlsx(doc: BuiltDocument, page: Page): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.title = page.name;
  const sheet = book.addWorksheet(page.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Document', {
    pageSetup: { paperSize: (page.paper === 'letter' ? 1 : 9) as ExcelJS.PaperSize, orientation: page.orientation },
  });
  const cols = Math.max(1, ...doc.blocks.map((b) => (b.kind === 'table' ? Math.max(b.header?.length ?? 0, ...b.rows.map((r) => r.length)) : b.kind === 'field' ? 2 : 1)));
  sheet.columns = Array.from({ length: cols }, () => ({ width: cols === 1 ? 90 : 26 }));
  const grey = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFEFEFEF' } };
  const line = { style: 'thin' as const, color: { argb: 'FFA1A1AA' } };
  const add = (text: string, font: Partial<ExcelJS.Font> = {}) => {
    const row = sheet.addRow([text]);
    row.getCell(1).font = font;
    row.getCell(1).alignment = { vertical: 'top', wrapText: false };
    return row;
  };
  if (doc.header.length) add(flat(doc.header), { color: { argb: 'FF71717A' } });
  for (const b of doc.blocks) {
    if (b.kind === 'heading') {
      const size = b.level === 1 ? 16 : b.level === 2 ? 13 : 11;
      const row = add(flat(b.runs), { bold: true, size });
      // A heading set as a coloured band keeps its colour.
      if (b.fill && /^#[0-9a-f]{6}$/i.test(b.fill)) {
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${b.fill.slice(1).toUpperCase()}` } };
        row.getCell(1).font = { bold: true, size, color: { argb: 'FFFFFFFF' } };
      }
    } else if (b.kind === 'paragraph') for (const l of b.lines) add(flat(l));
    else if (b.kind === 'list') b.items.forEach((item, n) => add(`${b.ordered ? `${n + 1}.` : '\u2022'} ${flat(item)}`));
    else if (b.kind === 'note') add(flat(b.runs), { italic: true });
    else if (b.kind === 'field') {
      // A question and its answer: the label in the first column, the answer beside it.
      const row = sheet.addRow([flat(b.label), flat(b.answer)]);
      row.getCell(1).font = { bold: true };
      row.eachCell((cell) => {
        cell.border = { top: line, left: line, bottom: line, right: line };
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    } else {
      const rows = [...(b.header ? [{ cells: b.header, head: true }] : []), ...b.rows.map((cells) => ({ cells, head: false }))];
      for (const r of rows) {
        const row = sheet.addRow(Array.from({ length: cols }, (_, c) => (r.cells[c] ? (NUMBER.test(flat(r.cells[c]!).trim()) && !r.head ? Number(flat(r.cells[c]!).trim()) : flat(r.cells[c]!)) : '')));
        row.eachCell({ includeEmpty: true }, (cell, c) => {
          if (c > r.cells.length) return;
          cell.border = { top: line, left: line, bottom: line, right: line };
          cell.alignment = { vertical: 'top', wrapText: true };
          if (r.head) {
            cell.font = { bold: true };
            cell.fill = grey;
          }
        });
      }
    }
    sheet.addRow([]);
  }
  if (doc.footer.length) add(flat(doc.footer), { color: { argb: 'FF71717A' } });
  return Buffer.from(await book.xlsx.writeBuffer());
}
