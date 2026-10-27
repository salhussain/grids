import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { StreamLanguage } from '@codemirror/language';
import { r } from '@codemirror/legacy-modes/mode/r';
import type { CompletionContext } from '@codemirror/autocomplete';
import { EditorState, RangeSet, StateEffect, StateField } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo, useRef } from 'react';

export type CodeLanguage = 'python' | 'r' | 'javascript';

const PLACEHOLDER: Record<CodeLanguage, string> = {
  python: '# Set `result` to a data frame',
  r: '# Set `result` to a data.frame',
  javascript: '// Return a list of rows',
};

/** The red dot in the gutter of a line with a breakpoint. */
class Dot extends GutterMarker {
  override toDOM() {
    const d = document.createElement('span');
    d.style.cssText =
      'display:block;width:10px;height:10px;margin:4px auto 0;border-radius:50%;background:#da1e28;box-shadow:0 0 0 2px rgb(218 30 40 / .25)';
    d.title = 'Breakpoint: click to remove';
    return d;
  }
}
const dot = new Dot();
const flip = StateEffect.define<number>({ map: (pos, change) => change.mapPos(pos) });
const marks = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects)
      if (e.is(flip)) {
        let has = false;
        set.between(e.value, e.value, () => void (has = true));
        set = has
          ? set.update({ filter: (from) => from !== e.value })
          : set.update({ add: [dot.range(e.value)] });
      }
    return set;
  },
});
/** Click a line number to mark a line to stop at (and look at the variables on). */
const breakpointGutter = [
  marks,
  gutter({
    class: 'cm-breakpoints',
    markers: (v) => v.state.field(marks),
    initialSpacer: () => dot,
    domEventHandlers: {
      mousedown(view, line) {
        view.dispatch({ effects: flip.of(line.from) });
        return true;
      },
    },
  }),
  EditorView.baseTheme({
    '.cm-breakpoints': { width: '18px', cursor: 'pointer' },
    '.cm-breakpoints:hover': { background: 'rgb(218 30 40 / .06)' },
  }),
];

const lines = (v: EditorView) => {
  const out: number[] = [];
  v.state
    .field(marks)
    .between(0, v.state.doc.length, (from) => void out.push(v.state.doc.lineAt(from).number));
  return [...new Set(out)].sort((a, b) => a - b);
};

/** The code editor for datasets written in Python, R or JavaScript. */
export default function ScriptEditor({
  value,
  onChange,
  onRun,
  onRunNew,
  onDebug,
  onBreakpoints,
  parameters = [],
  language,
  height = '260px',
}: {
  value: string;
  onChange(v: string): void;
  onRun(): void;
  onRunNew?(): void;
  onDebug?(): void;
  /** The marked lines, whenever they change (they move as the code is edited). */
  onBreakpoints?(lines: number[]): void;
  /** The dataset's parameters, offered as `params…` while typing. */
  parameters?: { name: string; label: string; type: string }[];
  language: CodeLanguage;
  height?: string;
}) {
  const last = useRef('');
  const known = useRef(parameters);
  known.current = parameters;
  const extensions = useMemo(
    () => [
      language === 'python' ? python() : language === 'r' ? StreamLanguage.define(r) : javascript(),
      EditorState.languageData.of(() => [
        {
          autocomplete: (ctx: CompletionContext) => {
            const m = ctx.matchBefore(/[\w$.["']*/);
            if (!m || !'params'.startsWith(m.text.slice(0, 6)) || !known.current.length)
              return null;
            const use = (n: string) =>
              language === 'r'
                ? `params$${n}`
                : language === 'javascript'
                  ? `params.${n}`
                  : `params["${n}"]`;
            return {
              from: m.from,
              options: known.current
                .filter((p) => p.name)
                .map((p) => ({
                  label: use(p.name),
                  type: 'variable',
                  detail: p.type,
                  info: p.label || undefined,
                  boost: 99,
                })),
            };
          },
        },
      ]),
      breakpointGutter,
      EditorView.updateListener.of((u) => {
        const l = lines(u.view);
        const key = l.join(',');
        if (key !== last.current) {
          last.current = key;
          onBreakpoints?.(l);
        }
      }),
    ],
    [language],
  );
  return (
    <div
      className={height === '100%' ? 'h-full' : undefined}
      onKeyDownCapture={(e) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        const act =
          e.key === 'Enter'
            ? e.shiftKey
              ? onDebug
              : onRun
            : e.key === '\\'
              ? onRunNew
              : undefined;
        if (!act) return;
        e.preventDefault();
        e.stopPropagation();
        act();
      }}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        height={height}
        extensions={extensions}
        theme={document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'}
        placeholder={PLACEHOLDER[language]}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          indentOnInput: true,
        }}
        className="text-[13px] [&_.cm-editor]:outline-none [&_.cm-scroller]:font-mono [&_.cm-lineNumbers_.cm-gutterElement]:!px-1"
      />
    </div>
  );
}
