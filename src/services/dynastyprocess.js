// DynastyProcess dynasty values — free public CSVs on GitHub, no key.
// values-players.csv carries per-player values (1QB + 2QB columns);
// values-picks.csv carries rookie-pick ECR ranks only (DP dropped the
// value columns), so pick values are recovered by interpolating pick ECR
// against the player (ecr → value) curve — the same overall-ECR scale.

import { isBlockedPosition } from '../utils/positions.js';
import { parsePickLabel } from '../utils/pickGrammar.js';

const TTL_SECONDS = 6 * 3600; // DP updates roughly weekly; 6h matches fantasycalc.js
const USER_AGENT = 'fleaflicker-dynasty-bot (https://github.com/tdmack/fleaflicker-dynasty-bot)';
const BASE = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files';
export const PLAYERS_URL = `${BASE}/values-players.csv`;
export const PICKS_URL = `${BASE}/values-picks.csv`;

// League shape follows the same env var FantasyCalc uses so both blend
// sources always describe the same league type.
function qbMode(env) {
  const n = Number(env.FANTASYCALC_NUM_QBS);
  return Number.isFinite(n) && n < 2 ? '1qb' : '2qb';
}

export function dpCacheKey(env) {
  return `dynastyprocess:values:${qbMode(env)}`;
}

/** Minimal CSV parser: quoted fields, "" escapes, CRLF, trailing newline. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text ?? '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function toObjects(rows) {
  const [header, ...rest] = rows;
  if (!header) return [];
  return rest.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function maybeNum(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Linear interpolation of an overall-ECR rank onto the sorted player
 * (ecr → value) curve. Clamps at both ends; null for an empty curve.
 */
export function interpolateEcrValue(curve, ecr) {
  if (!curve.length) return null;
  if (ecr <= curve[0].ecr) return curve[0].value;
  const last = curve[curve.length - 1];
  if (ecr >= last.ecr) return last.value;
  for (let i = 1; i < curve.length; i++) {
    const lo = curve[i - 1];
    const hi = curve[i];
    if (ecr <= hi.ecr) {
      if (hi.ecr === lo.ecr) return (lo.value + hi.value) / 2;
      return lo.value + ((ecr - lo.ecr) / (hi.ecr - lo.ecr)) * (hi.value - lo.value);
    }
  }
  return last.value;
}

/**
 * Parse values-players.csv → { players, curve }.
 * players: [{ name, position, team, value }] on DP's native ~0–10000 scale.
 * curve: [{ ecr, value }] sorted ascending by ecr, for pick interpolation.
 */
export function parseDpPlayers(csvText, mode) {
  const valueCol = mode === '1qb' ? 'value_1qb' : 'value_2qb';
  const ecrCol = mode === '1qb' ? 'ecr_1qb' : 'ecr_2qb';
  const players = [];
  const curve = [];
  for (const row of toObjects(parseCsv(csvText))) {
    const position = (row.pos || '?').toUpperCase();
    if (isBlockedPosition(position)) continue;
    const value = maybeNum(row[valueCol]);
    if (value === null || !row.player) continue;
    players.push({ name: row.player, position, team: row.team || '—', value });
    const ecr = maybeNum(row[ecrCol]);
    if (ecr !== null) curve.push({ ecr, value });
  }
  curve.sort((a, b) => a.ecr - b.ecr);
  return { players, curve };
}

/**
 * Parse values-picks.csv → [{ year, round, hint, slot, value }] with values
 * interpolated from the player curve (same overall-ECR scale).
 */
export function parseDpPicks(csvText, mode, curve) {
  const ecrCol = mode === '1qb' ? 'ecr_1qb' : 'ecr_2qb';
  const picks = [];
  for (const row of toObjects(parseCsv(csvText))) {
    const parsed = parsePickLabel(row.player);
    if (!parsed) continue;
    const ecr = maybeNum(row[ecrCol]);
    if (ecr === null) continue;
    const value = interpolateEcrValue(curve, ecr);
    if (value === null) continue;
    picks.push({ ...parsed, value });
  }
  return picks;
}

/**
 * Full DP dataset, KV-cached 6h: { players, picks }.
 * players: [{ name, position, team, value }]; picks: [{ year, round, hint, slot, value }].
 */
export async function getDpValues(env) {
  const cacheKey = dpCacheKey(env);
  const cached = await env.BOT_KV.get(cacheKey, 'json');
  if (cached && Array.isArray(cached.players) && cached.players.length > 0) return cached;

  const fetchCsv = async (url) => {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`DynastyProcess returned HTTP ${res.status} for ${url}`);
    return res.text();
  };

  const mode = qbMode(env);
  const [playersCsv, picksCsv] = await Promise.all([fetchCsv(PLAYERS_URL), fetchCsv(PICKS_URL)]);
  const { players, curve } = parseDpPlayers(playersCsv, mode);
  if (players.length === 0) throw new Error('DynastyProcess players CSV parsed to zero rows');
  const picks = parseDpPicks(picksCsv, mode, curve);

  const data = { players, picks };
  await env.BOT_KV.put(cacheKey, JSON.stringify(data), { expirationTtl: TTL_SECONDS });
  return data;
}
