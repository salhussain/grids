import { cx } from '@grids/ui';
import { Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'A', 'UL', 'OL', 'LI', 'BR', 'P', 'H4']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT']);

/**
 * Reduces user-written HTML to a small safe subset (bold, italic, underline, links, lists,
 * paragraphs). Everything else is unwrapped or dropped; links keep only http(s)/mailto addresses.
 */
export function sanitizeRich(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node: Element) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1) {
        child.remove();
        continue;
      }
      const el = child as Element;
      if (DROP.has(el.tagName)) {
        el.remove();
        continue;
      }
      if (!ALLOWED.has(el.tagName)) {
        walk(el);
        el.replaceWith(...el.childNodes);
        continue;
      }
      for (const a of [...el.attributes]) if (!(el.tagName === 'A' && a.name === 'href')) el.removeAttribute(a.name);
      if (el.tagName === 'A') {
        const href = (el.getAttribute('href') ?? '').trim();
        if (/^(https?:|mailto:)/i.test(href)) {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        } else el.removeAttribute('href');
      }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** Whether rich text holds anything visible. */
export const richIsEmpty = (html?: string) => !html || !sanitizeRich(html).replace(/<[^>]*>/g, '').trim();

const RICH_STYLE =
  '[&_a]:text-accent-700 [&_a]:underline [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:my-1.5 [&_h4]:mt-1 [&_h4]:font-semibold';

/** Renders sanitised rich text. */
export function RichText({ html, className }: { html: string; className?: string }) {
  // Sanitised above to a fixed allowlist.
  return <div className={cx(RICH_STYLE, className)} dangerouslySetInnerHTML={{ __html: sanitizeRich(html) }} />;
}

/**
 * The small (i) beside a title: hover, focus or tap opens a card with rich text. The card
 * stays open while the pointer is over it, so links inside can be clicked; Esc closes it.
 */
export function InfoTip({ html, label = 'More information', className }: { html: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = () => {
    window.clearTimeout(timer.current);
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    setAt({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left - 12, window.innerWidth - 328)) });
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 160);
  };
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const down = (e: MouseEvent) => !btn.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', down);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', down);
    };
  }, [open]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (richIsEmpty(html)) return null;
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          open ? setOpen(false) : show();
        }}
        className={cx(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-full transition-colors',
          open ? 'bg-accent-50 text-accent-700' : 'text-zinc-400 hover:bg-zinc-100 hover:text-accent-700',
          className,
        )}
      >
        <Info className="size-[15px]" strokeWidth={2} />
      </button>
      {open &&
        at &&
        createPortal(
          <div
            ref={pop}
            role="tooltip"
            onMouseEnter={() => window.clearTimeout(timer.current)}
            onMouseLeave={hide}
            style={{ top: at.top, left: at.left }}
            className="fixed z-[200] w-80 max-w-[calc(100vw-1rem)] rounded-[14px] border border-zinc-200 bg-snow p-3.5 text-[13px] leading-relaxed text-zinc-700 shadow-[0_14px_34px_rgba(16,24,40,0.2)]"
          >
            <RichText html={html} />
          </div>,
          // A modal dialog sits in the browser's top layer, above everything on the page: show the card inside it.
          btn.current?.closest('dialog') ?? document.body,
        )}
    </>
  );
}
