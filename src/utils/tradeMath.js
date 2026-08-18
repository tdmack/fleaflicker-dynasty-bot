// Core trade math ported from dynasty-command-center's
// backend/app/services/trade_math.py: the KTC raw-adjustment formula and
// tolerance-band verdict. Roster displacement, the equalizer, age curves,
// and contention multipliers are NOT ported — they need roster/DB state
// this bot doesn't have (see docs/superpowers/specs/2026-08-18-tradecalc-design.md).

export const K1 = 0.20;
export const K2 = 0.50;
export const FAIR_BAND = 0.05;    // ≤5% → Fair Deal (DCC TOLERANCE_BAND)
export const SLIGHT_BAND = 0.20;  // ≤20% → Slight Edge; beyond → Lopsided

/**
 * KTC raw adjustment: p * (p/t)^K1 * (p/v)^K2.
 * p = asset value, t = max value on its own side, v = market max in trade.
 * Edge cases match trade_math.py: p=0 → 0; t=0 or v=0 → p.
 */
export function rawAdjustment(p, t, v, k1 = K1, k2 = K2) {
  if (p === 0) return 0;
  if (t === 0 || v === 0) return p;
  return p * (p / t) ** k1 * (p / v) ** k2;
}

/** Verdict tier for an absolute delta fraction of the larger side. */
export function tierFor(deltaPct) {
  if (deltaPct <= FAIR_BAND) return 'fair';
  if (deltaPct <= SLIGHT_BAND) return 'slight';
  return 'lopsided';
}

/**
 * Evaluate a trade. Sides are arrays of { label, value } on the blended
 * 0–10000 scale (extra keys pass through to the adjusted rows).
 * Returns { adjustedA, adjustedB, totalA, totalB, delta, deltaPct,
 * verdict, stronger } where stronger is 1, 2, or null (dead even).
 */
export function evaluateTrade(assetsA, assetsB) {
  const all = [...assetsA, ...assetsB].map((a) => a.value);
  const v = Math.max(...all, 0);
  const tA = Math.max(...assetsA.map((a) => a.value), 0);
  const tB = Math.max(...assetsB.map((a) => a.value), 0);

  const adjust = (assets, t) =>
    assets.map((a) => ({ ...a, adjusted: rawAdjustment(a.value, t, v) }));
  const adjustedA = adjust(assetsA, tA);
  const adjustedB = adjust(assetsB, tB);
  const totalA = adjustedA.reduce((s, a) => s + a.adjusted, 0);
  const totalB = adjustedB.reduce((s, a) => s + a.adjusted, 0);

  const delta = totalA - totalB;
  // max(…, 1) guards divide-by-near-zero, mirroring compute_fairness.
  const deltaPct = Math.abs(delta) / Math.max(totalA, totalB, 1);

  return {
    adjustedA,
    adjustedB,
    totalA,
    totalB,
    delta,
    deltaPct,
    verdict: tierFor(deltaPct),
    stronger: delta === 0 ? null : delta > 0 ? 1 : 2,
  };
}
