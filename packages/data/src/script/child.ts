/**
 * Runs one script in its own process and writes one JSON answer. Started by `runScript` with Node's permission model
 * on (no writing files, no child processes, no workers unless R needs one), an empty environment, and a memory cap.
 * The code itself runs inside WebAssembly (Python, R) or a QuickJS engine (JavaScript), and before it starts the
 * network and DNS are switched off in this process as a second layer. None of this is a substitute for an operating
 * system sandbox: see SCRIPT_SANDBOX_CMD.
 */
import { createRequire } from 'node:module';
import process from 'node:process';
import type { DebugHit, ScriptRequest, ScriptResponse } from './types.js';

const out = (r: ScriptResponse) => {
  process.stdout.write(JSON.stringify(r), () => process.exit(0));
};

async function readRequest(): Promise<ScriptRequest> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ScriptRequest;
}

/** Switches off outbound connections and name lookups for the rest of this process. */
function noNetwork() {
  const load = createRequire(import.meta.url);
  const deny = () => {
    throw new Error('Scripts cannot use the network');
  };
  const swap = (o: Record<string, unknown>, k: string) => {
    try {
      o[k] = deny;
    } catch {
      /* not replaceable */
    }
  };
  const net = load('node:net') as Record<string, unknown> & { Socket: { prototype: Record<string, unknown> } };
  swap(net.Socket.prototype, 'connect');
  swap(net, 'connect');
  swap(net, 'createConnection');
  const dns = load('node:dns') as Record<string, unknown> & { promises: Record<string, unknown> };
  for (const k of Object.keys(dns)) if (/^(lookup|resolve|reverse)/.test(k) && typeof dns[k] === 'function') swap(dns, k);
  for (const k of Object.keys(dns.promises)) if (/^(lookup|resolve|reverse)/.test(k)) swap(dns.promises, k);
  swap(load('node:dgram') as Record<string, unknown>, 'createSocket');
  swap(load('node:tls') as Record<string, unknown>, 'connect');
  swap(load('node:http2') as Record<string, unknown>, 'connect');
}

/** Takes the host's own handles away from code that can reach the JavaScript globals (Pyodide's `js` module). */
function stripGlobals() {
  const g = globalThis as Record<string, unknown>;
  for (const k of ['process', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'require', 'module', 'Worker', 'MessageChannel', 'BroadcastChannel']) {
    try {
      delete g[k];
    } catch {
      /* not removable: left as it is */
    }
  }
}

const cleanRows = (rows: unknown, limit: number): { columns: string[]; rows: Record<string, unknown>[]; truncated: boolean } => {
  if (!Array.isArray(rows)) throw new Error('The script must produce a table: a data frame, or a list of rows');
  const list = rows as Record<string, unknown>[];
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const r of list.slice(0, 2000)) for (const k of Object.keys(r ?? {})) if (!seen.has(k)) (seen.add(k), columns.push(k));
  return { columns, rows: list.slice(0, limit), truncated: list.length > limit };
};

const MAX_HITS = 50;
const MAX_VARS = 40;
const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);
const STOP = '__DEBUG_STOP__';

/** A value as a short line of text, and what kind of thing it is. */
function describe(v: unknown): { type: string; preview: string } {
  if (Array.isArray(v)) {
    const head = v.slice(0, 5);
    return { type: v.length && typeof v[0] === 'object' ? `table, ${v.length} rows` : `list, ${v.length}`, preview: clip(head.map((x) => JSON.stringify(x)).join('\n') + (v.length > 5 ? `\n… ${v.length - 5} more` : '')) };
  }
  if (v === null) return { type: 'null', preview: 'null' };
  if (typeof v === 'object') return { type: 'object', preview: clip(JSON.stringify(v)) };
  return { type: typeof v, preview: clip(String(v)) };
}

/** Python: a tracer that looks at the variables whenever a marked line is about to run, and can stop there. */
const PY_DEBUG = `
import sys, json
__dbg_cfg = json.loads(__dbg_json)
__dbg_lines = set(__dbg_cfg["lines"])
__dbg_stop = bool(__dbg_cfg["stop"])
__dbg_hits = []
__dbg_on = False
class __DebugStop(BaseException):
    pass
def __dbg_show(v):
    try:
        import pandas as pd
        if isinstance(v, pd.DataFrame):
            return ("table, %d rows" % v.shape[0], "%d rows x %d columns\\n%s" % (v.shape[0], v.shape[1], v.head(5).to_string(max_cols=12)))
        if isinstance(v, pd.Series):
            return ("series, %d values" % len(v), v.head(5).to_string())
    except ImportError:
        pass
    return (type(v).__name__, repr(v))
def __dbg_trace(frame, event, arg):
    if not __dbg_on or frame.f_code.co_filename != "<exec>":
        return None
    if event == "line" and frame.f_lineno in __dbg_lines:
        if len(__dbg_hits) < ${MAX_HITS}:
            found = []
            ns = dict(frame.f_globals)
            ns.update(frame.f_locals)
            for k, v in ns.items():
                if k.startswith("_") or k == "tables" or callable(v) or type(v).__name__ == "module":
                    continue
                if len(found) >= ${MAX_VARS}:
                    break
                try:
                    t, p = __dbg_show(v)
                except Exception:
                    t, p = type(v).__name__, "?"
                found.append({"name": k, "type": t, "preview": p[:400]})
            __dbg_hits.append({"line": frame.f_lineno, "vars": found})
        if __dbg_stop:
            raise __DebugStop()
    return __dbg_trace
sys.settrace(__dbg_trace)
`;

async function runJavaScript(req: ScriptRequest) {
  const { getQuickJS } = await import('quickjs-emscripten');
  const QuickJS = await getQuickJS();
  const rt = QuickJS.newRuntime();
  rt.setMemoryLimit(512 * 1024 * 1024);
  rt.setMaxStackSize(1024 * 1024);
  const vm = rt.newContext();
  const logs: string[] = [];
  const hits: DebugHit[] = [];
  let stopped = false;
  try {
    const log = vm.newFunction('log', (...args) => {
      logs.push(args.map((a) => String(vm.dump(a))).join(' '));
    });
    const con = vm.newObject();
    vm.setProp(con, 'log', log);
    vm.setProp(vm.global, 'console', con);
    log.dispose();
    con.dispose();
    // Breakpoints: a call is put in front of each marked line that hands over the variables the code has declared.
    let code = req.code;
    if (req.debug?.lines.length) {
      const names = [...new Set([...req.code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!)), 'result', 'params', 'tables'];
      const grab = `(function(){var o={};${names.map((n) => `try{o[${JSON.stringify(n)}]=${n}}catch(e){}`).join('')}return o})()`;
      const marked = new Set(req.debug.lines);
      code = req.code.split('\n').map((line, i) => (marked.has(i + 1) ? `__bp(${i + 1}, ${grab}); ${line}` : line)).join('\n');
      const bp = vm.newFunction('__bp', (lineH, varsH) => {
        if (hits.length < MAX_HITS) {
          const o = vm.dump(varsH) as Record<string, unknown>;
          hits.push({ line: Number(vm.dump(lineH)), vars: Object.entries(o).filter(([, v]) => v !== undefined && typeof v !== 'function').slice(0, MAX_VARS).map(([name, v]) => ({ name, ...describe(v) })) });
        }
        if (req.debug!.stop) throw new Error(STOP);
      });
      vm.setProp(vm.global, '__bp', bp);
      bp.dispose();
    }
    const tables = Object.fromEntries(req.tables.map((t) => [t.name, t.rows]));
    // The code is a function body: it returns the rows, or sets `result`.
    const program = `(function () { const tables = ${JSON.stringify(tables)}; const params = ${JSON.stringify(req.params ?? {})}; let result; const run = function (tables) {\n${code}\n}; const returned = run(tables); const out = returned !== undefined ? returned : result; return JSON.stringify(out === undefined ? null : out); })()`;
    const res = vm.evalCode(program);
    if (res.error) {
      const e = vm.dump(res.error) as { name?: string; message?: string };
      res.error.dispose();
      if (req.debug && e.message === STOP) {
        stopped = true;
        return { columns: [], rows: [], truncated: false, log: logs.join('\n'), debug: { hits, stopped } };
      }
      throw new Error(`${e.name ?? 'Error'}: ${e.message ?? 'The script failed'}`);
    }
    const text = vm.getString(res.value);
    res.value.dispose();
    return { ...cleanRows(JSON.parse(text), req.limit), log: logs.join('\n'), ...(req.debug && { debug: { hits, stopped } }) };
  } finally {
    vm.dispose();
    rt.dispose();
  }
}

async function runPython(req: ScriptRequest) {
  const { loadPyodide } = await import('pyodide');
  const py = await loadPyodide({ stdout: () => undefined, stderr: () => undefined });
  const needsFrames = /\b(pandas|pd|numpy|np)\b/.test(req.code) || req.tables.length > 0;
  if (needsFrames) await py.loadPackage(['pandas', 'numpy'], { messageCallback: () => undefined, errorCallback: () => undefined });
  noNetwork();
  const logs: string[] = [];
  py.setStdout({ batched: (s: string) => logs.push(s) });
  py.setStderr({ batched: (s: string) => logs.push(s) });
  py.globals.set('__params_json', JSON.stringify(req.params ?? {}));
  py.globals.set('__tables_json', JSON.stringify(Object.fromEntries(req.tables.map((t) => [t.name, t.rows]))));
  py.runPython(`
import json
params = json.loads(__params_json)
tables = {}
if ${needsFrames ? 'True' : 'False'}:
    import pandas as pd
    for _name, _rows in json.loads(__tables_json).items():
        tables[_name] = pd.DataFrame(_rows)
        globals()[_name] = tables[_name]
result = None
`);
  stripGlobals();
  let stopped = false;
  if (req.debug?.lines.length) {
    py.globals.set('__dbg_json', JSON.stringify(req.debug));
    py.runPython(PY_DEBUG);
    py.globals.set('__dbg_on', true);
  }
  try {
    await py.runPythonAsync(req.code);
  } catch (e) {
    if (req.debug?.lines.length && /__DebugStop/.test(e instanceof Error ? e.message : String(e))) stopped = true;
    else throw e;
  } finally {
    if (req.debug?.lines.length) {
      py.globals.set('__dbg_on', false);
      py.runPython('import sys\nsys.settrace(None)');
    }
  }
  const hits = req.debug?.lines.length ? (JSON.parse(py.runPython('json.dumps(__dbg_hits)') as string) as DebugHit[]) : [];
  const debug = req.debug ? { debug: { hits, stopped } } : {};
  if (stopped) return { columns: [], rows: [], truncated: false, log: logs.join('\n'), ...debug };
  const answer = py.runPython(`
import json
def __finish(r):
    try:
        import pandas as pd
        if isinstance(r, pd.DataFrame):
            return r.to_json(orient="records", date_format="iso")
        if isinstance(r, pd.Series):
            return r.to_frame().to_json(orient="records", date_format="iso")
    except ImportError:
        pass
    if r is None:
        raise ValueError("Set result to a data frame, or a list of rows (result = ...)")
    return json.dumps(r, default=str)
__finish(result)
`) as string;
  return { ...cleanRows(JSON.parse(answer), req.limit), log: logs.join('\n'), ...debug };
}

async function runR(req: ScriptRequest) {
  const { WebR } = await import('webr');
  const webR = new WebR({ interactive: false });
  await webR.init();
  try {
    for (const t of req.tables) {
      const cols = [...new Set(t.rows.flatMap((r) => Object.keys(r)))];
      const data: Record<string, (string | number | boolean | null)[]> = Object.fromEntries(cols.map((c) => [c, t.rows.map((r) => (r[c] ?? null) as string | number | boolean | null)]));
      const list = await new webR.RList(data as never);
      await webR.objs.globalEnv.bind(`.${t.name}_cols`, list);
      await webR.evalRVoid(`${t.name} <- as.data.frame(lapply(.${t.name}_cols, function(x) if (is.list(x)) unlist(lapply(x, function(v) if (is.null(v)) NA else v)) else x), stringsAsFactors = FALSE); rm(.${t.name}_cols)`);
    }
    noNetwork();
    stripGlobals();
    const shelter = await new webR.Shelter();
    try {
      const rParams = Object.entries(req.params ?? {}).map(([k, v]) => `${k} = ${typeof v === 'number' ? v : JSON.stringify(v)}`).join(', ');
      const dbg = req.debug?.lines.length ? req.debug : null;
      let code = req.code;
      if (dbg) {
        // A call in front of each marked line looks at the variables (and stops there if asked to).
        const marked = new Set(dbg.lines);
        code = req.code.split('\n').map((l, i) => (marked.has(i + 1) ? `.dbg(${i + 1}); ${l}` : l)).join('\n');
        await shelter.evalR(
          `.dbg_out <- character(0); .dbg_n <- 0
.dbg <- function(line) {
  .dbg_n <<- .dbg_n + 1
  if (.dbg_n <= ${MAX_HITS}) {
    for (nm in head(setdiff(ls(globalenv()), "tables"), ${MAX_VARS})) {
      v <- get(nm, envir = globalenv())
      if (is.function(v)) next
      txt <- paste(utils::capture.output(print(if (is.data.frame(v)) utils::head(v, 5) else v)), collapse = "\\n")
      cls <- if (is.data.frame(v)) paste0("table, ", nrow(v), " rows") else class(v)[1]
      .dbg_out <<- c(.dbg_out, paste(.dbg_n, line, nm, cls, substr(txt, 1, 400), sep = "\\x1f"))
    }
  }
  ${dbg.stop ? `stop("${STOP}")` : ''}
}`,
        );
      }
      let stopped = false;
      try {
        await shelter.evalR(`result <- NULL\nparams <- list(${rParams})\ntables <- list(${req.tables.map((t) => `${t.name} = ${t.name}`).join(', ')})\n${code}`);
      } catch (e) {
        if (dbg && String(e instanceof Error ? e.message : e).includes(STOP)) stopped = true;
        else throw e;
      }
      const hits: DebugHit[] = [];
      if (dbg) {
        const out = (await (await shelter.evalR('.dbg_out')).toJs()) as { values?: string[] };
        const byHit = new Map<number, DebugHit>();
        for (const row of out.values ?? []) {
          const [n, line, name, type, preview] = row.split('\x1f');
          const h = byHit.get(Number(n)) ?? { line: Number(line), vars: [] };
          h.vars.push({ name: name ?? '', type: type ?? '', preview: preview ?? '' });
          byHit.set(Number(n), h);
        }
        hits.push(...byHit.values());
      }
      const debug = dbg ? { debug: { hits, stopped } } : {};
      if (stopped) return { columns: [], rows: [], truncated: false, log: '', ...debug };
      const frame = await shelter.evalR('if (is.null(result)) stop("Set result to a data frame (result <- ...)"); as.data.frame(result)');
      const obj = (await frame.toJs()) as { names: string[] | null; values: { values: unknown[] }[] };
      const names = obj.names ?? [];
      const columns = obj.values.map((v) => v.values);
      const n = columns.reduce((m, c) => Math.max(m, c.length), 0);
      const rows = Array.from({ length: n }, (_, i) => Object.fromEntries(names.map((name, k) => [name, columns[k]![i] ?? null])));
      return { ...cleanRows(rows, req.limit), log: '', ...debug };
    } finally {
      await shelter.purge();
    }
  } finally {
    await webR.close();
  }
}

/** What went wrong in a line or two: the error, and which line of the person's code it was on. */
function explain(message: string): string {
  const lines = message.split('\n').filter((l) => l.trim());
  const at = [...message.matchAll(/File "<exec>", line (\d+)/g)].at(-1)?.[1];
  const last = lines.at(-1) ?? 'The script failed';
  return `${at ? `Line ${at}: ` : ''}${last}`.slice(0, 1000);
}

try {
  const req = await readRequest();
  const run = req.language === 'python' ? runPython : req.language === 'r' ? runR : runJavaScript;
  try {
    out({ ok: true, ...(await run(req)) });
  } catch (e) {
    out({ ok: false, error: e instanceof Error ? explain(e.message) : String(e), log: '' });
  }
} catch (e) {
  out({ ok: false, error: `The script could not start: ${e instanceof Error ? e.message : String(e)}`, log: '' });
}
