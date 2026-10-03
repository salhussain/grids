/* Remaining workspace pages for workspace.html. Loaded after the main script, so it can
   use its helpers (ic, spark, lineChart, barChart, mapView, reportsTable, PROJECTS, PEOPLE …). */

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

/* ---------- Breadcrumbs ---------- */
const LABELS = { forms: 'Forms', inbox: 'Inbox', fill: 'Fill in', structure: 'Structure', access: 'Roles & access', branding: 'Branding', security: 'Security', domains: 'Domains', languages: 'Languages', billing: 'Billing', invoice: 'Billing', support: 'Support', ticket: 'Support', activity: 'Activity', picker: 'Organisations', invite: 'Invitation', home: 'Home', projects: 'Projects', people: 'People' };
window.CRUMBS = (r) => {
  if (r.startsWith('project:')) {
    const p = PROJECTS.find((x) => 'project:' + x.id === r);
    return ['Projects', p.name];
  }
  if (r === 'invoice') return ['Billing', 'INV-2026-00041'];
  if (r === 'ticket') return ['Support', 'Dashboard export times out'];
  if (r === 'builder') return ['Projects', 'Facility surveillance', 'Forms', 'Weekly facility report'];
  if (r === 'entity') return ['Projects', 'Facility surveillance', 'Entities', 'Riverside clinic'];
  if (r === 'fill') return ['Forms', 'Weekly facility report'];
  return [LABELS[r] || r];
};

/* ---------- Rethink prompts shown per page ---------- */
const Q = {
  home: 'Is Home a dashboard, an inbox or a launcher? Today it is all three.',
  projects: 'Should projects be grouped by programme or team once there are more than ~10?',
  people: 'Invite, roles and unit placement are three steps today. Could one dialog cover them?',
  forms: 'Forms live under projects but are filled from here. Is “Forms” the collector’s home screen?',
  inbox: 'Review work (approve, return, reject) is mixed with plain submissions. Separate queues?',
  fill: 'Phone-first. What must work offline, and what do we show when the outbox is full?',
  structure: 'Tree vs. map vs. table. Admins also want bulk import/export of units.',
  access: 'Role × permission matrix, or a plain-language sentence per role?',
  branding: 'Live preview of login + workspace next to the form, instead of after saving.',
  security: 'Only 2FA today. Where do session length, IP allow-list and SSO go?',
  domains: 'The DNS steps are the hard part. A guided checklist with a live “check again” could replace the table.',
  languages: 'Translation coverage per language is hidden. Surface it, with a “missing strings” view?',
  billing: 'Usage vs. limit is the key signal. Should upgrades start from the meter that is nearly full?',
  invoice: 'Printable invoice, pay-now and a PDF download. Anything else for finance teams?',
  support: 'A ticket list plus a floating bubble. Do we need knowledge-base search before “New ticket”?',
  ticket: 'Conversation plus metadata. Attachments and screenshots from the page the user was on?',
  activity: 'An audit log for admins. Filters by person, project, action; export for compliance?',
  builder: 'Three panes is dense. Should logic (skip rules, calculations) get its own mode?',
  entity: 'Entity page = profile + data + submissions + map. What deserves the top of the page?',
  picker: 'People with many organisations need search and recents; most have one.',
  invite: 'Show who invited them and what they will get access to before asking for a password.',
  'project:overview': 'Overview duplicates Dashboards for many projects. Merge, or make it setup progress for new ones?',
  'project:explore': 'The map is the product for some teams. Should it be full-bleed with panels on top?',
  'project:jobs': 'Jobs, triggers and runs: a pipeline view may explain this better than tabs.',
  'project:settings': 'Settings holds both project details and entity types. Split them?',
};
window.annotate = (r) => {
  document.querySelector('.annot')?.remove();
  const key = r.startsWith('project:') ? `project:${projectTab}` : r;
  const q = Q[key] || Q[r];
  if (!q) return;
  const d = document.createElement('div');
  d.className = 'annot';
  d.className = 'annot min';
  d.innerHTML = `<button aria-label="Hide" onclick="event.stopPropagation();this.parentElement.classList.add('min')">✕</button><b>To rethink ＋</b><span>${q}</span>`;
  d.addEventListener('click', () => d.classList.remove('min'));
  document.body.appendChild(d);
};
// The annotation depends on the project tab too.
const _rv = renderView;
renderView = function () { _rv(); if (route.startsWith('project:')) annotate(route); };

/* ---------- Pre-shell screens ---------- */
V.picker = () => `<section class="centered">
  <div><span class="org-mark" style="width:36px;height:36px;display:inline-grid;margin-bottom:12px">${ic('org', 18)}</span><h1>Choose an organisation</h1><p>You belong to 3 organisations.</p></div>
  <label class="field" style="height:38px">${ic('search', 15)}<input style="width:100%" placeholder="Search organisations" aria-label="Search"/></label>
  ${[['Kestrel District Health', 'Organisation admin · last used today', '#0f62fe'], ['Pacific Water Alliance', 'Data manager', '#007d79'], ['Harbour Education Trust', 'Viewer', '#8a3ffc']].map(([n, r, c]) => `<div class="org-opt" data-go="home">${av(n, c, 36)}<div><div style="font-weight:600">${n}</div><div class="muted sm">${r}</div></div><span class="ml-auto muted">${ic('arrow', 16)}</span></div>`).join('')}
  <div class="muted sm" style="text-align:center">Signed in as amina.rahman@kestrel.example · <a class="dl">Sign out</a></div>
</section>`;

V.invite = () => `<section class="centered">
  <div><span class="org-mark" style="width:36px;height:36px;display:inline-grid;margin-bottom:12px">${ic('mail', 18)}</span><h1>Join Kestrel District Health</h1><p><b>Amina Rahman</b> invited you as <b>Data collector</b> in <b>Riverside clinic</b>.</p></div>
  <div class="panel"><div class="kv"><div>Email</div><div>sina.leota@kestrel.example</div><div>Unit</div><div>Hill View health post</div><div>Access</div><div>Fill in forms · View own submissions</div><div>Expires</div><div>in 6 days</div></div></div>
  <div class="form-grid"><div>${field('First name', 'Sina')}</div><div>${field('Last name', 'Leota')}</div></div>
  <button class="btn primary" style="justify-content:center;height:40px" data-go="home">Accept and continue</button>
  <div class="muted sm" style="text-align:center">You’ll set a password and optional two-step verification next.</div>
</section>`;

/* ---------- Forms (collector home) ---------- */
const FORMGROUPS = [['Surveillance', 'pulse', 3], ['Facility', 'org', 2], ['Staff & training', 'users', 4], ['Water points', 'drop', 1]];
V.forms = () => `<section class="page">
  ${hero('Collect', 'Forms', 'Choose a form to fill in. Forms are organised into groups by your administrators.', btn('Outbox · 2 waiting', 'upload', '', 'inbox'))}
  <div class="split">
    <div class="panel"><div class="panel-b" style="padding:8px">
      <ul class="tree">
        <li><div class="n sel">${ic('forms', 15)}All forms<span class="lvl">13</span></div></li>
        ${FORMGROUPS.map(([n, i, c], k) => `<li><div class="n"><span class="caret">${ic('chevron', 12)}</span>${ic(i, 15)}${n}<span class="lvl">${c}</span></div>${k === 0 ? `<ul><li><div class="n">Weekly reports<span class="lvl">2</span></div></li><li><div class="n">Outbreak alerts<span class="lvl">1</span></div></li></ul>` : ''}</li>`).join('')}
      </ul></div></div>
    <div class="stack">
      <div class="toolbar"><label class="field">${ic('search', 15)}<input placeholder="Search forms" aria-label="Search forms"/></label><span class="muted sm ml-auto">13 forms</span></div>
      <div class="cards">
        ${[['Weekly facility report', 'Facility surveillance', 'Due Fri · 4 of 18 submitted', '#da1e28', 'pulse', 'Approval workflow'], ['Outbreak alert', 'Facility surveillance', 'Anytime', '#da1e28', 'alert', ''], ['Borehole check', 'Water points', 'Works offline · 318 sites', '#007d79', 'drop', ''], ['Leave request', 'Workforce', 'Reviewed by line manager', '#8a3ffc', 'users', 'Approval workflow'], ['Training attendance', 'Workforce', 'Anytime', '#8a3ffc', 'check', ''], ['Stock count', 'Facility surveillance', 'Monthly', '#da1e28', 'data', '']].map(([n, p, s, c, i, w]) => `
          <article class="card" data-go="fill" tabindex="0"><div class="body" style="padding-bottom:12px"><div class="row-between"><span class="p-ic" style="width:34px;height:34px;background:${c}">${ic(i, 17)}</span>${w ? chip(w, 'brand') : ''}</div><h3 style="margin-top:6px">${n}</h3><p>${p}</p></div><div class="foot"><span>${s}</span><span class="stats">${ic('arrow', 14)}</span></div></article>`).join('')}
      </div>
    </div>
  </div></section>`;

V.fill = () => `<section class="page">
  ${hero('Weekly facility report', 'Riverside clinic · Week 39', 'Draft saved on this device 2 minutes ago. It will sync when you are back online.', btn('Save draft', '', '') + btn('Submit', 'send', 'primary'))}
  <div class="steps"><div class="done"><span class="no">${ic('check', 12)}</span>Facility</div><div class="on"><span class="no">2</span>Cases</div><div><span class="no">3</span>Stock</div><div><span class="no">4</span>Review</div></div>
  <div class="split wide">
    <div class="stack">
      ${panel('Confirmed cases this week', `<div class="form-grid">
        ${field('Malaria · under 5', '14', 'Must be 0 or more', 'number')}${field('Malaria · 5 and over', '27', '', 'number')}
        ${field('Tests performed', '212', '', 'number')}${field('Test positivity', '19.3 %', 'Calculated from cases and tests')}
        <label class="label full">Notes<textarea class="textarea" placeholder="Anything unusual this week?"></textarea></label></div>
        <div class="setting" style="margin:18px -18px -18px;background:var(--bad-soft)"><span style="color:var(--bad)">${ic('alert', 18)}</span><div><div class="t">Above the alert threshold</div><div class="s">41 cases, the limit is 30. Your district manager will be notified on submit.</div></div></div>`, '', true)}
      ${panel('Photos', `<div class="pill-row">${[1, 2].map((i) => `<div style="width:96px;height:72px;background:var(--raise);border:1px solid var(--line);display:grid;place-items:center;color:var(--ink-3)">${ic('photo', 22)}</div>`).join('')}<button class="btn" style="height:72px">${ic('plus', 16)}Add photo</button></div>`, 'Optional', true)}
    </div>
    <div class="stack">
      <div class="phone"><div class="ph-h"><div class="eyebrow">Step 2 of 4</div><b>Cases</b></div><div class="ph-b">${field('Malaria · under 5', '14')}${field('Malaria · 5 and over', '27')}${field('Tests performed', '212')}<div class="chip bad" style="height:auto;padding:8px">Above threshold · notify manager</div></div><div class="ph-f"><button class="btn">Back</button><button class="btn primary">Next</button></div></div>
      <div class="muted sm" style="text-align:center">Same form on a phone</div>
    </div>
  </div></section>`;

V.inbox = () => `<section class="page">
  ${hero('Collect', 'Inbox', 'Your submissions, anything waiting for your review, and the outbox of items not yet synced.', btn('Sync now', 'upload', 'primary'))}
  <div class="toolbar"><div class="seg"><button aria-pressed="true">Mine <span class="mono muted">9</span></button><button aria-pressed="false">To review <span class="mono muted">3</span></button><button aria-pressed="false">Outbox <span class="mono muted">2</span></button></div><select class="select"><option>All forms</option></select><select class="select"><option>Any status</option><option>Draft</option><option>Submitted</option><option>Returned</option><option>Approved</option></select></div>
  <div class="panel">${tableOf(['Form', 'Facility', 'Period', 'Status', 'Updated', ''], [
    ['<b>Weekly facility report</b>', 'Riverside clinic', 'W39', chip('Submitted', 'brand'), '<span class="muted">1 h ago</span>', ''],
    ['<b>Weekly facility report</b>', 'Riverside clinic', 'W38', chip('Approved', 'good'), '<span class="muted">8 days ago</span>', ''],
    ['<b>Stock count</b>', 'Riverside clinic', 'Sep', chip('Returned · fix totals', 'bad'), '<span class="muted">2 days ago</span>', btn('Edit', 'edit')],
    ['<b>Borehole check</b>', 'Hill View', '—', chip('Waiting to sync', 'stale'), '<span class="muted">Offline</span>', btn('Retry', 'upload')],
    ['<b>Weekly facility report</b>', 'Port clinic', 'W39', chip('Draft', ''), '<span class="muted">Today</span>', btn('Continue', 'edit')]])}</div></section>`;

/* ---------- Organisation ---------- */
const UNITS = [['District office', 'District', 'DO', 4, [['North region', 'Region', 'N', 12], ['South region', 'Region', 'S', 9], ['East region', 'Region', 'E', 8], ['Coastal region', 'Region', 'C', 14]]]];
V.structure = () => `<section class="page">
  ${hero('Organisation', 'Structure', 'People are placed in units; roles can be granted for a unit and everything below it.', btn('Import CSV', 'upload') + btn('Add unit', 'plus', 'primary'))}
  <div class="split wide">
    ${panel('Units', `<div style="padding:8px"><ul class="tree"><li><div class="n"><span class="caret">▾</span>${ic('org', 15)}Kestrel District Health<span class="lvl">Organisation</span></div><ul>
      <li><div class="n"><span class="caret">▾</span>District office<span class="lvl">District</span></div></li>
      <li><div class="n sel"><span class="caret">▾</span>Coastal region<span class="lvl">Region</span></div><ul><li><div class="n">Riverside clinic<span class="lvl">Facility</span></div></li><li><div class="n">Port clinic<span class="lvl">Facility</span></div></li><li><div class="n">Lagoon health post<span class="lvl">Facility</span></div></li></ul></li>
      <li><div class="n"><span class="caret">▸</span>North region<span class="lvl">Region</span></div></li><li><div class="n"><span class="caret">▸</span>South region<span class="lvl">Region</span></div></li><li><div class="n"><span class="caret">▸</span>East region<span class="lvl">Region</span></div></li><li><div class="n"><span class="caret">▸</span>Highlands<span class="lvl">Region</span></div></li></ul></li></ul></div>`, '52 facilities')}
    <div class="stack">
      ${panel('Coastal region', `<div class="kv"><div>Level</div><div>Region</div><div>Code</div><div class="mono">COAST</div><div>Parent</div><div>Kestrel District Health</div><div>Children</div><div>3 facilities</div><div>People</div><div>14 · <a class="dl" data-go="people">View</a></div></div>${saveBar(btn('Delete unit', 'trash', 'ghost'))}`, '', false)}
      ${panel('People here', tableOf(['Name', 'Role'], PEOPLE.slice(2, 5).map(([n, , , r, , , c]) => [`<div class="person">${av(n, c)}${n}</div>`, r])))}
    </div>
  </div></section>`;

V.access = () => {
  const perms = ['View data', 'Submit forms', 'Review submissions', 'Edit dashboards', 'Manage entities', 'Manage jobs', 'Manage people'];
  const roles = [['Admin', [1, 1, 1, 1, 1, 1, 1]], ['Data manager', [1, 1, 1, 1, 1, 1, 0]], ['Epidemiologist', [1, 0, 1, 1, 0, 0, 0]], ['Data collector', [0, 1, 0, 0, 0, 0, 0]], ['Viewer', [1, 0, 0, 0, 0, 0, 0]]];
  return `<section class="page">
  ${hero('Organisation', 'Roles & access', 'Admins hold everything and everyone holds Member; these are the extra roles. Grant a role for a unit and everything below it.', btn('New role', 'plus', 'primary'))}
  ${panel('Roles', `<div class="table-wrap"><table class="matrix"><thead><tr><th>Role</th>${perms.map((p) => `<th>${p}</th>`).join('')}<th></th></tr></thead><tbody>${roles.map(([n, g]) => `<tr><td><b>${n}</b></td>${g.map((x) => `<td><span class="tick ${x ? '' : 'no'}">${ic('check', 12)}</span></td>`).join('')}<td>${rowActions}</td></tr>`).join('')}</tbody></table></div>`)}
  ${panel('Grants', tableOf(['Person', 'Role', 'Applies to', 'Since', ''], [
    [`<div class="person">${av('Joseph Tui', '#0f62fe')}Joseph Tui</div>`, 'Data manager', 'North region and below', '<span class="muted">Mar 2026</span>', rowActions],
    [`<div class="person">${av('Priya Nair', '#0043ce')}Priya Nair</div>`, 'Epidemiologist', 'Whole organisation', '<span class="muted">Jan 2026</span>', rowActions],
    [`<div class="person">${av('Mele Fifita', '#007d79')}Mele Fifita</div>`, 'Data collector', 'Riverside clinic', '<span class="muted">Today</span>', rowActions]]), '', false)}
  </section>`;
};

V.branding = () => `<section class="page">
  ${hero('Settings', 'Branding', 'Your logo and colour appear on the sign-in page, the workspace and public dashboards.', btn('Reset to default', '', '') + btn('Publish branding', '', 'primary'))}
  <div class="split wide">
    <div class="stack">
      ${panel('Identity', `<div class="form-grid">${field('Display name', 'Kestrel District Health')}${field('Short name', 'Kestrel', 'Shown in tight spaces')}
        <label class="label full">Logo<div class="row-between" style="border:1px dashed var(--line-2);padding:16px"><span class="org-mark" style="width:44px;height:44px">${ic('org', 22)}</span><div class="grow"><div style="font-weight:500">kestrel-mark.svg</div><div class="hint">SVG or PNG, square, at least 128 px</div></div>${btn('Replace', 'upload')}</div></label>
        <div class="full label">Brand colour<div class="swatches">${['#0f62fe', '#007d79', '#8a3ffc', '#da1e28', '#b28600', '#198038', '#161616'].map((c, i) => `<button class="swatch" style="background:${c}" aria-pressed="${i === 0}" aria-label="${c}"></button>`).join('')}<input class="input mono" style="width:110px" value="#0f62fe"/></div><span class="hint">Text on the colour is chosen for contrast: 7.2 : 1 with white (AAA).</span></div></div>`, '', true)}
      ${panel('Sign-in page', `<div class="form-grid full">${field('Welcome line', 'Sign in to Kestrel')}${field('Support email', 'help@kestrel.example')}</div>`, '', true)}
    </div>
    <div class="stack"><div class="eyebrow">Live preview</div>
      <div class="panel" style="background:var(--canvas)"><div style="display:grid;grid-template-columns:120px 1fr;min-height:200px"><div style="padding:12px;display:grid;gap:6px;align-content:start"><div class="row-between"><span class="org-mark" style="width:22px;height:22px"></span><b style="font-size:12px">Kestrel</b></div>${['Home', 'Projects', 'People'].map((x, i) => `<div style="height:24px;padding:0 8px;font-size:11px;display:flex;align-items:center;${i === 0 ? 'background:var(--sheet);box-shadow:var(--shadow);border-left:2px solid var(--brand)' : 'color:var(--ink-3)'}">${x}</div>`).join('')}</div><div style="background:var(--sheet);padding:16px;display:grid;gap:10px;align-content:start;border-left:1px solid var(--line)"><b>Good morning</b><div class="pill-row"><button class="btn primary" style="height:26px;font-size:12px">Primary</button><span class="chip brand">Tag</span></div><div class="meter"><i style="width:62%"></i></div></div></div></div>
      <div class="panel"><div style="padding:24px;display:grid;gap:10px;justify-items:center;text-align:center"><span class="org-mark" style="width:40px;height:40px">${ic('org', 20)}</span><b>Sign in to Kestrel</b><input class="input" style="max-width:240px" placeholder="Email"/><button class="btn primary" style="width:240px;justify-content:center">Continue</button></div></div></div>
  </div></section>`;

V.security = () => `<section class="page">
  ${hero('Settings', 'Security', 'Sign-in rules for everyone in the organisation.')}
  <div class="grid2">
    ${panel('Two-factor authentication', `<div class="setting"><div class="grow"><div class="t">Require 2FA for everyone</div><div class="s">People without it are asked to set it up at their next sign-in.</div></div>${toggle(true, 'Require 2FA')}</div><div class="setting"><div class="grow"><div class="t">Enrolled</div><div class="meter" style="margin-top:6px"><i style="width:86%"></i></div></div><span class="mono">184 / 214</span></div>`)}
    ${panel('Not yet enrolled', `<ul class="list">${PEOPLE.slice(3, 7).map(([n, e, , , , , c]) => `<li style="align-items:center">${av(n, c)}<div><div class="t">${n}</div><div class="s">${e}</div></div><span class="ml-auto">${btn('Remind', 'mail')}</span></li>`).join('')}</ul>`, '30 people')}
  </div></section>`;

V.domains = () => `<section class="page">
  ${hero('Settings', 'Domains', 'Reach your workspace on your own address. Visitors to the platform address are redirected to the primary one.', btn('Add domain', 'plus', 'primary'))}
  ${panel('Addresses', tableOf(['Hostname', 'Status', 'Primary', ''], [
    ['<span class="mono">kestrel.grids.app</span>', chip('Platform address', ''), '', ''],
    ['<span class="mono">data.kestrel.example</span>', chip('Verified', 'good'), `<span class="chip brand">Primary</span>`, rowActions],
    ['<span class="mono">reports.kestrel.example</span>', chip('Waiting for DNS', 'stale'), btn('Make primary', '', 'ghost'), btn('Check again', 'play')]]))}
  ${panel('Verify reports.kestrel.example', `<div class="stack" style="gap:14px"><div class="steps"><div class="done"><span class="no">${ic('check', 12)}</span>Add domain</div><div class="on"><span class="no">2</span>Add DNS records</div><div><span class="no">3</span>Verify</div></div>
    <p class="muted" style="margin:0">Add both records at your DNS provider, then check again. This can take a few minutes.</p>
    <div class="code">CNAME  reports.kestrel.example    →  edge.grids.app\nTXT    _grids-challenge.reports…  =  grids-verify=8f31c0d2e7</div></div>`, '', true)}</section>`;

V.languages = () => `<section class="page">
  ${hero('Settings', 'Languages', 'People pick their own language. Choose which ones your organisation offers and the default for new people.', btn('Add language', 'plus', 'primary'))}
  ${panel('Offered languages', tableOf(['Language', 'Translated', 'Default', 'Enabled'], [['English', 100, 1, 1], ['Français', 98, 0, 1], ['Español', 96, 0, 1], ['العربية · right-to-left', 91, 0, 1], ['Samoan · Gagana Samoa', 64, 0, 0], ['Tongan · Lea faka-Tonga', 58, 0, 0], ['Tok Pisin', 41, 0, 0], ['Bislama', 37, 0, 0]].map(([n, p, d, e]) => [`<b>${n}</b>`, `<div class="row-between" style="width:200px"><div class="meter grow ${p < 50 ? 'warn' : ''}"><i style="width:${p}%"></i></div><span class="mono muted">${p}%</span></div>`, `<input type="radio" name="d" class="check" ${d ? 'checked' : ''}/>`, toggle(!!e, n)])))}
  ${panel('Workspace overrides', `<div class="form-grid">${select('Number format', ['1,234.5', '1.234,5', '1 234,5'])}${select('Week starts on', ['Monday', 'Sunday', 'Saturday'])}${select('Date format', ['3 Oct 2026', '10/03/2026', '2026-10-03'])}${select('Time zone', ['Pacific/Apia', 'UTC'])}</div>`, '', true)}</section>`;

V.billing = () => `<section class="page">
  ${hero('Settings', 'Billing', 'Your subscription, upcoming charges, usage and invoices.', btn('Change plan', '', '') + btn('Update contact', '', ''))}
  <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">
    <div class="kpi"><span class="eyebrow">Plan</span><span class="val" style="font-size:22px">Growth</span><span class="sub">Billed yearly · renews 14 Jan 2027</span></div>
    <div class="kpi"><span class="eyebrow">Upcoming charge</span><span class="val">$2,880</span><span class="sub">After a 10% negotiated discount</span></div>
    <div class="kpi"><span class="eyebrow">Outstanding</span><span class="val">$0</span><span class="sub"><span class="delta up">Paid up</span></span></div>
  </div>
  <div class="grid2">
    ${panel('Usage against your plan', [['People', 214, 250], ['Projects', 4, 10], ['Storage', 41, 50, ' GB'], ['Submissions / month', 5120, 10000]].map(([n, u, l, s = '']) => `<div class="setting"><div class="grow"><div class="row-between"><span class="t">${n}</span><span class="mono sm">${u.toLocaleString()}${s} / ${l.toLocaleString()}${s}</span></div><div class="meter ${u / l > .9 ? 'bad' : u / l > .8 ? 'warn' : ''}" style="margin-top:8px"><i style="width:${(u / l) * 100}%"></i></div></div></div>`).join(''))}
    ${panel('Included features', `<ul class="list">${['Custom domain', 'Offline forms', 'Public dashboards', 'API access', 'Priority support'].map((f) => `<li style="padding:10px 18px;align-items:center"><span class="tick">${ic('check', 12)}</span>${f}</li>`).join('')}</ul>`)}
  </div>
  ${panel('Invoices', tableOf(['Invoice', 'Issued', 'Due', 'Amount', 'Status', ''], [['<a class="dl mono" data-go="invoice">INV-2026-00041</a>', '14 Jan 2026', '28 Jan 2026', '$2,880.00', chip('Paid', 'good'), btn('PDF', 'download', 'ghost')], ['<a class="dl mono" data-go="invoice">INV-2025-00112</a>', '14 Jan 2025', '28 Jan 2025', '$2,400.00', chip('Paid', 'good'), btn('PDF', 'download', 'ghost')]], [3]))}</section>`;

V.invoice = () => `<section class="page" style="max-width:820px">
  ${hero('Billing · Invoice', 'INV-2026-00041', 'Issued 14 Jan 2026 · due 28 Jan 2026', btn('Download PDF', 'download') + btn('Print', ''))}
  ${panel('Summary', `<div class="kv"><div>Billed to</div><div>Kestrel District Health · billing@kestrel.example</div><div>Plan</div><div>Growth · yearly</div><div>Period</div><div>14 Jan 2026 – 13 Jan 2027</div><div>Status</div><div>${chip('Paid', 'good')} · bank transfer, 20 Jan 2026</div></div>`)}
  ${panel('Lines', tableOf(['Description', 'Qty', 'Amount'], [['Growth plan, yearly', 1, '$3,200.00'], ['Yearly discount (10%)', '', '−$320.00'], ['Negotiated discount (0%)', '', '$0.00'], ['<b>Total</b>', '', '<b>$2,880.00</b>']], [1, 2]))}</section>`;

V.support = () => `<section class="page">
  ${hero('Help', 'Support', 'Ask the Grids team a question. Replies arrive here and by email.', btn('New ticket', 'plus', 'primary'))}
  <div class="toolbar"><div class="seg"><button aria-pressed="true">Open <span class="mono muted">2</span></button><button aria-pressed="false">Waiting on you <span class="mono muted">1</span></button><button aria-pressed="false">Closed</button></div></div>
  ${panel('Tickets', tableOf(['Subject', 'Status', 'Priority', 'Updated', ''], [
    ['<a class="dl" data-go="ticket"><b>Dashboard export times out</b></a>', chip('Reply waiting', 'bad'), 'High', '<span class="muted">12 min ago</span>', ''],
    ['<b>Add a second billing contact</b>', chip('Open', 'brand'), 'Normal', '<span class="muted">Yesterday</span>', ''],
    ['<b>How do I import facilities from CSV?</b>', chip('Closed', ''), 'Low', '<span class="muted">3 weeks ago</span>', '']]))}</section>`;

V.ticket = () => `<section class="page">
  <div class="hero"><div><a class="eyebrow dl" data-go="support">Support</a><h1>Dashboard export times out</h1><p>#1042 · opened 2 days ago by Amina Rahman</p></div><div class="actions">${btn('Close ticket', 'check')}</div></div>
  <div class="split wide" style="grid-template-columns:minmax(0,1fr) 300px">
    ${panel('Conversation', `${[['Amina Rahman', '#8a3ffc', '2 days ago', 'Exporting the weekly dashboard as PDF spins forever when more than 3 regions are selected. Screenshot attached.'], ['Grace (Grids support)', '#198038', 'Yesterday', 'Thanks Amina, we reproduced it and shipped a fix to the export queue. Could you try again?'], ['Amina Rahman', '#8a3ffc', '12 min ago', 'Works now. Thank you!']].map(([n, c, w, t]) => `<div class="msg">${av(n, c, 32)}<div class="grow"><div class="row-between"><b>${n}</b><span class="muted mono sm">${w}</span></div><div class="bubble">${t}</div></div></div>`).join('')}
      <div class="panel-b" style="border-top:1px solid var(--line)"><textarea class="textarea" placeholder="Write a reply"></textarea><div class="row-between" style="margin-top:10px">${btn('Attach', 'link')}<span class="ml-auto">${btn('Send reply', 'send', 'primary')}</span></div></div>`)}
    <div class="stack">${panel('Details', `<div class="kv" style="grid-template-columns:90px 1fr"><div>Status</div><div>${chip('Reply waiting', 'bad')}</div><div>Priority</div><div>High</div><div>Assignee</div><div>Grace</div><div>Page</div><div class="mono sm">/p/health/dashboards</div></div>`)}</div>
  </div></section>`;

V.activity = () => `<section class="page">
  ${hero('Help', 'Activity', 'Everything that changed in the organisation, newest first.', btn('Export CSV', 'download'))}
  <div class="toolbar"><label class="field">${ic('search', 15)}<input placeholder="Search activity" aria-label="Search"/></label><select class="select"><option>All people</option></select><select class="select"><option>All areas</option><option>People</option><option>Projects</option><option>Security</option><option>Billing</option></select><select class="select"><option>Last 7 days</option><option>Last 30 days</option></select></div>
  <div class="panel"><ul class="timeline">${[['b', 'Amina Rahman', 'invited <b>sina.leota@kestrel.example</b> as Data collector', 'People', '2 h ago'], ['g', 'Joseph Tui', 'published dashboard <b>Measles</b>', 'Projects', '3 h ago'], ['w', 'Amina Rahman', 'turned <b>Require 2FA</b> on', 'Security', 'Yesterday'], ['b', 'Priya Nair', 'edited form <b>Weekly facility report</b> (v12)', 'Projects', 'Yesterday'], ['r', 'Amina Rahman', 'suspended <b>Tomás Ruiz</b>', 'People', '3 days ago'], ['', 'Grids billing', 'issued invoice <b>INV-2026-00041</b>', 'Billing', '14 Jan']].map(([c, w, t, a, when]) => `<li class="${c}"><div class="grow"><b>${w}</b> <span class="muted">${t.replace(/<b>/g, '<b style="color:var(--ink);font-weight:500">')}</span></div>${chip(a)}<span class="mono muted sm" style="width:80px;text-align:right">${when}</span></li>`).join('')}</ul></div></section>`;

/* ---------- Project tabs ---------- */
PT.overview = () => `
  <div class="kpis">
    <div class="kpi"><span class="eyebrow">Facilities</span><span class="val">52</span><span class="sub">4 regions</span></div>
    <div class="kpi"><span class="eyebrow">Submissions</span><span class="val">1,284</span><span class="sub">this week</span></div>
    <div class="kpi"><span class="eyebrow">Dashboards</span><span class="val">3</span><span class="sub">1 public</span></div>
    <div class="kpi"><span class="eyebrow">Data freshness</span><span class="val" style="font-size:22px">${'Live'}</span><span class="sub">Last update 4 min ago</span></div>
  </div>
  <div class="cols">${panel('Pick up where you left off', `<ul class="list">${[['chart', 'Malaria weekly overview', 'Dashboard · edited yesterday', 'dash'], ['forms', 'Weekly facility report', 'Form · v12 · 18 submissions waiting', 'forms'], ['jobs', 'Import DHIS2 indicators', 'Job · ran 6 min ago', 'jobs']].map(([i, t, s, tab]) => `<li data-go="project:${route.split(':')[1]}@${tab}" style="cursor:pointer;align-items:center"><span class="alert-ic" style="background:var(--raise)">${ic(i, 16)}</span><div><div class="t">${t}</div><div class="s">${s}</div></div><span class="ml-auto muted">${ic('arrow', 15)}</span></li>`).join('')}</ul>`)}
    ${panel('Setup', ['Define entity types', 'Add facilities', 'Create a form', 'Build a dashboard', 'Publish'].map((t, i) => `<div class="setting"><span class="tick ${i < 4 ? '' : 'no'}">${ic('check', 12)}</span><span class="grow ${i < 4 ? 'muted' : ''}" style="${i < 4 ? 'text-decoration:line-through' : ''}">${t}</span></div>`).join(''), '4 of 5')}</div>`;

PT.explore = () => `<div class="panel"><div class="row-between" style="padding:10px 14px;border-bottom:1px solid var(--line)"><select class="select"><option>Malaria · confirmed cases</option></select><select class="select"><option>Week 39</option></select><select class="select"><option>Facilities</option></select><div class="seg ml-auto"><button aria-pressed="true">Map</button><button aria-pressed="false">Table</button><button aria-pressed="false">Chart</button></div></div>
  <div style="display:grid;grid-template-columns:minmax(0,1fr) 280px">${mapView()}<div style="border-left:1px solid var(--line);padding:16px;display:grid;gap:12px;align-content:start"><div class="eyebrow">Selected</div><b>Riverside clinic</b><div class="kv" style="grid-template-columns:90px 1fr;margin:0 -18px"><div>Cases</div><div class="mono">41</div><div>Threshold</div><div class="mono">30</div><div>Region</div><div>Coastal</div></div>${spark([12, 18, 22, 30, 28, 36, 41], 240, 50)}${btn('Open entity', 'arrow', '', 'entity')}</div></div></div>`;

PT.entities = () => `<div class="toolbar"><div class="seg"><button aria-pressed="true">Facility <span class="mono muted">52</span></button><button aria-pressed="false">Region <span class="mono muted">6</span></button></div><label class="field">${ic('search', 15)}<input placeholder="Search entities"/></label><span class="ml-auto">${btn('Import CSV', 'upload') + btn('Add entity', 'plus', 'primary')}</span></div>
  <div class="panel">${tableOf(['Code', 'Name', 'Parent', 'Beds', 'Location', ''], [['FAC-0012', '<a class="dl" data-go="entity"><b>Riverside clinic</b></a>', 'Coastal', 24, '<span class="mono muted">−13.83, −171.76</span>', rowActions], ['FAC-0013', '<b>Port clinic</b>', 'Coastal', 12, '<span class="mono muted">−13.82, −171.74</span>', rowActions], ['FAC-0021', '<b>Central hospital</b>', 'Central', 180, '<span class="mono muted">−13.84, −171.75</span>', rowActions], ['FAC-0034', '<b>Hill View health post</b>', 'Highlands', 4, '<span class="mono muted">−13.91, −171.80</span>', rowActions]], [3])}</div>`;

V.entity = () => `<section class="page">
  <div class="hero"><div><a class="eyebrow dl" data-go="project:health@entities">Facility surveillance · Entities</a><h1>Riverside clinic</h1><p>Facility · FAC-0012 · Coastal region</p></div><div class="actions">${btn('Edit', 'edit')}${btn('New submission', 'plus', 'primary', 'fill')}</div></div>
  <div class="split wide"><div class="stack">${panel('Profile', `<div class="kv"><div>Type</div><div>Facility</div><div>Code</div><div class="mono">FAC-0012</div><div>Parent</div><div>Coastal region</div><div>Beds</div><div>24</div><div>Location</div><div class="mono">−13.83, −171.76</div></div>`)}<div class="panel">${mapView().replace(/aspect-ratio/, 'aspect-ratio')}</div></div>
  <div class="stack">${panel('Confirmed cases · last 12 weeks', lineChart(), '', true)}${panel('Recent submissions', tableOf(['Form', 'Period', 'Status'], [['Weekly facility report', 'W39', chip('Submitted', 'brand')], ['Weekly facility report', 'W38', chip('Approved', 'good')], ['Stock count', 'Sep', chip('Returned', 'bad')]]))}</div></div></section>`;

PT.data = () => `<div class="hero" style="margin-bottom:-8px"><div><p style="margin:0">Indicators recorded as observations over time (by forms, jobs or the API).</p></div><div class="actions">${btn('New data element', 'plus', 'primary')}</div></div>
  <div class="panel">${tableOf(['Name', 'Key', 'Unit', 'Type', 'Aggregation', 'Latest', ''], [['<b>Confirmed malaria cases</b>', '<span class="mono">malaria_cases</span>', 'cases', 'Number', 'Sum', '389', rowActions], ['<b>Test positivity</b>', '<span class="mono">positivity</span>', '%', 'Number', 'Average', '18.2', rowActions], ['<b>Stock-out days</b>', '<span class="mono">stockout_days</span>', 'days', 'Number', 'Max', '2', rowActions], ['<b>Facility reported</b>', '<span class="mono">reported</span>', '', 'Yes / no', 'Count', '46', rowActions]], [5])}</div>`;

PT.datasets = () => `<div class="hero" style="margin-bottom:-8px"><div><p style="margin:0">Tables of rows: made by jobs, or created here and loaded from a spreadsheet. Dashboard widgets can chart them.</p></div><div class="actions">${btn('Upload CSV', 'upload')}${btn('New dataset', 'plus', 'primary')}</div></div>
  <div class="panel">${tableOf(['Dataset', 'Source', 'Rows', 'Updates', 'Freshness', ''], [['<b>DHIS2 indicators</b>', 'Job · Import DHIS2', '48,210', 'Daily', chip('<i></i>Live', 'live'), rowActions], ['<b>Facility register</b>', 'CSV upload', '52', 'On demand', chip('Updated 2 d ago', ''), rowActions], ['<b>Rainfall (BoM)</b>', 'Job · Weather feed', '9,400', 'Daily', chip('Stale · 3 d', 'stale'), rowActions]], [2])}</div>`;

PT.forms = () => `<div class="hero" style="margin-bottom:-8px"><div><p style="margin:0">Design forms, set who fills them and how submissions are reviewed.</p></div><div class="actions">${btn('Form groups', 'forms')}${btn('New form', 'plus', 'primary')}</div></div>
  <div class="cards">${[['Weekly facility report', 'v12 · 18 fields · 3 sections', 'Submitted → Approved', 1284], ['Outbreak alert', 'v3 · 9 fields', 'No review', 41], ['Stock count', 'v5 · 31 fields', 'Submitted → Approved', 212]].map(([n, m, w, c]) => `<article class="card"><div class="body"><h3>${n}</h3><p>${m}</p><div class="pill-row" style="margin-top:6px">${chip(w, 'brand')}${chip('Offline', '')}</div></div><div class="foot">${btn('Edit', 'edit', '', 'builder')}${btn('Fill', 'play', 'ghost', 'fill')}<span class="stats">${c.toLocaleString()} submissions</span></div></article>`).join('')}</div>`;

PT.submissions = () => `<div class="toolbar"><select class="select"><option>Weekly facility report</option></select><select class="select"><option>Any status</option></select><span class="ml-auto">${btn('Export', 'download')}</span></div>
  <div class="panel">${tableOf(['Facility', 'Period', 'Submitted by', 'Status', 'Cases', ''], [['<b>Riverside clinic</b>', 'W39', 'Mele Fifita', chip('Submitted', 'brand'), 41, btn('Review', 'check')], ['<b>Port clinic</b>', 'W39', 'Grace Kalo', chip('Submitted', 'brand'), 33, btn('Review', 'check')], ['<b>Central hospital</b>', 'W39', 'Priya Nair', chip('Approved', 'good'), 28, ''], ['<b>North gate clinic</b>', 'W38', 'Joseph Tui', chip('Returned', 'bad'), 19, '']], [4])}</div>`;

PT.jobs = () => `<div class="hero" style="margin-bottom:-8px"><div><p style="margin:0">Pull data in from other systems, on a schedule or when something happens.</p></div><div class="actions">${btn('New job', 'plus', 'primary')}</div></div>
  <div class="panel"><div class="panel-h"><h2>Import DHIS2 indicators</h2>${chip('<i></i>Running', 'live')}<span class="ml-auto">${btn('Run now', 'play')}${btn('Edit', 'edit')}</span></div><div class="panel-b"><div class="pipeline"><div class="stage"><div class="eyebrow">Trigger</div><b>Every day · 02:00</b></div><div class="link"></div><div class="stage"><div class="eyebrow">Fetch</div><b>DHIS2 API</b></div><div class="link"></div><div class="stage"><div class="eyebrow">Transform</div><b>Map to data elements</b></div><div class="link"></div><div class="stage"><div class="eyebrow">Load</div><b>Dataset · DHIS2 indicators</b></div></div></div></div>
  <div class="grid2">${panel('Triggers', `<ul class="list">${[['clock', 'Schedule', 'Every day at 02:00'], ['link', 'Webhook', 'POST /hooks/9a31… → rows'], ['globe', 'Sensor', 'Poll opensky.example every 5 min']].map(([i, t, s]) => `<li style="align-items:center"><span class="alert-ic" style="background:var(--raise)">${ic(i, 15)}</span><div><div class="t">${t}</div><div class="s">${s}</div></div><span class="ml-auto">${toggle(true, t)}</span></li>`).join('')}</ul>`)}
    ${panel('Recent runs', tableOf(['Started', 'Result', 'Rows'], [['6 min ago', chip('Succeeded', 'good'), '1,204'], ['Yesterday 02:00', chip('Succeeded', 'good'), '1,198'], ['2 days ago', chip('Failed · 401', 'bad'), '0']], [2]))}</div>`;

PT.overlays = () => `<div class="hero" style="margin-bottom:-8px"><div><p style="margin:0">Layers people can switch on in the map explorer, grouped like Health › Malaria.</p></div><div class="actions">${btn('Overlay groups', 'forms')}${btn('New overlay', 'plus', 'primary')}</div></div>
  ${['Health › Malaria', 'Health › Measles', 'Environment'].map((g, i) => `<div><div class="eyebrow" style="margin-bottom:8px">${g}</div><div class="cards">${[['Confirmed cases', 'Sum · latest week · choropleth'], ['Test positivity', 'Average · latest week · dots']].slice(0, i === 2 ? 1 : 2).map(([n, d]) => `<article class="card"><div class="body"><h3>${n}</h3><p>${d}</p></div><div class="foot">${chip('Visible by default', 'brand')}<span class="ml-auto">${rowActions}</span></div></article>`).join('')}</div></div>`).join('')}`;

PT.members = () => `<div class="hero" style="margin-bottom:-8px"><div><p style="margin:0">Who can use this project, and what they can do in it.</p></div><div class="actions">${btn('Add member', 'plus', 'primary')}</div></div>
  <div class="panel">${tableOf(['Person', 'Project role', 'Access via', ''], PEOPLE.slice(0, 5).map(([n, e, , r, , , c], i) => [`<div class="person">${av(n, c)}<div><b>${n}</b><div class="muted sm">${e}</div></div></div>`, i === 0 ? 'Owner' : i < 3 ? 'Editor' : 'Viewer', i < 2 ? 'Direct' : 'Group · Coastal team', rowActions]))}</div>`;

PT.settings = () => `<div class="grid2">
  ${panel('Project', `<div class="panel-b"><div class="form-grid">${field('Name', 'Facility surveillance')}${select('Visibility', ['Organisation', 'Private', 'Public'], 'Public projects are readable by anyone with the link.')}<label class="label full">Description<textarea class="textarea">Weekly facility reports with indicators, alerts, maps and trends.</textarea></label><div class="label">Colour<div class="swatches">${['#da1e28', '#8a3ffc', '#007d79', '#0043ce'].map((c, i) => `<button class="swatch" style="background:${c}" aria-pressed="${i === 0}"></button>`).join('')}</div></div></div></div>${saveBar()}`)}
  ${panel('Entity types', tableOf(['Type', 'Attributes', 'Sits under', ''], [['<b>Facility</b>', '5', 'Region', rowActions], ['<b>Region</b>', '2', '—', rowActions]]), '', false)}</div>
  ${panel('Danger zone', `<div class="setting"><div class="grow"><div class="t">Archive project</div><div class="s">Hides it from everyone. Data is kept and it can be restored.</div></div>${btn('Archive', '')}</div><div class="setting"><div class="grow"><div class="t">Delete project</div><div class="s">Permanently removes entities, submissions and dashboards.</div></div><button class="btn" style="color:var(--bad);border-color:var(--bad)">Delete…</button></div>`)}`;

/* ---------- Form builder ---------- */
V.builder = () => `<section class="page">
  <div class="hero"><div><a class="eyebrow dl" data-go="project:health@forms">Facility surveillance · Forms</a><h1>Weekly facility report</h1><p>Version 12 · draft changes not yet published</p></div><div class="actions">${btn('Preview', 'play')}${btn('Publish v13', 'check', 'primary')}</div></div>
  <div class="tabs"><button aria-selected="true">Fields</button><button>Logic</button><button>Workflow</button><button>Settings</button></div>
  <div class="builder">
    <aside><div class="eyebrow">Add a field</div>${[['Text', 'type'], ['Number', 'hash'], ['Date', 'calendar'], ['Choice', 'check'], ['Location', 'gps'], ['Photo', 'photo'], ['Entity link', 'entities'], ['Calculation', 'settings']].map(([n, i]) => `<div class="ftype">${ic(i, 15)}${n}<span class="ml-auto muted">${ic('drag', 14)}</span></div>`).join('')}</aside>
    <div class="canvas">
      <div class="section-card"><div class="panel-h"><span class="muted">${ic('drag', 14)}</span><h2>1 · Facility</h2><span class="meta">2 fields</span></div><div style="padding:14px">
        <div class="fcard"><div class="head">${ic('entities', 15)}<b>Facility</b><span class="chip ml-auto">Required</span></div><div class="fake"></div></div>
        <div class="fcard"><div class="head">${ic('calendar', 15)}<b>Reporting week</b><span class="chip ml-auto">Required</span></div><div class="fake"></div></div></div></div>
      <div class="section-card"><div class="panel-h"><span class="muted">${ic('drag', 14)}</span><h2>2 · Cases</h2><span class="meta">4 fields</span></div><div style="padding:14px">
        <div class="fcard"><div class="head">${ic('hash', 15)}<b>Malaria · under 5</b></div><div class="fake"></div></div>
        <div class="fcard sel"><div class="head">${ic('hash', 15)}<b>Malaria · 5 and over</b><span class="chip ml-auto brand">Selected</span></div><div class="fake"></div></div>
        <div class="fcard"><div class="head">${ic('settings', 15)}<b>Test positivity</b><span class="chip ml-auto">Calculated</span></div><div class="code" style="white-space:normal">(cases_u5 + cases_5plus) / tests * 100</div></div>
        <div class="fcard" style="border-style:dashed;text-align:center;color:var(--ink-3)">${ic('plus', 15)} Drop a field here</div></div></div>
    </div>
    <aside><div class="eyebrow">Field settings</div>${field('Label', 'Malaria · 5 and over')}${field('Key', 'cases_5plus', 'Used by dashboards and exports')}${select('Type', ['Number', 'Text', 'Choice'])}<div class="row-between"><span>Required</span>${toggle(false, 'Required')}</div><div class="form-grid" style="gap:10px">${field('Min', '0', '', 'number')}${field('Max', '', '', 'number')}</div><div class="eyebrow" style="margin-top:8px">Show when</div><div class="code" style="white-space:normal">reported = yes</div><button class="btn" style="color:var(--bad);margin-top:8px">${ic('trash', 15)}Remove field</button></aside>
  </div></section>`;
