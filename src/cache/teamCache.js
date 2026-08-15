// Team list cache. v4 kept this in process memory with an hourly refresh and
// served the last-good list when a refresh failed; this port keeps both
// behaviors on KV: the entry never expires, carries its fetch time, and a
// failed refresh falls back to the stale list rather than erroring.

import { fetchLeagueRosters } from '../services/fleaflicker.js';

const KV_KEY = 'teams:v2'; // { teams: [{id,name}], fetchedAt: epochMs }
const MAX_AGE_MS = 3600 * 1000;

/** Returns [{ id, name }] — refreshing from Fleaflicker when stale. */
export async function getTeams(env) {
  const cached = await env.BOT_KV.get(KV_KEY, 'json');
  const hasCache = Array.isArray(cached?.teams) && cached.teams.length > 0;

  if (hasCache && Date.now() - (cached.fetchedAt || 0) < MAX_AGE_MS) {
    return cached.teams;
  }

  try {
    const data = await fetchLeagueRosters(env);
    const teams = (data.rosters || [])
      .map((r) => ({
        id: String(r.team?.id || r.id),
        name: r.team?.name || r.name || 'Unknown',
      }))
      .filter((t) => t.id && t.name !== 'Unknown');

    if (teams.length > 0) {
      await env.BOT_KV.put(KV_KEY, JSON.stringify({ teams, fetchedAt: Date.now() }));
      return teams;
    }
  } catch (err) {
    console.error('[TeamCache] Refresh failed:', err.message);
  }

  // Refresh failed or returned nothing — serve stale rather than nothing
  if (hasCache) return cached.teams;
  const err = new Error('Team list unavailable — Fleaflicker may be down, please try again');
  err.safe = true;
  throw err;
}

/**
 * Find teams by partial case-insensitive name match.
 * Returns array of matches (may be 0, 1, or multiple).
 */
export function findTeams(teams, query) {
  if (!query || typeof query !== 'string') return [];
  const lower = query.trim().slice(0, 100).toLowerCase();
  return teams.filter((t) => t.name.toLowerCase().includes(lower));
}
