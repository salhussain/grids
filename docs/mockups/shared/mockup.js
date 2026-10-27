/* Tiny helpers shared by the mockups: icons, hash router, theme, modal, toast. No dependencies. */
const P = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  folder: '<path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14a6.5 6.5 0 013.5 6"/>',
  network: '<rect x="9" y="3" width="6" height="5"/><rect x="2" y="16" width="6" height="5"/><rect x="16" y="16" width="6" height="5"/><path d="M12 8v4M5 16v-4h14v4"/>',
  boxes: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  palette: '<path d="M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 003-3c0-5-4-11-8-11z"/><circle cx="7.5" cy="11" r="1"/><circle cx="11" cy="7" r="1"/><circle cx="16" cy="8" r="1"/>',
  lang: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  app: '<rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
  card: '<rect x="2" y="5" width="20" height="14"/><path d="M2 10h20M6 15h4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1-1.5 2.5M12 17h.01"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chev: '<path d="M6 9l6 6 6-6"/>', right: '<path d="M9 6l6 6-6 6"/>', left: '<path d="M15 6l-6 6 6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  moon: '<path d="M20 14A8 8 0 1110 4a7 7 0 0010 10z"/>',
  out: '<path d="M9 4H5a2 2 0 00-2 2v12a2 2 0 002 2h4M16 8l4 4-4 4M20 12H9"/>',
  mail: '<rect x="3" y="5" width="18" height="14"/><path d="M3 7l9 6 9-6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  badge: '<rect x="4" y="3" width="16" height="18"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  building: '<path d="M4 21V4l8-2v19M12 8h8v13M2 21h20M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01"/>',
  dollar: '<path d="M12 2v20M17 6.5C16 5 14 4.5 12 4.5c-2.5 0-4.5 1-4.5 3s2 2.7 4.5 3.2 4.5 1.2 4.5 3.3-2 3-4.5 3c-2.200 0-4.200-.7-5.200-2.200"/>',
  check: '<path d="M5 12l5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>', dl: '<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.700l1-1"/>',
  lock: '<rect x="4" y="11" width="16" height="10"/><path d="M8 11V7a4 4 0 018 0v4"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  pin: '<path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  send: '<path d="M21 3L3 11l7 3 3 7z"/>', zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>', db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.700 3.600 3 8 3s8-1.300 8-3V5M4 12c0 1.700 3.600 3 8 3s8-1.300 8-3"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  form: '<rect x="4" y="3" width="16" height="18"/><path d="M8 8h8M8 12h8M8 16h4"/>', wifi: '<path d="M2 9a15 15 0 0120 0M5 13a10 10 0 0114 0M8.500 16.500a5 5 0 017 0M12 20h.01"/>',
};
const ic = (n, s) => `<svg class="i" viewBox="0 0 24 24"${s ? ` style="width:${s}px;height:${s}px"` : ''}>${P[n] || ''}</svg>`;
const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const av = (name, cls = '') => `<span class="avatar ${cls}" style="background:oklch(.55 .15 ${hue(name)})">${name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>`;
const badge = (txt, tone = '') => `<span class="badge ${tone}">${txt}</span>`;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const bars = (vals, h = 140) => { const m = Math.max(...vals); return `<div class="bars" style="height:${h}px">${vals.map((v) => `<i title="${v}" style="height:${(v / m) * 100}%"></i>`).join('')}</div>`; };
const spark = (vals, w = 120, h = 32, c = 'var(--brand)') => { const m = Math.max(...vals), n = Math.min(...vals); const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 3 - ((v - n) / (m - n || 1)) * (h - 6)}`).join(' '); return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.6"/></svg>`; };
const head = (eyebrow, title, desc, actions = '') => `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${desc ? `<p>${desc}</p>` : ''}</div><div class="actions">${actions}</div></div>`;
const kpi = (label, val, ctx, icon, tone = '', to = '') => `<${to ? `a href="#/${to}"` : 'div'} class="kpi"><div class="top">${label}<span class="ico ${tone}">${ic(icon)}</span></div><div class="val">${val}</div><div class="ctx">${ctx}</div></${to ? 'a' : 'div'}>`;
const card = (title, body, { sub = '', actions = '', pad = true } = {}) => `<section class="card"><header><div class="grow"><h2>${title}</h2>${sub ? `<small>${sub}</small>` : ''}</div>${actions}</header>${pad ? `<div class="body">${body}</div>` : body}</section>`;
const field = (label, input, hint = '') => `<div class="field"><label>${label}</label>${input}${hint ? `<small>${hint}</small>` : ''}</div>`;
const tgl = (on) => `<button class="toggle" role="switch" aria-checked="${on}"></button>`;

function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2200); }
function modal(title, body, ok = 'Save', cancel = 'Cancel') {
  const m = document.createElement('div'); m.className = 'scrim';
  m.innerHTML = `<div class="modal" role="dialog" aria-label="${title}"><header><h2>${title}</h2><button class="icon-btn end" data-x>${ic('x')}</button></header><div class="body">${body}</div><footer><button class="btn" data-x>${cancel}</button><button class="btn primary" data-ok>${ok}</button></footer></div>`;
  m.onclick = (e) => { if (e.target === m || e.target.closest('[data-x]')) m.remove(); else if (e.target.closest('[data-ok]')) { m.remove(); toast(`${ok} — mockup only`); } };
  document.body.append(m);
}
/* Buttons marked data-modal="Title|Confirm" open a placeholder dialog; toggles and segmented controls respond. */
function wire(root = document) {
  $$('.toggle', root).forEach((t) => (t.onclick = () => t.setAttribute('aria-checked', t.getAttribute('aria-checked') !== 'true')));
  $$('.seg', root).forEach((s) => $$('button', s).forEach((b) => (b.onclick = () => { $$('button', s).forEach((x) => x.setAttribute('aria-pressed', x === b)); s.dispatchEvent(new CustomEvent('pick', { detail: b.dataset.v ?? b.textContent })); })));
  $$('[data-tabs]', root).forEach((t) => $$('button', t).forEach((b) => (b.onclick = () => { $$('button', t).forEach((x) => x.setAttribute('aria-selected', x === b)); $$('[data-pane]', root).forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.t)); })));
  $$('[data-modal]', root).forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const [t, ok] = b.dataset.modal.split('|'); modal(t, b.dataset.body || '<p class="sub">This is a mockup — the real dialog collects the details here.</p>', ok || 'Save'); }));
  $$('[data-toast]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); toast(b.dataset.toast); }));
  $$('[data-go]', root).forEach((b) => (b.onclick = () => (location.hash = '#/' + b.dataset.go)));
  $$('.swatch', root).forEach((s) => (s.onclick = () => { document.documentElement.style.setProperty('--brand', s.dataset.c); toast('Brand colour applied across the workspace'); }));
}
/* Theme: follows the system until the toggle is used. */
function initTheme(btn) {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const set = (d) => { document.documentElement.dataset.theme = d ? 'dark' : 'light'; if (btn) btn.innerHTML = ic(d ? 'sun' : 'moon'); };
  set(mq.matches); mq.onchange = (e) => !localStorage.mockTheme && set(e.matches);
  if (btn) btn.onclick = () => { const d = document.documentElement.dataset.theme !== 'dark'; localStorage.mockTheme = d ? 'dark' : 'light'; set(d); };
  if (localStorage.mockTheme) set(localStorage.mockTheme === 'dark');
}
/* Hash router: routes = { 'path': (params) => html }, supports /x/:id style patterns. */
function router(routes, render) {
  const run = () => {
    const path = location.hash.replace(/^#\/?/, '') || '';
    for (const [pat, fn] of Object.entries(routes)) {
      const keys = []; const re = new RegExp('^' + pat.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
      const m = path.match(re);
      if (m) { render(path, fn(Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])))); scrollTo(0, 0); return; }
    }
    render(path, '<div class="empty">Not found</div>');
  };
  addEventListener('hashchange', run); run();
}
