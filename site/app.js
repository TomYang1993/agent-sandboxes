import { quote, overall, onboarding, safeUrl, ageDays, WEIGHTS, LABELS, ISO, FREE, BURST } from './calc.js';

// All text goes in through textContent, so feed text can never become markup.
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(9)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}
const $ = id => document.getElementById(id);
const unk = (t = 'unknown') => h('span', { class: 'u' }, t);
const ext = (u, t) => { const s = safeUrl(u); return s ? h('a', { href: s, rel: 'noopener noreferrer' }, t || s) : h('span', {}, t || 'no link'); };
const num = v => typeof v === 'number';
const usd = (v, d) => num(v) ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: d ?? (v % 1 ? 2 : 0), maximumFractionDigits: d ?? (v && v < 0.1 ? 4 : 2) }) : unk();
const yn = v => v === true ? h('span', { class: 'b good' }, 'yes') : v === false ? h('span', { class: 'b' }, 'no') : unk();
const badge = (t, c = '') => h('span', { class: 'b ' + c }, t);

const VIEWS = [['overall', 'Overall'], ['cost', 'Cost'], ['free', 'Free tier'], ['paid', 'Pro tier'], ['tokens', 'Token efficiency'],
  ['caps', 'Capabilities'], ['onboarding', 'Onboarding'], ['startup', 'Startup'], ['compare', 'Compare'], ['changes', 'Price changes'], ['method', 'Method']];
const KIND = { recurring: ['Every month', 'good'], software: ['Free software, your machine', 'good'], credit: ['One-off credit', ''], trial: ['Trial', 'warn'], none: ['None', 'bad'] };
const RISK = { hard_stop: ['Hard stop', 'good'], can_auto_charge: ['Can auto-charge', 'bad'], auto_moves_to_paid: ['Moves to paid', 'bad'], trial_converts: ['Trial converts to paid', 'bad'] };
const FIT = { gpu_free: ['Free GPU', 'good'], gpu_sold: ['GPU sold, not free', 'warn'], cpu_sold: ['CPU only, sold, not free', 'warn'], too_small: ['Too small', 'bad'], unknown: ['Unknown', ''] };
const SRC = { computesdk: 'ComputeSDK', starsling: 'StarSling', aisandboxbench: 'AI Sandbox Bench' };
const CALC = { cpu: 2, ram: 4, hrs: 176, busy: 30, idle: 0 };
let D, S, META, CATS, seq = 0;

// ---- URL state -----------------------------------------------------------
const state = () => new URLSearchParams(location.search);
function go(patch, replace) {
  const s = state();
  for (const [k, v] of Object.entries(patch)) (v === null || v === '' || v === undefined || v === false) ? s.delete(k) : s.set(k, v);
  history[replace ? 'replaceState' : 'pushState'](null, '', s.toString() ? '?' + s : './');
  render(!replace);
}
const link = patch => { const s = state(); for (const [k, v] of Object.entries(patch)) v === null ? s.delete(k) : s.set(k, v); return '?' + s; };
const provLink = p => h('a', { href: link({ view: 'provider', p: p.slug }), 'data-nav': true }, p.name);
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[data-nav]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault(); history.pushState(null, '', a.getAttribute('href')); render(true);
});
addEventListener('popstate', () => render(true));
const cmpList = () => (S.get('compare') || '').split(',').filter(s => D.some(p => p.slug === s)).slice(0, 4);

// ---- filters --------------------------------------------------------------
const catName = id => CATS.find(c => c.id === id)?.name || id;
const inCat = (p, c) => c === 'all' || (c === 'core' ? p.categories.some(x => x === 'code-sandbox' || x === 'dev-box') : p.categories.includes(c));
function filtered() {
  const q = (S.get('q') || '').toLowerCase(), c = S.get('cat') || 'core', e = p => p.effective;
  return D.filter(p => inCat(p, c)
    && (!q || `${p.name} ${p.slug} ${p.company || ''} ${p.tagline || ''}`.toLowerCase().includes(q))
    && (!S.get('kind') || e(p).freeKind === S.get('kind'))
    && (!S.get('iso') || (p.isolationKind || 'unknown') === S.get('iso'))
    && (!S.get('ink') || e(p).inkling2MiniFit.verdict === S.get('ink'))
    && (!S.get('nocard') || e(p).cardRequiredForFree === false)
    && (!S.get('gpu') || p.features.gpu === true || p.pricing.gpu.length > 0)
    && (!S.get('pause') || p.features.pauseResume === true)
    && (!S.get('os') || p.openSource === true) && (!S.get('self') || p.selfHost === true));
}
const select = (label, key, opts, cur, cls) => h('label', { class: cls }, label, h('select', { id: 'f-' + key, onchange: e => go({ [key]: e.target.value }, true) },
  opts.map(([v, t]) => h('option', { value: v, selected: (cur ?? S.get(key) ?? '') === v }, t))));
const check = (label, key) => h('label', { class: 'chk' }, h('input', { id: 'f-' + key, type: 'checkbox', checked: S.get(key) === '1', onchange: e => go({ [key]: e.target.checked ? '1' : null }, true) }), label);
let timer;
function filterBar(count, opts = {}) {
  const cats = opts.cats || [['core', 'Code sandboxes and dev boxes'], ...CATS.map(c => [c.id, c.name]), ['notebook', 'Notebooks'], ['all', 'Everything']];
  const more = ['kind', 'iso', 'ink', 'nocard', 'gpu', 'pause', 'os', 'self'];
  return h('section', { class: 'panel', 'aria-label': 'Filters' },
    h('div', { class: 'fields' },
      select('Category', 'cat', cats, S.get('cat') || 'core'),
      h('label', {}, 'Search', h('input', { id: 'f-q', type: 'search', value: S.get('q') || '', oninput: e => { clearTimeout(timer); const v = e.target.value; timer = setTimeout(() => go({ q: v }, true), 200); } })),
      h('span', { class: 'dim small', role: 'status' }, `${count} shown`),
      h('button', { type: 'button', onclick: () => go(Object.fromEntries(['q', 'cat', ...more].map(k => [k, null])), true) }, 'Clear filters')),
    h('details', { id: 'more', open: more.some(k => S.get(k)) || openIds.has('more') }, h('summary', {}, 'More filters'),
      h('div', { class: 'fields' },
        select('Free tier', 'kind', [['', 'Any'], ...Object.entries(KIND).map(([k, v]) => [k, v[0]])]),
        select('Isolation', 'iso', [['', 'Any'], ...[...Object.keys(ISO), 'unknown'].map(k => [k, k])]),
        select('Inkling 2 Mini', 'ink', [['', 'Any'], ...Object.entries(FIT).map(([k, v]) => [k, v[0]])]),
        check('No card (known)', 'nocard'), check('Has GPU', 'gpu'), check('Can pause', 'pause'), check('Open source', 'os'), check('Self-host', 'self'))));
}
const openIds = new Set();

// ---- table ------------------------------------------------------------------
function nameCell(p) {
  const age = ageDays(p.lastChecked), on = cmpList().includes(p.slug);
  return [provLink(p),
    h('span', { class: 'cmp' }, 'checked ', p.lastChecked || 'unknown'),
    p.status === 'shutting-down' && badge('Shutting down', 'bad'), p.status !== 'active' && p.status !== 'shutting-down' && badge(p.status, 'warn'),
    age === null ? badge('check date unknown', 'warn') : age > 30 && badge('older than 30 days', 'warn'),
    p.manual && badge('manual, not refreshed', 'warn'), p.conflicts.length > 0 && badge('sources conflict', 'warn'), p.reviewCount > 0 && badge('needs review', 'bad'),
    h('label', { class: 'cmp' }, h('input', { type: 'checkbox', id: 'cmp-' + p.slug, checked: on, 'aria-label': 'Compare ' + p.name, onchange: e => {
      const l = cmpList().filter(s => s !== p.slug); if (e.target.checked) { if (l.length >= 4) { e.target.checked = false; return alert('Compare up to 4.'); } l.push(p.slug); }
      go({ compare: l.join(',') }, true); } }), 'compare')];
}
// cols: {k, label, get, cell, num, asc}. Unknown always sorts last.
function table(rows, cols, def, opts = {}) {
  const key = cols.some(c => c.k === S.get('sort')) ? S.get('sort') : def, col = cols.find(c => c.k === key) || cols[0];
  const dir = S.get('sort') === key && S.get('dir') ? (S.get('dir') === 'asc' ? 1 : -1) : (col.asc === false ? -1 : 1);
  const val = (c, p) => c.get(p);
  const sorted = [...rows].sort((a, b) => {
    const x = val(col, a), y = val(col, b), xu = x === null || x === undefined, yu = y === null || y === undefined;
    if (xu || yu) return xu && yu ? a.name.localeCompare(b.name) : xu ? 1 : -1;
    return (num(x) ? x - y : String(x).localeCompare(String(y))) * dir || a.name.localeCompare(b.name);
  });
  const flip = c => go({ sort: c.k, dir: key === c.k ? (dir === 1 ? 'desc' : 'asc') : (c.asc === false ? 'desc' : 'asc') }, true);
  const t = ++seq;
  return [h('div', { class: 'fields phone panel' },
    h('label', {}, 'Sort by', h('select', { id: 'sort-' + t, onchange: e => go({ sort: e.target.value, dir: null }, true) }, cols.map(c => h('option', { value: c.k, selected: c.k === key }, c.label)))),
    h('button', { type: 'button', id: 'dir-' + t, onclick: () => flip(col) }, dir === 1 ? 'Ascending' : 'Descending')),
  h('div', { class: 'scroll cards', tabindex: '0', role: 'region', 'aria-label': opts.label || 'Providers' }, h('table', {},
    h('thead', {}, h('tr', {}, cols.map(c => h('th', { scope: 'col', class: c.num ? 'num' : null, 'aria-sort': c.k === key ? (dir === 1 ? 'ascending' : 'descending') : 'none' },
      h('button', { type: 'button', id: `th-${t}-${c.k}`, onclick: () => flip(c), title: c.tip }, c.label, c.k === key ? (dir === 1 ? ' ↑' : ' ↓') : ''))))),
    h('tbody', {}, sorted.length ? sorted.map(p => h('tr', {}, cols.map(c => c.k === 'name' ? h('th', { scope: 'row' }, nameCell(p))
      : h('td', { class: (c.num ? 'num ' : '') + (c.txt ? 'txt' : ''), 'data-label': c.label }, h('div', { class: 'cell' }, c.cell ? c.cell(p) : val(c, p) ?? unk())))))
      : h('tr', {}, h('td', { colspan: cols.length }, 'No provider matches these filters.')))))];
}
const NAME = { k: 'name', label: 'Provider', get: p => p.name.toLowerCase() };
const live = p => p.status !== 'shutting-down';
const head = (t, lead) => [h('h1', {}, t), h('p', { class: 'lead' }, lead)];
const meter = v => { const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'), r = document.createElementNS(ns, 'rect');
  r.setAttribute('width', Math.max(0, Math.min(100, v)) + '%'); r.setAttribute('height', '5'); s.append(r); s.setAttribute('aria-hidden', 'true'); return h('span', { class: 'meter' }, s); };
const rankCats = () => { const c = S.get('cat') || 'core'; return c === 'core' ? ['code-sandbox', 'dev-box'] : c === 'all' ? CATS.map(x => x.id) : [c]; };

// ---- views -----------------------------------------------------------------
function vOverall() {
  const w = {}; for (const k in WEIGHTS) { const v = S.get('w_' + k); w[k] = v === null || Number.isNaN(+v) ? WEIGHTS[k] : Math.max(0, Math.min(100, +v)); }
  const min = S.get('min') === null || Number.isNaN(+S.get('min')) ? 60 : Math.max(0, Math.min(100, +S.get('min')));
  const rows = filtered();
  const out = [head('Overall leaderboard', 'Set what matters to you. Each score uses only facts we know, and shows how much of it is known. Categories are ranked apart because their workloads differ.'),
    filterBar(rows.length),
    h('section', { class: 'panel', 'aria-label': 'Weights' }, h('div', { class: 'fields' },
      Object.keys(WEIGHTS).map(k => h('label', {}, `${LABELS[k]}: ${w[k]}`, h('input', { type: 'range', id: 'w-' + k, min: 0, max: 100, step: 5, value: w[k], onchange: e => go({ ['w_' + k]: +e.target.value === WEIGHTS[k] ? null : e.target.value }, true) }))),
      h('label', {}, `Minimum coverage: ${min}%`, h('input', { type: 'range', id: 'w-min', min: 0, max: 100, step: 5, value: min, onchange: e => go({ min: +e.target.value === 60 ? null : e.target.value }, true) })),
      h('button', { type: 'button', onclick: () => go(Object.fromEntries([...Object.keys(WEIGHTS).map(k => ['w_' + k, null]), ['min', null]]), true) }, 'Reset weights')),
    h('p', { class: 'small dim' }, 'Score = Σ(weight × known share × value) ÷ Σ(weight × known share). Coverage = Σ(weight × known share) ÷ Σ weight. Below the minimum coverage, or shutting down: not ranked. ', h('a', { href: link({ view: 'method' }), 'data-nav': true }, 'Full formula'))) ];
  for (const cat of rankCats()) {
    const peers = D.filter(p => p.categories.includes(cat) && live(p)), res = new Map();
    const list = rows.filter(p => p.categories.includes(cat));
    for (const p of peers) res.set(p.slug, overall(p, peers, cat, w));
    const ok = p => live(p) && res.get(p.slug).score !== null && res.get(p.slug).coverage >= min;
    const order = peers.filter(ok).sort((a, b) => res.get(b.slug).score - res.get(a.slug).score), rank = new Map();
    order.forEach((p, i) => { const prev = order[i - 1]; rank.set(p.slug, prev && Math.abs(res.get(prev.slug).score - res.get(p.slug).score) < 1e-9 ? rank.get(prev.slug) : i + 1); });
    const part = k => ({ k, label: LABELS[k], num: true, asc: false, get: p => res.get(p.slug)?.parts[k].v ?? null, cell: p => { const x = res.get(p.slug)?.parts[k]; return !x || x.v === null ? unk() : `${Math.round(x.v * 100)}${x.known < 0.999 ? ` (${Math.round(x.known * 100)}% known)` : ''}`; } });
    out.push(h('h2', {}, catName(cat)), h('p', { class: 'small dim' }, `${order.length} of ${peers.length} ranked. Ranks count the whole category; filters only hide rows.`),
      table(list, [{ k: 'rank', label: 'Rank', num: true, get: p => rank.get(p.slug) ?? null, cell: p => rank.get(p.slug) ?? unk('not ranked') }, NAME,
        { k: 'score', label: 'Score', num: true, asc: false, get: p => ok(p) ? res.get(p.slug).score : null, cell: p => ok(p) ? [h('strong', {}, res.get(p.slug).score.toFixed(1)), meter(res.get(p.slug).score)] : unk(live(p) ? 'too little known' : 'shutting down') },
        { k: 'coverage', label: 'Known', num: true, asc: false, get: p => res.get(p.slug)?.coverage ?? null, cell: p => live(p) ? Math.round(res.get(p.slug).coverage) + '%' : unk('n/a') },
        ...Object.keys(WEIGHTS).map(part)], 'rank', { label: catName(cat) }));
  }
  if (!rankCats().some(c => CATS.some(x => x.id === c))) out.push(h('p', {}, 'Notebooks are manual rows with too few facts to rank.'));
  return out;
}

function vCost() {
  const rows = filtered(), g = (k, max) => { const v = S.get(k); const x = v === null ? CALC[k] : +v; return Number.isFinite(x) && x >= 0 ? Math.min(max, x) : CALC[k]; };
  const c = { cpu: g('cpu', 1024), ram: g('ram', 8192), hrs: g('hrs', 744), busy: g('busy', 100), idle: g('idle', 744) };
  const pause = S.get('np') !== '1', freeUse = S.get('fu') === '1';
  const w = { vcpu: c.cpu || 1, gib: c.ram, hours: c.hrs, busy: c.busy / 100, idle: c.idle, pause, freeUse };
  const input = (k, label, max) => h('label', {}, label, h('input', { type: 'number', id: 'c-' + k, min: 0, max, step: 'any', value: c[k], onchange: e => go({ [k]: e.target.value === '' || +e.target.value === CALC[k] ? null : e.target.value }, true) }));
  const out = [head('Cost-effectiveness', 'Monthly cost for your workload, plus AI Sandbox Hunt’s fixed reference price. Only providers in the same category and workload are ranked together. A missing rate means not ranked.'),
    filterBar(rows.length),
    h('section', { class: 'panel', 'aria-label': 'Calculator' }, h('div', { class: 'fields' },
      input('cpu', 'vCPU', 1024), input('ram', 'Memory GiB', 8192), input('hrs', 'Working hours / month', 744), input('busy', 'CPU busy %', 100), input('idle', 'Idle hours / month', 744),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', id: 'c-np', checked: pause, onchange: e => go({ np: e.target.checked ? null : '1' }, true) }), 'Pause while idle, where documented'),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', id: 'c-fu', checked: freeUse, onchange: e => go({ fu: e.target.checked ? '1' : null }, true) }), 'Subtract free monthly plan usage')),
    h('p', { class: 'small dim' }, 'Compute and memory only: storage, traffic, per-plan session limits and one-off credits are not priced. Picks the cheapest published plan, with its fee, included usage and cap. Fixed sizes are multiplied up.')) ];
  for (const cat of rankCats()) {
    const info = CATS.find(x => x.id === cat), list = rows.filter(p => p.categories.includes(cat)), calc = cat === 'code-sandbox' || cat === 'dev-box';
    if (!info) { out.push(h('p', {}, 'No comparable prices for this category.')); continue; }
    if (info.priceUnit === 'none') { out.push(h('h2', {}, info.name), h('p', {}, 'Coding agents are sold by seat and credits, so there is no comparable price to rank.')); continue; }
    const unit = { workload: info.workload, browserHour: 'one browser-hour', h100: 'one H100 hour' }[info.priceUnit] || info.priceUnit;
    const quotes = new Map(D.filter(p => p.categories.includes(cat)).map(p => [p.slug, quote(p, w)]));
    const q = p => quotes.get(p.slug), cp = p => live(p) ? p.comparablePrice[cat] ?? null : null;
    const val = calc ? p => q(p).total : cp, order = D.filter(p => p.categories.includes(cat) && val(p) !== null).sort((a, b) => val(a) - val(b)), rank = new Map();
    order.forEach((p, i) => rank.set(p.slug, i && Math.abs(val(order[i - 1]) - val(p)) < 0.005 ? rank.get(order[i - 1].slug) : i + 1));
    const r = k => p => p.pricing.rates[k] ?? null;
    const cols = [{ k: 'rank', label: 'Rank', num: true, get: p => rank.get(p.slug) ?? null, cell: p => rank.get(p.slug) ?? unk('not ranked') }, NAME];
    if (calc) cols.push({ k: 'cost', label: 'Your cost / month', num: true, get: p => q(p).total, cell: p => q(p).total === null ? unk(q(p).why) : h('strong', {}, usd(q(p).total, 2)) },
      { k: 'plan', label: 'Plan and billing notes', txt: true, get: p => q(p).plan ?? null, cell: p => q(p).total === null ? unk('–') : [h('div', {}, q(p).plan), h('div', { class: 'small dim' }, q(p).notes.join('; ')), q(p).limits && h('details', {}, h('summary', { class: 'small' }, 'Plan limits'), q(p).limits)] });
    cols.push({ k: 'ref', label: 'Reference price', num: true, get: cp, cell: p => cp(p) === null ? unk() : usd(cp(p), cp(p) < 1 ? 3 : 2) });
    if (cat === 'browser') cols.push({ k: 'bh', label: 'Browser-hour rate', num: true, get: r('browserHour'), cell: p => usd(r('browserHour')(p)) });
    else cols.push({ k: 'vcpu', label: 'vCPU-hour', num: true, get: r('vcpuHour'), cell: p => usd(r('vcpuHour')(p)) }, { k: 'gib', label: 'GiB-hour', num: true, get: r('gibHour'), cell: p => usd(r('gibHour')(p)) },
      { k: 'inst', label: 'Fixed size / hour', num: true, get: r('instanceHour'), cell: p => r('instanceHour')(p) === null ? unk('none listed') : [usd(r('instanceHour')(p)), h('div', { class: 'small dim' }, p.pricing.rates.instance)] });
    cols.push({ k: 'active', label: 'CPU billed only when active', get: p => p.pricing.rates.cpuActiveOnly === undefined ? null : +p.pricing.rates.cpuActiveOnly, cell: p => yn(p.pricing.rates.cpuActiveOnly) },
      { k: 'billed', label: 'Billed while', txt: true, get: p => p.pricing.rates.billedWhile ?? null });
    out.push(h('h2', {}, info.name), h('p', { class: 'small dim' }, `Reference price is AI Sandbox Hunt’s, for: ${unit}. ${calc ? 'Rank uses your workload above.' : 'Rank uses the reference price.'}`), table(list, cols, 'rank', { label: info.name }));
  }
  return out;
}

function vFree() {
  const rows = filtered(), e = p => p.effective, ord = { recurring: 0, software: 1, credit: 2, trial: 3, none: 4 };
  return [head('Free tier', 'What you get without paying, whether a card is needed, when it ends, and whether you can be charged. Dollar amounts are the vendor’s own credit units, so they are not like for like.'), filterBar(rows.length),
    h('p', { class: 'small dim' }, 'The feed calls trials “credit”; we list one as a trial only where its own text says so. Likewise free software is split from hosted free plans.'),
    table(rows, [NAME, { k: 'kind', label: 'Kind', get: p => ord[e(p).freeKind] ?? null, cell: p => badge(...(KIND[e(p).freeKind] || [e(p).freeKind])) },
      { k: 'amount', label: 'Amount', num: true, asc: false, get: p => p.derived.freeAmountUsd, cell: p => num(p.derived.freeAmountUsd) ? [(p.derived.freeAmountUpTo ? 'up to ' : ''), usd(p.derived.freeAmountUsd), e(p).freeKind === 'recurring' ? ' / month' : ' once'] : e(p).freeKind === 'none' ? '–' : unk('not in dollars') },
      { k: 'card', label: 'Card required', get: p => e(p).freeKind === 'none' ? null : e(p).cardRequiredForFree === null ? null : +e(p).cardRequiredForFree, cell: p => e(p).freeKind === 'none' ? '–' : e(p).cardRequiredForFree === true ? badge('card needed', 'warn') : e(p).cardRequiredForFree === false ? badge('no card', 'good') : unk() },
      { k: 'expiry', label: 'Ends', get: p => p.derived.freeExpiry, cell: p => p.derived.freeExpiry ?? (e(p).freeKind === 'none' || e(p).freeKind === 'software' ? '–' : unk()) },
      { k: 'risk', label: 'Stop or charge', get: p => e(p).freeRisk, cell: p => e(p).freeRisk ? badge(...(RISK[e(p).freeRisk] || [e(p).freeRisk, 'warn'])) : unk() },
      { k: 'text', label: 'What the source says', txt: true, get: p => e(p).freeTier, cell: p => [h('div', {}, e(p).freeTier), 'freeTier' in p.override && h('div', { class: 'small dim' }, `Feed says: ${p.pricing.freeTier}`), conflictNotes(p)] }], 'kind')];
}
const conflictNotes = p => p.conflicts.map(c => h('div', { class: 'note small' }, h('strong', {}, 'Conflict. '), c.note, ' ', ext(c.url, 'Source'), ` (${c.sourceLevel}, checked ${c.checked})`));

function vPaid() {
  const rows = filtered(), pl = p => p.derived.cheapestPaidPlan;
  return [head('Pro tier', 'The cheapest paid plan of each provider, what it includes, its limits, and included usage per dollar of fee.'), filterBar(rows.length),
    h('p', { class: 'small dim' }, 'Value per dollar = included usage ÷ monthly fee, at the provider’s own prices. $2.00 means $1 of fee buys $2 of usage. Flat plans and seat prices include no dollar usage in the data, so they get no value figure. Pay-as-you-go plans with no fee are not here.'),
    table(rows, [NAME, { k: 'fee', label: 'Monthly fee', num: true, get: p => pl(p)?.monthlyFee ?? null, cell: p => pl(p) ? [h('strong', {}, usd(pl(p).monthlyFee)), h('div', { class: 'small dim' }, pl(p).name)] : unk('none listed') },
      { k: 'incl', label: 'Included usage', num: true, asc: false, get: p => pl(p)?.includedUsageUsd || null, cell: p => !pl(p) ? unk('–') : pl(p).includedUsageUsd ? usd(pl(p).includedUsageUsd) : unk('no dollar usage in data') },
      { k: 'hours', label: 'Included hours', num: true, asc: false, get: p => pl(p)?.includedVcpuHours || null, cell: p => !pl(p) ? unk('–') : [pl(p).includedVcpuHours ? `${+pl(p).includedVcpuHours.toFixed(1)} vCPU-h ` : '', pl(p).includedGibHours ? `${pl(p).includedGibHours} GiB-h` : '', !pl(p).includedVcpuHours && !pl(p).includedGibHours && unk('none in data')] },
      { k: 'value', label: 'Value per $1', num: true, asc: false, get: p => p.derived.paidUsagePerDollar ?? null, cell: p => num(p.derived.paidUsagePerDollar) ? usd(p.derived.paidUsagePerDollar, 2) : unk() },
      { k: 'cap', label: 'Stops at allowance', get: p => pl(p) ? +pl(p).capped : null, cell: p => pl(p) ? yn(pl(p).capped) : unk('–') },
      { k: 'limits', label: 'Limits', txt: true, get: p => pl(p)?.limits ?? null }], 'fee')];
}

function vTokens() {
  const rows = filtered();
  return [head('Token efficiency', 'Not measured for any provider. A sandbox does not use tokens itself; the agent driving it does. We found no public per-provider figures, so there is no score, no estimate and no stand-in.'), filterBar(rows.length),
    h('section', { class: 'panel' }, h('h2', {}, 'How it could be measured'), h('p', {}, 'Keep the agent, the model and the prompt fixed. For each provider, run one task N times and report the median input and output tokens, with the spread and the failure count:'),
      h('ol', {}, ['Create a sandbox', 'Run a command', 'Move a file in and out', 'Recover from one planted error', 'Tear the sandbox down'].map(x => h('li', {}, x))),
      h('p', {}, 'What would differ is the length of the tool descriptions, the number of calls, the size of the replies and how clear the errors are. Publish the prompt, versions, dates and raw logs.')),
    table(rows, [NAME, { k: 'tok', label: 'Token efficiency', get: () => null, cell: () => unk('Not measured') }], 'name')];
}

function vCaps() {
  const rows = filtered(), f = p => p.features, b = k => ({ get: p => f(p)[k] === true ? 1 : f(p)[k] === false ? 0 : null, asc: false, cell: p => yn(f(p)[k]) });
  const o = k => ({ get: p => p[k] === true ? 1 : p[k] === false ? 0 : null, asc: false, cell: p => yn(p[k]) });
  const fo = ['gpu_free', 'gpu_sold', 'cpu_sold', 'too_small', 'unknown'];
  return [head('Capabilities', 'What each sandbox can do, from published facts. Unknown means the vendor did not say.'), filterBar(rows.length),
    h('div', { class: 'note' }, h('strong', {}, 'Can it run Inkling 2 Mini? '), 'It needs a 24 GB GPU, or 32 GB RAM (slow), and about 30 GB of disk. “Sold” is not “free”: it means a large enough size can be bought, not that a free tier includes it. Disk is not checked.'),
    table(rows, [NAME, { k: 'ink', label: 'Runs Inkling 2 Mini?', get: p => fo.indexOf(p.effective.inkling2MiniFit.verdict), cell: p => { const x = p.effective.inkling2MiniFit; return [badge(...(FIT[x.verdict] || [x.verdict])), h('div', { class: 'small dim' }, x.why), 'inkling2MiniFit' in p.override && h('div', { class: 'small dim' }, `Derived from feed: ${FIT[p.derived.inkling2MiniFit.verdict][0]}`)]; } },
      { k: 'cpu', label: 'Max vCPU', num: true, asc: false, get: p => f(p).maxVcpu ?? null }, { k: 'ram', label: 'Max RAM GiB', num: true, asc: false, get: p => f(p).maxMemoryGib ?? null },
      { k: 'gpus', label: 'GPUs and price / hour', txt: true, asc: false, get: p => p.pricing.gpu.length || (f(p).gpu === true ? 0.5 : f(p).gpu === false ? 0 : null), cell: p => p.pricing.gpu.length ? (p.pricing.gpu.length > 2 ? h('details', {}, h('summary', {}, `${p.pricing.gpu.length} listed`), gpuList(p)) : gpuList(p)) : f(p).gpu === true ? 'Yes, models not listed' : yn(f(p).gpu) },
      { k: 'iso', label: 'Isolation', get: p => p.isolationKind && p.isolationKind !== 'unknown' ? p.isolationKind : null, cell: p => p.isolationKind && p.isolationKind !== 'unknown' ? [badge(p.isolationKind)] : unk() },
      { k: 'sess', label: 'Session limit h', num: true, asc: false, get: p => f(p).maxSessionHours ?? null },
      { k: 'pause', label: 'Pause', ...b('pauseResume') }, { k: 'snap', label: 'Snapshots', ...b('snapshots') }, { k: 'img', label: 'Custom images', ...b('customImages') }, { k: 'net', label: 'Network controls', ...b('networkControls') },
      { k: 'os', label: 'Open source', ...o('openSource') }, { k: 'self', label: 'Self-host', ...o('selfHost') },
      { k: 'reg', label: 'Regions', txt: true, get: p => p.regions ?? null }], 'name')];
}
const gpuList = p => h('ul', {}, p.pricing.gpu.map(g => h('li', {}, g.type, ': ', num(g.perHour) ? usd(g.perHour, 2) : unk())));

function vOnb() {
  const rows = filtered(), O = new Map(rows.map(p => [p.slug, onboarding(p)])), sum = p => O.get(p.slug).reduce((a, x) => a + x.earned, 0);
  const labels = onboarding(D[0]), max = labels.reduce((a, x) => a + x.points, 0);
  return [head('Onboarding ease', `Points for published facts, out of ${max}. This is documentation-based; we did not sign up or test anything.`), filterBar(rows.length),
    h('p', { class: 'small dim' }, 'Unknown earns no points and shows as unknown. The feed has no invite field: one point is lost for a stated invite, and otherwise it stays unknown. An interface that is not listed is unknown, not “no”.'),
    table(rows, [NAME, { k: 'pts', label: 'Points', num: true, asc: false, get: sum, cell: p => [h('strong', {}, `${sum(p)} / ${max}`), meter(100 * sum(p) / max)] },
      ...labels.map((l, i) => ({ k: 'o' + i, label: `${l.label} (${l.points})`, asc: false, get: p => { const v = O.get(p.slug)[i].value; return v === null ? null : +v; }, cell: p => { const x = O.get(p.slug)[i]; return x.value === true ? badge(`yes +${x.points}`, 'good') : x.value === false ? badge('no', '') : unk(); } })),
      { k: 'docs', label: 'Docs', get: p => p.docsUrl ?? null, cell: p => p.docsUrl ? ext(p.docsUrl, 'Open') : unk() }], 'pts')];
}

function vStart() {
  const rows = filtered().filter(p => p.benchmarks.length), ms = new Map();
  for (const p of rows) for (const b of p.benchmarks) { const k = `${b.source}|${b.metric}|${b.unit}`; (ms.get(k) || ms.set(k, []).get(k)).push([p, b]); }
  const out = [head('Startup and benchmarks', 'Results published by others, copied from the feed with source and date. They age, and each group is a different test, so do not compare between groups. We ran none of them.'), filterBar(rows.length)];
  if (ms.size) out.push(h('p', { class: 'small dim' }, 'Only providers with a published result appear.'));
  for (const [k, list] of ms) {
    const m = new Map(list.map(([p, b]) => [p.slug, b])), first = list[0][1];
    out.push(h('h2', {}, `${SRC[first.source] || first.source}: ${first.metric}`),
      table(list.map(x => x[0]), [NAME, { k: 'v', label: `Result (${first.unit})`, num: true, asc: first.better === 'lower', get: p => m.get(p.slug).value, cell: p => h('strong', {}, m.get(p.slug).value.toLocaleString('en-US')) },
        { k: 'r', label: 'Place in that test', num: true, get: p => m.get(p.slug).rank ?? null, cell: p => num(m.get(p.slug).rank) ? `${m.get(p.slug).rank} of ${m.get(p.slug).of}` : unk() },
        { k: 'd', label: 'Date', get: p => m.get(p.slug).date, cell: p => [m.get(p.slug).date, ageDays(m.get(p.slug).date) > 30 && badge('older than 30 days', 'warn')] },
        { k: 'n', label: 'Note', get: p => m.get(p.slug).note ?? null, cell: p => m.get(p.slug).note || '–' }], 'v', { label: first.metric }));
  }
  if (!ms.size) out.push(h('p', {}, 'No published benchmark for this selection.'));
  return out;
}

function vCompare() {
  const l = cmpList(), ps = l.map(s => D.find(p => p.slug === s));
  const opts = D.filter(p => !l.includes(p.slug));
  const out = [head('Compare', 'Pick 2 to 4 providers. The link in your address bar keeps the selection.'),
    h('section', { class: 'panel fields' }, l.length < 4 && h('label', {}, 'Add a provider', h('select', { id: 'cmp-add', onchange: e => e.target.value && go({ compare: [...l, e.target.value].join(',') }, true) }, h('option', { value: '' }, 'Choose…'), opts.map(p => h('option', { value: p.slug }, p.name)))),
      ps.map(p => h('button', { type: 'button', onclick: () => go({ compare: l.filter(s => s !== p.slug).join(',') }, true) }, `Remove ${p.name}`)))];
  if (ps.length < 2) return [...out, h('p', {}, 'Add at least two providers.')];
  const e = p => p.effective, f = p => p.features, r = p => p.pricing.rates, pl = p => p.derived.cheapestPaidPlan;
  const rowsDef = [['Categories', p => p.categories.join(', ')], ['Free tier', p => [badge(...KIND[e(p).freeKind]), h('div', {}, e(p).freeTier), conflictNotes(p)]], ['Card required', p => e(p).freeKind === 'none' ? '–' : yn(e(p).cardRequiredForFree)],
    ['Stop or charge', p => e(p).freeRisk ? badge(...(RISK[e(p).freeRisk] || [e(p).freeRisk])) : unk()],
    ['Reference price', p => Object.entries(p.comparablePrice).map(([c, v]) => h('div', {}, `${c}: `, usd(v)))], ['vCPU-hour', p => usd(r(p).vcpuHour)], ['GiB-hour', p => usd(r(p).gibHour)], ['Fixed size / hour', p => num(r(p).instanceHour) ? [usd(r(p).instanceHour), ' ', r(p).instance] : unk('none listed')],
    ['CPU billed only when active', p => yn(r(p).cpuActiveOnly)], ['Billed while', p => r(p).billedWhile ?? unk()], ['Cheapest paid plan', p => pl(p) ? [`${pl(p).name}: `, usd(pl(p).monthlyFee), h('div', { class: 'small dim' }, pl(p).limits)] : unk('none listed')],
    ['Max vCPU', p => f(p).maxVcpu ?? unk()], ['Max RAM GiB', p => f(p).maxMemoryGib ?? unk()], ['GPUs', p => p.pricing.gpu.length ? gpuList(p) : yn(f(p).gpu)], ['Isolation', p => p.isolation ?? unk()], ['Session limit h', p => f(p).maxSessionHours ?? unk()],
    ...[['Pause', 'pauseResume'], ['Snapshots', 'snapshots'], ['Custom images', 'customImages'], ['Network controls', 'networkControls']].map(([t, k]) => [t, p => yn(f(p)[k])]),
    ['Open source', p => yn(p.openSource)], ['Self-host', p => yn(p.selfHost)], ['Regions', p => p.regions ?? unk()], ['Interfaces', p => p.sdks?.join(', ') ?? unk()],
    ['Onboarding points', p => `${onboarding(p).reduce((a, x) => a + x.earned, 0)} / ${onboarding(p).reduce((a, x) => a + x.points, 0)}`], ['Token efficiency', () => unk('Not measured')],
    ['Inkling 2 Mini', p => [badge(...FIT[e(p).inkling2MiniFit.verdict]), ' ', e(p).inkling2MiniFit.why]], ['Burst start', p => { const b = p.benchmarks.find(x => x.metric === BURST); return b ? `${b.value} ${b.unit} (${SRC[b.source] || b.source}, ${b.date})` : unk('not measured'); }], ['Last checked', p => p.lastChecked]];
  out.push(h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-label': 'Comparison' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Fact'), ps.map(p => h('th', { scope: 'col' }, provLink(p), p.status === 'shutting-down' && badge('Shutting down', 'bad'), p.manual && badge('manual', 'warn'))))),
    h('tbody', {}, rowsDef.map(([t, fn]) => h('tr', {}, h('th', { scope: 'row' }, t), ps.map(p => h('td', { class: 'txt' }, fn(p)))))))));
  return out;
}

async function vChanges() {
  const [ev, days] = await Promise.all([get('data/changes.json'), get('data/history/index.json')]);
  const show = v => v === null || v === undefined ? 'unknown' : String(v);
  const evs = ev.filter(x => !S.get('p') || x.slug === S.get('p')).reverse();
  return [head('Price changes', `Differences between dated feed snapshots, since ${META.historySince}. A change in the feed is not always a change by the vendor: it can be a correction.`),
    evs.length ? h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-label': 'Changes' }, h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'Provider', 'What', 'Before', 'After'].map(t => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, evs.slice(0, 500).map(x => h('tr', {}, h('td', {}, x.date), h('td', {}, D.some(p => p.slug === x.slug) ? provLink(x) : x.name), h('td', {}, x.field), h('td', { class: 'txt' }, show(x.from)), h('td', { class: 'txt' }, show(x.to)))))))
      : h('p', {}, 'No price change recorded yet. The first snapshot is the starting point.'),
    h('h2', {}, 'Dated snapshots'), h('ul', {}, days.slice().reverse().map(d => h('li', {}, h('a', { href: `data/history/${encodeURIComponent(d)}.json` }, d))))];
}

async function vProvider() {
  const base = D.find(p => p.slug === S.get('p'));
  if (!base) return [h('h1', {}, 'Provider not found'), h('p', {}, h('a', { href: './', 'data-nav': true }, 'Back to the leaderboard'))];
  const p = await get(`data/p/${base.slug}.json`), e = p.effective, r = p.pricing.rates, f = p.features;
  const kv = rows => h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v ?? unk())]));
  const list = a => a?.length ? h('ul', {}, a.map(x => h('li', {}, x))) : h('p', {}, unk('none in the data'));
  return [h('h1', {}, p.name), h('p', { class: 'lead' }, p.summary || p.tagline || 'Manual row: few facts, not refreshed.'),
    h('p', {}, ext(p.website, 'Website'), ' · ', p.docsUrl && [ext(p.docsUrl, 'Docs'), ' · '], p.pricingUrl && [ext(p.pricingUrl, 'Pricing'), ' · '], p.page ? ext(p.page, 'Source: AI Sandbox Hunt page') : 'Source: manual research', ' · ', h('a', { href: `data/p/${p.slug}.json` }, 'JSON'), ' · ',
      h('a', { href: link({ view: 'changes' }), 'data-nav': true }, 'Price changes')),
    h('p', {}, p.categories.map(c => badge(catName(c))), badge(`last checked ${p.lastChecked}`, (ageDays(p.lastChecked) ?? 99) > 30 ? 'warn' : ''), p.manual && badge('manual, does not refresh', 'warn')),
    p.status !== 'active' && h('div', { class: 'note' }, h('strong', {}, `Status: ${p.status}. `), p.notice?.text, ' ', p.notice?.url && ext(p.notice.url, 'Notice')),
    p.review.length > 0 && h('div', { class: 'note' }, h('strong', {}, 'Needs review. '), 'The feed changed after our correction: ', p.review.map(x => x.field).join(', ')),
    conflictNotes(p),
    Object.keys(p.override).length > 0 && h('div', { class: 'note' }, h('strong', {}, `Our manual corrections (${p.overrideDate}, do not refresh): `), h('ul', {}, Object.entries(p.override).map(([k, v]) => h('li', {}, `${k}: `, v === null ? 'unknown' : typeof v === 'object' ? `${v.verdict}: ${v.why}` : String(v), k === 'freeTier' || k === 'freeTierKind' ? ` (feed says: ${p.pricing[k]})` : k === 'cardRequiredForFree' ? ` (derived from feed: ${p.derived[k] ?? 'unknown'})` : k === 'inkling2MiniFit' ? ` (derived from feed: ${p.derived[k].verdict})` : '')))),
    h('h2', {}, 'Free tier'), kv([['Kind', badge(...KIND[e.freeKind])], ['Detail', e.freeTier], ['Card required', e.freeKind === 'none' ? '–' : yn(e.cardRequiredForFree)], ['Ends', p.derived.freeExpiry], ['Stop or charge', e.freeRisk ? badge(...(RISK[e.freeRisk] || [e.freeRisk])) : null]]),
    h('h2', {}, 'Plans'), p.pricing.plans.length ? h('div', { class: 'scroll cards', tabindex: '0', role: 'region', 'aria-label': 'Plans' }, h('table', {}, h('thead', {}, h('tr', {}, ['Plan', 'Monthly fee', 'Included usage', 'Stops at allowance', 'Limits'].map(t => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, p.pricing.plans.map(x => h('tr', {}, h('th', { scope: 'row' }, x.name), [['Monthly fee', usd(x.monthlyFee)], ['Included usage', [x.includedUsageUsd ? usd(x.includedUsageUsd) : 'no dollar usage in data', x.includedVcpuHours ? `, ${+x.includedVcpuHours.toFixed(1)} vCPU-h` : '', x.includedGibHours ? `, ${x.includedGibHours} GiB-h` : '']], ['Stops at allowance', yn(x.capped)], ['Limits', x.limits ?? unk()]].map(([t, v]) => h('td', { class: t === 'Limits' ? 'txt' : null, 'data-label': t }, h('div', { class: 'cell' }, v)))))))) : h('p', {}, unk('No plan listed')),
    h('h2', {}, 'Rates'), kv([['vCPU-hour', usd(r.vcpuHour)], ['GiB-hour', usd(r.gibHour)], ['Fixed size / hour', num(r.instanceHour) ? [usd(r.instanceHour), ` ${r.instance || ''}`] : unk('none listed')], ['Storage GiB-month', usd(r.storageGibMonth)], ['Browser-hour', num(r.browserHour) ? usd(r.browserHour) : unk('none listed')], ['Billing increment', r.billingIncrement], ['Billed while', r.billedWhile], ['CPU billed only when active', yn(r.cpuActiveOnly)],
      ['Reference prices (theirs)', Object.entries(p.comparablePrice).length ? Object.entries(p.comparablePrice).map(([c, v]) => h('div', {}, `${catName(c)}: `, usd(v))) : null], ['AI Sandbox Hunt’s score (theirs, not ours)', p.score && Object.keys(p.score).length ? Object.entries(p.score).map(([c, v]) => h('div', {}, `${catName(c)}: ${v.total}`)) : null]]),
    p.pricing.gpu.length > 0 && [h('h3', {}, 'GPUs per hour'), gpuList(p)],
    h('h2', {}, 'Capabilities'), kv([['Isolation', p.isolation], ['Max vCPU', f.maxVcpu], ['Max RAM GiB', f.maxMemoryGib], ['Session limit h', f.maxSessionHours], ['GPU', yn(f.gpu)], ['Pause', yn(f.pauseResume)], ['Snapshots', yn(f.snapshots)], ['Custom images', yn(f.customImages)], ['Network controls', yn(f.networkControls)], ['Open source', yn(p.openSource)], ['Self-host', yn(p.selfHost)], ['Licence', p.license], ['Repository', p.repoUrl ? ext(p.repoUrl) : null], ['Regions', p.regions], ['Interfaces', p.sdks?.join(', ')], ['Inkling 2 Mini', [badge(...FIT[e.inkling2MiniFit.verdict]), ' ', e.inkling2MiniFit.why]], ['Token efficiency', unk('Not measured')]]),
    h('h2', {}, 'Onboarding points'), kv(onboarding(p).map(x => [`${x.label} (${x.points})`, x.value === true ? badge(`yes +${x.points}`, 'good') : x.value === false ? badge('no') : unk()])),
    h('h2', {}, 'Watch out'), list(p.watchOut), h('h2', {}, 'Best for, per the directory'), list(p.bestFor), h('h2', {}, 'Pricing notes'), list(p.pricing.notes),
    p.benchmarks.length > 0 && [h('h2', {}, 'Benchmarks by others'), h('ul', {}, p.benchmarks.map(b => h('li', {}, `${SRC[b.source] || b.source}, ${b.metric}: ${b.value} ${b.unit} (${b.date})${b.note ? '. ' + b.note : ''}`)))],
    h('h2', {}, 'Source quotes'), p.sources?.length ? h('details', { open: p.sources.length < 6 }, h('summary', {}, `${p.sources.length} sources`), p.sources.map(s => [s.quote && h('blockquote', {}, s.quote), h('p', { class: 'small' }, ext(s.url), ` · checked ${s.checked || 'unknown'}`)])) : list([])];
}

function vMethod() {
  const li = a => h('ul', {}, a.map(x => h('li', {}, x)));
  return [head('Method', 'How the data is gathered, what we change, and how scores work.'),
    h('h2', {}, 'Data'), li([`A daily job fetches the AI Sandbox Hunt feed, checks it and rebuilds this site. The page uses that committed copy, so a feed outage does not blank it. Last good fetch: ${META.lastGoodFetch}; the feed says it was updated ${META.feedUpdated}.`,
      'If the feed is unreachable, not valid JSON, missing fields, or loses more than 10% of providers, the last good data stays, with its date.',
      'Unknown is never counted as zero or “no”. Conflicts are shown, not silently settled.', 'Corrections and 9 manual rows are written by hand, dated, and do not refresh. If the feed later changes a field a correction covers, the provider is marked “needs review”.',
      'Luxor Agent Cloud Sandbox is the renamed Tenki Sandbox: one product, listed once.', 'We tested nothing and received no money.']),
    META.reviewNeeded.length > 0 && [h('h2', {}, 'Waiting for review'), li(META.reviewNeeded.map(x => `${x.slug}: ${x.what}`))],
    h('h2', {}, 'Overall formula'), h('p', {}, 'score = Σ(weight × known share × value) ÷ Σ(weight × known share), times 100. coverage = Σ(weight × known share) ÷ Σ weight. Default minimum coverage to rank: 60%. Ranked inside one category only.'),
    li([`Cost (${WEIGHTS.cost}): share of providers in the category with a higher reference price. Ties count half. Unknown price: left out.`,
      `Free tier (${WEIGHTS.free}): kind 6 parts (${Object.entries(FREE).map(([k, v]) => `${k} ${v}`).join(', ')}), no card 2 parts, hard stop rather than possible charge 2 parts.`,
      `Paid plan value (${WEIGHTS.paid}): share of the category with less included usage per dollar on its cheapest paid plan.`,
      `Capabilities (${WEIGHTS.caps}): equal parts pause, snapshots, custom images, network controls, GPU, vCPU (16 or more is full), memory (32 GiB or more is full).`,
      `Isolation (${WEIGHTS.iso}), our opinion: ${Object.entries(ISO).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
      `Onboarding (${WEIGHTS.onb}): points shown in that view ÷ total points; the known share is the points we have an answer for.`,
      `Startup (${WEIGHTS.start}): share of the category slower in ComputeSDK’s burst start test. Not measured: left out.`, 'Token efficiency has no weight because nobody has measured it.', 'AI Sandbox Hunt’s own score is not used. Provider pages show it, labelled theirs.']),
    h('h2', {}, 'Calculator'), li(['Metered: vCPU × hours × vCPU rate + GiB × hours × GiB rate. Where CPU is billed only while active, vCPU hours are multiplied by CPU busy %, with any published minimum.', 'Idle hours are free of compute only where pause is documented; some vendors bill memory while paused, and unknown pause is billed as running.', 'Plan: fee + usage above what it includes; a plan that stops at its allowance is skipped if your usage does not fit.', 'Vendors that price physical cores are converted by the feed at 2 vCPU per core, and flagged.', 'Storage, traffic, session limits, regional multipliers and one-off credits are left out.'])];
}

// ---- shell -------------------------------------------------------------------
async function get(u) { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); }
const FN = { overall: vOverall, cost: vCost, free: vFree, paid: vPaid, tokens: vTokens, caps: vCaps, onboarding: vOnb, startup: vStart, compare: vCompare, changes: vChanges, method: vMethod, provider: vProvider };
let run = 0;
async function render(moved) {
  const me = ++run; S = state(); seq = 0;
  const view = FN[S.get('view')] ? S.get('view') : 'overall', main = $('main');
  const act = document.activeElement, keep = act?.id, caret = act?.type === 'search' ? act.selectionStart : null;
  const more = $('more'); if (more) more.open ? openIds.add('more') : openIds.delete('more');
  const sc = scrollY;
  $('nav').replaceChildren(...VIEWS.map(([k, t]) => h('a', { href: link({ view: k === 'overall' ? null : k, p: null, sort: null, dir: null }), 'data-nav': true, 'aria-current': k === view ? 'page' : null }, t)));
  let nodes;
  try { nodes = await FN[view](); } catch (err) { nodes = [h('h1', {}, 'Could not load this view'), h('p', {}, String(err.message))]; }
  if (me !== run) return;
  main.replaceChildren(...nodes.flat(9).filter(Boolean));
  document.title = `${main.querySelector('h1')?.textContent || 'Agent sandboxes'} · Agent Sandbox Leaderboard`;
  const l = cmpList(), tray = $('tray'); tray.hidden = !l.length || view === 'compare';
  tray.replaceChildren(...(l.length ? [h('span', {}, `Comparing: ${l.map(s => D.find(p => p.slug === s).name).join(', ')}`), h('a', { href: link({ view: 'compare' }), 'data-nav': true }, l.length < 2 ? 'Add one more' : 'Compare'), h('button', { type: 'button', onclick: () => go({ compare: null }, true) }, 'Clear')] : []));
  if (moved) { scrollTo(0, 0); main.focus({ preventScroll: true }); }
  else { scrollTo(0, sc); const el = keep && $(keep); if (el) { el.focus({ preventScroll: true }); if (caret !== null) el.setSelectionRange(caret, caret); } }
  const cur = $('nav').querySelector('[aria-current]'); if (cur) $('nav').scrollLeft = Math.max(0, cur.offsetLeft - $('nav').offsetLeft - 40);
}
(async () => {
  try {
    const d = await get('data/site.json'); D = d.providers; META = d.meta; CATS = META.categories;
    const age = ageDays(META.lastGoodFetch);
    $('fresh').replaceChildren(`Last refreshed ${META.lastGoodFetch.slice(0, 16).replace('T', ' ')} UTC`, age > 2 ? ` (${age} days ago: the daily refresh may be failing)` : '');
    await render(false);
  } catch (err) { $('main').replaceChildren(h('h1', {}, 'Data could not be loaded'), h('p', {}, String(err.message)), h('p', {}, h('a', { href: 'agent-sandboxes.md' }, 'Try the Markdown copy'))); }
})();
