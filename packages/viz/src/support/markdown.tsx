import { cx } from '@grids/ui';
import { AlertCircle, ChevronRight, Download } from 'lucide-react';
import { HIGHLIGHT_CSS, highlighted } from './highlight';
import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------- rich text for conversations
// Messages are written in a small, familiar Markdown: headings, bold, italic, strike, code, links, lists, checklists,
// quotes, code blocks, callouts, collapsible sections and pictures. It is drawn as React elements (never as HTML), and
// only web links and the conversation's own files can be linked, so a message cannot run anything.

/** How the text reaches a file that came with the conversation (`file:<id>`): a link a browser can show, and how to open it. */
export interface RichFiles {
  url(id: string): Promise<string>;
  open(id: string, name: string): void | Promise<void>;
}
export const FilesCtx = createContext<RichFiles | null>(null);
export const RichFilesProvider = FilesCtx.Provider;

type Block =
  | { t: 'h'; level: 1 | 2 | 3; text: string }
  | { t: 'p'; text: string }
  | { t: 'list'; ordered: boolean; items: { text: string; checked: boolean | null }[] }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'hr' }
  | { t: 'callout'; blocks: Block[] }
  | { t: 'details'; title: string; blocks: Block[] };

const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

export function parseBlocks(src: string): Block[] {
  return blocks(src.replace(/\r\n?/g, '\n').split('\n'));
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
      i++;
      out.push({ t: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    const open = /^:::(callout|details)\s*(.*)$/.exec(line);
    if (open) {
      const body: string[] = [];
      let depth = 1;
      i++;
      while (i < lines.length) {
        const l = lines[i]!;
        if (/^:::(callout|details)/.test(l)) depth++;
        else if (/^:::\s*$/.test(l) && --depth === 0) break;
        body.push(l);
        i++;
      }
      i++;
      out.push(open[1] === 'callout' ? { t: 'callout', blocks: blocks(body) } : { t: 'details', title: open[2]?.trim() || 'Details', blocks: blocks(body) });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ t: 'h', level: h[1]!.length as 1 | 2 | 3, text: h[2]! });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push({ t: 'hr' });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) body.push(lines[i++]!.replace(/^>\s?/, ''));
      out.push({ t: 'quote', blocks: blocks(body) });
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]!);
      const items: { text: string; checked: boolean | null }[] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]!);
        if (!m || /\d/.test(m[2]!) !== ordered) break;
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(m[3]!);
        items.push(task ? { text: task[2]!, checked: task[1] !== ' ' } : { text: m[3]!, checked: null });
        i++;
      }
      out.push({ t: 'list', ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(```|:::|#{1,3}\s|>\s?|-{3,}\s*$)/.test(lines[i]!) && !LIST.test(lines[i]!)) para.push(lines[i++]!);
    if (!para.length) para.push(lines[i++]!);
    out.push({ t: 'p', text: para.join('\n') });
  }
  return out;
}

// ---------------------------------------------------------------- inline

const INLINE = /(`[^`\n]+`)|(!\[[^\]\n]*\]\([^)\s]+\))|(\[[^\]\n]+\]\([^)\s]+\))|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\b_[^_\n]+_\b)|(https?:\/\/[^\s<>)]+)/g;
const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const FILE = /^file:([0-9a-f-]{36})$/i;

function FileImage({ id, alt }: { id: string; alt: string }) {
  const files = useContext(FilesCtx);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    files?.url(id).then((u) => live && setSrc(u), () => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, files]);
  if (failed || !files) return <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><AlertCircle className="size-3.5" /> {alt || 'picture'} could not be shown</span>;
  if (!src) return <span className="inline-block h-24 w-40 animate-pulse bg-zinc-200 align-middle" aria-label="Loading picture" />;
  return <img src={src} alt={alt} className="my-1 max-h-80 max-w-full border border-zinc-200" />;
}

function FileLink({ id, children }: { id: string; children: ReactNode }) {
  const files = useContext(FilesCtx);
  return (
    <button type="button" onClick={() => void files?.open(id, String(children))} className="inline-flex items-center gap-1 text-accent-700 underline underline-offset-2 hover:text-accent-800">
      <Download className="size-3.5" /> {children}
    </button>
  );
}

export function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index!;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} className="bg-zinc-100 px-1 py-px font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    else if (m[2]) {
      const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(tok)!;
      const f = FILE.exec(img[2]!);
      if (f) out.push(<FileImage key={k} id={f[1]!} alt={img[1]!} />);
      else if (/^https:\/\//i.test(img[2]!)) out.push(<img key={k} src={img[2]} alt={img[1]} className="my-1 max-h-80 max-w-full border border-zinc-200" loading="lazy" referrerPolicy="no-referrer" />);
      else out.push(tok);
    } else if (m[3]) {
      const a = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const f = FILE.exec(a[2]!);
      if (f) out.push(<FileLink key={k} id={f[1]!}>{a[1]}</FileLink>);
      else if (SAFE_URL.test(a[2]!)) out.push(<a key={k} href={a[2]} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-700 underline underline-offset-2 hover:text-accent-800">{inline(a[1]!, k)}</a>);
      else out.push(a[1]);
    } else if (m[4]) out.push(<strong key={k} className="font-semibold">{inline(tok.slice(2, -2), k)}</strong>);
    else if (m[5]) out.push(<s key={k}>{inline(tok.slice(2, -2), k)}</s>);
    else if (m[6] || m[7]) out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>);
    else if (m[8]) {
      const url = tok.replace(/[.,;:!?]+$/, '');
      out.push(<a key={k} href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-700 underline underline-offset-2 hover:text-accent-800">{url}</a>);
      if (url.length < tok.length) out.push(tok.slice(url.length));
    }
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const withBreaks = (text: string, key: string) =>
  text.split('\n').map((l, i) => (
    <Fragment key={`${key}-${i}`}>
      {i > 0 && <br />}
      {inline(l, `${key}-${i}`)}
    </Fragment>
  ));

function Details({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 border border-zinc-200">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-3 py-2 text-start text-sm font-medium hover:bg-zinc-50">
        <ChevronRight className={cx('size-4 text-zinc-400 transition-transform', open && 'rotate-90')} /> {title}
      </button>
      {open && <div className="border-t border-zinc-200 px-3 py-2">{children}</div>}
    </div>
  );
}

function render(bs: Block[], key = 'b'): ReactNode[] {
  return bs.map((b, i) => {
    const k = `${key}-${i}`;
    switch (b.t) {
      case 'h':
        return b.level === 1 ? (
          <h2 key={k} className="mt-3 mb-1.5 text-xl font-semibold tracking-tight first:mt-0">{inline(b.text, k)}</h2>
        ) : b.level === 2 ? (
          <h3 key={k} className="mt-3 mb-1 text-lg font-semibold first:mt-0">{inline(b.text, k)}</h3>
        ) : (
          <h4 key={k} className="mt-2 mb-1 text-base font-semibold first:mt-0">{inline(b.text, k)}</h4>
        );
      case 'p':
        return <p key={k} className="my-1.5 first:mt-0 last:mb-0">{withBreaks(b.text, k)}</p>;
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul';
        const task = b.items.some((x) => x.checked !== null);
        return (
          <Tag key={k} className={cx('my-1.5 space-y-0.5 ps-5', task ? 'list-none ps-1' : b.ordered ? 'list-decimal' : 'list-disc')}>
            {b.items.map((x, j) => (
              <li key={`${k}-${j}`} className={cx(x.checked !== null && 'flex items-start gap-2')}>
                {x.checked !== null && <input type="checkbox" checked={x.checked} readOnly tabIndex={-1} className="mt-1 size-3.5 accent-[var(--color-accent-600)]" aria-label={x.checked ? 'Done' : 'Not done'} />}
                <span className={cx(x.checked && 'text-zinc-500 line-through')}>{inline(x.text, `${k}-${j}`)}</span>
              </li>
            ))}
          </Tag>
        );
      }
      case 'quote':
        return <blockquote key={k} className="my-2 border-s-[3px] border-zinc-300 ps-3 text-zinc-600">{render(b.blocks, k)}</blockquote>;
      case 'code':
        return (
          <pre key={k} className="my-2 overflow-x-auto rounded-md bg-zinc-100 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-zinc-800">
            <style>{HIGHLIGHT_CSS}</style>
            {highlighted(b.text, b.lang)}
          </pre>
        );
      case 'hr':
        return <hr key={k} className="my-3 border-zinc-200" />;
      case 'callout':
        return <div key={k} className="my-2 flex gap-2.5 border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950"><span aria-hidden>💡</span><div className="min-w-0 flex-1">{render(b.blocks, k)}</div></div>;
      case 'details':
        return <Details key={k} title={b.title}>{render(b.blocks, k)}</Details>;
    }
  });
}

/** A message's text, formatted. */
export function RichBody({ text, className }: { text: string; className?: string }) {
  return <div className={cx('text-sm leading-relaxed break-words', className)}>{render(parseBlocks(text))}</div>;
}

/** The text with the formatting taken out (for previews and lists). */
export function plainOf(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^:::.*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,3}\s+|^>\s?|^[-*]\s+(\[[ xX]\]\s+)?|^\d+\.\s+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
