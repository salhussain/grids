import type { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { MariaSQL, MSSQL, MySQL, PLSQL, PostgreSQL, StandardSQL, sql } from '@codemirror/lang-sql';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo, useRef } from 'react';

const DIALECTS = {
  postgres: PostgreSQL,
  redshift: PostgreSQL,
  local: PostgreSQL,
  mysql: MySQL,
  mariadb: MariaSQL,
  mssql: MSSQL,
  oracle: PLSQL,
} as const;

/** The SQL editor: highlighting for the database's dialect and completion of its tables and columns. */
export default function SqlEditor({
  value,
  onChange,
  onRun,
  onRunNew,
  onSelection,
  dialect,
  schema,
  parameters = [],
  height = '260px',
}: {
  value: string;
  onChange(v: string): void;
  /** Runs the query, or just the selected part of it when something is selected. */
  onRun(selection?: string): void;
  onRunNew?(selection?: string): void;
  /** Told what is selected, whenever the selection changes. */
  onSelection?(text: string): void;
  /** A connection kind, or `local` for the embedded engine. */
  dialect: string;
  /** Table name to its column names. */
  schema: Record<string, string[]>;
  /** The dataset's parameters, offered as `:name` while typing. */
  parameters?: { name: string; label: string; type: string }[];
  height?: string;
}) {
  const selected = useRef('');
  // Read when suggestions are asked for, so a parameter added while the editor is open is offered at once.
  const params = useRef(parameters);
  params.current = parameters;
  const paramData = useMemo(
    () => ({
      autocomplete: (ctx: CompletionContext) => {
        // Offered after a colon (not the `::` of a cast), and among the ordinary suggestions when a word is started or on Ctrl+Space.
        const m = ctx.matchBefore(/(?<![:\w]):?[a-z0-9_]*/i);
        const list = params.current.filter((p) => p.name);
        if (!m || !list.length || (!m.text && !ctx.explicit)) return null;
        return {
          from: m.from,
          validFor: /^:?[a-z0-9_]*$/i,
          options: list.map((p) => ({ label: `:${p.name}`, type: 'variable', detail: p.type, info: p.label || undefined, boost: 99 })),
        };
      },
    }),
    [],
  );
  const extensions = useMemo(
    () => [
      sql({
        dialect: DIALECTS[dialect as keyof typeof DIALECTS] ?? StandardSQL,
        schema,
        upperCaseKeywords: true,
      }),
      // The dataset's own parameters, written `:name`. The source must be the same function each time it is asked for,
      // or CodeMirror drops its answers, so it is made once here and only handed out by the lookup.
      EditorState.languageData.of(() => [paramData]),
    ],
    [dialect, schema, paramData],
  );
  return (
    // Ctrl/Cmd+Enter runs the query: caught before the editor turns it into a new line.
    <div
      className={height === '100%' ? 'h-full' : undefined}
      onKeyDownCapture={(e) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        const act = e.key === 'Enter' ? onRun : e.key === '\\' ? onRunNew : undefined;
        if (!act) return;
        e.preventDefault();
        e.stopPropagation();
        act(selected.current || undefined);
      }}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        height={height}
        onStatistics={(st) => {
          selected.current = st.selectionCode;
          onSelection?.(st.selectionCode);
        }}
        extensions={extensions}
        theme={document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'}
        placeholder="select * from …"
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
        className="text-[13px] [&_.cm-editor]:outline-none [&_.cm-scroller]:font-mono [&_.cm-lineNumbers_.cm-gutterElement]:!px-1"
      />
    </div>
  );
}
