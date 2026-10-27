import { cx } from '@grids/ui';
import { sanitizeRich } from '@grids/viz';
import { Bold, Italic, Link2, List, ListOrdered, RemoveFormatting, Underline } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * A small rich-text box (bold, italic, underline, links, lists). Its value is the
 * sanitised HTML subset the dashboards render in their info tips.
 */
export function RichTextEditor({ value, onChange, label, placeholder }: { value: string; onChange(html: string): void; label: string; placeholder?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (box.current) box.current.innerHTML = sanitizeRich(value);
    // The box owns its content while it is being edited; it is filled once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => onChange(sanitizeRich(box.current?.innerHTML ?? ''));
  const refresh = () => setActive({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), underline: document.queryCommandState('underline'), ul: document.queryCommandState('insertUnorderedList'), ol: document.queryCommandState('insertOrderedList') });
  const run = (cmd: string, arg?: string) => {
    box.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
    refresh();
  };
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keep the text selection while a button is pressed
  const btn = (on: boolean) => cx('flex size-8 items-center justify-center text-zinc-700 hover:bg-zinc-200', on && 'bg-snow shadow-sm');

  const startLink = () => {
    const sel = window.getSelection();
    saved.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    setLink('https://');
  };
  const applyLink = () => {
    const url = (link ?? '').trim();
    setLink(null);
    box.current?.focus();
    const sel = window.getSelection();
    if (saved.current && sel) {
      sel.removeAllRanges();
      sel.addRange(saved.current);
    }
    if (/^(https?:\/\/|mailto:)/i.test(url)) run('createLink', url);
  };

  return (
    <div className="overflow-hidden border border-zinc-300 focus-within:border-accent-600">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 p-1.5" role="toolbar" aria-label={`${label} formatting`}>
        <button type="button" aria-label="Bold" title="Bold" aria-pressed={active.bold} onMouseDown={keep} onClick={() => run('bold')} className={btn(!!active.bold)}><Bold className="size-4" /></button>
        <button type="button" aria-label="Italic" title="Italic" aria-pressed={active.italic} onMouseDown={keep} onClick={() => run('italic')} className={btn(!!active.italic)}><Italic className="size-4" /></button>
        <button type="button" aria-label="Underline" title="Underline" aria-pressed={active.underline} onMouseDown={keep} onClick={() => run('underline')} className={btn(!!active.underline)}><Underline className="size-4" /></button>
        <span className="mx-1.5 h-5 w-px bg-zinc-300" aria-hidden />
        <button type="button" aria-label="Link" title="Link" onMouseDown={keep} onClick={startLink} className={btn(false)}><Link2 className="size-4" /></button>
        <button type="button" aria-label="Bulleted list" title="Bulleted list" aria-pressed={active.ul} onMouseDown={keep} onClick={() => run('insertUnorderedList')} className={btn(!!active.ul)}><List className="size-4" /></button>
        <button type="button" aria-label="Numbered list" title="Numbered list" aria-pressed={active.ol} onMouseDown={keep} onClick={() => run('insertOrderedList')} className={btn(!!active.ol)}><ListOrdered className="size-4" /></button>
        <button type="button" aria-label="Clear formatting" title="Clear formatting" onMouseDown={keep} onClick={() => (run('removeFormat'), run('unlink'))} className={cx(btn(false), 'ms-auto')}><RemoveFormatting className="size-4" /></button>
      </div>
      {link !== null && (
        <div className="flex items-center gap-2 border-b border-zinc-200 bg-snow p-2">
          <input
            autoFocus
            aria-label="Link address"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.preventDefault(), applyLink());
              if (e.key === 'Escape') setLink(null);
            }}
            placeholder="https://example.org/page"
            className="h-8 min-w-0 flex-1 border border-zinc-300 bg-snow px-2 text-sm focus:border-accent-600 focus:outline-none"
          />
          <button type="button" onClick={applyLink} className="h-8 bg-accent-600 px-3 text-sm font-medium text-on-accent hover:bg-accent-700">Add link</button>
          <button type="button" onClick={() => setLink(null)} className="h-8 px-2 text-sm text-zinc-600 hover:bg-zinc-100">Cancel</button>
        </div>
      )}
      <div
        ref={box}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder={placeholder}
        onInput={emit}
        onKeyUp={refresh}
        onMouseUp={refresh}
        onBlur={emit}
        className="min-h-24 max-h-56 overflow-y-auto px-3.5 py-3 text-sm leading-relaxed focus:outline-none empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)] [&_a]:text-accent-700 [&_a]:underline [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5"
      />
    </div>
  );
}
