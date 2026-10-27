import { mdToHtml } from '@grids/forms';
import { Listbox, cx } from '@grids/ui';
import { Bold, Heading2, Italic, Link2, List, ListOrdered, Variable, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';

/** Reads the editor's content back as the Markdown subset an email message is stored in (see `mdToHtml`). */
function toMarkdown(root: HTMLElement): string {
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof HTMLElement)) return '';
    const inner = () => [...node.childNodes].map(walk).join('');
    switch (node.tagName) {
      case 'STRONG':
      case 'B': {
        const t = inner();
        return t.trim() ? `**${t}**` : t;
      }
      case 'EM':
      case 'I': {
        const t = inner();
        return t.trim() ? `*${t}*` : t;
      }
      case 'A': {
        const href = node.getAttribute('href') ?? '';
        return /^(https?:|mailto:)/i.test(href) ? `[${inner()}](${href})` : inner();
      }
      case 'BR':
        return '\n';
      case 'H1':
      case 'H2':
      case 'H3':
        return `\n\n## ${inner().trim()}\n\n`;
      case 'UL':
        return `\n\n${[...node.children].map((li) => `- ${walk(li).trim()}`).join('\n')}\n\n`;
      case 'OL':
        return `\n\n${[...node.children].map((li, i) => `${i + 1}. ${walk(li).trim()}`).join('\n')}\n\n`;
      case 'P':
        return `${inner()}\n\n`;
      case 'DIV':
        return `${inner()}\n`;
      default:
        return inner();
    }
  };
  return walk(root).replace(/\u00A0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

const placeholder = (key: string) => `\${${key}}`;

/**
 * An entry of an "insert an answer" list. A question shows its key; a detail of the submission itself
 * (`_submitted_at` and the like) shows that it is made by the system instead of a code.
 */
export const answerOption = (a: { key: string; label: string }) => {
  const system = a.key.startsWith('_');
  return {
    value: a.key,
    label: a.label || a.key,
    description: system ? <span className="font-medium text-accent-700">System generated</span> : a.key,
    text: system ? a.label : `${a.label} ${a.key}`,
  };
};

/**
 * A message box with a little formatting: bold, italic, a heading, lists and links, and answers from the form
 * to put in. It keeps the message as plain text with Markdown marks, which is also how it is sent.
 */
export function RichTextField({ value, onChange, answers, label }: { value: string; onChange(v: string): void; answers: { key: string; label: string }[]; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const last = useRef(value);
  const caret = useRef<Range | null>(null);
  useLayoutEffect(() => {
    if (box.current) box.current.innerHTML = mdToHtml(value, placeholder);
  }, []);
  useEffect(() => {
    // Only when the message changed from outside (another step selected), not as it is typed.
    if (box.current && value !== last.current) {
      box.current.innerHTML = mdToHtml(value, placeholder);
      last.current = value;
    }
  }, [value]);
  const emit = () => {
    if (!box.current) return;
    const md = toMarkdown(box.current);
    last.current = md;
    onChange(md);
  };
  const remember = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && box.current?.contains(sel.anchorNode)) caret.current = sel.getRangeAt(0).cloneRange();
  };
  const run = (cmd: string, arg?: string) => {
    box.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };
  const insert = (text: string) => {
    box.current?.focus();
    const sel = window.getSelection();
    if (caret.current && sel) {
      sel.removeAllRanges();
      sel.addRange(caret.current);
    }
    document.execCommand('insertText', false, text);
    emit();
  };
  const tool = (title: string, Icon: LucideIcon, action: () => void) => (
    <button key={title} type="button" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={action} className="p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-ink">
      <Icon className="size-4" />
    </button>
  );
  return (
    <div className="border border-zinc-300 bg-snow focus-within:border-accent-600 focus-within:ring-2 focus-within:ring-accent-600/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-1 py-0.5">
        {tool('Bold', Bold, () => run('bold'))}
        {tool('Italic', Italic, () => run('italic'))}
        {tool('Heading', Heading2, () => run('formatBlock', 'h2'))}
        {tool('Bulleted list', List, () => run('insertUnorderedList'))}
        {tool('Numbered list', ListOrdered, () => run('insertOrderedList'))}
        {tool('Link', Link2, () => {
          remember();
          const url = window.prompt('Link address (starting with https://)', 'https://');
          if (url && /^(https?:\/\/|mailto:)\S+$/i.test(url.trim())) {
            const sel = window.getSelection();
            if (caret.current && sel) {
              sel.removeAllRanges();
              sel.addRange(caret.current);
            }
            run('createLink', url.trim());
          }
        })}
        {answers.length > 0 && (
          <span className="ms-auto">
            <Listbox
              searchable
              label="Put an answer in the message"
              value={null}
              align="end"
              trigger={{
                className: 'inline-flex h-7 items-center gap-1.5 px-2 text-xs font-medium text-accent-700 hover:bg-accent-50',
                children: (
                  <>
                    <Variable className="size-3.5" /> Insert answer
                  </>
                ),
              }}
              options={answers.map(answerOption)}
              onChange={(k) => insert(placeholder(k))}
            />
          </span>
        )}
      </div>
      <div
        ref={box}
        role="textbox"
        aria-multiline
        aria-label={label}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onKeyUp={remember}
        onMouseUp={remember}
        onBlur={remember}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        className={cx(
          'min-h-32 max-h-80 overflow-y-auto px-3 py-2 text-sm outline-none',
          '[&_a]:text-accent-700 [&_a]:underline [&_h3]:text-base [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:ps-5',
        )}
      />
    </div>
  );
}
