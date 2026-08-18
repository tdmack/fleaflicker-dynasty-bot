// 50/50 FantasyCalc + DynastyProcess blend. Each source is normalized by
// its own current max before averaging — the two live on "10000-ish"
// scales that differ by ~15% at any given time, so raw averaging would
// silently overweight whichever runs hotter. Display scale stays 0–10000.

import { getDynastyValues } from './fantasycalc.js';
import { getDpValues } from './dynastyprocess.js';
import { parsePickLabel, pickHintKey, pickSlotKey } from '../utils/pickGrammar.js';

export const BLEND_SCALE = 10000;

/** Lowercased name with punctuation and Jr/Sr/II-V suffixes stripped. */
export function normalizeName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[.''-]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SRC_FC = 'FantasyCalc';
const SRC_DP = 'DynastyProcess';

function blendPair(fcVal, fcMax, dpVal, dpMax) {
  const parts = [];
  if (fcVal !== null && fcMax > 0) parts.push({ src: SRC_FC, norm: fcVal / fcMax });
  if (dpVal !== null && dpMax > 0) parts.push({ src: SRC_DP, norm: dpVal / dpMax });
  if (parts.length === 0) return null;
  const mean = parts.reduce((s, p) => s + p.norm, 0) / parts.length;
  return { value: Math.round(mean * BLEND_SCALE), sources: parts.map((p) => p.src) };
}

// Pick table per source: exact-slot map + hint buckets. Explicit hint
// entries (incl. bare-round → Mid) are preferred over slot averages.
function buildPickTable(pickEntries) {
  const slots = new Map();
  const hints = new Map();
  for (const p of pickEntries) {
    const hk = pickHintKey(p);
    if (!hints.has(hk)) hints.set(hk, { explicit: [], slotVals: [] });
    if (p.slot !== null) {
      slots.set(pickSlotKey(p), p.value);
      hints.get(hk).slotVals.push(p.value);
    } else {
      hints.get(hk).explicit.push(p.value);
    }
  }
  return { slots, hints };
}

function bucketValue(bucket) {
  if (!bucket) return null;
  const vals = bucket.explicit.length > 0 ? bucket.explicit : bucket.slotVals;
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

// Returns { value, usedFallback } or null. Far-out years are only priced
// at round level (stored under the Mid hint per the shared convention), so
// an Early/Late request whose bucket is missing falls back to the round's
// Mid value — flagged so the embed can say the hint wasn't really priced.
function pickValueFrom(table, parsed) {
  if (!table) return null;
  if (parsed.slot !== null) {
    const exact = table.slots.get(pickSlotKey(parsed));
    if (exact !== undefined) return { value: exact, usedFallback: false };
  }
  const direct = bucketValue(table.hints.get(pickHintKey(parsed)));
  if (direct !== null) return { value: direct, usedFallback: false };
  if (parsed.hint !== 'Mid') {
    const mid = bucketValue(table.hints.get(pickHintKey({ ...parsed, hint: 'Mid' })));
    if (mid !== null) return { value: mid, usedFallback: true };
  }
  return null;
}

/**
 * Pure blend assembly. fcRaw is getDynastyValues() output (players and
 * PICK entries mixed) or null when the source is down; dp is
 * getDpValues() output ({ players, picks }) or null.
 * Returns { players, resolvePick, sourcesUp }.
 */
export function assembleBlend(fcRaw, dp) {
  if (!fcRaw && !dp) throw new Error('Both value sources unavailable');

  const fcPlayers = (fcRaw ?? []).filter((e) => e.position !== 'PICK');
  const fcPicks = (fcRaw ?? [])
    .filter((e) => e.position === 'PICK')
    .map((e) => ({ parsed: parsePickLabel(e.name), value: e.value }))
    .filter((e) => e.parsed !== null)
    .map((e) => ({ ...e.parsed, value: e.value }));

  const fcMax = fcRaw ? Math.max(...fcRaw.map((e) => e.value), 0) : 0;
  const dpAll = dp ? [...dp.players.map((p) => p.value), ...dp.picks.map((p) => p.value)] : [];
  const dpMax = dp ? Math.max(...dpAll, 0) : 0;

  // --- players ---
  const dpByKey = new Map();
  for (const p of dp?.players ?? []) {
    dpByKey.set(`${normalizeName(p.name)}|${p.position}`, p);
  }
  const players = [];
  const seenDpKeys = new Set();
  for (const p of fcPlayers) {
    const key = `${normalizeName(p.name)}|${p.position}`;
    const dpMatch = dpByKey.get(key);
    if (dpMatch) seenDpKeys.add(key);
    const blended = blendPair(p.value, fcMax, dpMatch ? dpMatch.value : null, dpMax);
    if (!blended) continue;
    players.push({
      name: p.name,
      norm: normalizeName(p.name),
      position: p.position,
      team: p.team,
      value: blended.value,
      sources: blended.sources,
      trend30Day: p.trend30Day ?? null,
    });
  }
  for (const [key, p] of dpByKey) {
    if (seenDpKeys.has(key)) continue;
    const blended = blendPair(null, fcMax, p.value, dpMax);
    if (!blended) continue;
    players.push({
      name: p.name,
      norm: normalizeName(p.name),
      position: p.position,
      team: p.team,
      value: blended.value,
      sources: blended.sources,
      trend30Day: null,
    });
  }
  players.sort((a, b) => b.value - a.value);

  // --- picks ---
  const fcTable = fcRaw ? buildPickTable(fcPicks) : null;
  const dpTable = dp ? buildPickTable(dp.picks) : null;

  const resolvePick = (parsed) => {
    if (!parsed) return null;
    const fcHit = pickValueFrom(fcTable, parsed);
    const dpHit = pickValueFrom(dpTable, parsed);
    const blended = blendPair(fcHit ? fcHit.value : null, fcMax, dpHit ? dpHit.value : null, dpMax);
    if (!blended) return null;
    const approx = Boolean(fcHit?.usedFallback) || Boolean(dpHit?.usedFallback);
    return { ...blended, approx };
  };

  return {
    players,
    resolvePick,
    sourcesUp: { fantasycalc: Boolean(fcRaw), dynastyprocess: Boolean(dp) },
  };
}

/** Fetch both sources (tolerating one failure) and assemble the blend. */
export async function getBlendedAssets(env) {
  const [fcRes, dpRes] = await Promise.allSettled([getDynastyValues(env), getDpValues(env)]);
  const fcRaw = fcRes.status === 'fulfilled' && fcRes.value.length > 0 ? fcRes.value : null;
  const dp = dpRes.status === 'fulfilled' ? dpRes.value : null;
  if (!fcRaw) console.warn('[Blend] FantasyCalc unavailable:', fcRes.status === 'fulfilled' ? 'empty list' : fcRes.reason);
  if (!dp) console.warn('[Blend] DynastyProcess unavailable:', dpRes.status === 'fulfilled' ? 'empty data' : dpRes.reason);
  return assembleBlend(fcRaw, dp); // throws when both are down
}
