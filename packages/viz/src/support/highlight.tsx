import { common, createLowlight } from 'lowlight';
import type { ReactNode } from 'react';

/** Syntax colouring for code blocks, shared by the editor and the page that shows a message. */
export const lowlight = createLowlight(common);

// hast (what lowlight returns) as React elements, never as HTML.
type Hast = { type: 'text'; value: string } | { type: 'element'; properties?: { className?: string[] }; children: Hast[] } | { type: 'root'; children: Hast[] };
const toReact = (n: Hast, k: string): ReactNode =>
  n.type === 'text' ? n.value : n.type === 'root' ? n.children.map((c, i) => toReact(c, `${k}.${i}`)) : <span key={k} className={n.properties?.className?.join(' ')}>{n.children.map((c, i) => toReact(c, `${k}.${i}`))}</span>;

/** The code with its keywords, strings and the like wrapped for colouring; plain when the language is unknown. */
export function highlighted(code: string, lang: string): ReactNode {
  if (!lang || !lowlight.registered(lang)) return code;
  try {
    return toReact(lowlight.highlight(lang, code) as Hast, 'h');
  } catch {
    return code;
  }
}

/** Token colours (the `hljs-*` classes), for light surfaces. */
export const HIGHLIGHT_CSS = `
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-built_in,.hljs-doctag{color:#9333ea}
.hljs-string,.hljs-regexp,.hljs-addition,.hljs-attribute,.hljs-meta .hljs-string{color:#15803d}
.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-link{color:#c2410c}
.hljs-comment,.hljs-quote,.hljs-deletion{color:#71717a;font-style:italic}
.hljs-title,.hljs-section,.hljs-name,.hljs-type,.hljs-class .hljs-title{color:#1d4ed8}
.hljs-variable,.hljs-template-variable,.hljs-attr,.hljs-property{color:#0e7490}
.hljs-meta{color:#a16207}
.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}
`;
