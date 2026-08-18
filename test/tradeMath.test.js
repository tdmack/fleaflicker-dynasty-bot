import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawAdjustment, tierFor, evaluateTrade, K1, K2 } from '../src/utils/tradeMath.js';

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('rawAdjustment edge cases match trade_math.py', () => {
  assert.equal(rawAdjustment(0, 5000, 10000), 0);      // p=0 → 0
  assert.equal(rawAdjustment(3000, 0, 10000), 3000);   // t=0 → p
  assert.equal(rawAdjustment(3000, 5000, 0), 3000);    // v=0 → p
});

test('rawAdjustment formula: p * (p/t)^K1 * (p/v)^K2', () => {
  const p = 3000, t = 9000, v = 9000;
  approx(rawAdjustment(p, t, v), p * (p / t) ** K1 * (p / v) ** K2);
});

test('top asset on a side passes through undiscounted when it is the market max', () => {
  approx(rawAdjustment(9000, 9000, 9000), 9000);
});

test('tierFor boundaries: 5% and 20% inclusive', () => {
  assert.equal(tierFor(0), 'fair');
  assert.equal(tierFor(0.05), 'fair');
  assert.equal(tierFor(0.050001), 'slight');
  assert.equal(tierFor(0.20), 'slight');
  assert.equal(tierFor(0.200001), 'lopsided');
});

test('equal single-asset sides are a Fair Deal', () => {
  const r = evaluateTrade([{ label: 'A', value: 10000 }], [{ label: 'B', value: 10000 }]);
  assert.equal(r.verdict, 'fair');
  assert.equal(r.stronger, null);
  approx(r.totalA, 10000);
  approx(r.totalB, 10000);
});

test('stud + piece beats three mids of equal raw sum (package discount)', () => {
  // Raw sums equal (12000 each); the KTC adjustment must discount the
  // quantity side. Expected values hand-derived from the formula:
  // v = 9000. Side A: 9000*1*1 + 3000*(1/3)^0.7 ; Side B: 3*(4000*(4000/9000)^0.5)
  const a = [{ label: 'stud', value: 9000 }, { label: 'piece', value: 3000 }];
  const b = [{ label: 'm1', value: 4000 }, { label: 'm2', value: 4000 }, { label: 'm3', value: 4000 }];
  const r = evaluateTrade(a, b);
  assert.ok(r.totalA > r.totalB);
  assert.equal(r.stronger, 1);
  approx(r.totalA, 9000 + 3000 * (3000 / 9000) ** K1 * (3000 / 9000) ** K2, 1e-6);
  approx(r.totalB, 3 * (4000 * (4000 / 9000) ** K2), 1e-6);
});

test('deltaPct uses the larger side total as denominator', () => {
  const r = evaluateTrade([{ label: 'A', value: 10000 }], [{ label: 'B', value: 8000 }]);
  approx(r.deltaPct, Math.abs(r.delta) / Math.max(r.totalA, r.totalB));
});

test('per-asset adjusted contributions are attached', () => {
  const r = evaluateTrade([{ label: 'A', value: 9000 }, { label: 'C', value: 3000 }], [{ label: 'B', value: 9000 }]);
  assert.equal(r.adjustedA.length, 2);
  assert.equal(r.adjustedA[0].label, 'A');
  approx(r.adjustedA[0].adjusted, 9000);
  assert.ok(r.adjustedA[1].adjusted < 3000); // discounted below raw
});
