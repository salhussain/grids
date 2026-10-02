/**
 * A small, safe expression language for forms (ODK/XLSForm-flavoured):
 *
 *   ${age} >= 18 and selected(${symptoms}, 'fever')
 *   if(${weight} > 0, round(${weight} / (${height} * ${height}), 1), '')
 *   . <= 120                      (`.` = the answer being constrained)
 *
 * Operators: or, and, not(), = != < <= > >=, + - * div mod (also / %), unary -.
 * No property access, no assignment, no loops: evaluation is a pure function of
 * the answers, so it runs identically in browsers, devices and on the server.
 */

export type Value = string | number | boolean | null | string[];
export type Answers = Record<string, unknown>;

type Node =
  | { k: 'lit'; v: Value }
  | { k: 'ref'; name: string }
  | { k: 'self' }
  | { k: 'un'; op: '-' | 'not'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] };

export class ExprError extends Error {}

type Tok = { t: 'num' | 'str' | 'ref' | 'id' | 'op' | 'dot' | '(' | ')' | ',' | 'eof'; v: string; pos: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const start = i;
    if (c === '$' && src[i + 1] === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw new ExprError(`Unclosed \${ at ${i}`);
      out.push({ t: 'ref', v: src.slice(i + 2, end).trim(), pos: start });
      i = end + 1;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      while (i < src.length && /[0-9.]/.test(src[i]!)) i++;
      out.push({ t: 'num', v: src.slice(start, i), pos: start });
    } else if (c === "'" || c === '"') {
      i++;
      let s = '';
      while (i < src.length && src[i] !== c) s += src[i++];
      if (src[i] !== c) throw new ExprError(`Unclosed string at ${start}`);
      i++;
      out.push({ t: 'str', v: s, pos: start });
    } else if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_-]/.test(src[i]!)) i++;
      out.push({ t: 'id', v: src.slice(start, i), pos: start });
    } else if (c === '.') {
      out.push({ t: 'dot', v: '.', pos: i++ });
    } else if ('(),'.includes(c)) {
      out.push({ t: c as '(' | ')' | ',', v: c, pos: i++ });
    } else {
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '!='].includes(two)) {
        out.push({ t: 'op', v: two, pos: i });
        i += 2;
      } else if ('=<>+-*/%'.includes(c)) {
        out.push({ t: 'op', v: c, pos: i++ });
      } else throw new ExprError(`Unexpected "${c}" at ${i}`);
    }
  }
  out.push({ t: 'eof', v: '', pos: src.length });
  return out;
}

const BINARY: Record<string, number> = {
  or: 1,
  and: 2,
  '=': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  div: 6,
  '%': 6,
  mod: 6,
};

/** Parses an expression into an AST (throws ExprError with a position on bad syntax). */
export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p]!;
  const next = () => toks[p++]!;
  const opOf = (tk: Tok) => (tk.t === 'op' || (tk.t === 'id' && ['and', 'or', 'div', 'mod'].includes(tk.v)) ? tk.v : null);

  function primary(): Node {
    const tk = next();
    switch (tk.t) {
      case 'num':
        return { k: 'lit', v: Number(tk.v) };
      case 'str':
        return { k: 'lit', v: tk.v };
      case 'ref':
        return { k: 'ref', name: tk.v };
      case 'dot':
        return { k: 'self' };
      case '(': {
        const e = expr(0);
        if (next().t !== ')') throw new ExprError(`Expected ) at ${tk.pos}`);
        return e;
      }
      case 'op':
        if (tk.v === '-') return { k: 'un', op: '-', a: unary() };
        break;
      case 'id': {
        if (tk.v === 'true' || tk.v === 'false') {
          if (peek().t === '(') {
            next();
            next();
          }
          return { k: 'lit', v: tk.v === 'true' };
        }
        if (peek().t !== '(') throw new ExprError(`Unknown name "${tk.v}" at ${tk.pos}; use \${${tk.v}} for answers`);
        next();
        const args: Node[] = [];
        if (peek().t !== ')') {
          do args.push(expr(0));
          while (peek().t === ',' && next());
        }
        if (next().t !== ')') throw new ExprError(`Expected ) after arguments of ${tk.v}`);
        if (tk.v === 'not') return { k: 'un', op: 'not', a: args[0] ?? { k: 'lit', v: null } };
        if (!Object.hasOwn(FUNCTIONS, tk.v)) throw new ExprError(`Unknown function ${tk.v}()`);
        return { k: 'call', fn: tk.v, args };
      }
    }
    throw new ExprError(`Unexpected ${tk.t === 'eof' ? 'end of expression' : `"${tk.v}"`} at ${tk.pos}`);
  }
  function unary(): Node {
    return primary();
  }
  function expr(minPrec: number): Node {
    let left = unary();
    for (;;) {
      const op = opOf(peek());
      const prec = op ? BINARY[op] : undefined;
      if (!op || prec === undefined || prec < minPrec) break;
      next();
      const right = expr(prec + 1);
      left = { k: 'bin', op, a: left, b: right };
    }
    return left;
  }
  const ast = expr(0);
  if (peek().t !== 'eof') throw new ExprError(`Unexpected "${peek().v}" at ${peek().pos}`);
  return ast;
}

const num = (v: Value): number => {
  if (v === null || v === '') return NaN;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Array.isArray(v)) return v.length;
  return Number(v);
};
const str = (v: Value): string => (v === null ? '' : Array.isArray(v) ? v.join(' ') : String(v));
export const truthy = (v: Value): boolean =>
  v === null ? false : typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 && !Number.isNaN(v) : Array.isArray(v) ? v.length > 0 : v !== '';
const list = (v: Value): string[] => (Array.isArray(v) ? v : v === null || v === '' ? [] : String(v).split(' '));

const FUNCTIONS: Record<string, (args: Value[]) => Value> = Object.assign(Object.create(null), {
  selected: ([a, b]) => list(a ?? null).includes(str(b ?? null)),
  'count-selected': ([a]) => list(a ?? null).length,
  if: ([c, a, b]) => (truthy(c ?? null) ? (a ?? null) : (b ?? null)),
  coalesce: (args) => args.find((v) => v !== null && v !== '') ?? null,
  'string-length': ([a]) => str(a ?? null).length,
  concat: (args) => args.map(str).join(''),
  contains: ([a, b]) => str(a ?? null).includes(str(b ?? null)),
  'starts-with': ([a, b]) => str(a ?? null).startsWith(str(b ?? null)),
  regex: ([a, b]) => {
    const pattern = str(b ?? null);
    if (pattern.length > 200) return false;
    try {
      return new RegExp(pattern).test(str(a ?? null));
    } catch {
      return false;
    }
  },
  round: ([a, d]) => {
    const f = 10 ** (d === undefined ? 0 : num(d));
    return Math.round(num(a ?? null) * f) / f;
  },
  int: ([a]) => Math.trunc(num(a ?? null)),
  number: ([a]) => num(a ?? null),
  string: ([a]) => str(a ?? null),
  min: (args) => Math.min(...args.map(num)),
  max: (args) => Math.max(...args.map(num)),
  abs: ([a]) => Math.abs(num(a ?? null)),
  pow: ([a, b]) => num(a ?? null) ** num(b ?? null),
  sqrt: ([a]) => Math.sqrt(num(a ?? null)),
  today: () => new Date().toISOString().slice(0, 10),
  now: () => new Date().toISOString(),
  /** Whole days between two ISO dates (b − a). */
  'days-between': ([a, b]) => Math.round((Date.parse(str(b ?? null)) - Date.parse(str(a ?? null))) / 86_400_000),
  /** Whole years from a birth date to today (or to b). */
  age: ([a, b]) => {
    const from = new Date(str(a ?? null));
    const to = b ? new Date(str(b)) : new Date();
    if (Number.isNaN(from.getTime())) return null;
    let y = to.getUTCFullYear() - from.getUTCFullYear();
    if (to.getUTCMonth() < from.getUTCMonth() || (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate())) y--;
    return y;
  },
  'is-empty': ([a]) => !truthy(a ?? null) && a !== 0 && a !== false,
} satisfies Record<string, (args: Value[]) => Value>);

function compare(op: string, a: Value, b: Value): boolean {
  // Numbers compare numerically when both sides look numeric; otherwise as strings (ISO dates sort).
  const na = num(a);
  const nb = num(b);
  const numeric = !Number.isNaN(na) && !Number.isNaN(nb) && a !== '' && b !== '' && a !== null && b !== null;
  const x: number | string = numeric ? na : str(a);
  const y: number | string = numeric ? nb : str(b);
  switch (op) {
    case '=':
      return numeric ? x === y : str(a) === str(b);
    case '!=':
      return numeric ? x !== y : str(a) !== str(b);
    case '<':
      return x < y;
    case '<=':
      return x <= y;
    case '>':
      return x > y;
    default:
      return x >= y;
  }
}

function evaluate(n: Node, answers: Answers, self: unknown): Value {
  switch (n.k) {
    case 'lit':
      return n.v;
    case 'self':
      return normalize(self);
    case 'ref':
      return normalize(answers[n.name]);
    case 'un':
      return n.op === 'not' ? !truthy(evaluate(n.a, answers, self)) : -num(evaluate(n.a, answers, self));
    case 'call':
      return FUNCTIONS[n.fn]!(n.args.map((a) => evaluate(a, answers, self)));
    case 'bin': {
      if (n.op === 'and') return truthy(evaluate(n.a, answers, self)) && truthy(evaluate(n.b, answers, self));
      if (n.op === 'or') return truthy(evaluate(n.a, answers, self)) || truthy(evaluate(n.b, answers, self));
      const a = evaluate(n.a, answers, self);
      const b = evaluate(n.b, answers, self);
      switch (n.op) {
        case '+':
          return num(a) + num(b);
        case '-':
          return num(a) - num(b);
        case '*':
          return num(a) * num(b);
        case '/':
        case 'div':
          return num(b) === 0 ? null : num(a) / num(b);
        case '%':
        case 'mod':
          return num(b) === 0 ? null : num(a) % num(b);
        default:
          return compare(n.op, a, b);
      }
    }
  }
}

function normalize(v: unknown): Value {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'object') return JSON.stringify(v);
  return v as Value;
}

const cache = new Map<string, Node>();
const compiled = (src: string) => {
  let ast = cache.get(src);
  if (!ast) {
    ast = parse(src);
    if (cache.size > 2000) cache.clear();
    cache.set(src, ast);
  }
  return ast;
};

/** Evaluates an expression against answers (`self` is the value for `.`). */
export function evalExpr(src: string, answers: Answers, self?: unknown): Value {
  return evaluate(compiled(src), answers, self);
}

/** Answer keys an expression reads (for dependency tracking and builder validation). */
export function references(src: string): string[] {
  const refs = new Set<string>();
  const walk = (n: Node) => {
    if (n.k === 'ref') refs.add(n.name);
    else if (n.k === 'un') walk(n.a);
    else if (n.k === 'bin') {
      walk(n.a);
      walk(n.b);
    } else if (n.k === 'call') n.args.forEach(walk);
  };
  walk(compiled(src));
  return [...refs];
}

export const FUNCTION_NAMES = Object.keys(FUNCTIONS).concat('not');
