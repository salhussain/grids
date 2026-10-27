import PDFDocument from 'pdfkit';

/** What a receipt says. Money is in minor units. What Grids charges the organisation is not the payer's business and is not here. */
export interface ReceiptData {
  organisation: string;
  number: string;
  paidAt: Date;
  description: string;
  form: string;
  payerEmail: string | null;
  method: string | null;
  amount: number;
  surcharge: number;
  currency: string;
  paymentId: string;
}

const money = (minor: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
};

/** One receipt as a PDF (A4, one page). */
export function renderReceipt(r: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Receipt ${r.number}`, Author: r.organisation } });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const left = pdf.page.margins.left;
    const width = pdf.page.width - left - pdf.page.margins.right;
    const grey = '#667085';

    pdf.fillColor('#14181f').font('Helvetica-Bold').fontSize(20).text(r.organisation, left, 56, { width });
    pdf.moveDown(0.3).font('Helvetica').fontSize(11).fillColor(grey).text('Payment receipt');
    pdf.fontSize(11).fillColor('#14181f').font('Helvetica-Bold').text(r.number, left, 56, { width, align: 'right' });
    pdf.font('Helvetica').fillColor(grey).text(r.paidAt.toISOString().slice(0, 10), left, 72, { width, align: 'right' });

    pdf.moveTo(left, 130).lineTo(left + width, 130).strokeColor('#e1e5ea').stroke();

    let y = 150;
    const row = (label: string, value: string, bold = false) => {
      pdf.font('Helvetica').fontSize(10).fillColor(grey).text(label, left, y, { width: 140 });
      pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 13 : 11).fillColor('#14181f').text(value, left + 150, y - (bold ? 1 : 0), { width: width - 150 });
      y = Math.max(y + (bold ? 24 : 20), pdf.y + 8);
    };
    row('Received from', r.payerEmail ?? 'Not given');
    row('For', r.description || r.form);
    row('Form', r.form);
    row('Paid with', r.method ?? 'Not recorded');
    row('Date', r.paidAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
    y += 8;
    pdf.moveTo(left, y).lineTo(left + width, y).strokeColor('#e1e5ea').stroke();
    y += 14;
    row('Amount', money(r.amount, r.currency));
    if (r.surcharge > 0) row('Payment method charge', money(r.surcharge, r.currency));
    row('Total paid', money(r.amount + r.surcharge, r.currency), true);

    pdf.font('Helvetica').fontSize(9).fillColor(grey).text(`Payment reference ${r.paymentId}`, left, pdf.page.height - 90, { width });
    pdf.text('This receipt confirms the payment above was received.', left, pdf.page.height - 76, { width });
    pdf.end();
  });
}

// ---------------------------------------------------------------- ZIP (stored, no compression: a PDF barely shrinks)

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A ZIP file holding these files. Names must be unique and plain (no folders). */
export function zipFiles(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x0800, 6); // names are UTF-8
    head.writeUInt16LE(0, 8); // stored
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(f.data.length, 18);
    head.writeUInt32LE(f.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    parts.push(head, name, f.data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(f.data.length, 20);
    entry.writeUInt32LE(f.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += head.length + name.length + f.data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
