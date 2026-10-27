import PDFDocument from 'pdfkit';
import type { BillTo, InvoiceDto } from '@grids/schema';

const money = (minor: number, currency: string) => {
  const abs = Math.abs(minor) / 100;
  // The currency's code, not its symbol: the built-in PDF fonts cannot draw every symbol.
  const text = new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'code' }).format(abs).replace(/ /g, ' ');
  return minor < 0 ? `-${text}` : text;
};
const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso)) : '-');
/** The built-in PDF fonts draw Western European text only; anything else becomes "?" rather than a broken glyph. */
const latin = (s: string) => s.replace(/[^ -ÿ–—‘’“”€]/g, '?');

const INK = '#161616';
const MUTED = '#6f6f6f';
const LINE = '#d0d0d0';

/**
 * An invoice, or the receipt for a paid one, as a PDF. Both say who it is for (the organisation at its billing
 * address), what it covers and what it came to; a receipt adds how and when it was paid.
 */
export function renderInvoicePdf(opts: { invoice: InvoiceDto; billTo: BillTo; kind: 'invoice' | 'receipt'; accent?: string }): Promise<Buffer> {
  const { invoice: i, billTo, kind } = opts;
  const accent = opts.accent ?? '#8a1f4a';
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: `${kind === 'receipt' ? 'Receipt' : 'Invoice'} ${i.number}` } });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    const left = 56;
    const width = pdf.page.width - 112;
    const right = left + width;

    // Heading
    pdf.rect(left, 56, 22, 22).fill(accent);
    pdf.fillColor(INK).font('Helvetica-Bold').fontSize(16).text('Grids', left + 32, 59);
    pdf.font('Helvetica').fontSize(9).fillColor(MUTED).text('Grids Platform', left + 32, 79);
    pdf.font('Helvetica').fontSize(9).fillColor(MUTED).text(kind === 'receipt' ? 'RECEIPT' : 'INVOICE', left, 56, { width, align: 'right', characterSpacing: 2 });
    pdf.font('Courier-Bold').fontSize(16).fillColor(INK).text(i.number, left, 70, { width, align: 'right' });
    const status = kind === 'receipt' ? 'PAID' : i.status === 'paid' ? 'PAID' : i.overdue ? 'OVERDUE' : i.status === 'void' ? 'VOID' : 'OPEN';
    pdf.font('Helvetica-Bold').fontSize(9).fillColor(status === 'PAID' ? '#198038' : status === 'OVERDUE' ? '#da1e28' : MUTED).text(status, left, 94, { width, align: 'right' });
    pdf.moveTo(left, 116).lineTo(right, 116).lineWidth(0.7).strokeColor(LINE).stroke();

    // Who it is for, and the dates
    let y = 134;
    pdf.font('Helvetica').fontSize(8).fillColor(MUTED).text('BILL TO', left, y);
    const lines = [
      billTo.legalName || billTo.name,
      billTo.legalName && billTo.legalName !== billTo.name ? billTo.name : null,
      billTo.line1,
      billTo.line2,
      [billTo.city, billTo.region, billTo.postalCode].filter(Boolean).join(' '),
      billTo.country,
      billTo.taxId ? `Tax ID: ${billTo.taxId}` : null,
      billTo.registrationNumber ? `Registration no.: ${billTo.registrationNumber}` : null,
    ].filter((l): l is string => !!l);
    pdf.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(latin(lines[0] ?? ''), left, y + 13, { width: 260 });
    pdf.font('Helvetica').fontSize(10).fillColor(INK);
    let ly = pdf.y + 2;
    for (const l of lines.slice(1)) {
      pdf.text(latin(l), left, ly, { width: 260 });
      ly = pdf.y + 1;
    }
    const facts: [string, string][] = [
      ['Issued', date(i.issuedAt)],
      ...(kind === 'receipt' ? ([['Paid', date(i.paidAt)]] as [string, string][]) : ([['Due', date(i.dueAt)]] as [string, string][])),
      ...(i.periodStart ? ([['Period', `${date(i.periodStart)} - ${date(i.periodEnd)}`]] as [string, string][]) : []),
      ...(kind === 'receipt' && i.paymentMethod ? ([['Method', i.paymentMethod.replace('_', ' ')]] as [string, string][]) : []),
      ...(kind === 'receipt' && i.paymentReference ? ([['Reference', i.paymentReference]] as [string, string][]) : []),
    ];
    let fy = y;
    for (const [k, v] of facts) {
      pdf.font('Helvetica').fontSize(8).fillColor(MUTED).text(k.toUpperCase(), 340, fy, { width: 80 });
      pdf.font('Helvetica').fontSize(10).fillColor(INK).text(latin(v), 420, fy - 1, { width: right - 420, align: 'right' });
      fy += 18;
    }
    y = Math.max(ly, fy) + 24;

    // Lines
    const cols = { desc: left, qty: left + width * 0.58, unit: left + width * 0.7, amt: left + width * 0.85 };
    pdf.rect(left, y, width, 22).fill('#f4f4f4');
    pdf.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    pdf.text('DESCRIPTION', cols.desc + 8, y + 7);
    pdf.text('QTY', cols.qty, y + 7, { width: width * 0.1, align: 'right' });
    pdf.text('UNIT', cols.unit, y + 7, { width: width * 0.13, align: 'right' });
    pdf.text('AMOUNT', cols.amt, y + 7, { width: width * 0.15 - 8, align: 'right' });
    y += 30;
    pdf.font('Helvetica').fontSize(10).fillColor(INK);
    for (const l of i.lines) {
      const h = pdf.heightOfString(latin(l.description), { width: width * 0.55 });
      if (y + h > pdf.page.height - 160) {
        pdf.addPage();
        y = 56;
      }
      pdf.fillColor(INK).text(latin(l.description), cols.desc + 8, y, { width: width * 0.55 });
      pdf.text(String(l.quantity), cols.qty, y, { width: width * 0.1, align: 'right' });
      pdf.text(money(l.unitAmount, i.currency), cols.unit, y, { width: width * 0.13, align: 'right' });
      pdf.text(money(l.amount, i.currency), cols.amt, y, { width: width * 0.15 - 8, align: 'right' });
      y += Math.max(h, 12) + 8;
      pdf.moveTo(left, y - 4).lineTo(right, y - 4).lineWidth(0.4).strokeColor('#e8e8e8').stroke();
    }

    // Totals
    y += 8;
    const tx = left + width * 0.55;
    const tw = right - tx;
    const row = (label: string, value: string, bold = false) => {
      pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor(bold ? INK : MUTED).text(label, tx, y, { width: tw * 0.5 });
      pdf.fillColor(INK).text(value, tx + tw * 0.4, y, { width: tw * 0.6, align: 'right' });
      y += bold ? 22 : 16;
    };
    row('Subtotal', money(i.subtotal, i.currency));
    if (i.discount > 0) row('Discount', `-${money(i.discount, i.currency)}`);
    pdf.moveTo(tx, y).lineTo(right, y).lineWidth(0.7).strokeColor(LINE).stroke();
    y += 6;
    row(kind === 'receipt' ? 'Amount paid' : 'Total', money(i.total, i.currency), true);
    if (kind === 'receipt') {
      pdf.font('Helvetica').fontSize(9).fillColor('#198038').text(`Paid in full on ${date(i.paidAt)}. Thank you.`, left, y + 8, { width, align: 'right' });
    } else if (i.status === 'open') {
      pdf.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Payment is due by ${date(i.dueAt)}. Quote ${i.number} when you pay.`, left, y + 8, { width, align: 'right' });
    }
    pdf.font('Helvetica').fontSize(8).fillColor(MUTED).text('Grids Platform', left, pdf.page.height - 70, { width, align: 'center' });
    pdf.end();
  });
}
