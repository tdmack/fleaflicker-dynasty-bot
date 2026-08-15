// All Fleaflicker API calls. Fetch-based port of the v4 axios service —
// same endpoints, same error contract (safe messages, real errors logged).
// The v4 500ms inter-call sleeps were dropped: they protected a long-lived
// polling process, but a per-request Worker makes at most a handful of calls
// per invocation, and 429s are already handled.

const BASE_URL = 'https://www.fleaflicker.com/api';
const REQUEST_TIMEOUT_MS = 15000;

// Errors flagged `safe` carry a message fit for users; the top-level handler
// in src/index.js shows them verbatim instead of the generic fallback.
function safeError(message) {
  const err = new Error(message);
  err.safe = true;
  return err;
}

function leagueParams(env) {
  if (!env.FLEAFLICKER_LEAGUE_ID) {
    throw new Error('FLEAFLICKER_LEAGUE_ID is not configured');
  }
  return {
    sport: env.FLEAFLICKER_SPORT || 'NFL',
    league_id: env.FLEAFLICKER_LEAGUE_ID,
  };
}

async function get(env, endpoint, params = {}) {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  const merged = { ...leagueParams(env), ...params };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw safeError('Request timed out — Fleaflicker may be slow, please try again');
    }
    console.error(`[Fleaflicker API] ${endpoint} failed:`, err.message);
    throw safeError('Failed to fetch data from Fleaflicker');
  }

  if (response.status === 429) {
    throw safeError('Fleaflicker API rate limit reached — please try again later');
  }
  if (response.status === 404) {
    throw safeError(`Resource not found: ${endpoint}`);
  }
  if (!response.ok) {
    console.error(`[Fleaflicker API] ${endpoint} failed: HTTP ${response.status}`);
    throw safeError('Failed to fetch data from Fleaflicker');
  }
  return response.json();
}

export async function fetchPlayerListing(env, params = {}) {
  return get(env, 'FetchPlayerListing', params);
}

export async function fetchLeagueScoreboard(env, scoringPeriod, season) {
  const params = {};
  if (scoringPeriod) params.scoring_period = scoringPeriod;
  if (season) params.season = season;
  return get(env, 'FetchLeagueScoreboard', params);
}

export async function fetchRoster(env, teamId) {
  return get(env, 'FetchRoster', { team_id: teamId });
}

export async function fetchLeagueStandings(env, season) {
  const params = {};
  if (season) params.season = season;
  return get(env, 'FetchLeagueStandings', params);
}

export async function fetchTeamPicks(env, teamId) {
  return get(env, 'FetchTeamPicks', { team_id: teamId });
}

export async function fetchLeagueDraftBoard(env, season) {
  const params = {};
  if (season) params.season = season;
  return get(env, 'FetchLeagueDraftBoard', params);
}

export async function fetchLeagueTransactions(env, teamId) {
  const params = {};
  if (teamId) params.team_id = teamId;
  return get(env, 'FetchLeagueTransactions', params);
}

export async function fetchLeagueActivity(env) {
  return get(env, 'FetchLeagueActivity');
}

export async function fetchLeagueBoxscore(env, fantasyGameId) {
  return get(env, 'FetchLeagueBoxscore', { fantasy_game_id: fantasyGameId });
}

export async function fetchLeagueRules(env) {
  return get(env, 'FetchLeagueRules');
}

export async function fetchTrades(env, filter) {
  const filterValue = filter === 'pending' ? 'TRADES_UNDER_REVIEW' : 'TRADES_COMPLETED';
  return get(env, 'FetchTrades', { filter: filterValue });
}

export async function fetchLeagueRosters(env) {
  return get(env, 'FetchLeagueRosters');
}
