import {
  buildDocument,
  buildRecord,
  documentToHtmlParts,
  renderBlocks,
  lintDocument,
  recordMarkdown,
} from '@grids/forms';
import {
  DocumentTemplate,
  SUBMISSION_FIELDS,
  SUBMISSION_RECORD,
  SUBMISSION_RECORD_ID,
  type DocumentDesign,
  type FormDefinition,
  type PlacedField,
  type DocumentVisibility,
  RecordOptions,
  RECORD_FOOTER_ITEMS,
  type RecordFooterItem,
  RECORD_FOOTER_LABEL,
} from '@grids/schema';
import { Button, Dialog, Field, Input, Listbox, confirmDialog, cx, useToast } from '@grids/ui';
import { usePermissionGroups } from './permissions';
import { DocumentHistory } from './DocumentHistory';
import { useQueryClient } from '@tanstack/react-query';
import { AttachmentImage } from './FormInputs';
import { ChoiceCards } from './fields';
import { PictureDrop } from './PictureDrop';
import { ToggleLine } from './PanelCard';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  File,
  Globe,
  History,
  Mail,
  Lock,
  Upload,
  Download,
  Save,
  Send,
  FileDown,
  Files,
  CalendarClock,
  Check,
  FileText,
  FolderOpen,
  GripVertical,
  Hash,
  Image as ImageIcon,
  Layers,
  Minus,
  Pencil,
  Printer,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Plus,
  Repeat,
  Table2,
  Trash2,
  UserRound,
  Type,
  Variable,
  type LucideIcon,
  ShieldCheck,
} from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api';
import type { Draft } from './FormBuilder';
import { answerOption } from './RichText';
import { PlacedAnswerDialog, kindOfAnswer } from './PlacedAnswerDialog';
import { Slider } from './Slider';
import { useProject } from './context';

/** The three levels of who may use a document. */
const VISIBILITY: Record<DocumentVisibility, { label: string; text: string; icon: LucideIcon }> = {
  internal: {
    label: 'Restricted',
    text: 'Managers, and the permissions you choose. Never sent out.',
    icon: Lock,
  },
  email: {
    label: 'Emailable',
    text: 'Managers and chosen permissions; can be attached to workflow emails.',
    icon: Mail,
  },
  public: { label: 'Public', text: 'Also open to anyone who can see the submission.', icon: Globe },
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'd_$1')
    .slice(0, 40) || 'document';

/** Hands a file to the browser to save. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Made-up answers, to see a document filled in: one value per question, and two rows for a repeating section. */
function sampleValues(def: FormDefinition): {
  values: Record<string, unknown>;
  names: Record<string, string>;
} {
  const names: Record<string, string> = {};
  const one = (q: FormDefinition['sections'][number]['questions'][number], n: number): unknown => {
    switch (q.type) {
      case 'integer':
        return 10 + n;
      case 'decimal':
        return 12.5 + n;
      case 'boolean':
        return n % 2 === 0;
      case 'select':
        return q.options?.[0]?.value;
      case 'multiselect':
        return q.options?.slice(0, 2).map((o) => o.value);
      case 'date':
        return '2026-03-04';
      case 'datetime':
        return '2026-03-04T10:00:00Z';
      case 'time':
        return '09:30';
      case 'phone':
        return '+685 123 4567';
      case 'email':
        return 'name@example.org';
      case 'url':
        return 'https://example.org';
      case 'rating':
        return Math.min(4, q.max ?? 5);
      case 'geopoint':
        return { lat: -13.83, lon: -171.76 };
      case 'entity': {
        const id = `00000000-0000-4000-8000-00000000000${n}`;
        names[id] = 'Sample place';
        return id;
      }
      case 'note':
      case 'image':
      case 'file':
      case 'signature':
        return undefined;
      default:
        return n ? `Sample text ${n + 1}` : 'Sample text';
    }
  };
  const values: Record<string, unknown> = {};
  for (const s of def.sections) {
    if (s.repeat)
      values[s.key] = [0, 1].map((n) =>
        Object.fromEntries(
          s.questions.map((q) => [q.key, one(q, n)]).filter(([, v]) => v !== undefined),
        ),
      );
    else for (const q of s.questions) if (one(q, 0) !== undefined) values[q.key] = one(q, 0);
  }
  return { values, names };
}

const SAMPLE_DETAILS: Record<string, string> = {
  _submitted_at: '4 Mar 2026, 10:00',
  _submitted_by: 'Ana Smith',
  _submitted_by_email: 'ana@example.org',
  _collected_at: '4 Mar 2026, 09:40',
  _decided_at: '5 Mar 2026, 14:15',
  _status: 'Approved',
  _submission_id: '0190c1a0-0000-7000-8000-000000000001',
  _form_name: 'Your form',
  _project_name: 'Your project',
  _today: '6 Mar 2026',
  _printed_at: '6 Mar 2026, 09:15',
};

const STARTER =
  '# ${_form_name}\n\nSubmitted on ${_submitted_at} by ${_submitted_by}.\n\nWrite your document here. Put answers in with Insert answer.';

/** Folds a group of settings away until it is needed; says what is inside while it is closed. */
function Fold({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary?: ReactNode;
  open: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  return (
    <div className="border border-zinc-200 bg-snow [&+&]:-mt-px">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-11 w-full items-center gap-2.5 px-3.5 text-start text-sm font-medium"
      >
        <ChevronRight
          className={cx('size-4 shrink-0 text-zinc-400 transition-transform', open && 'rotate-90')}
        />
        {title}
        {summary && (
          <span className="ms-auto min-w-0 truncate pe-1 text-[13px] font-normal text-zinc-500">
            {summary}
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-4 border-t border-zinc-100 px-3.5 pt-4 pb-4">{children}</div>
      )}
    </div>
  );
}

/** A small drawn sheet of paper, for the pictures on the option cards. */
const Sheet = ({ children, land }: { children: ReactNode; land?: boolean }) => (
  <div
    className={cx(
      'relative overflow-hidden bg-white shadow-sm ring-1 ring-zinc-300',
      land ? 'h-14 w-20' : 'h-[4.5rem] w-[3.25rem]',
    )}
  >
    {children}
  </div>
);
const Ln = ({ w = 'w-full', dark }: { w?: string; dark?: boolean }) => (
  <i className={cx('block h-[3px]', w, dark ? 'bg-zinc-500' : 'bg-zinc-300')} />
);
const Lines = () => (
  <div className="flex flex-col gap-1 p-1.5">
    <Ln w="w-2/3" dark />
    <Ln />
    <Ln />
    <Ln w="w-4/5" />
    <Ln />
    <Ln w="w-1/2" />
  </div>
);
const ART = {
  flow: (
    <Sheet>
      <Lines />
    </Sheet>
  ),
  placed: (
    <Sheet>
      <div className="absolute inset-1 border border-zinc-300" />
      <i className="absolute top-3 left-2 h-1.5 w-6 border border-dashed border-accent-600 bg-accent-100" />
      <i className="absolute top-7 right-2 h-1.5 w-5 border border-dashed border-accent-600 bg-accent-100" />
      <i className="absolute bottom-3 left-3 h-1.5 w-7 border border-dashed border-accent-600 bg-accent-100" />
    </Sheet>
  ),
  table: (
    <Sheet>
      <div className="flex flex-col gap-1 p-1.5">
        <Ln w="w-2/3" dark />
        <div className="grid grid-cols-2 border border-zinc-300 [&>i]:h-[7px] [&>i]:border-b [&>i]:border-zinc-300 [&>i:nth-child(odd)]:border-e">
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
        <Ln w="w-1/2" dark />
        <div className="grid grid-cols-2 border border-zinc-300 [&>i]:h-[7px] [&>i]:border-b [&>i]:border-zinc-300 [&>i:nth-child(odd)]:border-e">
          {Array.from({ length: 4 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      </div>
    </Sheet>
  ),
  form: (
    <Sheet>
      <div className="flex flex-col gap-1 p-1">
        <i className="block h-2.5 bg-accent-600" />
        {[0, 1, 2].map((n) => (
          <div key={n} className="flex flex-col gap-[2px]">
            <Ln w="w-1/3" dark />
            <i className="block h-2 border border-zinc-300 bg-accent-50" />
          </div>
        ))}
      </div>
    </Sheet>
  ),
  wmNone: (
    <Sheet>
      <Lines />
    </Sheet>
  ),
  wmText: (
    <Sheet>
      <Lines />
      <span className="absolute inset-0 flex -rotate-[35deg] items-center justify-center text-[11px] font-bold text-zinc-400/60">
        DRAFT
      </span>
    </Sheet>
  ),
  wmImage: (
    <Sheet>
      <Lines />
      <i className="absolute inset-0 m-auto size-8 rounded-full bg-zinc-300/60" />
      <i className="absolute right-3 bottom-4 size-3 rounded-full bg-zinc-300/60" />
    </Sheet>
  ),
};

/** Option cards with a small drawing of each: for the choices that change how the whole page looks. */
function ArtCards<T extends string>({
  label,
  intro,
  value,
  onChange,
  options,
}: {
  label: string;
  intro?: string;
  value: T;
  onChange(v: T): void;
  options: Record<T, { label: string; text: string; art: ReactNode }>;
}) {
  const entries = Object.entries(options) as [T, { label: string; text: string; art: ReactNode }][];
  return (
    <fieldset>
      <legend className="mb-1 text-[13px] font-medium text-zinc-700">{label}</legend>
      {intro && <p className="mb-2 text-xs text-zinc-500">{intro}</p>}
      <div
        role="radiogroup"
        aria-label={label}
        className="grid gap-2.5"
        style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}
      >
        {entries.map(([k, o]) => {
          const on = value === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(k)}
              className={cx(
                'flex flex-col overflow-hidden border text-start transition',
                on
                  ? 'border-accent-600 shadow-[inset_0_-2px_0_var(--brand-600)]'
                  : 'border-zinc-300 hover:border-zinc-500',
              )}
            >
              <div
                className={cx(
                  'flex h-24 items-center justify-center',
                  on ? 'bg-accent-50' : 'bg-zinc-100',
                )}
              >
                {o.art}
              </div>
              <div className="p-2.5">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  {on && <CheckCircle2 className="size-4 text-accent-600" />}
                  {o.label}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{o.text}</p>
              </div>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const PAPER_MM = { a4: [210, 297], letter: [215.9, 279.4] } as const;

const FOOTER_ICON: Record<RecordFooterItem, typeof Hash> = {
  submission_id: Hash,
  submitted_at: CalendarClock,
  submitted_by: UserRound,
  printed_at: Printer,
  project: FolderOpen,
  form: FileText,
};

/** The document as pages: the text is measured at the page's width and broken between blocks where a page is full. */
function PagedPreview({
  t,
  design,
  parts,
  projectKey,
  tenantId,
}: {
  t: Pick<DocumentTemplate, 'paper' | 'orientation'>;
  design: DocumentDesign;
  parts: ReturnType<typeof documentToHtmlParts>;
  projectKey: string;
  tenantId: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const meas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pages, setPages] = useState<number[][]>([]);
  const [pw, ph] = PAPER_MM[t.paper];
  const [w, h] = t.orientation === 'landscape' ? [ph, pw] : [pw, ph];
  const landscape = t.orientation === 'landscape';
  const pageW = Math.min(width, (landscape ? 42 : 34) * 16);
  const pageH = (pageW * h) / w;
  const PAD = 32;
  const reserve = (first: boolean) =>
    design.logo.image && (first || design.logo.pages === 'all') ? pageH * 0.12 : 0;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const m = meas.current;
    if (!m || !pageW) return;
    const kids = Array.from(m.querySelectorAll<HTMLElement>('[data-b]'));
    const head = m.querySelector<HTMLElement>('[data-h]')?.offsetHeight ?? 0;
    const foot = (m.querySelector<HTMLElement>('[data-f]')?.offsetHeight ?? 0) + 24;
    const heads = new Map<number, number>();
    m.querySelectorAll<HTMLElement>('[data-hd]').forEach((el) =>
      heads.set(Number(el.dataset.hd), el.offsetHeight),
    );
    const out: number[][] = [[]];
    let used = 0;
    kids.forEach((k, i) => {
      const t = parts.blocks[i]?.table;
      const cur = out[out.length - 1]!;
      const continues =
        !!t && cur.length > 0 && parts.blocks[cur[cur.length - 1]!]?.table?.id === t.id;
      // The first row of a table on a page brings the table's heading row with it.
      const hh = k.offsetHeight + (t && !continues ? (heads.get(t.id) ?? 0) : 0);
      const room = pageH - PAD * 2 - head - foot - reserve(out.length === 1);
      if (used + hh > room && cur.length) {
        out.push([]);
        used = 0;
        used += k.offsetHeight + (t ? (heads.get(t.id) ?? 0) : 0);
      } else used += hh;
      out[out.length - 1]!.push(i);
    });
    setPages(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, pageW, pageH, design.logo.image, design.logo.pages]);

  const list = pages.length ? pages : [parts.blocks.map((_, i) => i)];
  return (
    <div ref={wrap} className="relative">
      {/* Hidden copy, at the page's width, to measure each block. */}
      <div
        ref={meas}
        aria-hidden
        className="pointer-events-none invisible absolute -z-10 text-[13px] leading-relaxed"
        style={{ width: Math.max(0, pageW - PAD * 2) }}
      >
        <div data-h dangerouslySetInnerHTML={{ __html: parts.header }} />
        {parts.blocks.map((b, i) => (
          <div key={i}>
            <div
              data-b
              style={{ display: 'flow-root' }}
              dangerouslySetInnerHTML={{
                __html: b.table
                  ? `<table style="border-collapse:collapse;width:100%">${b.html}</table>`
                  : b.html,
              }}
            />
            {b.table && parts.blocks.findIndex((x) => x.table?.id === b.table!.id) === i && (
              <div
                data-hd={b.table.id}
                style={{ display: 'flow-root' }}
                dangerouslySetInnerHTML={{
                  __html: `<table style="border-collapse:collapse;width:100%">${b.table.head}</table>`,
                }}
              />
            )}
          </div>
        ))}
        <div data-f dangerouslySetInnerHTML={{ __html: parts.footer }} />
      </div>
      <div className="space-y-4">
        {list.map((idx, n) => (
          <div key={n}>
            <Paper
              t={t}
              design={{ ...design, logo: { ...design.logo, image: null } }}
              projectKey={projectKey}
              tenantId={tenantId}
            >
              <div
                className="flex flex-col text-[13px] leading-relaxed text-zinc-900"
                style={{ height: pageH, padding: PAD }}
              >
                {design.logo.image && (n === 0 || design.logo.pages === 'all') && (
                  <div
                    className="shrink-0"
                    style={{ textAlign: design.logo.align, height: pageH * 0.12 }}
                  >
                    <AttachmentImage
                      tenantId={tenantId}
                      project={projectKey}
                      id={design.logo.image}
                      className="inline-block h-auto object-contain"
                      style={{ width: (design.logo.width / w) * pageW, maxHeight: pageH * 0.11 }}
                    />
                  </div>
                )}
                <div dangerouslySetInnerHTML={{ __html: parts.header }} />
                <div
                  className="min-h-0 flex-1 overflow-hidden"
                  dangerouslySetInnerHTML={{
                    // `pages` can briefly describe the previous document (before it is measured again).
                    __html: renderBlocks(
                      idx.flatMap((i) => (parts.blocks[i] ? [parts.blocks[i]!] : [])),
                    ),
                  }}
                />
                {(parts.footer || parts.pageNumbers) && (
                  <div className="mt-3 flex items-end justify-between gap-3 border-t border-zinc-200 pt-1.5 text-xs text-zinc-500">
                    <div dangerouslySetInnerHTML={{ __html: parts.footer }} />
                    {parts.pageNumbers && (
                      <span className="shrink-0">
                        Page {n + 1} of {list.length}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </Paper>
            <p className="mt-1 text-center text-[11px] text-zinc-500">
              {list.length > 1 ? `Page ${n + 1} of ${list.length}` : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The paper with what is behind the words: the picture, the watermark and the logo. `children` is what is written on it. */
function Paper({
  t,
  design,
  children,
  projectKey,
  tenantId,
  minHeight,
}: {
  t: Pick<DocumentTemplate, 'paper' | 'orientation'>;
  design: DocumentDesign;
  children: ReactNode;
  projectKey: string;
  tenantId: string;
  minHeight?: string;
}) {
  const [pw, ph] = PAPER_MM[t.paper];
  const [w, h] = t.orientation === 'landscape' ? [ph, pw] : [pw, ph];
  const wm = design.watermark;
  const logo = design.logo;
  return (
    <div
      className="relative mx-auto overflow-hidden bg-white shadow"
      style={{
        maxWidth: t.orientation === 'landscape' ? '42rem' : '34rem',
        aspectRatio: minHeight ? undefined : `${w} / ${h}`,
        minHeight,
        containerType: 'inline-size',
      }}
    >
      {design.background.image && (
        <AttachmentImage
          tenantId={tenantId}
          project={projectKey}
          id={design.background.image}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {wm.kind === 'text' && wm.text.trim() && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
        >
          <span
            className="font-bold whitespace-nowrap text-black"
            style={{
              opacity: wm.opacity / 100,
              transform: `rotate(${wm.angle}deg)`,
              fontSize: `${Math.min(26, 150 / Math.max(4, wm.text.trim().length))}cqw`,
            }}
          >
            {wm.text.trim()}
          </span>
        </div>
      )}
      {wm.kind === 'image' && wm.image && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <AttachmentImage
            tenantId={tenantId}
            project={projectKey}
            id={wm.image}
            className="max-h-[60%] max-w-[60%] object-contain"
            style={{ opacity: wm.opacity / 100 }}
          />
        </div>
      )}
      <div className="relative">
        {logo.image && (
          <div className="px-[6%] pt-[4%]" style={{ textAlign: logo.align }}>
            <AttachmentImage
              tenantId={tenantId}
              project={projectKey}
              id={logo.image}
              className="inline-block h-auto object-contain"
              style={{ width: `${(logo.width / w) * 100}%`, maxHeight: '14%' }}
            />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** The page with each answer where it is put: drag one to move it, or pick it in the list to change how it looks. */
function PagePlacer({
  t,
  design,
  texts,
  isPicture,
  labelOf,
  fields,
  selected,
  onSelect,
  onMove,
  onResize,
  projectKey,
  tenantId,
}: {
  t: Pick<DocumentTemplate, 'paper' | 'orientation'>;
  design: DocumentDesign;
  texts: Map<string, string>;
  isPicture(key: string): boolean;
  /** The question's name, shown above its box. */
  labelOf(key: string): string;
  fields: PlacedField[];
  selected: string | null;
  onSelect(id: string | null): void;
  onMove(id: string, x: number, y: number): void;
  /** Drag a handle of the selected answer: its width, or the size of its text. */
  onResize(id: string, patch: { width?: number; size?: number }): void;
  projectKey: string;
  tenantId: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: string;
    dx: number;
    dy: number;
    mode: 'move' | 'width' | 'size';
    size: number;
    y0: number;
  } | null>(null);
  const [pw, ph] = PAPER_MM[t.paper];
  const [w, h] = t.orientation === 'landscape' ? [ph, pw] : [pw, ph];
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  };
  const grab = (e: React.PointerEvent, f: PlacedField, mode: 'width' | 'size') => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = at(e);
    drag.current = { id: f.id, dx: 0, dy: 0, mode, size: f.size, y0: p.y };
  };
  return (
    <div
      className="mx-auto"
      style={{ maxWidth: t.orientation === 'landscape' ? '42rem' : '34rem' }}
    >
      <div
        ref={box}
        className="relative overflow-hidden bg-white shadow"
        style={{ aspectRatio: `${w} / ${h}`, containerType: 'inline-size', touchAction: 'none' }}
        onPointerDown={(e) => e.target === e.currentTarget && onSelect(null)}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const p = at(e);
          const f = fields.find((x) => x.id === drag.current!.id);
          if (!f) return;
          if (drag.current.mode === 'width')
            onResize(f.id, {
              width: Math.round(Math.max(5, Math.min(100 - f.x, p.x - f.x)) * 10) / 10,
            });
          else if (drag.current.mode === 'size')
            onResize(f.id, {
              size: Math.round(
                Math.max(
                  6,
                  Math.min(72, drag.current.size + ((p.y - drag.current.y0) / 100) * h * 2.8346),
                ),
              ),
            });
          else
            onMove(
              f.id,
              Math.max(0, Math.min(100 - Math.min(f.width, 100), p.x - drag.current.dx)),
              Math.max(0, Math.min(97, p.y - drag.current.dy)),
            );
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {design.background.image ? (
          <AttachmentImage
            tenantId={tenantId}
            project={projectKey}
            id={design.background.image}
            className="pointer-events-none absolute inset-0 size-full object-cover"
          />
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-xs text-zinc-400">
            Choose a background picture, such as your pre-printed form, then drag each answer to
            where it belongs.
          </div>
        )}
        {fields.map((f) => (
          <div
            key={f.id}
            role="button"
            tabIndex={0}
            aria-label={`Move ${texts.get(f.id) || f.key}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              const p = at(e);
              drag.current = {
                id: f.id,
                dx: p.x - f.x,
                dy: p.y - f.y,
                mode: 'move',
                size: f.size,
                y0: p.y,
              };
              onSelect(f.id);
            }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 2 : 0.5;
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                onMove(f.id, Math.max(0, f.x - step), f.y);
              }
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                onMove(f.id, Math.min(100 - f.width, f.x + step), f.y);
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                onMove(f.id, f.x, Math.max(0, f.y - step));
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                onMove(f.id, f.x, Math.min(97, f.y + step));
              }
            }}
            className={cx(
              'absolute cursor-move overflow-hidden px-0.5 leading-tight text-zinc-900 outline-1 outline-dashed',
              f.id === selected
                ? 'bg-accent-100/70 outline-accent-600'
                : 'bg-white/40 outline-zinc-400 hover:bg-accent-50/70',
            )}
            style={{
              left: `${f.x}%`,
              top: `${f.y}%`,
              width: `${f.width}%`,
              ...(isPicture(f.key) && { height: `${((f.size * 3) / (h * 2.8346)) * 100}%` }),
              fontSize: `${(f.size / (w * 2.8346)) * 100}cqw`,
              fontWeight: f.bold ? 700 : 400,
              textAlign: f.align,
            }}
          >
            {isPicture(f.key) ? (
              <span className="flex h-full items-center justify-center gap-1 bg-zinc-200/70 text-zinc-500">
                <ImageIcon className="size-4" aria-hidden />
              </span>
            ) : (
              texts.get(f.id) || f.key
            )}
            {f.id === selected && (
              <>
                <span
                  aria-hidden
                  title="Drag to change the width"
                  onPointerDown={(e) => grab(e, f, 'width')}
                  className="absolute inset-y-0 end-0 w-1.5 cursor-ew-resize bg-accent-600"
                />
                <span
                  aria-hidden
                  title="Drag to change the text size"
                  onPointerDown={(e) => grab(e, f, 'size')}
                  className="absolute end-0 bottom-0 size-2.5 cursor-nwse-resize bg-accent-600"
                />
              </>
            )}
          </div>
        ))}
        {fields.map((f) => (
          <span
            key={`${f.id}-label`}
            aria-hidden
            className={cx(
              'pointer-events-none absolute z-10 max-w-[40%] -translate-y-full truncate px-1 text-[9px] leading-[14px] font-medium',
              f.id === selected ? 'bg-accent-600 text-on-accent' : 'bg-zinc-800/80 text-white',
            )}
            style={{ left: `${f.x}%`, top: `${f.y}%` }}
          >
            {labelOf(f.key)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Documents made from a submission: a notice, a letter, a certificate. Every form starts with the Submission
 * record, which lists all its questions and answers and follows the form by itself. The others are written once,
 * here, with the answers placed in them (flowing as text, or each put where it belongs on a picture such as a
 * pre-printed form), and made as a PDF or Word file for any submission: from the submission itself, or as the
 * attachment of an email in the workflow.
 */
export function DocumentsPanel({
  draft,
  set,
  formKey,
}: {
  draft: Draft;
  set(p: Partial<Draft>): void;
  formKey: string;
}) {
  const { tenantId, project } = useProject();
  const toast = useToast();
  const qc = useQueryClient();
  // Edits wait in the draft until published; people and emails use the published ones.
  const pending = draft.settings.documentDraft;
  const docs = pending?.documents ?? draft.settings.documents ?? [];
  const [pick, setPick] = useState<string>(SUBMISSION_RECORD_ID);
  const [busy, setBusy] = useState<'pdf' | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({
    details: true,
    contents: true,
    text: true,
    look: true,
    fields: true,
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ field: PlacedField; isNew: boolean } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // Which page of a multi-page document is on show, and whether each page has its own background.
  const [pageNo, setPageNo] = useState(1);
  const [diffPages, setDiffPages] = useState(false);
  const body = useRef<HTMLTextAreaElement>(null);
  const isRecord = pick === SUBMISSION_RECORD_ID || !docs.some((d) => d.id === pick);
  const t: DocumentTemplate = isRecord ? SUBMISSION_RECORD : docs.find((d) => d.id === pick)!;
  const def = draft.def;
  const record = pending?.record ?? draft.settings.record;
  const design = isRecord ? record.design : t.design;
  const placed = !isRecord && t.mode === 'placed';
  const accent = def.look?.accent ?? project.color;
  const setDocs = (next: DocumentTemplate[]) =>
    set({ settings: { ...draft.settings, documentDraft: { documents: next, record } } });
  const groups = usePermissionGroups();
  const update = (patch: Partial<DocumentTemplate>) =>
    !isRecord && setDocs(docs.map((d) => (d.id === t.id ? { ...d, ...patch } : d)));
  const setRecord = (patch: Partial<typeof record>) =>
    set({
      settings: {
        ...draft.settings,
        documentDraft: { documents: docs, record: { ...record, ...patch } },
      },
    });
  const published = draft.settings.documents ?? [];
  const stateOf = (id: string) =>
    id === SUBMISSION_RECORD_ID
      ? JSON.stringify(record)
      : JSON.stringify(docs.find((d) => d.id === id) ?? null);
  const liveOf = (id: string) =>
    id === SUBMISSION_RECORD_ID
      ? JSON.stringify(draft.settings.record)
      : JSON.stringify(published.find((d) => d.id === id) ?? null);
  const unpublishedIds = [
    SUBMISSION_RECORD_ID,
    ...docs.map((d) => d.id),
    ...published.map((d) => d.id),
  ]
    .filter((id, i, all) => all.indexOf(id) === i)
    .filter((id) => stateOf(id) !== liveOf(id));
  // What was last kept in the document's history, to tell the person when there is more to save.
  const [kept, setKept] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [SUBMISSION_RECORD_ID, ...docs.map((d) => d.id)].map((id) => [id, stateOf(id)]),
    ),
  );
  const [working, setWorking] = useState<'save' | 'publish' | 'discard' | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const importer = useRef<HTMLInputElement>(null);
  const run = async (what: NonNullable<typeof working>, job: () => Promise<void>) => {
    setWorking(what);
    try {
      await job();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setWorking(null);
    }
  };
  const keep = (
    documentId: string,
    next = { documents: docs, record },
    action: 'saved' | 'restored' = 'saved',
  ) =>
    api.saveDocumentDraft(tenantId, project.key, formKey, {
      documents: next.documents,
      record: next.record,
      documentId,
      action,
    });
  const setDesign = (patch: Partial<DocumentDesign>) =>
    isRecord
      ? setRecord({ design: { ...design, ...patch } })
      : update({ design: { ...design, ...patch } });
  const sample = useMemo(() => sampleValues(def), [def]);
  // The record's sample leaves a question in every few unanswered, so what "Include unanswered questions" does shows.
  const recordSample = useMemo(() => {
    const values = { ...sample.values };
    def.sections
      .filter((s) => !s.repeat)
      .flatMap((s) => s.questions)
      .filter((q) => q.type !== 'note')
      .forEach((q, i) => i % 4 === 3 && delete values[q.key]);
    return values;
  }, [def, sample]);
  const questions = def.sections.flatMap((s) => s.questions).filter((q) => q.type !== 'note');
  const problems = useMemo(() => (isRecord ? [] : lintDocument(t, def)), [isRecord, t, def]);
  const details = useMemo(() => ({ ...SAMPLE_DETAILS, _form_name: def.title }), [def.title]);
  const built = useMemo(
    () =>
      isRecord
        ? buildRecord(def, { values: recordSample, details, names: sample.names, accent }, record)
        : buildDocument(t, def, { values: sample.values, details, names: sample.names, accent }),
    [isRecord, t, def, details, sample, recordSample, record, accent],
  );
  const parts = useMemo(() => documentToHtmlParts(built), [built]);
  const texts = useMemo(
    () => new Map(built.placed.map((f) => [f.id, f.runs.map((r) => r.text).join('')])),
    [built],
  );

  const add = (init?: Partial<DocumentTemplate>) => {
    let id = 'document';
    for (let n = 2; docs.some((d) => d.id === id) || id === SUBMISSION_RECORD_ID; n++)
      id = `document_${n}`;
    setDocs([
      ...docs,
      DocumentTemplate.parse({
        name: 'New document',
        body: STARTER,
        visibility: 'internal',
        formats: ['pdf'],
        ...init,
        id,
      }),
    ]);
    setPick(id);
    setOpen({ details: true, text: true, look: true, fields: true });
  };
  const duplicateRecord = () =>
    add({
      name: 'Submission record (copy)',
      description: SUBMISSION_RECORD.description,
      header: SUBMISSION_RECORD.header,
      footer: SUBMISSION_RECORD.footer,
      body: recordMarkdown(def, record),
      design,
    });
  const duplicate = () =>
    isRecord
      ? duplicateRecord()
      : add({
          ...t,
          id: undefined,
          name: `${t.name} (copy)`,
          fields: t.fields.map((f) => ({ ...f, id: Math.random().toString(36).slice(2, 10) })),
        });
  const remove = async () => {
    if (isRecord) return;
    if (
      !(await confirmDialog(`Delete “${t.name}”? It stays in use until you publish.`, {
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    setDocs(docs.filter((d) => d.id !== t.id));
    setPick(SUBMISSION_RECORD_ID);
  };
  const saveOne = () =>
    run('save', async () => {
      await keep(t.id);
      setKept({ ...kept, [t.id]: stateOf(t.id) });
      toast('Document saved');
    });
  /** The published documents with this one's draft applied: added, replaced in place, or removed. */
  const liveWith = (id: string) => {
    const mine = docs.find((d) => d.id === id);
    if (!mine) return published.filter((d) => d.id !== id);
    return published.some((d) => d.id === id)
      ? published.map((d) => (d.id === id ? mine : d))
      : [...published, mine];
  };
  /** Publishes one document, or all of those with changes. */
  const publish = (all: boolean) =>
    run('publish', async () => {
      const ids = all ? unpublishedIds : [t.id];
      const names = ids.map((id) =>
        id === SUBMISSION_RECORD_ID
          ? SUBMISSION_RECORD.name
          : (docs.find((d) => d.id === id)?.name ?? id),
      );
      if (
        !(await confirmDialog(
          all
            ? `Publish ${ids.length} changed ${ids.length === 1 ? 'document' : 'documents'} (${names.join(', ')})? Emails and downloads use the new versions straight away.`
            : `Publish “${names[0]}”? Emails and downloads use the new version straight away.`,
          { confirmLabel: 'Publish' },
        ))
      )
        return;
      await Promise.all(ids.map((id) => keep(id)));
      await api.publishDocuments(tenantId, project.key, formKey, all ? undefined : t.id);
      const rest = unpublishedIds.filter((id) => !ids.includes(id));
      set({
        settings: {
          ...draft.settings,
          documents: all ? docs : liveWith(t.id),
          record: all || ids.includes(SUBMISSION_RECORD_ID) ? record : draft.settings.record,
          documentDraft: rest.length ? { documents: docs, record } : null,
        },
      });
      void qc.invalidateQueries({ queryKey: ['forms', tenantId, project.key] });
      toast(all ? 'Documents published' : 'Document published');
    });
  const discard = (all: boolean) =>
    run('discard', async () => {
      if (
        !(await confirmDialog(
          all
            ? 'Discard every unpublished change to the documents?'
            : `Discard the unpublished changes to “${t.name}”?`,
          {
            confirmLabel: 'Discard',
            danger: true,
          },
        ))
      )
        return;
      await api.discardDocuments(tenantId, project.key, formKey, all ? undefined : t.id);
      void qc.invalidateQueries({ queryKey: ['forms', tenantId, project.key] });
      if (all) set({ settings: { ...draft.settings, documentDraft: null } });
      else {
        const back = published.find((d) => d.id === t.id);
        const nextDocs = back
          ? docs.map((d) => (d.id === t.id ? back : d))
          : docs.filter((d) => d.id !== t.id);
        const nextRecord = t.id === SUBMISSION_RECORD_ID ? draft.settings.record : record;
        const rest = unpublishedIds.filter((id) => id !== t.id);
        set({
          settings: {
            ...draft.settings,
            documentDraft: rest.length ? { documents: nextDocs, record: nextRecord } : null,
          },
        });
        if (!back && t.id !== SUBMISSION_RECORD_ID) setPick(SUBMISSION_RECORD_ID);
      }
    });
  const restore = (snapshot: unknown) =>
    run('save', async () => {
      if (isRecord) {
        const next = RecordOptions.parse(snapshot);
        set({ settings: { ...draft.settings, documentDraft: { documents: docs, record: next } } });
        await keep(t.id, { documents: docs, record: next }, 'restored');
      } else {
        const next = docs.map((d) =>
          d.id === t.id ? { ...DocumentTemplate.parse(snapshot), id: t.id } : d,
        );
        setDocs(next);
        await keep(t.id, { documents: next, record }, 'restored');
      }
      toast('Restored as a draft. Publish to use it');
    });
  /** The document's design and text as a file, to use in another form. Pictures are not included. */
  const exportOne = () => {
    const { id: _id, ...rest } = isRecord
      ? { ...SUBMISSION_RECORD, body: recordMarkdown(def, record), design }
      : t;
    const clean = {
      ...rest,
      design: {
        ...rest.design,
        logo: { ...rest.design.logo, image: null },
        background: { image: null },
        watermark: { ...rest.design.watermark, image: null },
      },
    };
    saveBlob(
      new Blob([JSON.stringify({ grids: 'document', template: clean }, null, 2)], {
        type: 'application/json',
      }),
      `${slug(t.name)}.json`,
    );
  };
  const importOne = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as { grids?: string; template?: unknown };
      if (raw.grids !== 'document' || !raw.template) throw new Error('This is not a document file');
      const { id: _i, ...tpl } = DocumentTemplate.partial().parse(
        raw.template,
      ) as Partial<DocumentTemplate>;
      add({ ...tpl, visibility: 'internal', groups: [] });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The file could not be read');
    }
  };
  /** Puts text into the body at the cursor, around any selected text when `wrap` is given. */
  const put = (text: string, wrap?: [string, string]) => {
    const el = body.current;
    if (isRecord || !el) return;
    const [a, z] = [el.selectionStart, el.selectionEnd];
    const inside = t.body.slice(a, z);
    const next = wrap
      ? `${t.body.slice(0, a)}${wrap[0]}${inside || 'text'}${wrap[1]}${t.body.slice(z)}`
      : `${t.body.slice(0, a)}${text}${t.body.slice(z)}`;
    update({ body: next });
    requestAnimationFrame(
      () => (
        el.focus(),
        el.setSelectionRange(
          a + (wrap ? wrap[0].length : text.length),
          a + (wrap ? wrap[0].length + (inside || 'text').length : text.length),
        )
      ),
    );
  };
  const lineStart = (prefix: string) => {
    const el = body.current;
    if (isRecord || !el) return;
    const at = t.body.lastIndexOf('\n', el.selectionStart - 1) + 1;
    update({ body: `${t.body.slice(0, at)}${prefix}${t.body.slice(at)}` });
    requestAnimationFrame(
      () => (
        el.focus(),
        el.setSelectionRange(el.selectionStart + prefix.length, el.selectionStart + prefix.length)
      ),
    );
  };
  const download = async (format: 'pdf') => {
    setBusy(format);
    try {
      saveBlob(
        await api.sampleDocument(tenantId, project.key, formKey, {
          template: t,
          format,
          answers: isRecord ? recordSample : sample.values,
          ...(isRecord && { record }),
        }),
        `${slug(t.name)}.${format}`,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The sample could not be made');
    } finally {
      setBusy(null);
    }
  };
  const fold = (id: string) => ({
    open: !!open[id],
    onToggle: () => setOpen({ ...open, [id]: !open[id] }),
  });

  // Answers placed on the page.
  const fields = t.fields;
  const setFields = (next: PlacedField[]) => update({ fields: next });
  const editField = (id: string, patch: Partial<PlacedField>) =>
    setFields(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const typeOf = (key: string) => questions.find((q) => q.key === key)?.type;
  const openNew = () =>
    setDialog({
      isNew: true,
      field: {
        id: Math.random().toString(36).slice(2, 10),
        key: '',
        x: 10,
        y: Math.min(90, 8 + fields.filter((f) => (f.page ?? 1) === pageNo).length * 7),
        width: 40,
        size: 12,
        align: 'left',
        bold: false,
        page: Math.min(pageNo, t.pages ?? 1),
      },
    });
  const saveField = (f: PlacedField, isNew: boolean) => {
    setFields(isNew ? [...fields, f] : fields.map((x) => (x.id === f.id ? f : x)));
    setChosen(f.id);
    setPageNo(f.page ?? 1);
    setDialog(null);
  };
  const duplicateField = (f: PlacedField) => {
    const copy = {
      ...f,
      id: Math.random().toString(36).slice(2, 10),
      y: Math.min(97, f.y + 4),
      x: Math.min(100 - Math.min(f.width, 100), f.x + 2),
    };
    const at = fields.findIndex((x) => x.id === f.id);
    setFields([...fields.slice(0, at + 1), copy, ...fields.slice(at + 1)]);
    setChosen(copy.id);
  };
  const removeField = async (f: PlacedField) => {
    if (
      !(await confirmDialog(`Remove “${labelOf(f.key)}” from the page?`, {
        confirmLabel: 'Remove',
        danger: true,
      }))
    )
      return;
    setFields(fields.filter((x) => x.id !== f.id));
    if (chosen === f.id) setChosen(null);
  };
  /** Moves an answer in front of another (or to the end of a page), onto that page. */
  const moveField = (id: string, page: number, before: string | null) => {
    const f = fields.find((x) => x.id === id);
    if (!f || id === before) return;
    const rest = fields.filter((x) => x.id !== id);
    const moved = { ...f, page };
    const at = before ? rest.findIndex((x) => x.id === before) : -1;
    if (at >= 0) rest.splice(at, 0, moved);
    else {
      const last = rest.map((x) => x.page ?? 1).lastIndexOf(page);
      rest.splice(last >= 0 ? last + 1 : rest.length, 0, moved);
    }
    setFields(rest);
  };
  const pageCount = t.pages ?? 1;
  const setPages = (n: number) => {
    const count = Math.max(1, Math.min(10, n));
    update({
      pages: count,
      fields: fields.map((f) => ({ ...f, page: Math.min(f.page ?? 1, count) })),
      design: {
        ...design,
        background: { ...design.background, pages: design.background.pages.slice(0, count) },
      },
    });
    setPageNo((p) => Math.min(p, count));
  };
  const different = placed && pageCount > 1 && (diffPages || design.background.pages.some(Boolean));
  const labelOf = (key: string) =>
    questions.find((q) => q.key === key)?.label ||
    SUBMISSION_FIELDS.find((f) => f.key === key)?.label ||
    key;

  const tool = (title: string, Icon: LucideIcon, action: () => void) => (
    <button
      key={title}
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
      className="p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-ink"
    >
      <Icon className="size-4" />
    </button>
  );
  const repeating = def.sections.filter((s) => s.repeat);
  const menu = (
    label: string,
    icon: ReactNode,
    options: { value: string; label: string; description?: ReactNode; text?: string }[],
    onChange: (v: string) => void,
  ) => (
    <Listbox
      searchable
      label={label}
      value={null}
      align="end"
      trigger={{
        className:
          'inline-flex h-7 items-center gap-1.5 px-2 text-xs font-medium text-accent-700 hover:bg-accent-50',
        children: (
          <>
            {icon} {label}
          </>
        ),
      }}
      options={options}
      onChange={onChange}
    />
  );
  const answerOptions = [
    ...questions.map((q) => ({ key: q.key, label: q.label })),
    ...SUBMISSION_FIELDS.map((f) => ({ key: f.key, label: f.label })),
  ].map(answerOption);
  const tabs: {
    id: string;
    name: string;
    description: string;
    visibility: DocumentVisibility;
    builtIn?: boolean;
    broken?: boolean;
  }[] = [
    {
      id: SUBMISSION_RECORD_ID,
      name: SUBMISSION_RECORD.name,
      description: SUBMISSION_RECORD.description,
      visibility: 'public',
      builtIn: true,
    },
    ...docs.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      visibility: d.visibility,
      broken: lintDocument(d, def).length > 0,
    })),
  ];

  const looks = [
    design.logo.image && 'logo',
    design.watermark.kind !== 'none' && 'watermark',
    design.background.image && 'background',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="border border-zinc-200 bg-snow lg:sticky lg:top-4">
        <header className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
          <h3 className="me-auto text-sm font-semibold">Documents</h3>
          <input
            ref={importer}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importOne(f);
            }}
          />
        </header>
        <div role="tablist" aria-label="Documents" aria-orientation="vertical">
          {tabs.map((d) => (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={d.id === t.id}
              onClick={() => setPick(d.id)}
              className={cx(
                'flex w-full items-start gap-3 border-s-[3px] px-4 py-3 text-start transition-colors [&+&]:border-t [&+&]:border-t-zinc-100',
                d.id === t.id
                  ? 'border-s-accent-600 bg-accent-50'
                  : 'border-s-transparent hover:bg-zinc-50',
              )}
            >
              <span
                className={cx(
                  'flex size-8 shrink-0 items-center justify-center',
                  d.id === t.id ? 'bg-snow text-accent-700' : 'bg-zinc-100 text-zinc-500',
                )}
              >
                <FileText className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className="truncate">{d.name}</span>
                  {d.builtIn && (
                    <span className="bg-zinc-100 px-1.5 py-px text-[10.5px] font-medium text-zinc-600">
                      Default
                    </span>
                  )}
                  {d.broken && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-amber-500"
                      title="Needs attention"
                    />
                  )}
                  {unpublishedIds.includes(d.id) && (
                    <span className="bg-amber-100 px-1.5 py-px text-[10.5px] font-medium text-amber-900">
                      Draft
                    </span>
                  )}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-500">
                  {d.description || 'No description'}
                </span>
                <span className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500">
                  {(() => {
                    const V = VISIBILITY[d.visibility];
                    return (
                      <>
                        <V.icon className="size-3" aria-hidden /> {V.label}
                      </>
                    );
                  })()}
                </span>
              </span>
            </button>
          ))}
        </div>
        <footer className="flex gap-2 border-t border-zinc-100 p-3">
          <Button
            variant="secondary"
            className="flex-1"
            icon={Upload}
            onClick={() => importer.current?.click()}
            title="Import a document file"
          >
            Import
          </Button>
          <Button className="flex-1" icon={Plus} onClick={() => add()}>
            New
          </Button>
        </footer>
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 border border-zinc-200 bg-snow px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center bg-accent-50 text-accent-700">
            <FileText className="size-4" aria-hidden />
          </span>
          <h3 className="me-auto min-w-0 truncate text-sm font-semibold">{t.name}</h3>
          {kept[t.id] !== stateOf(t.id) && (
            <span className="text-xs text-amber-800">Unsaved changes</span>
          )}
          {(
            [
              [
                'Save',
                Save,
                () => void saveOne(),
                kept[t.id] === stateOf(t.id) || working === 'save',
              ],
              ['History', History, () => setHistoryOpen(true), false],
              ['Export', Download, exportOne, false],
              ['Duplicate', Copy, duplicate, false],
              ['Delete', Trash2, () => void remove(), isRecord],
            ] as const
          ).map(([label, Icon, onClick, off]) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={label}
              disabled={off}
              onClick={onClick}
              className={cx(
                'p-1.5 hover:bg-zinc-100 disabled:opacity-35 disabled:hover:bg-transparent',
                label === 'Save' && !off ? 'text-accent-700' : 'text-zinc-500 hover:text-ink',
                label === 'Delete' && 'hover:text-red-700',
              )}
            >
              <Icon className="size-[18px]" />
            </button>
          ))}
        </div>
        {unpublishedIds.includes(t.id) && (
          <div
            className="flex flex-wrap items-center gap-3 border-s-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            role="status"
          >
            <span className="me-auto">
              Unpublished changes. Emails and downloads still use the published version.
            </span>
            <Button
              variant="secondary"
              size="sm"
              loading={working === 'discard'}
              onClick={() => void discard(false)}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Send}
              loading={working === 'publish'}
              onClick={() => void publish(false)}
            >
              Publish
            </Button>
          </div>
        )}
        {historyOpen && (
          <DocumentHistory
            formKey={formKey}
            docId={t.id}
            name={t.name}
            onRestore={(snap) => void restore(snap)}
            onClose={() => setHistoryOpen(false)}
          />
        )}
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <div>
            <Fold title="Details" {...fold('details')}>
              {isRecord ? (
                <>
                  <p className="text-sm text-zinc-600">
                    Every form has this one. It lists each question with its answer, and follows the
                    form as questions are added, moved and removed, so there is nothing to keep up
                    to date.
                  </p>
                  <p className="text-xs text-zinc-500">
                    A4, portrait. Header and footer are set below. Public: open to anyone who can
                    see the submission.
                  </p>
                </>
              ) : (
                <>
                  <Field
                    label="Name"
                    intro="Shown wherever people choose it, and used for the file name"
                  >
                    <Input value={t.name} onChange={(e) => update({ name: e.target.value })} />
                  </Field>
                  <Field
                    label="Description"
                    intro="What it is for, e.g. Sent when a payment is approved"
                  >
                    <Input
                      value={t.description}
                      onChange={(e) => update({ description: e.target.value })}
                    />
                  </Field>
                  <ChoiceCards
                    label="Who can use it"
                    intro="Where this document may be made available"
                    value={t.visibility}
                    onChange={(visibility) => update({ visibility })}
                    options={{
                      internal: {
                        label: VISIBILITY.internal.label,
                        text: VISIBILITY.internal.text,
                        icon: Lock,
                      },
                      email: {
                        label: VISIBILITY.email.label,
                        text: VISIBILITY.email.text,
                        icon: Mail,
                      },
                      public: {
                        label: VISIBILITY.public.label,
                        text: VISIBILITY.public.text,
                        icon: Globe,
                      },
                    }}
                  />
                  {t.visibility !== 'public' && (
                    <Field
                      label="Also available to"
                      intro="People with one of these permissions, or one above, can use it. Managers always can. Leave empty for managers only"
                    >
                      <Listbox
                        label="Permissions"
                        placeholder={
                          groups.data?.length
                            ? 'Managers only'
                            : 'This project has no permissions yet'
                        }
                        value={null}
                        values={t.groups}
                        searchable
                        disabled={!groups.data?.length}
                        options={(groups.data ?? []).map((g) => ({
                          value: g.id,
                          label: `${'  '.repeat(g.depth)}${g.name}`,
                          text: g.name,
                          description: 'and above',
                          icon: ShieldCheck,
                        }))}
                        onChangeMany={(ids) => update({ groups: ids })}
                      />
                    </Field>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Paper" intro="Page size it is printed on">
                      <Listbox
                        label="Paper"
                        value={t.paper}
                        options={[
                          { value: 'a4', label: 'A4' },
                          { value: 'letter', label: 'Letter' },
                        ]}
                        onChange={(paper) => update({ paper: paper as 'a4' | 'letter' })}
                      />
                    </Field>
                    <Field label="Orientation" intro="Tall or wide page">
                      <Listbox
                        label="Orientation"
                        value={t.orientation}
                        options={[
                          { value: 'portrait', label: 'Portrait' },
                          { value: 'landscape', label: 'Landscape' },
                        ]}
                        onChange={(orientation) =>
                          update({ orientation: orientation as 'portrait' | 'landscape' })
                        }
                      />
                    </Field>
                  </div>
                  <ArtCards
                    label="How it is laid out"
                    intro="Flowing text starts at the top; a placed layout puts each answer exactly where you drop it"
                    value={t.mode}
                    onChange={(mode) => update({ mode })}
                    options={{
                      flow: {
                        label: 'Flowing text',
                        text: 'The words run down the page from the top, like a letter.',
                        art: ART.flow,
                      },
                      placed: {
                        label: 'Answers placed',
                        text: 'For a pre-printed form or certificate: drag each answer into place on your picture.',
                        art: ART.placed,
                      },
                    }}
                  />
                </>
              )}
            </Fold>

            {isRecord && (
              <Fold
                title="Contents"
                summary={record.layout === 'form' ? 'As the form' : 'Question and answer tables'}
                {...fold('contents')}
              >
                <ArtCards
                  label="Layout"
                  intro="How the questions and answers are set out on the page"
                  value={record.layout}
                  onChange={(layout) => setRecord({ layout })}
                  options={{
                    table: {
                      label: 'Tables',
                      text: 'A Question and Answer table for each section.',
                      art: ART.table,
                    },
                    form: {
                      label: 'As the form',
                      text: 'Each question with its answer in a box, in the form’s order.',
                      art: ART.form,
                    },
                  }}
                />
                <div className="divide-y divide-zinc-100">
                  <ToggleLine
                    label="Project name"
                    description="“Project: …” in a line above the title"
                    checked={record.project}
                    onChange={(project) => setRecord({ project })}
                  />
                  <ToggleLine
                    label="Title block"
                    description="The form’s name and its introduction at the top"
                    checked={record.header}
                    onChange={(header) => setRecord({ header })}
                  />
                  <ToggleLine
                    label="Colours"
                    description="Your accent colour on the title and section headings, and a light shade behind answers"
                    checked={record.colors}
                    onChange={(colors) => setRecord({ colors })}
                  />
                  <ToggleLine
                    label="Notes and help text"
                    description="The form’s notes and each question’s help text, in order"
                    checked={record.notes}
                    onChange={(notes) => setRecord({ notes })}
                  />
                  <ToggleLine
                    label="Group by section"
                    description="A heading above each section’s questions"
                    checked={record.group}
                    onChange={(group) => setRecord({ group })}
                  />
                  <ToggleLine
                    label="Show who sent it and when"
                    description="A line under the title"
                    checked={record.details}
                    onChange={(details) => setRecord({ details })}
                  />
                  <ToggleLine
                    label="Include unanswered questions"
                    description="Shown with “No answer”; otherwise they are left out"
                    checked={record.blank}
                    onChange={(blank) => setRecord({ blank })}
                  />
                </div>
                <p className="text-xs text-zinc-500">
                  A repeating section lists every row. To write the text yourself, duplicate this
                  document.
                </p>
              </Fold>
            )}

            {isRecord && (
              <Fold
                title="Header and footer"
                summary={[
                  record.pageHeader ? 'Header' : 'No header',
                  record.pageFooter ? 'Footer' : 'No footer',
                ].join(' · ')}
                {...fold('hf')}
              >
                <div className="divide-y divide-zinc-100">
                  <ToggleLine
                    label="Header on every page"
                    description="The form’s name at the top"
                    checked={record.pageHeader}
                    onChange={(pageHeader) => setRecord({ pageHeader })}
                  />
                  <ToggleLine
                    label="Footer on every page"
                    description="A line at the bottom, made of what you pick below"
                    checked={record.pageFooter}
                    onChange={(pageFooter) => setRecord({ pageFooter })}
                  />
                  {record.pageFooter && (
                    <div className="space-y-2 bg-zinc-50 p-3">
                      <p className="text-xs text-zinc-500">In the footer, in this order</p>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {RECORD_FOOTER_ITEMS.map((item) => {
                          const on = record.footerItems.includes(item);
                          const I = FOOTER_ICON[item];
                          return (
                            <li key={item}>
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={on}
                                onClick={() =>
                                  setRecord({
                                    footerItems: on
                                      ? record.footerItems.filter((x) => x !== item)
                                      : RECORD_FOOTER_ITEMS.filter(
                                          (x) => x === item || record.footerItems.includes(x),
                                        ),
                                  })
                                }
                                className={cx(
                                  'flex w-full items-center gap-2.5 border px-3 py-2 text-start text-sm transition-colors',
                                  on
                                    ? 'border-accent-600 bg-accent-50 text-ink'
                                    : 'border-zinc-200 bg-snow text-zinc-700 hover:border-zinc-400',
                                )}
                              >
                                <span
                                  className={cx(
                                    'flex size-7 shrink-0 items-center justify-center',
                                    on ? 'bg-accent-600 text-white' : 'bg-zinc-100 text-zinc-500',
                                  )}
                                >
                                  <I className="size-4" aria-hidden />
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                  {RECORD_FOOTER_LABEL[item]}
                                </span>
                                {on && (
                                  <Check className="size-4 shrink-0 text-accent-700" aria-hidden />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  <ToggleLine
                    label="Page numbers"
                    description="“Page 1 of 3” at the right of the footer"
                    checked={record.pageNumbers}
                    onChange={(pageNumbers) => setRecord({ pageNumbers })}
                  />
                </div>
              </Fold>
            )}

            {!isRecord && placed && (
              <Fold
                title="Pages"
                summary={`${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`}
                {...fold('pages')}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-medium text-zinc-700">Pages</div>
                    <p className="text-xs text-zinc-500">How many pages the document has</p>
                  </div>
                  <div className="flex items-center border border-zinc-300">
                    <button
                      type="button"
                      aria-label="Fewer pages"
                      disabled={pageCount <= 1}
                      onClick={() => setPages(pageCount - 1)}
                      className="p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-35"
                    >
                      <Minus className="size-4" />
                    </button>
                    <span className="w-8 text-center text-sm tabular-nums">{pageCount}</span>
                    <button
                      type="button"
                      aria-label="More pages"
                      disabled={pageCount >= 10}
                      onClick={() => setPages(pageCount + 1)}
                      className="p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-35"
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                </div>
              </Fold>
            )}

            <Fold
              title="Logo, watermark and background"
              summary={looks || 'None'}
              {...fold('look')}
            >
              <div className="space-y-3">
                <PictureDrop
                  label="Logo"
                  intro="Printed at the top of the page"
                  value={design.logo.image}
                  onChange={(image) => setDesign({ logo: { ...design.logo, image } })}
                  formKey={formKey}
                />
                {design.logo.image && (
                  <div className="space-y-3 ps-3 border-s-2 border-zinc-100">
                    <ChoiceCards
                      label="Position"
                      intro="Where the logo sits across the top"
                      value={design.logo.align}
                      onChange={(align) => setDesign({ logo: { ...design.logo, align } })}
                      options={{
                        left: { label: 'Left', text: 'Starts at the left edge.', icon: AlignLeft },
                        center: {
                          label: 'Centre',
                          text: 'In the middle of the page.',
                          icon: AlignCenter,
                        },
                        right: {
                          label: 'Right',
                          text: 'Ends at the right edge.',
                          icon: AlignRight,
                        },
                      }}
                    />
                    <ChoiceCards
                      label="Shown on"
                      intro="Which pages carry the logo"
                      value={design.logo.pages}
                      onChange={(pages) => setDesign({ logo: { ...design.logo, pages } })}
                      options={{
                        first: {
                          label: 'First page',
                          text: 'Only at the top of the first page.',
                          icon: File,
                        },
                        all: {
                          label: 'Every page',
                          text: 'At the top of each page, above the header.',
                          icon: Files,
                        },
                      }}
                    />
                    <Slider
                      label="Width"
                      intro="How wide the logo is printed"
                      value={design.logo.width}
                      min={10}
                      max={150}
                      unit=" mm"
                      onChange={(width) => setDesign({ logo: { ...design.logo, width } })}
                    />
                  </div>
                )}
              </div>
              <div className="space-y-3 border-t border-zinc-100 pt-4">
                <ArtCards
                  label="Watermark"
                  intro="Large and pale behind the words, like DRAFT or your crest"
                  value={design.watermark.kind}
                  onChange={(kind) => setDesign({ watermark: { ...design.watermark, kind } })}
                  options={{
                    none: { label: 'None', text: 'Nothing behind the words.', art: ART.wmNone },
                    text: {
                      label: 'Text',
                      text: 'Words across the page, tilted if you like.',
                      art: ART.wmText,
                    },
                    image: { label: 'Picture', text: 'A pale picture, centred.', art: ART.wmImage },
                  }}
                />
                {design.watermark.kind === 'text' && (
                  <>
                    <Field
                      label="Text"
                      intro="Printed large and pale across the page, e.g. DRAFT or CONFIDENTIAL"
                    >
                      <Input
                        value={design.watermark.text}
                        maxLength={60}
                        onChange={(e) =>
                          setDesign({ watermark: { ...design.watermark, text: e.target.value } })
                        }
                      />
                    </Field>
                    <Slider
                      label="Tilt"
                      intro="Angle of the text across the page"
                      value={design.watermark.angle}
                      min={-90}
                      max={90}
                      unit="°"
                      onChange={(angle) => setDesign({ watermark: { ...design.watermark, angle } })}
                    />
                  </>
                )}
                {design.watermark.kind === 'image' && (
                  <PictureDrop
                    label="Picture"
                    intro="Centred behind the text"
                    value={design.watermark.image}
                    onChange={(image) => setDesign({ watermark: { ...design.watermark, image } })}
                    formKey={formKey}
                  />
                )}
                {design.watermark.kind !== 'none' && (
                  <Slider
                    label="Strength"
                    intro="How faint it is behind the words"
                    value={design.watermark.opacity}
                    min={3}
                    max={60}
                    unit="%"
                    onChange={(opacity) =>
                      setDesign({ watermark: { ...design.watermark, opacity } })
                    }
                  />
                )}
                {design.watermark.kind !== 'none' && (
                  <p className="text-xs text-zinc-500">
                    A picture is used as it is, so choose a pale one.
                  </p>
                )}
              </div>
              <div className="space-y-3 border-t border-zinc-100 pt-4">
                {placed && pageCount > 1 && (
                  <ChoiceCards
                    label="Background"
                    intro="The picture behind the pages"
                    value={different ? 'different' : 'same'}
                    onChange={(v) => {
                      if (v === 'same') {
                        setDiffPages(false);
                        setDesign({ background: { ...design.background, pages: [] } });
                      } else {
                        setDiffPages(true);
                        setDesign({
                          background: {
                            ...design.background,
                            pages: Array.from({ length: pageCount }, () => design.background.image),
                          },
                        });
                      }
                    }}
                    options={{
                      same: {
                        label: 'Same on every page',
                        text: 'One picture behind all pages.',
                        icon: Copy,
                      },
                      different: {
                        label: 'Different per page',
                        text: 'Each page has its own picture.',
                        icon: Layers,
                      },
                    }}
                  />
                )}
                {different ? (
                  Array.from({ length: pageCount }, (_, i) => (
                    <PictureDrop
                      key={i}
                      label={`Page ${i + 1}`}
                      intro="Your pre-printed form for this page"
                      value={design.background.pages[i] ?? null}
                      onChange={(image) =>
                        setDesign({
                          background: {
                            ...design.background,
                            pages: Array.from({ length: pageCount }, (_, k) =>
                              k === i ? image : (design.background.pages[k] ?? null),
                            ),
                          },
                        })
                      }
                      formKey={formKey}
                    />
                  ))
                ) : (
                  <PictureDrop
                    label="Background picture"
                    intro={
                      placed
                        ? 'Your pre-printed form or certificate. Answers go on top of it'
                        : 'Behind every page, such as a letterhead'
                    }
                    value={design.background.image}
                    onChange={(image) => setDesign({ background: { ...design.background, image } })}
                    formKey={formKey}
                    tall
                  />
                )}
              </div>
            </Fold>

            {!isRecord && placed && (
              <Fold
                title="Answers on the page"
                summary={`${fields.length} placed`}
                {...fold('fields')}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-zinc-500">
                    Drag each answer on the page to where it belongs. Arrow keys nudge the selected
                    one.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Plus}
                    className="shrink-0"
                    onClick={openNew}
                  >
                    Add
                  </Button>
                </div>
                {fields.length === 0 ? (
                  <p className="border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500">
                    No answers on the page yet. Add one, then drag it into place.
                  </p>
                ) : (
                  <div className="border border-zinc-200">
                    {Array.from({ length: pageCount }, (_, i) => {
                      const here = fields.filter((f) => Math.min(f.page ?? 1, pageCount) === i + 1);
                      const over = (e: React.DragEvent) => dragId && e.preventDefault();
                      return (
                        <section
                          key={i}
                          className="[&+&]:border-t [&+&]:border-t-zinc-200"
                          onDragOver={over}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragId) moveField(dragId, i + 1, null);
                            setDragId(null);
                          }}
                        >
                          {pageCount > 1 && (
                            <button
                              type="button"
                              onClick={() => setPageNo(i + 1)}
                              className={cx(
                                'flex w-full items-center gap-2 px-3 py-2 text-start text-[13px] font-semibold',
                                pageNo === i + 1
                                  ? 'bg-accent-50 text-accent-800'
                                  : 'bg-zinc-50 text-zinc-700 hover:bg-zinc-100',
                              )}
                            >
                              <FileText className="size-3.5 shrink-0" aria-hidden />
                              <span className="me-auto">Page {i + 1}</span>
                              <span className="text-xs font-normal text-zinc-500">
                                {here.length}
                              </span>
                            </button>
                          )}
                          {here.length === 0 && pageCount > 1 ? (
                            <p className="px-3 py-2 ps-9 text-xs text-zinc-500">
                              {dragId ? 'Drop here' : 'Nothing on this page yet'}
                            </p>
                          ) : (
                            <ul
                              className={cx(
                                'divide-y divide-zinc-100',
                                pageCount > 1 && 'ms-5 border-s border-zinc-200',
                              )}
                            >
                              {here.map((f) => (
                                <li
                                  key={f.id}
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer.effectAllowed = 'move';
                                    setDragId(f.id);
                                  }}
                                  onDragEnd={() => setDragId(null)}
                                  onDragOver={over}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (dragId) moveField(dragId, i + 1, f.id);
                                    setDragId(null);
                                  }}
                                  className={cx(
                                    'group flex items-center',
                                    dragId === f.id && 'opacity-40',
                                  )}
                                >
                                  <button
                                    type="button"
                                    onClick={() => (setChosen(f.id), setPageNo(f.page ?? 1))}
                                    className={cx(
                                      'flex min-w-0 flex-1 items-center gap-2 py-2 ps-2 pe-1 text-start text-sm',
                                      f.id === chosen ? 'bg-accent-50' : 'hover:bg-zinc-50',
                                    )}
                                  >
                                    <GripVertical
                                      className="size-4 shrink-0 cursor-grab text-zinc-300 group-hover:text-zinc-500"
                                      aria-hidden
                                    />
                                    {kindOfAnswer(typeOf(f.key)) === 'picture' ? (
                                      <ImageIcon className="size-3.5 shrink-0 text-zinc-400" />
                                    ) : (
                                      <Variable className="size-3.5 shrink-0 text-zinc-400" />
                                    )}
                                    <span className="min-w-0 flex-1 truncate">
                                      {labelOf(f.key)}
                                    </span>
                                    <span className="text-xs text-zinc-500 tabular-nums">
                                      {Math.round(f.x)}%, {Math.round(f.y)}%
                                    </span>
                                  </button>
                                  <span
                                    className={cx(
                                      'flex items-center self-stretch pe-1',
                                      f.id === chosen ? 'bg-accent-50' : '',
                                    )}
                                  >
                                    {(
                                      [
                                        [
                                          'Edit',
                                          Pencil,
                                          () => (
                                            setChosen(f.id),
                                            setPageNo(f.page ?? 1),
                                            setDialog({ field: f, isNew: false })
                                          ),
                                        ],
                                        ['Duplicate', Copy, () => duplicateField(f)],
                                        ['Remove', Trash2, () => void removeField(f)],
                                      ] as const
                                    ).map(([label, Icon, onClick]) => (
                                      <button
                                        key={label}
                                        type="button"
                                        aria-label={`${label} ${labelOf(f.key)}`}
                                        title={label}
                                        onClick={onClick}
                                        className={cx(
                                          'p-1.5 text-zinc-500 hover:bg-zinc-100',
                                          label === 'Remove'
                                            ? 'hover:text-red-700'
                                            : 'hover:text-ink',
                                        )}
                                      >
                                        <Icon className="size-4" />
                                      </button>
                                    ))}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}
                {dialog && (
                  <PlacedAnswerDialog
                    key={dialog.field.id}
                    value={dialog.field}
                    isNew={dialog.isNew}
                    pageCount={pageCount}
                    options={answerOptions}
                    typeOf={typeOf}
                    onSave={(f) => saveField(f, dialog.isNew)}
                    onClose={() => setDialog(null)}
                  />
                )}
              </Fold>
            )}

            {!isRecord && !placed && (
              <>
                <Fold
                  title="Header and footer"
                  summary={[t.header || 'No header', t.footer || 'No footer'].join(' · ')}
                  {...fold('hf')}
                >
                  <Field label="Header" intro="A line at the top of every page">
                    <Input value={t.header} onChange={(e) => update({ header: e.target.value })} />
                  </Field>
                  <Field
                    label="Footer"
                    intro="A line at the bottom of every page, before the page number"
                  >
                    <Input value={t.footer} onChange={(e) => update({ footer: e.target.value })} />
                  </Field>
                </Fold>
                <Fold title="Text" summary="Answers and formatting" {...fold('text')}>
                  <p className="text-[13px] font-medium text-zinc-700">Body</p>
                  <p className="-mt-3 text-xs text-zinc-500">
                    What the document says; insert answers where they belong
                  </p>
                  <div className="border border-zinc-300 focus-within:border-accent-600 focus-within:ring-2 focus-within:ring-accent-600/20">
                    <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-1 py-0.5">
                      {tool('Heading', Heading2, () => lineStart('## '))}
                      {tool('Bold', Bold, () => put('', ['**', '**']))}
                      {tool('Italic', Italic, () => put('', ['*', '*']))}
                      {tool('Bulleted list', List, () => lineStart('- '))}
                      {tool('Numbered list', ListOrdered, () => lineStart('1. '))}
                      {tool('Link', Link2, () => put('', ['[', '](https://)']))}
                      {tool('Table', Table2, () =>
                        put('\n| Column | Column |\n|---|---|\n| ${} | ${} |\n'),
                      )}
                      <span className="ms-auto flex items-center">
                        {repeating.length > 0 &&
                          menu(
                            'Repeat',
                            <Repeat className="size-3.5" />,
                            repeating.flatMap((s) => [
                              {
                                value: `block:${s.key}`,
                                label: `${s.repeat?.itemLabel || s.title || s.key}: a block for each`,
                                description: 'Repeats the lines between the marks for every row',
                              },
                              {
                                value: `table:${s.key}`,
                                label: `${s.repeat?.itemLabel || s.title || s.key}: a table row for each`,
                                description: 'A table with a row per fill-in',
                              },
                            ]),
                            (v) => {
                              const [kind, key] = v.split(':') as ['block' | 'table', string];
                              const s = repeating.find((x) => x.key === key)!;
                              const cols = s.questions.filter((q) => q.type !== 'note').slice(0, 4);
                              if (kind === 'block')
                                put(
                                  `\n[[each ${key}]]\n${cols.map((q) => `\${${q.key}}`).join(', ')}\n[[end]]\n`,
                                );
                              else
                                put(
                                  `\n| ${cols.map((q) => q.label || q.key).join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n[[each ${key}]]| ${cols.map((q) => `\${${q.key}}`).join(' | ')} |\n`,
                                );
                            },
                          )}
                        {menu(
                          'Insert answer',
                          <Variable className="size-3.5" />,
                          answerOptions,
                          (k) => put(`\${${k}}`),
                        )}
                      </span>
                    </div>
                    <textarea
                      ref={body}
                      aria-label="Text of the document"
                      value={t.body}
                      onChange={(e) => update({ body: e.target.value })}
                      className="block min-h-72 w-full resize-y bg-snow p-3 font-mono text-xs leading-5 outline-none"
                      spellCheck={false}
                    />
                  </div>
                </Fold>
              </>
            )}
          </div>

          <section className="space-y-3 border border-zinc-200 bg-snow p-4 xl:sticky xl:top-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="me-auto min-w-0">
                <h3 className="text-sm font-semibold">{placed ? 'The page' : 'Preview'}</h3>
                <p className="text-xs text-zinc-500">
                  {placed ? 'Drag answers into place' : 'Shown with sample answers'}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={FileDown}
                loading={busy === 'pdf'}
                disabled={problems.length > 0}
                onClick={() => void download('pdf')}
              >
                Download PDF
              </Button>
            </div>
            {problems.length > 0 && (
              <div
                className="border-s-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                role="status"
              >
                <ul className="list-disc ps-5">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="max-h-[78vh] overflow-auto border border-zinc-300 bg-zinc-100 p-4">
              {placed ? (
                <>
                  {pageCount > 1 && (
                    <div
                      role="tablist"
                      aria-label="Pages"
                      className="mb-3 flex flex-wrap justify-center gap-1"
                    >
                      {Array.from({ length: pageCount }, (_, i) => (
                        <button
                          key={i}
                          type="button"
                          role="tab"
                          aria-selected={pageNo === i + 1}
                          onClick={() => setPageNo(i + 1)}
                          className={cx(
                            'h-7 min-w-9 px-2 text-xs font-medium',
                            pageNo === i + 1
                              ? 'bg-accent-600 text-white'
                              : 'bg-snow text-zinc-700 hover:bg-zinc-50',
                          )}
                        >
                          {i + 1}
                        </button>
                      ))}
                    </div>
                  )}
                  <div
                    className="relative mx-auto"
                    style={{ maxWidth: t.orientation === 'landscape' ? '42rem' : '34rem' }}
                  >
                    <PagePlacer
                      t={t}
                      design={{
                        ...design,
                        background: {
                          image: design.background.pages[pageNo - 1] ?? design.background.image,
                          pages: [],
                        },
                      }}
                      texts={texts}
                      isPicture={(key) => kindOfAnswer(typeOf(key)) === 'picture'}
                      labelOf={(key) =>
                        questions.find((q) => q.key === key)?.label ||
                        SUBMISSION_FIELDS.find((f) => f.key === key)?.label ||
                        key
                      }
                      fields={fields.filter((f) => (f.page ?? 1) === pageNo)}
                      selected={chosen}
                      onSelect={setChosen}
                      onMove={(id, x, y) =>
                        editField(id, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 })
                      }
                      onResize={(id, patch) => editField(id, patch)}
                      projectKey={project.key}
                      tenantId={tenantId}
                    />
                    {pageCount > 1 &&
                      (
                        [
                          ['Previous page', ChevronLeft, -1, 'left-0 -translate-x-1/2'],
                          ['Next page', ChevronRight, 1, 'right-0 translate-x-1/2'],
                        ] as const
                      ).map(([label, Icon, step, side]) => (
                        <button
                          key={label}
                          type="button"
                          aria-label={label}
                          title={label}
                          disabled={pageNo + step < 1 || pageNo + step > pageCount}
                          onClick={() => setPageNo(pageNo + step)}
                          className={cx(
                            'absolute top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center bg-accent-600 text-white shadow hover:bg-accent-700 disabled:opacity-30',
                            side,
                          )}
                        >
                          <Icon className="size-5" />
                        </button>
                      ))}
                  </div>
                </>
              ) : (
                <PagedPreview
                  t={t}
                  design={design}
                  parts={parts}
                  projectKey={project.key}
                  tenantId={tenantId}
                />
              )}
            </div>
            <p className="text-xs text-zinc-500">
              {isRecord
                ? 'The sample leaves a few questions unanswered, so you can see what the last switch does. '
                : ''}
              Characters outside Western European alphabets can’t be printed in the PDF.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
