import type { ActivitySummaryDto } from '@grids/schema';
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_LABEL } from '@grids/schema';

const FONT = "'IBM Plex Sans', system-ui, sans-serif";

/** Hands a file to the browser's download. */
export function saveFile(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
/** A spreadsheet-ready CSV (with the mark Excel needs to read accents). */
export function saveCsv(name: string, head: string[], rows: (string | number)[][]) {
  const text = [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  saveFile(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
}

export const daysCsv = (days: ActivitySummaryDto['days']) => ({
  head: ['Day', 'Total', ...AUDIT_CATEGORIES.map((c) => AUDIT_CATEGORY_LABEL[c])],
  rows: days.map((d) => [d.day, d.total, ...AUDIT_CATEGORIES.map((c) => d.byCategory[c] ?? 0)]),
});

/** A nice top for an axis. */
export const niceMax = (n: number) => {
  if (n <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= n) ?? n;
};

function canvas(w: number, h: number, title: string, subtitle: string) {
  const c = document.createElement('canvas');
  c.width = w * 2;
  c.height = h * 2;
  const g = c.getContext('2d')!;
  g.scale(2, 2);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#16181d';
  g.font = `600 22px ${FONT}`;
  g.fillText(title, 32, 48);
  g.fillStyle = '#5e6470';
  g.font = `14px ${FONT}`;
  g.fillText(subtitle, 32, 72);
  return { c, g };
}
const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('The picture could not be made'))), 'image/png'));

/** The daily bars as a picture, in the project's colour. */
export async function daysPng(days: ActivitySummaryDto['days'], title: string, subtitle: string, accent: string): Promise<Blob> {
  const W = 1000;
  const H = 520;
  const { c, g } = canvas(W, H, title, subtitle);
  const top = niceMax(Math.max(1, ...days.map((d) => d.total)));
  const [x0, y0, x1, y1] = [86, 100, W - 32, H - 80];
  g.strokeStyle = '#e3e5ea';
  g.fillStyle = '#8b919c';
  g.font = `12px ${FONT}`;
  g.textAlign = 'right';
  for (const f of [0, 0.5, 1]) {
    const y = y1 - (y1 - y0) * f;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    g.fillText(String(top * f), x0 - 8, y + 4);
  }
  g.save();
  g.translate(24, (y0 + y1) / 2);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.fillText('Events per day', 0, 0);
  g.restore();
  const slot = (x1 - x0) / days.length;
  const step = Math.ceil(days.length / 14);
  g.fillStyle = accent;
  days.forEach((d, i) => {
    const h = (d.total / top) * (y1 - y0);
    g.globalAlpha = d.total ? 1 : 0.15;
    g.fillRect(x0 + i * slot + slot * 0.15, y1 - Math.max(h, d.total ? 3 : 2), slot * 0.7, Math.max(h, d.total ? 3 : 2));
  });
  g.globalAlpha = 1;
  g.fillStyle = '#8b919c';
  g.textAlign = 'center';
  days.forEach((d, i) => {
    if (i % step && i !== days.length - 1) return;
    const dt = new Date(`${d.day}T00:00`);
    g.fillText(dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), x0 + i * slot + slot / 2, y1 + 20);
  });
  g.fillText('Day', (x0 + x1) / 2, y1 + 48);
  return toBlob(c);
}

/** A ranked list as a picture, in the project's colour. */
export async function listPng(rows: { label: string; count: number }[], title: string, subtitle: string, accent: string): Promise<Blob> {
  const W = 800;
  const rowH = 44;
  const H = 110 + Math.max(1, rows.length) * rowH + 24;
  const { c, g } = canvas(W, H, title, subtitle);
  const top = Math.max(1, ...rows.map((r) => r.count));
  rows.forEach((r, i) => {
    const y = 110 + i * rowH;
    g.fillStyle = '#16181d';
    g.font = `14px ${FONT}`;
    g.textAlign = 'left';
    g.fillText(r.label.length > 60 ? `${r.label.slice(0, 59)}…` : r.label, 32, y);
    g.textAlign = 'right';
    g.fillStyle = '#5e6470';
    g.fillText(r.count.toLocaleString(), W - 32, y);
    g.fillStyle = '#eef0f3';
    g.fillRect(32, y + 8, W - 64, 6);
    g.fillStyle = accent;
    g.fillRect(32, y + 8, ((W - 64) * r.count) / top, 6);
  });
  return toBlob(c);
}

/** One or more readings over time as lines, with a key when there are several. */
export async function linesPng(series: { name: string; color: string; points: { at: string; value: number }[] }[], title: string, subtitle: string, yLabel: string): Promise<Blob> {
  const W = 1000;
  const H = 540;
  const { c, g } = canvas(W, H, title, subtitle);
  const all = series.flatMap((s) => s.points);
  const [x0, y0, x1, y1] = [86, series.length > 1 ? 120 : 100, W - 40, H - 80];
  const times = all.map((p) => new Date(p.at).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times, t0 + 1);
  const top = niceMax(Math.max(1, ...all.map((p) => p.value)));
  g.strokeStyle = '#e3e5ea';
  g.fillStyle = '#8b919c';
  g.font = `12px ${FONT}`;
  g.textAlign = 'right';
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const y = y1 - (y1 - y0) * f;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    g.fillText(String(Math.round(top * f * 100) / 100), x0 - 8, y + 4);
  }
  g.save();
  g.translate(24, (y0 + y1) / 2);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.fillText(yLabel, 0, 0);
  g.restore();
  const px = (t: number) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
  const py = (v: number) => y1 - (v / top) * (y1 - y0);
  for (const s of series) {
    g.strokeStyle = s.color;
    g.lineWidth = 2.5;
    g.beginPath();
    s.points.forEach((p, i) => (i ? g.lineTo(px(new Date(p.at).getTime()), py(p.value)) : g.moveTo(px(new Date(p.at).getTime()), py(p.value))));
    g.stroke();
    if (s.points.length <= 60) {
      g.fillStyle = '#ffffff';
      for (const p of s.points) {
        g.beginPath();
        g.arc(px(new Date(p.at).getTime()), py(p.value), 4, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
  }
  g.lineWidth = 1;
  g.fillStyle = '#8b919c';
  g.textAlign = 'center';
  g.font = `12px ${FONT}`;
  for (let i = 0; i <= 5; i++) {
    const t = t0 + ((t1 - t0) * i) / 5;
    g.fillText(new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' }), px(t), y1 + 20);
  }
  g.fillText('Date', (x0 + x1) / 2, y1 + 48);
  if (series.length > 1) {
    let x = x0;
    g.textAlign = 'left';
    g.font = `13px ${FONT}`;
    for (const s of series) {
      g.fillStyle = s.color;
      g.fillRect(x, 92, 12, 12);
      g.fillStyle = '#16181d';
      g.fillText(s.name, x + 18, 103);
      x += 40 + g.measureText(s.name).width;
    }
  }
  return toBlob(c);
}
