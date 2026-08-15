// Trade formatting shared by /trades, /transactions, /activity, and the
// trade-alert cron.

import { formatTimestamp } from './formatters.js';

export function formatTradeAssets(players, picks) {
  const playerLines = (players || []).map((p) => {
    const pp = p.proPlayer || p;
    const name = pp.nameFull || 'Unknown Player';
    const pos = pp.position || '';
    return `${name}${pos ? ` (${pos})` : ''}`;
  });

  const pickLines = (picks || []).map((pick) => {
    const season = pick.season || '?';
    const round = pick.slot?.round || '?';
    const origOwner = pick.originalOwner?.name;
    const origNote = origOwner ? ` (orig: ${origOwner})` : '';
    return `${season} Round ${round} Pick${origNote}`;
  });

  return [...playerLines, ...pickLines].join(', ') || '*nothing*';
}

/** Build a { name, value } embed field describing one trade. */
export function buildTradeField(trade, index = 0) {
  // Pending trades have no approvedOn yet — fall back to when it was proposed
  const epochMilli = trade.approvedOn ?? trade.proposedOn ?? trade.createdOn;
  const timestamp = formatTimestamp(Number(epochMilli) / 1000);
  const teams = trade.teams || [];

  let tradeDesc = '';
  if (teams.length >= 2) {
    const side1 = teams[0];
    const side2 = teams[1];
    const team1Name = side1.team?.name || 'Team A';
    const team2Name = side2.team?.name || 'Team B';
    const side1Assets = formatTradeAssets(side1.playersObtained || [], side1.picksObtained || []);
    const side2Assets = formatTradeAssets(side2.playersObtained || [], side2.picksObtained || []);

    tradeDesc = `**${team1Name}** receives: ${side1Assets}\n**${team2Name}** receives: ${side2Assets}\n*${timestamp}*`;
  } else {
    tradeDesc = `${trade.description || 'Trade details unavailable.'}\n*${timestamp}*`;
  }

  return {
    name: `🔀 ${trade.description || `Trade ${index + 1}`}`,
    value: tradeDesc || '—',
    inline: false,
  };
}

/**
 * Build a tradeId -> [teamName, ...] lookup from a FetchTrades response.
 * Used to show a trade's counterparty even when one side received nothing
 * (the activity/transaction feeds omit that side entirely).
 */
export function buildTradeTeamsMap(tradesData) {
  const map = new Map();
  for (const trade of (tradesData?.trades || [])) {
    if (!trade.id) continue;
    const names = (trade.teams || []).map((e) => e.team?.name).filter(Boolean);
    if (names.length > 0) map.set(String(trade.id), names);
  }
  return map;
}

/** Fleaflicker trade page URL, or null when tradeId isn't a safe numeric id. */
export function tradeUrl(env, tradeId) {
  if (!/^\d+$/.test(String(tradeId))) return null;
  const sport = (env.FLEAFLICKER_SPORT || 'NFL').toLowerCase();
  return `https://www.fleaflicker.com/${sport}/leagues/${env.FLEAFLICKER_LEAGUE_ID}/trades/${tradeId}`;
}

// Discord poll limits: 55 chars per answer (counted in code points), 10 answers max.
const POLL_ANSWER_MAX = 55;
const POLL_MAX_ANSWERS = 10;
const POLL_HOURS = 48;

/**
 * Native Discord poll payload for a completed trade, or null when the trade
 * lacks two identifiable teams. Sent as its OWN message: Discord only accepts
 * polls on message create, never on edit, so the trade embed posts first and
 * the poll follows as a second message.
 */
export function buildTradePoll(trade) {
  const names = (trade.teams || []).map((e) => e.team?.name).filter(Boolean);
  if (names.length < 2) return null;
  // Multi-team (3+) trades include EVERY team, even though buildTradeField's
  // embed only renders the first two sides. A "who won" vote needs every
  // participant as an option; the embed's two-team limit is pre-existing
  // and out of scope for this poll builder.
  const answers = [...names.slice(0, POLL_MAX_ANSWERS - 1), 'Fair deal'].map((text) => ({
    // Slice by code point, not UTF-16 unit, so a surrogate pair straddling
    // the limit isn't split into an invalid lone surrogate.
    poll_media: { text: [...text].slice(0, POLL_ANSWER_MAX).join('') },
  }));
  return {
    question: { text: 'Who won this trade?' },
    answers,
    duration: POLL_HOURS,
    allow_multiselect: false,
  };
}
