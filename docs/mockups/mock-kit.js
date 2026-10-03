/* Shared helpers for the console mockup (icons, small components). */
  const I = {
    home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
    projects: '<path d="M3 6h7l2 2h9v12H3z"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-6 6.5-6s5.9 2.4 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14.4c2 .8 3.2 2.9 3.5 5.6"/>',
    structure: '<rect x="9" y="3" width="6" height="5"/><rect x="3" y="16" width="6" height="5"/><rect x="15" y="16" width="6" height="5"/><path d="M12 8v4M6 16v-4h12v4"/>',
    access: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
    branding: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.2-1-1.4-1-2.6 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    security: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    billing: '<rect x="2" y="5" width="20" height="14"/><path d="M2 10h20"/>',
    support: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    chart: '<path d="M3 3v18h18M8 17v-5M13 17V7M18 17v-8"/>',
    map: '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    entities: '<path d="m12 2 9 5v10l-9 5-9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
    data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    forms: '<rect x="5" y="3" width="14" height="18"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    jobs: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><path d="M6.5 10v4a3 3 0 0 0 3 3H14"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    pulse: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/><path d="M3.2 12H9l1-2 2 4 1-2h7.8"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-6 6.5-6s5.9 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.4c2 .8 3.2 2.9 3.5 5.6"/>',
    drop: '<path d="M12 2.7s7 7.3 7 12.3a7 7 0 0 1-14 0c0-5 7-12.3 7-12.3z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    lock: '<rect x="4" y="11" width="16" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    org: '<rect x="3" y="3" width="18" height="18"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M10 21v-4h4v4"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    lang: '<path d="M4 5h9M8.5 3v2M6 5c.5 3 3 6 6 7M11 5c-.5 3-3 6-7 8M12 20l4.5-10L21 20M13.7 16.5h5.6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    send: '<path d="m22 2-11 11M22 2l-7 20-4-9-9-4z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    drag: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    mail: '<rect x="3" y="5" width="18" height="14"/><path d="m3 7 9 6 9-6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
    hash: '<path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18"/>',
    type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
    calendar: '<rect x="3" y="5" width="18" height="16"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    gps: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    photo: '<rect x="3" y="5" width="18" height="14"/><circle cx="9" cy="11" r="2"/><path d="m21 17-5-5-9 7"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  };
  const ic = (n, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

  function spark(data, w = 96, h = 30) {
    const max = Math.max(...data), min = Math.min(...data);
    const x = (i) => (i / (data.length - 1)) * (w - 4) + 2;
    const y = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 8);
    const d = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path class="a" d="${d}L${x(data.length - 1)} ${h}L2 ${h}Z"/><path class="l" d="${d}"/><circle cx="${x(data.length - 1)}" cy="${y(data.at(-1))}" r="3"/></svg>`;
  }

const av = (n, c, s = 28) => `<span class="avatar" style="width:${s}px;height:${s}px;font-size:${s * .38}px;background:${c}">${n.split(' ').map((x) => x[0]).join('')}</span>`;
const hero = (eyebrow, title, lede, actions = '') => `<div class="hero"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${lede ? `<p>${lede}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
const btn = (label, icon, cls = '', go = '') => `<button class="btn ${cls}" ${go ? `data-go="${go}"` : ''}>${icon ? ic(icon, 15) : ''}${label}</button>`;
const toggle = (on = false, label = '') => `<button type="button" class="toggle" role="switch" aria-checked="${on}" aria-label="${label}" onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked') !== 'true')"></button>`;
const field = (label, value = '', hint = '', type = 'text') => `<label class="label">${label}<input class="input" type="${type}" value="${value}" />${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
const select = (label, opts, hint = '') => `<label class="label">${label}<select class="select" style="width:100%">${opts.map((o) => `<option>${o}</option>`).join('')}</select>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
const panel = (title, body, meta = '', pad = false) => `<div class="panel"><div class="panel-h"><h2>${title}</h2>${meta ? `<span class="meta">${meta}</span>` : ''}</div>${pad ? `<div class="panel-b">${body}</div>` : body}</div>`;
const chip = (t, c = '') => `<span class="chip ${c}">${t}</span>`;
const empty = (icon, title, text, action = '') => `<div class="empty"><span class="ico">${ic(icon, 20)}</span><b>${title}</b><span>${text}</span>${action}</div>`;
const tableOf = (heads, rows, num = []) => `<div class="table-wrap"><table><thead><tr>${heads.map((h, i) => `<th class="${num.includes(i) ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${num.includes(i) ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const rowActions = `<span style="display:flex;gap:2px;justify-content:flex-end"><button class="icon-btn" aria-label="Edit">${ic('edit', 15)}</button><button class="icon-btn" aria-label="Delete">${ic('trash', 15)}</button></span>`;
const saveBar = (extra = '') => `<div class="panel-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end">${extra}${btn('Cancel', '', 'ghost')}${btn('Save changes', '', 'primary')}</div>`;

