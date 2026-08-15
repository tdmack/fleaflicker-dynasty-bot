// FantasyCalc dynasty trade values — free public API, no key.
// League shape is configurable via vars; defaults match a superflex,
// 12-team, 0.5 PPR league.

const TTL_SECONDS = 6 * 3600; // values update ~daily

import { isBlockedPosition } from '../utils/positions.js';

function num(raw, fallback) {
  const n = Number(raw);
  if (raw !== undefined && raw !== null && String(raw).trim() !== '' && Number.isFinite(n)) {
    return String(n);
  }
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    console.warn(`[FantasyCalc] Ignoring invalid setting "${raw}" — using default ${fallback}`);
  }
  return fallback;
}

function valueSettings(env) {
  return {
    numQbs: num(env.FANTASYCALC_NUM_QBS, '2'),
    numTeams: num(env.FANTASYCALC_NUM_TEAMS, '12'),
    ppr: num(env.FANTASYCALC_PPR, '0.5'),
  };
}

export function buildValuesUrl(env) {
  const s = valueSettings(env);
  return `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${s.numQbs}&numTeams=${s.numTeams}&ppr=${s.ppr}`;
}

// Settings are part of the key so a var change never serves stale values
// cached under the old settings.
export function valuesCacheKey(env) {
  const s = valueSettings(env);
  return `fantasycalc:values:${s.numQbs}:${s.numTeams}:${s.ppr}`;
}

export function valuesFooter(env) {
  const s = valueSettings(env);
  const qbLabel = Number(s.numQbs) >= 2 ? 'superflex' : '1QB';
  return `FantasyCalc • ${qbLabel}, ${s.numTeams}-team, ${s.ppr} PPR`;
}

/**
 * Returns the full dynasty value list, cached in KV for 6h.
 * Each entry: { name, position, team, value, overallRank, positionRank, trend30Day }
 */
export async function getDynastyValues(env) {
  const cacheKey = valuesCacheKey(env);
  const cached = await env.BOT_KV.get(cacheKey, 'json');
  if (Array.isArray(cached) && cached.length > 0) return cached;

  const res = await fetch(buildValuesUrl(env), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw new Error(`FantasyCalc returned HTTP ${res.status}`);
  }
  const raw = await res.json();
  if (!Array.isArray(raw)) {
    throw new Error('Unexpected FantasyCalc response shape');
  }

  const values = raw
    .map((entry) => ({
      name: entry.player?.name || 'Unknown',
      position: (entry.player?.position || '?').toUpperCase(),
      team: entry.player?.maybeTeam || entry.player?.team || '—',
      value: entry.value ?? 0,
      overallRank: entry.overallRank ?? null,
      positionRank: entry.positionRank ?? null,
      trend30Day: entry.trend30Day ?? null,
    }))
    .filter((p) => !isBlockedPosition(p.position));

  if (values.length > 0) {
    await env.BOT_KV.put(cacheKey, JSON.stringify(values), { expirationTtl: TTL_SECONDS });
  }
  return values;
}
