import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { quote, percentile, onboarding, overall, safeUrl, ageDays, WEIGHTS } from '../site/calc.js';

const P = (rates = {}, plans = [], more = {}) => ({ status: 'active', features: {}, derived: {}, effective: {}, comparablePrice: {}, benchmarks: [], pricing: { rates, plans }, ...more });
const W = { vcpu: 2, gib: 4, hours: 100, busy: 0.3, idle: 0, pause: true, freeUse: false };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

test('missing rate is not ranked, never zero', () => {
  assert.equal(quote(P(), W).total, null);
  assert.equal(quote(P({ vcpuHour: 0.05, gibHour: null }), W).total, null);
  assert.equal(quote(P({ instanceHour: 1, unitVcpu: 2, unitGib: null }), W).total, null);
});
test('a real zero rate is kept', () => near(quote(P({ vcpuHour: 0.1, gibHour: 0 }), W).total, 20));
test('CPU billed only when active, with floor', () => {
  near(quote(P({ vcpuHour: 1, gibHour: 0, cpuActiveOnly: true }), W).total, 60);
  near(quote(P({ vcpuHour: 1, gibHour: 0, cpuActiveOnly: true }, [], { derived: { cpuFloor: 0.5 } }), W).total, 100);
});
test('size limits and shutting down', () => {
  assert.equal(quote(P({ vcpuHour: 1, gibHour: 1 }, [], { features: { maxVcpu: 1 } }), W).total, null);
  assert.equal(quote(P({ vcpuHour: 1, gibHour: 1 }, [], { status: 'shutting-down' }), W).total, null);
});
test('capped plan is skipped when usage does not fit', () => {
  const cap = { name: 'c', monthlyFee: 1, includedUsageUsd: 5, includedVcpuHours: 0, includedGibHours: 0, capped: true };
  const r = { vcpuHour: 0.1, gibHour: 0 };
  assert.equal(quote(P(r, [cap]), W).total, null);
  near(quote(P(r, [cap, { ...cap, name: 'd', monthlyFee: 9, capped: false }]), W).total, 24);
});
test('idle: unknown pause bills in full, memory pause bills memory', () => {
  const r = { vcpuHour: 0.1, gibHour: 0.1 }, w = { ...W, idle: 100 };
  near(quote(P(r), w).total, 120);
  near(quote(P(r, [], { derived: { pauseBilling: 'none' } }), w).total, 60);
  near(quote(P(r, [], { derived: { pauseBilling: 'memory' } }), w).total, 100);
});
test('percentile', () => {
  assert.equal(percentile(1, [1, 2, 3], true), 1);
  assert.equal(percentile(3, [1, 2, 3, null], true), 0);
  assert.equal(percentile(null, [1, 2], true), null);
});
test('unknown earns no onboarding points and is not "no"', () => {
  const o = onboarding(P());
  assert.ok(o.slice(1).every(x => x.value === null && x.earned === 0));
});
test('overall: unknowns lower coverage, not score', () => {
  const p = P({}, [], { isolationKind: 'microvm' }), w = Object.fromEntries(Object.keys(WEIGHTS).map(k => [k, k === 'iso' || k === 'cost' ? 10 : 0]));
  const o = overall(p, [p], 'code-sandbox', w);
  near(o.score, 100); near(o.coverage, 50);
  assert.equal(overall(p, [p], 'code-sandbox', {}).score, null);
});
test('links', () => {
  for (const u of ['javascript:alert(1)', 'data:x', ' java\nscript:1', null, '/x']) assert.equal(safeUrl(u), null);
  assert.equal(safeUrl('https://a.b/c'), 'https://a.b/c');
  assert.equal(ageDays('2026-11-01', Date.parse('2026-12-03')), 32);
  assert.equal(ageDays('nope'), null);
});
test('calculator reproduces the feed reference prices', () => {
  // Checked against the frozen snapshot this was written for, so later feed edits cannot block the daily refresh.
  const dir = mkdtempSync(tmpdir() + '/s-'), root = new URL('..', import.meta.url).pathname;
  execFileSync('python3', ['-c', `import sys,json,pathlib;sys.path.insert(0,${JSON.stringify(root)});import build
f=json.load(open(${JSON.stringify(root + 'tests/feed-2026-11-24.json')}));json.dump(build.make(f,{"entries":{},"manual":[]})[0],open(${JSON.stringify(dir + '/o.json')},"w"))`]);
  const ps = JSON.parse(readFileSync(dir + '/o.json'));
  const sets = {
    'code-sandbox': [{ vcpu: 2, gib: 4, hours: 176, busy: 0.3, idle: 0, pause: false, freeUse: false },
      // Not ranked here: no vCPU rate, size cap too small, shutting down. Depot: we count its plan's included minutes.
      ['blaxel', 'cloudflare-dynamic-workers', 'depot', 'runloop'], 41],
    'dev-box': [{ vcpu: 2, gib: 4, hours: 220, busy: 0.2, idle: 0, pause: true, freeUse: false }, null, 30],
  };
  for (const [cat, [w, exceptions, min]] of Object.entries(sets)) {
    const bad = []; let ok = 0;
    for (const p of ps) {
      const v = p.comparablePrice[cat]; if (v === undefined || v === null) continue;
      const q = quote(p, w).total;
      if (q !== null && Math.abs(q - v) < 0.02) ok++; else bad.push(p.slug);
    }
    assert.ok(ok >= min, `${cat}: ${ok} match, not ${bad}`);
    if (exceptions) assert.deepEqual(bad.sort(), exceptions);
    else assert.ok(bad.length <= 4, String(bad));
  }
});
