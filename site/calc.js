// Pure functions: no DOM, no network. Tested by tests/calc.test.mjs.
const n = v => typeof v === 'number' && Number.isFinite(v);

/** Monthly cost for a workload. Returns {total, plan, notes} or {total:null, why}. A missing rate is never treated as zero. */
export function quote(p, w) {
  const r = p.pricing.rates || {}, f = p.features || {}, no = why => ({ total: null, why });
  if (p.status === 'shutting-down') return no('shutting down');
  if (n(f.maxVcpu) && w.vcpu > f.maxVcpu) return no(`largest listed size is ${f.maxVcpu} vCPU`);
  if (n(f.maxMemoryGib) && w.gib > f.maxMemoryGib) return no(`largest listed size is ${f.maxMemoryGib} GiB`);
  const notes = [], d = p.derived || {};
  const idleMode = w.pause ? (d.pauseBilling || 'full') : 'full';
  if (w.pause && w.idle > 0) {
    if (idleMode === 'full') notes.push('no documented pause: idle hours billed as running');
    if (idleMode === 'memory') notes.push('paused time billed for memory');
    if (idleMode === 'none') notes.push('paused time free of compute; stored disk not priced');
  }
  let vh, gh, vr, gr, usage;
  if (n(r.vcpuHour) && n(r.gibHour)) {
    const floor = Math.max(d.cpuFloor || 0, 0), busy = Math.max(w.busy, floor);
    const runIdle = idleMode === 'full' ? w.idle : 0;
    const wall = w.hours + runIdle;
    vh = w.vcpu * (r.cpuActiveOnly === true ? w.hours * busy + runIdle * floor : wall);
    gh = w.gib * (wall + (idleMode === 'memory' ? w.idle : 0));
    vr = r.vcpuHour; gr = r.gibHour;
    usage = (iv, ig) => Math.max(0, vh - iv) * vr + Math.max(0, gh - ig) * gr;
    if (r.cpuActiveOnly === true) notes.push('CPU billed only while active' + (floor ? `, at least ${floor * 100}%` : ''));
  } else if (n(r.instanceHour)) {
    if (!n(r.unitVcpu) || !n(r.unitGib)) return no('fixed size without a published vCPU and memory');
    if (idleMode === 'memory') return no('cannot price paused memory for a fixed size');
    const units = Math.max(1, Math.ceil(w.vcpu / r.unitVcpu), Math.ceil(w.gib / r.unitGib));
    const wall = w.hours + (idleMode === 'full' ? w.idle : 0);
    const u = units * wall * r.instanceHour;
    vh = units * r.unitVcpu * wall; gh = units * r.unitGib * wall;
    // Included hours cannot be split out of a bundled price, so they only reduce cost in whole-unit terms.
    usage = iv => Math.max(0, u - (iv / r.unitVcpu) * r.instanceHour);
    notes.push(`${units} × fixed size (${r.unitVcpu} vCPU / ${r.unitGib} GiB)` + (units > 1 ? ', scaled linearly' : ''));
  } else return no('no published rate');
  const base = usage(0, 0);
  const plans = p.pricing.plans || [];
  let best = plans.length ? null : { total: base, plan: 'usage only', usage: base };
  for (const x of plans) {
    if (!n(x.monthlyFee)) continue;
    const free = x.monthlyFee === 0, count = !free || w.freeUse;
    if (free && x.capped === true && !count) continue;         // a capped free plan cannot sell this usage
    const iv = count ? x.includedVcpuHours || 0 : 0, ig = count ? x.includedGibHours || 0 : 0;
    const over = Math.max(0, usage(iv, ig) - (count ? x.includedUsageUsd || 0 : 0));
    if (x.capped === true && over > 1e-9) continue;            // plan stops at its allowance
    const total = x.monthlyFee + over;
    if (!best || total < best.total) best = { total, plan: x.name, usage: usage(0, 0), limits: x.limits, capped: x.capped };
  }
  if (!best) return no('every plan with a price is capped below this usage');
  if (d.physicalCoreNote) notes.push('vendor prices physical cores; feed counts 1 core as 2 vCPU');
  if (!n(f.maxVcpu) || !n(f.maxMemoryGib)) notes.push('maximum size not published');
  return { ...best, notes };
}

/** Share of the other known values this one beats (ties count half). 1 is best. */
export function percentile(v, all, lowerBetter) {
  const o = all.filter(n);
  if (!n(v) || o.length < 2) return null;
  let s = 0;
  for (const x of o) s += x === v ? 0.5 : (lowerBetter ? x > v : x < v) ? 1 : 0;
  return (s - 0.5) / (o.length - 1);
}

export const ISO = { microvm: 1, vm: 1, gvisor: 0.75, isolate: 0.6, container: 0.4, process: 0.2 };
export const FREE = { recurring: 1, software: 0.8, credit: 0.6, trial: 0.4, none: 0 };
export const BURST = 'Burst start time (median of 100 at once)';
export const WEIGHTS = { cost: 30, free: 15, paid: 5, caps: 20, iso: 10, onb: 10, start: 10 };
export const LABELS = { cost: 'Cost', free: 'Free tier', paid: 'Paid plan value', caps: 'Capabilities', iso: 'Isolation', onb: 'Onboarding', start: 'Startup' };

/** Onboarding facts. Unknown earns none. The feed has no invite field, so silence stays unknown. */
export function onboarding(p) {
  const d = p.derived || {}, e = p.effective || {};
  const invite = /\binvite (code|is)|require an invite|invite-only/i.test(`${e.freeTier || ''} ${(p.pricing.plans || []).map(x => x.limits || '').join(' ')}`);
  const free = e.freeKind ? ['recurring', 'credit', 'trial', 'software'].includes(e.freeKind) : null;
  const t = v => (v === true ? true : v === false ? false : null);
  return [
    ['Free to start', 2, free],
    ['No card to start free', 2, free === true && e.cardRequiredForFree !== null && e.cardRequiredForFree !== undefined ? e.cardRequiredForFree === false : (e.freeKind === 'software' ? true : null)],
    ['No invite needed', 1, invite ? false : null],
    ['Docs link', 1, p.docsUrl ? true : null],
    ['Python SDK', 1, t(d.hasPython)], ['TypeScript SDK', 1, t(d.hasTypescript)],
    ['REST or CLI', 1, t(d.hasRestOrCli)], ['MCP', 1, t(d.hasMcp)],
  ].map(([label, points, v]) => ({ label, points, value: v, earned: v === true ? points : 0 }));
}

const avg = parts => {                                          // parts: [weight, value|null]
  let s = 0, k = 0, t = 0;
  for (const [w, v] of parts) { t += w; if (v !== null && v !== undefined) { k += w; s += w * v; } }
  return { v: k ? s / k : null, known: t ? k / t : 0 };
};
const b = v => (v === true ? 1 : v === false ? 0 : null);

/** Component values 0..1 plus how much of each is known, within one category's peers. */
export function components(p, peers, cat) {
  const e = p.effective || {}, f = p.features || {};
  const cp = x => (x.comparablePrice || {})[cat];
  const st = x => { const m = (x.benchmarks || []).find(y => y.metric === BURST); return m ? m.value : null; };
  const one = v => ({ v, known: v === null ? 0 : 1 });
  const on = onboarding(p), tot = on.reduce((a, x) => a + x.points, 0);
  return {
    cost: one(percentile(cp(p), peers.map(cp), true)),
    free: avg([[6, e.freeKind in FREE ? FREE[e.freeKind] : null],
      [2, e.freeKind === 'none' ? 0 : b(e.cardRequiredForFree) === null ? null : 1 - b(e.cardRequiredForFree)],
      [2, e.freeKind === 'none' ? 0 : e.freeRisk ? (e.freeRisk === 'hard_stop' ? 1 : 0) : null]]),
    paid: one(percentile(p.derived.paidUsagePerDollar, peers.map(x => x.derived.paidUsagePerDollar), false)),
    caps: avg([[1, b(f.pauseResume)], [1, b(f.snapshots)], [1, b(f.customImages)], [1, b(f.networkControls)], [1, b(f.gpu)],
      [1, n(f.maxVcpu) ? Math.min(1, f.maxVcpu / 16) : null], [1, n(f.maxMemoryGib) ? Math.min(1, f.maxMemoryGib / 32) : null]]),
    iso: one(p.isolationKind in ISO ? ISO[p.isolationKind] : null),
    onb: { v: on.reduce((a, x) => a + x.earned, 0) / tot, known: on.filter(x => x.value !== null).reduce((a, x) => a + x.points, 0) / tot },
    start: one(percentile(st(p), peers.map(st), true)),
  };
}

/** score = Σ weight × known × value ÷ Σ weight × known; coverage = Σ weight × known ÷ Σ weight. */
export function overall(p, peers, cat, weights) {
  const c = components(p, peers, cat);
  let s = 0, k = 0, t = 0;
  for (const key in WEIGHTS) {
    const w = Math.max(0, +weights[key] || 0);
    t += w; k += w * c[key].known; s += w * c[key].known * (c[key].v ?? 0);
  }
  return { score: k ? (100 * s) / k : null, coverage: t ? (100 * k) / t : 0, parts: c };
}

export const safeUrl = u => {
  if (typeof u !== 'string') return null;
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; }
};
export const ageDays = (date, now = Date.now()) => { const t = Date.parse(date); return Number.isNaN(t) ? null : Math.floor((now - t) / 864e5); };
