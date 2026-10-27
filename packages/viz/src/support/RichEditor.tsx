import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Extension, Node, mergeAttributes, type Editor, type Range } from '@tiptap/core';
import { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Suggestion from '@tiptap/suggestion';
import { cx } from '@grids/ui';
// @ts-ignore -- the package ships no types
import container from 'markdown-it-container';
import {
  Bold,
  ChevronRight,
  ChevronsUpDown,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Lightbulb,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Paperclip,
  Quote,
  SquareCode,
  Strikethrough,
} from 'lucide-react';
import { Markdown } from 'tiptap-markdown';
import { useContext, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { HIGHLIGHT_CSS, lowlight } from './highlight';
import { FilesCtx } from './markdown';

// ---------------------------------------------------------------- what the editor knows how to hold

const LANGUAGES: [string, string][] = [
  ['', 'Plaintext'],
  ['bash', 'Bash'],
  ['css', 'CSS'],
  ['html', 'HTML'],
  ['javascript', 'JavaScript'],
  ['json', 'JSON'],
  ['python', 'Python'],
  ['r', 'R'],
  ['sql', 'SQL'],
  ['typescript', 'TypeScript'],
  ['yaml', 'YAML'],
];

function CodeView({ node, updateAttributes }: NodeViewProps) {
  const lang = (node.attrs.language as string | null) ?? '';
  return (
    <NodeViewWrapper className="rich-code">
      <select
        contentEditable={false}
        aria-label="Language"
        value={LANGUAGES.some(([v]) => v === lang) ? lang : ''}
        onChange={(e) => updateAttributes({ language: e.target.value || null })}
        className="rich-code-lang"
      >
        {LANGUAGES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <pre>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
const Code3 = CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }).extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeView);
  },
});

/** `:::callout` … `:::` */
const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'rich-callout' }), 0],
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(':::callout\n');
          state.renderContent(node);
          state.ensureNewLine();
          state.write(':::');
          state.closeBlock(node);
        },
        parse: {
          setup(md: any) {
            md.use(container, 'callout', { render: (t: any[], i: number) => (t[i].nesting === 1 ? '<div data-callout>\n' : '</div>\n') });
          },
        },
      },
    };
  },
});

function DetailsView({ node, updateAttributes }: NodeViewProps) {
  return (
    <NodeViewWrapper className="rich-details">
      <div contentEditable={false} className="rich-details-head">
        <ChevronRight className="size-4 shrink-0" />
        <input aria-label="Section title" value={node.attrs.title as string} onChange={(e) => updateAttributes({ title: e.target.value })} placeholder="Title" />
      </div>
      <NodeViewContent className="rich-details-body" />
    </NodeViewWrapper>
  );
}
/** `:::details Title` … `:::` */
const Details = Node.create({
  name: 'details',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { title: { default: 'Details', parseHTML: (el) => el.getAttribute('data-title') ?? 'Details' } };
  },
  parseHTML: () => [{ tag: 'div[data-details]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-details': '', 'data-title': node.attrs.title }), 0],
  addNodeView() {
    return ReactNodeViewRenderer(DetailsView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`:::details ${String(node.attrs.title || 'Details').replace(/\n/g, ' ')}\n`);
          state.renderContent(node);
          state.ensureNewLine();
          state.write(':::');
          state.closeBlock(node);
        },
        parse: {
          setup(md: any) {
            md.use(container, 'details', {
              validate: (p: string) => /^details(\s|$)/.test(p.trim()),
              render: (t: any[], i: number) => {
                if (t[i].nesting !== 1) return '</div>\n';
                const title = t[i].info.trim().slice('details'.length).trim() || 'Details';
                return `<div data-details data-title="${md.utils.escapeHtml(title)}">\n`;
              },
            });
          },
        },
      },
    };
  },
});

const FILE = /^file:([0-9a-f-]{36})$/i;
function PictureView({ node }: NodeViewProps) {
  const files = useContext(FilesCtx);
  const src = node.attrs.src as string;
  const id = FILE.exec(src)?.[1];
  const [url, setUrl] = useState<string | null>(id ? null : src);
  useEffect(() => {
    if (!id) return;
    let live = true;
    files?.url(id).then((u) => live && setUrl(u), () => undefined);
    return () => {
      live = false;
    };
  }, [id, files]);
  return (
    <NodeViewWrapper className="my-1">
      {url ? <img src={url} alt={(node.attrs.alt as string) ?? ''} className="max-h-80 max-w-full border border-zinc-200" /> : <span className="inline-block h-24 w-40 animate-pulse bg-zinc-200" />}
    </NodeViewWrapper>
  );
}
/** Pictures that came with the conversation are linked as `file:<id>`; the stock Markdown parser would refuse that link. */
const Picture = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PictureView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`![${state.esc(node.attrs.alt || '')}](${node.attrs.src})`);
        },
        parse: {
          setup(md: any) {
            const stock = md.validateLink.bind(md);
            md.validateLink = (u: string) => /^file:/i.test(u.trim()) || stock(u);
          },
        },
      },
    };
  },
});

// ---------------------------------------------------------------- the `/` menu

interface Command {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  keys?: string;
  action?: 'media' | 'attach';
  run?(editor: Editor): void;
}
const COMMANDS: Command[][] = [
  [
    { id: 'h1', label: 'Heading 1', icon: Heading1, keys: '⌘⌥1', run: (e) => e.chain().focus().setNode('heading', { level: 1 }).run() },
    { id: 'h2', label: 'Heading 2', icon: Heading2, keys: '⌘⌥2', run: (e) => e.chain().focus().setNode('heading', { level: 2 }).run() },
    { id: 'h3', label: 'Heading 3', icon: Heading3, keys: '⌘⌥3', run: (e) => e.chain().focus().setNode('heading', { level: 3 }).run() },
  ],
  [
    { id: 'bullets', label: 'Bulleted list', icon: List, keys: '⌘⇧8', run: (e) => e.chain().focus().toggleBulletList().run() },
    { id: 'numbers', label: 'Numbered list', icon: ListOrdered, keys: '⌘⇧9', run: (e) => e.chain().focus().toggleOrderedList().run() },
    { id: 'checklist', label: 'Checklist', icon: ListChecks, keys: '⌘⇧7', run: (e) => e.chain().focus().toggleTaskList().run() },
  ],
  [
    { id: 'media', label: 'Insert media…', icon: ImageIcon, action: 'media' },
    { id: 'attach', label: 'Attach files…', icon: Paperclip, keys: '⌘⇧U', action: 'attach' },
  ],
  [
    { id: 'code', label: 'Code block', icon: SquareCode, keys: '⌘⇧\\', run: (e) => e.chain().focus().setCodeBlock().run() },
    {
      id: 'details',
      label: 'Collapsible section',
      icon: ChevronsUpDown,
      keys: '⌘⇧6',
      run: (e) => e.chain().focus().insertContent({ type: 'details', attrs: { title: 'Details' }, content: [{ type: 'paragraph' }] }).run(),
    },
    { id: 'quote', label: 'Blockquote', icon: Quote, keys: '⌥⇧.', run: (e) => e.chain().focus().toggleBlockquote().run() },
    { id: 'callout', label: 'Callout', icon: Lightbulb, run: (e) => e.chain().focus().insertContent({ type: 'callout', content: [{ type: 'paragraph' }] }).run() },
    { id: 'rule', label: 'Divider', icon: Minus, run: (e) => e.chain().focus().setHorizontalRule().run() },
  ],
];

interface MenuState {
  items: Command[];
  at: { x: number; y: number; up: boolean };
  pick(c: Command): void;
}
interface Bridge {
  open(m: MenuState | null): void;
  /** Arrow/Enter/Escape while the menu is open; true when handled. */
  key(e: KeyboardEvent): boolean;
  available(c: Command): boolean;
}

const Slash = (bridge: { current: Bridge }) =>
  Extension.create({
    name: 'slashMenu',
    addProseMirrorPlugins() {
      return [
        Suggestion<Command, Command>({
          editor: this.editor,
          char: '/',
          allowSpaces: false,
          items: ({ query }) => {
            const q = query.toLowerCase();
            return COMMANDS.flat().filter((c) => bridge.current.available(c) && (!q || c.label.toLowerCase().includes(q) || c.id.startsWith(q)));
          },
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: Command }) => {
            editor.chain().focus().deleteRange(range).run();
            bridge.current.open(null);
            if (props.run) props.run(editor);
            else (editor.storage as any).richActions?.(props.action);
          },
          render: () => {
            const show = (p: { items: Command[]; clientRect?: (() => DOMRect | null) | null; command(c: Command): void }) => {
              const r = p.clientRect?.();
              if (!r || !p.items.length) return bridge.current.open(null);
              const up = r.bottom + 330 > window.innerHeight && r.top > 330;
              bridge.current.open({ items: p.items, at: { x: r.left, y: up ? r.top : r.bottom, up }, pick: p.command });
            };
            return {
              onStart: show,
              onUpdate: show,
              onKeyDown: ({ event }) => bridge.current.key(event),
              onExit: () => bridge.current.open(null),
            };
          },
        }),
      ];
    },
  });

// ---------------------------------------------------------------- the editor

const STYLE = `
.grids-rich{font-size:.875rem;line-height:1.6;outline:none}
.grids-rich>*+*{margin-top:.6em}
.grids-rich h1{font-size:1.4rem;font-weight:650;line-height:1.3}
.grids-rich h2{font-size:1.2rem;font-weight:650;line-height:1.3}
.grids-rich h3{font-size:1.05rem;font-weight:650;line-height:1.3}
.grids-rich ul{list-style:disc;padding-inline-start:1.4em}
.grids-rich ol{list-style:decimal;padding-inline-start:1.4em}
.grids-rich ul[data-type=taskList]{list-style:none;padding-inline-start:.1em}
.grids-rich ul[data-type=taskList] li{display:flex;gap:.55em;align-items:flex-start}
.grids-rich ul[data-type=taskList] li>label{margin-top:.25em;user-select:none}
.grids-rich ul[data-type=taskList] li[data-checked=true]>div{color:var(--color-zinc-400,#a1a1aa);text-decoration:line-through}
.grids-rich ul[data-type=taskList] li>div{flex:1}
.grids-rich li p,.grids-rich li>*+*{margin-top:0}
.grids-rich blockquote{border-inline-start:3px solid var(--color-zinc-300,#d4d4d8);padding-inline-start:.9em;color:var(--color-zinc-600,#52525b)}
.grids-rich code{background:var(--color-zinc-100,#f4f4f5);padding:.1em .35em;font-size:.85em;font-family:var(--font-mono,ui-monospace,monospace)}
.grids-rich a{color:var(--color-accent-700,#1d6b5f);text-decoration:underline}
.grids-rich hr{border:0;border-top:1px solid var(--color-zinc-200,#e4e4e7);margin:1em 0}
.grids-rich .rich-code{position:relative;background:var(--color-zinc-100,#f4f4f5);border-radius:6px}
.grids-rich .rich-code pre{padding:1.9em .9em .7em;overflow-x:auto}
.grids-rich .rich-code pre code{background:none;padding:0}
.grids-rich .rich-code-lang{position:absolute;top:.35em;inset-inline-start:.5em;background:transparent;font-size:.75rem;color:var(--color-zinc-500,#71717a);border:0;outline:none;cursor:pointer}
.grids-rich .rich-callout{border-radius:8px;background:var(--color-accent-50,#eef7f5);border:1px solid var(--color-accent-200,#bfe0da);padding:.55em .8em}
.grids-rich .rich-details{border:1px solid var(--color-zinc-200,#e4e4e7);border-radius:8px;padding:.3em .8em .5em}
.grids-rich .rich-details-head{display:flex;align-items:center;gap:.4em;font-weight:600}
.grids-rich .rich-details-head input{flex:1;background:transparent;outline:none;font-weight:600}
.grids-rich .rich-details-body{padding-inline-start:1.4em}
.grids-rich p.is-editor-empty:first-child::before{content:attr(data-placeholder);float:left;height:0;pointer-events:none;color:var(--color-zinc-400,#a1a1aa)}
.grids-rich .ProseMirror-selectednode{outline:2px solid var(--color-accent-500,#2f8f80)}
`;

/**
 * A text box for conversations that shows the formatting as you write it: headings, lists, checklists, code, callouts,
 * collapsible sections and pictures, with a `/` menu to add them. What it hands back is still Markdown, so the page
 * that shows the message (and the people who get it by email) need nothing new.
 */
export function RichEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  label,
  minRows = 5,
  onAttach,
  onMedia,
  tone = 'plain',
  autoFocus,
}: {
  value: string;
  onChange(v: string): void;
  /** ⌘↵ */
  onSubmit?(): void;
  placeholder?: string;
  label: string;
  minRows?: number;
  /** Opens the picker for files that go with the message (the "Attach files" command). */
  onAttach?(): void;
  /** Uploads a picture and returns what to link it by (`file:<id>`); without it the command is left out. */
  onMedia?(file: File): Promise<{ id: string; name: string }>;
  tone?: 'plain' | 'note';
  autoFocus?: boolean;
}) {
  const media = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const last = useRef(value);
  const live = useRef({ onChange, onSubmit, onAttach, onMedia, menu, active });
  live.current = { onChange, onSubmit, onAttach, onMedia, menu, active };

  const bridge = useRef<Bridge>({
    open: (m) => (setMenu(m), setActive(0)),
    key: (e) => {
      const m = live.current.menu;
      if (!m) return false;
      if (e.key === 'ArrowDown') return (setActive((a) => (a + 1) % m.items.length), true);
      if (e.key === 'ArrowUp') return (setActive((a) => (a - 1 + m.items.length) % m.items.length), true);
      if (e.key === 'Enter' || e.key === 'Tab') return (m.pick(m.items[live.current.active] ?? m.items[0]!), true);
      if (e.key === 'Escape') return (setMenu(null), true);
      return false;
    },
    available: (c) => (c.action !== 'media' || !!live.current.onMedia) && (c.action !== 'attach' || !!live.current.onAttach),
  });

  const extensions = useMemo(
    () => [
      StarterKit.configure({ codeBlock: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
      Code3,
      TaskList,
      TaskItem.configure({ nested: true }),
      Picture,
      Callout,
      Details,
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      Markdown.configure({ html: false, tightLists: true, linkify: true, breaks: true, transformPastedText: true }),
      Slash(bridge),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const editor = useEditor({
    extensions,
    content: value,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: 'grids-rich px-4 py-3', 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' },
      handleKeyDown: (_v, e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key === 'Enter') return (e.preventDefault(), live.current.onSubmit?.(), true);
        if (mod && e.shiftKey && e.code === 'KeyU' && live.current.onAttach) return (e.preventDefault(), live.current.onAttach(), true);
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      // Checklist items come out one per paragraph; keep a list together.
      const md = ((ed.storage as any).markdown.getMarkdown() as string).trimEnd().replace(/^(\s*(?:[-*]|\d+\.) .*)\n\n(?=\s*(?:[-*]|\d+\.) )/gm, '$1\n');
      last.current = md;
      live.current.onChange(md);
    },
  });
  // The message is cleared (or set) from outside, for instance after it is sent.
  useEffect(() => {
    if (editor && value !== last.current) {
      last.current = value;
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);
  useEffect(() => {
    if (!editor) return;
    (editor.storage as any).richActions = (a: 'media' | 'attach') => (a === 'media' ? media.current?.click() : live.current.onAttach?.());
  }, [editor]);

  const link = () => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link address', prev ?? 'https://');
    if (url === null) return;
    if (!url.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else if (/^(https?:\/\/|mailto:)/i.test(url.trim())) editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };
  const tool = (title: string, Icon: ComponentType<{ className?: string }>, fn: () => void, on?: boolean) => (
    <button key={title} type="button" title={title} aria-label={title} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={fn} className={cx('flex size-7 items-center justify-center text-zinc-600 hover:bg-black/5 hover:text-ink', on && 'bg-black/5 text-ink')}>
      <Icon className="size-4" />
    </button>
  );
  const sep = <span className="mx-0.5 h-4 w-px bg-black/10" aria-hidden />;
  const c = editor?.chain().focus();
  return (
    <div className={cx('relative', tone === 'note' ? 'bg-accent-50' : 'bg-snow')}>
      <style>{STYLE + HIGHLIGHT_CSS}</style>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-black/5 px-2 py-1">
        {tool('Bold (⌘B)', Bold, () => c?.toggleBold().run(), editor?.isActive('bold'))}
        {tool('Italic (⌘I)', Italic, () => c?.toggleItalic().run(), editor?.isActive('italic'))}
        {tool('Strikethrough', Strikethrough, () => c?.toggleStrike().run(), editor?.isActive('strike'))}
        {tool('Code', Code, () => c?.toggleCode().run(), editor?.isActive('code'))}
        {tool('Link (⌘K)', Link2, link, editor?.isActive('link'))}
        {sep}
        {tool('Heading', Heading2, () => c?.toggleHeading({ level: 2 }).run(), editor?.isActive('heading'))}
        {tool('Bulleted list', List, () => c?.toggleBulletList().run(), editor?.isActive('bulletList'))}
        {tool('Numbered list', ListOrdered, () => c?.toggleOrderedList().run(), editor?.isActive('orderedList'))}
        {tool('Checklist', ListChecks, () => c?.toggleTaskList().run(), editor?.isActive('taskList'))}
        {tool('Quote', Quote, () => c?.toggleBlockquote().run(), editor?.isActive('blockquote'))}
        {tool('Code block', SquareCode, () => c?.toggleCodeBlock().run(), editor?.isActive('codeBlock'))}
        {onMedia && tool('Insert a picture', ImageIcon, () => media.current?.click())}
        <span className="ms-auto hidden text-[11px] text-zinc-400 sm:inline">
          Type <kbd className="border border-zinc-300 px-1">/</kbd> for commands
        </span>
      </div>
      <div style={{ minHeight: `${minRows * 1.4}rem` }} onClick={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}>
        <EditorContent editor={editor} />
      </div>
      <input
        ref={media}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f || !onMedia || !editor) return;
          setBusy(true);
          try {
            const up = await onMedia(f);
            editor.chain().focus().insertContent({ type: 'image', attrs: { src: `file:${up.id}`, alt: up.name } }).run();
          } finally {
            setBusy(false);
          }
        }}
      />
      {busy && <div className="absolute end-3 top-11 text-xs text-zinc-500">Uploading…</div>}
      {menu && (
        <div
          role="listbox"
          aria-label="Commands"
          style={{ position: 'fixed', left: Math.min(menu.at.x, window.innerWidth - 300), top: menu.at.up ? undefined : menu.at.y + 6, bottom: menu.at.up ? window.innerHeight - menu.at.y + 6 : undefined }}
          className="z-50 max-h-80 w-72 overflow-y-auto rounded-lg border border-zinc-200 bg-snow py-1.5 shadow-xl"
        >
          {menu.items.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), menu.pick(c))}
              onMouseEnter={() => setActive(i)}
              className={cx('flex w-full items-center gap-3 px-3 py-1.5 text-start text-sm', i === active && 'bg-zinc-100')}
            >
              <c.icon className="size-4 shrink-0 text-zinc-500" />
              <span className="flex-1">{c.label}</span>
              {c.keys && <span className="text-xs text-zinc-400">{c.keys}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
