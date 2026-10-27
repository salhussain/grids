/**
 * The formatting an email message can have, kept as a small, plain-text subset of Markdown so it is safe by
 * construction: everything is escaped first, only the tags below are ever produced, and answers filled in from
 * the form are text, never markup.
 *
 *   **bold**   *italic*   [a link](https://example.org)   ## Heading   - bullets   1. numbers   ${question}
 */

/** What a `${question}` becomes (null or '' = nothing). */
export type Fill = (key: string) => string | null | undefined;

/** Answers as people read them: lists joined with commas, missing ones empty. */
export const fillFrom =
  (values: Record<string, unknown>): Fill =>
  (key) => {
    const v = values[key];
    return v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
  };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SAFE_URL = /^(https?:\/\/[^\s"<>]+|mailto:[^\s"<>]+)$/i;
const TOKEN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\)|\$\{[a-z_][a-z0-9_]*\})/g;

/** One line's formatting, as HTML. */
function inlineHtml(text: string, fill: Fill): string {
  return text
    .split(TOKEN)
    .map((part) => {
      let m: RegExpExecArray | null;
      if ((m = /^\*\*([^*\n]+)\*\*$/.exec(part))) return `<strong>${inlineHtml(m[1]!, fill)}</strong>`;
      if ((m = /^\*([^*\n]+)\*$/.exec(part))) return `<em>${inlineHtml(m[1]!, fill)}</em>`;
      if ((m = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/.exec(part))) return SAFE_URL.test(m[2]!) ? `<a href="${esc(m[2]!)}">${inlineHtml(m[1]!, fill)}</a>` : esc(part);
      if ((m = /^\$\{([a-z_][a-z0-9_]*)\}$/.exec(part))) return esc(fill(m[1]!) ?? '');
      return esc(part);
    })
    .join('');
}

/** One line's formatting, as plain text. */
function inlineText(text: string, fill: Fill): string {
  return text
    .split(TOKEN)
    .map((part) => {
      let m: RegExpExecArray | null;
      if ((m = /^\*\*([^*\n]+)\*\*$/.exec(part)) || (m = /^\*([^*\n]+)\*$/.exec(part))) return inlineText(m[1]!, fill);
      if ((m = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/.exec(part))) return SAFE_URL.test(m[2]!) ? `${inlineText(m[1]!, fill)} (${m[2]})` : part;
      if ((m = /^\$\{([a-z_][a-z0-9_]*)\}$/.exec(part))) return fill(m[1]!) ?? '';
      return part;
    })
    .join('');
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'h'; level: number; text: string } | { kind: 'ul' | 'ol'; items: string[] };

function blocks(md: string): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!line.trim()) cur = null;
    else if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      out.push({ kind: 'h', level: m[1]!.length, text: m[2]! });
      cur = null;
    }
    else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      if (cur?.kind === 'ul') cur.items.push(m[1]!);
      else out.push((cur = { kind: 'ul', items: [m[1]!] }));
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      if (cur?.kind === 'ol') cur.items.push(m[1]!);
      else out.push((cur = { kind: 'ol', items: [m[1]!] }));
    } else if (cur?.kind === 'p') cur.lines.push(line);
    else out.push((cur = { kind: 'p', lines: [line] }));
  }
  return out;
}

/** The message as HTML (the body of an email), with answers filled in as escaped text. */
export function mdToHtml(md: string, fill: Fill = () => ''): string {
  return blocks(md)
    .map((b) =>
      b.kind === 'p'
        ? `<p style="margin:0 0 12px">${b.lines.map((l) => inlineHtml(l, fill)).join('<br>')}</p>`
        : b.kind === 'h'
          ? `<h${b.level + 1} style="margin:16px 0 8px">${inlineHtml(b.text, fill)}</h${b.level + 1}>`
          : `<${b.kind} style="margin:0 0 12px;padding-left:22px">${b.items.map((i) => `<li>${inlineHtml(i, fill)}</li>`).join('')}</${b.kind}>`,
    )
    .join('');
}

/** The message as plain text, for mail programs that do not show HTML. */
export function mdToText(md: string, fill: Fill = () => ''): string {
  return blocks(md)
    .map((b) =>
      b.kind === 'p'
        ? b.lines.map((l) => inlineText(l, fill)).join('\n')
        : b.kind === 'h'
          ? inlineText(b.text, fill).toUpperCase()
          : b.items.map((i, n) => `${b.kind === 'ul' ? '•' : `${n + 1}.`} ${inlineText(i, fill)}`).join('\n'),
    )
    .join('\n\n')
    .trim();
}
