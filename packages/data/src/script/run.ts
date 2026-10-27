import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScriptLanguage, ScriptRequest, ScriptResponse } from './types.js';

export interface ScriptOptions {
  /** Most rows to hand back. */
  limit: number;
  timeoutMs: number;
  /** Memory the script's process may use, in MB. */
  memoryMb?: number;
}

const require = createRequire(import.meta.url);
const CHILD = fileURLToPath(new URL('./child.js', import.meta.url));

/** The `node_modules` folder the engines are read from (they are read-only to the script's process). */
function modulesRoot(): string {
  const real = realpathSync(dirname(require.resolve('pyodide/package.json')));
  const i = real.indexOf(`${sep}node_modules${sep}`);
  return i >= 0 ? real.slice(0, i + `${sep}node_modules`.length) : dirname(real);
}

/** Whether running scripts has been switched on. Off in production unless SCRIPTS_ENABLED says so. */
export const scriptsEnabled = () => (process.env.SCRIPTS_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true';

/**
 * Runs a script over some tables in a separate process and returns the table it produced. JavaScript is fully locked
 * down (QuickJS plus Node's permission model). Python and R run as WebAssembly with an empty environment and no network
 * inside the process, which is a convenience boundary, not a security one. Put an operating system sandbox in front
 * before running other people's code: SCRIPT_SANDBOX_CMD is a command that runs what follows it (e.g.
 * `bwrap --unshare-net --ro-bind / / --dev /dev` or `firejail --net=none --quiet`).
 */
export async function runScript(req: ScriptRequest, opts: ScriptOptions): Promise<Extract<ScriptResponse, { ok: true }>> {
  if (!scriptsEnabled()) throw new Error('Scripts are switched off on this server (set SCRIPTS_ENABLED=true)');
  const root = modulesRoot();
  const wrapper = (process.env.SCRIPT_SANDBOX_CMD ?? '').trim().split(/\s+/).filter(Boolean);
  // JavaScript runs in the QuickJS engine, so Node's permission model can lock the whole process down. Pyodide and
  // WebR need parts of Node that model forbids, so for Python and R the process is cut off in other ways: an empty
  // environment, an empty folder to work in, no network inside the process, and the operating system sandbox below.
  const locked =
    req.language === 'javascript'
      ? ['--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${dirname(CHILD)}`, `--allow-fs-read=${join(dirname(CHILD), '..', '..')}`]
      : [];
  const flags = [...locked, `--max-old-space-size=${opts.memoryMb ?? 1024}`, '--disable-warning=ExperimentalWarning'];
  const [cmd, ...pre] = wrapper.length ? [...wrapper, process.execPath] : [process.execPath];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd!, [...pre, ...flags, CHILD], { cwd: req.language === 'javascript' ? dirname(CHILD) : tmpdir(), env: { NODE_ENV: 'production' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error('The script took too long')));
    }, opts.timeoutMs);
    child.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024 * 1024) {
        child.kill('SIGKILL');
        finish(() => reject(new Error('The script produced too much')));
      } else out.push(c);
    });
    let errText = '';
    child.stderr.on('data', (c: Buffer) => (errText = (errText + c.toString()).slice(-4000)));
    child.on('error', (e) => finish(() => reject(new Error(`The script could not start: ${e.message}`))));
    child.on('close', (code) =>
      finish(() => {
        const text = Buffer.concat(out).toString('utf8');
        if (!text) return reject(new Error(code === 137 || /heap|memory/i.test(errText) ? 'The script used too much memory' : `The script stopped without an answer${errText ? `: ${errText.split('\n').filter(Boolean).slice(-2).join(' ')}` : ''}`));
        const res = JSON.parse(text) as ScriptResponse;
        if (!res.ok) return reject(new Error(res.error));
        resolve(res);
      }),
    );
    const input: ScriptRequest = { language: req.language, code: req.code, tables: req.tables, limit: opts.limit, ...(req.params && { params: req.params }), ...(req.debug && { debug: req.debug }) };
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(input));
  });
}

export type { ScriptLanguage };
