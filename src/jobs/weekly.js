// Weekly posts — runs daily, but gated on DATA rather than weekday: the recap
// fires only once every matchup of a week is marked final (handles Monday,
// Wednesday, and holiday slates alike), and each post happens exactly once
// (tracked in KV). The preview for the next week posts after its predecessor's
// recap. In the offseason both gates stay closed and the job exits silently.
//
// All-play/luck and coach-rating semantics are adapted from Dynasty Command
// Center's week-in-review slice (phase-7.6-m5): all-play compares every team
// against all others each week; luck = actual win% − all-play win%; coach
// rating = actual ÷ Fleaflicker-computed optimum, never fabricated when the
// optimum is missing or zero, clamped at 100% when the payload is inconsistent.

import {
  fetchLeagueScoreboard,
  fetchLeagueBoxscore,
  fetchLeagueStandings,
  fetchLeagueTransactions,
} from '../services/fleaflicker.js';
import { createEmbed, truncate, COLORS, formatTimestamp } from '../utils/formatters.js';
import { txKind, formatSimpleTransaction } from '../utils/transactions.js';
import { postChannelMessage } from '../lib/discord.js';
import { seasonHasStarted, nflSeasonYear } from '../lib/season.js';

const KV_TTL = 60 * 86400; // posted-markers expire after ~2 months

const recapKey = (season, week) => `weekly:recap:${season}:${week}`;
const previewKey = (season, week) => `weekly:preview:${season}:${week}`;

export async function runWeekly(env) {
  const channelId = env.DISCORD_RECAP_CHANNEL_ID || env.DISCORD_TRADE_CHANNEL_ID;
  if (!channelId) return;

  const current = await fetchLeagueScoreboard(env);
  const games = current.games || [];
  const currentWeek = Number(current.schedulePeriod?.value) || 0;
  // The scoreboard can omit its season fields (observed offseason); fall back
  // to the NFL season year, NOT the calendar year (January is last season).
  const season = current.schedulePeriod?.season
    || current.schedulePeriod?.low?.season
    || nflSeasonYear();
  if (!currentWeek || games.length === 0) return; // offseason

  // --- Recap: latest week whose games are ALL final, posted at most once.
  // Check the KV marker BEFORE fetching a prior week's scoreboard so the
  // common already-posted case costs a KV read, not a Fleaflicker call.
  let recappedWeek = null; // latest week whose recap exists (or just posted)
  for (const w of [currentWeek, currentWeek - 1]) {
    if (w < 1) continue;
    if (await env.BOT_KV.get(recapKey(season, w))) {
      recappedWeek = w;
      break;
    }
    const sb = w === currentWeek ? current : await fetchLeagueScoreboard(env, w);
    const wGames = sb.games || [];
    if (wGames.length > 0 && wGames.every((g) => g.isFinalScore)) {
      await postRecap(env, channelId, season, w, sb);
      recappedWeek = w;
      break;
    }
  }

  // --- Preview: current week, posted once, only before any game starts.
  // Anchor on the previous week's recap; week 1 anchors on September instead.
  const anchored = recappedWeek === currentWeek - 1
    || (currentWeek === 1 && seasonHasStarted());
  const notStarted = !games.some((g) => g.isFinalScore || g.isInProgress);

  if (anchored && notStarted) {
    const key = previewKey(season, currentWeek);
    if (!(await env.BOT_KV.get(key))) {
      await postPreview(env, channelId, currentWeek, games);
      await env.BOT_KV.put(key, 'posted', { expirationTtl: KV_TTL });
    }
  }
}

// ---------------------------------------------------------------- recap

// apiSeason is normally undefined (Fleaflicker defaults to the current
// season); /testweekly passes an explicit historical season.
export async function postRecap(env, channelId, season, week, scoreboard, apiSeason) {
  const games = scoreboard.games || [];

  // Standings is needed by both messages — fetch before message 1
  const standings = await fetchLeagueStandings(env, apiSeason);
  const actualByTeam = new Map();
  for (const div of (standings.divisions || [])) {
    for (const t of (div.teams || [])) {
      const rec = t.recordOverall || {};
      const wins = rec.wins || 0;
      const losses = rec.losses || 0;
      const ties = rec.ties || 0;
      const total = wins + losses + ties;
      actualByTeam.set(String(t.id), {
        name: t.name,
        record: rec.formatted || `${wins}-${losses}`,
        winPct: total > 0 ? (wins + ties / 2) / total : null,
        winEquivalents: wins + ties / 2,
        gamesPlayed: total,
        pointsFor: t.pointsFor?.formatted || '—',
      });
    }
  }

  // ---- Message 1: scores + standings ----
  const scoreLines = games.map((g) => {
    const hn = g.home?.name || 'Home';
    const an = g.away?.name || 'Away';
    const hs = g.homeScore?.score?.value ?? 0;
    const as = g.awayScore?.score?.value ?? 0;
    const header = `**${hn}** ${fmtPts(hs)} — ${fmtPts(as)} **${an}**`;
    if (hs === as) return `${header}\n  *Tied*`;
    const winner = hs > as ? hn : an;
    return `${header}\n  *${winner} by ${Math.abs(hs - as).toFixed(1)}*`;
  });

  const margins = games.map((g) => ({
    margin: Math.abs((g.homeScore?.score?.value ?? 0) - (g.awayScore?.score?.value ?? 0)),
    g,
  })).sort((a, b) => b.margin - a.margin);
  let calloutLine = '';
  if (margins.length >= 2) {
    const blowout = margins[0];
    const nailbiter = margins[margins.length - 1];
    calloutLine = `\n💥 Biggest blowout: **${gameLabel(blowout.g)}** (${blowout.margin.toFixed(1)})\n😅 Closest call: **${gameLabel(nailbiter.g)}** (${nailbiter.margin.toFixed(1)})`;
  }

  const standingsLines = [...actualByTeam.values()]
    .sort((a, b) => (b.winPct ?? 0) - (a.winPct ?? 0))
    .map((t, i) => `**${i + 1}.** ${t.name} — ${t.record} | PF: ${t.pointsFor}`);

  await postChannelMessage(env, channelId, {
    embeds: [
      createEmbed({
        title: `📅 Week ${week} in Review`,
        description: truncate(scoreLines.join('\n') + calloutLine, 4000),
        color: COLORS.indigo,
        footer: `Season ${season}`,
      }),
      createEmbed({
        title: '🏆 Standings',
        description: truncate(standingsLines.join('\n'), 4000) || 'No standings available.',
        color: COLORS.gold,
      }),
    ],
  });

  // Mark posted as soon as the first message lands: a failure in the metrics
  // message below must not cause tomorrow's cron to duplicate the recap.
  await env.BOT_KV.put(recapKey(season, week), 'posted', { expirationTtl: KV_TTL });

  try {
    await postRecapMetrics(env, channelId, week, scoreboard, actualByTeam, apiSeason);
  } catch (err) {
    // Logged, not retried — the dedupe marker above already committed us
    console.error(`[Weekly] Metrics message for week ${week} failed:`, err.message);
  }
  console.log(`[Weekly] Posted week ${week} recap`);
}

// Message 2: all-play/luck + coach ratings + top scorers + transactions
async function postRecapMetrics(env, channelId, week, scoreboard, actualByTeam, apiSeason) {
  const games = scoreboard.games || [];

  // Boxscores (coach ratings + top scorers) — independent, fetch in parallel
  const teamPoints = new Map(); // teamId -> { name, actual, optimum }
  const playerScores = [];
  const boxes = await Promise.allSettled(games.map((g) => fetchLeagueBoxscore(env, g.id)));
  boxes.forEach((res, i) => {
    if (res.status !== 'fulfilled') {
      console.error(`[Weekly] Boxscore ${games[i].id} failed:`, res.reason?.message);
      return;
    }
    collectSide(teamPoints, games[i].home, res.value.pointsHome);
    collectSide(teamPoints, games[i].away, res.value.pointsAway);
    collectPlayers(playerScores, res.value, games[i]);
  });

  // All-play per week, accumulated season-to-date (historical weeks are
  // immutable, so parallel fetches are safe)
  const priorWeeks = Array.from({ length: week - 1 }, (_, i) => i + 1);
  const priorBoards = await Promise.allSettled(
    priorWeeks.map((w) => fetchLeagueScoreboard(env, w, apiSeason)),
  );
  const seasonAllPlay = new Map(); // teamId -> { name, w, l, t }
  const accumulate = (sb) => {
    const finals = (sb.games || []).filter((g) => g.isFinalScore);
    if (finals.length === 0) return;
    for (const [id, rec] of allPlayForGames(finals)) {
      const acc = seasonAllPlay.get(id) || { name: rec.name, w: 0, l: 0, t: 0 };
      acc.w += rec.w; acc.l += rec.l; acc.t += rec.t;
      acc.name = rec.name;
      seasonAllPlay.set(id, acc);
    }
  };
  priorBoards.forEach((res, i) => {
    if (res.status === 'fulfilled') accumulate(res.value);
    else console.error(`[Weekly] Week ${priorWeeks[i]} scoreboard failed:`, res.reason?.message);
  });
  accumulate(scoreboard);

  // Luck in wins: actual wins minus what the all-play rate deserved over the
  // games actually played. Sums to ~0 league-wide. (Standard "expected wins"
  // framing; per league-wide studies, ±1.5W is real grievance territory and
  // ±3W is a 1-in-40 season.)
  const luckRows = [...seasonAllPlay.entries()]
    .map(([id, szn]) => {
      const actual = actualByTeam.get(id);
      const luckWins = actual && actual.winPct !== null
        ? actual.winEquivalents - allPlayPct(szn) * actual.gamesPlayed
        : null;
      return { name: szn.name, szn, pct: allPlayPct(szn), actual, luckWins };
    })
    .sort((a, b) => (b.luckWins ?? -Infinity) - (a.luckWins ?? -Infinity));

  const allPlayLines = luckRows.map((row) => {
    const sznStr = `${row.szn.w}-${row.szn.l}${row.szn.t ? `-${row.szn.t}` : ''}`;
    const actualStr = row.actual?.record || '—';
    const luck = row.luckWins === null ? '—' : `${fmtLuckWins(row.luckWins)}${luckBadge(row.luckWins)}`;
    return `${row.name} — luck **${luck}** · actual ${actualStr} · all-play ${sznStr}`;
  });

  const allPlayExplainer =
    '*Sorted luckiest → most robbed. Your **all-play** record is how you\'d have done playing every team, every week. '
    + '**Luck** = actual wins − the wins your all-play rate deserved, totaled across the whole season so far: '
    + '🍀 the schedule\'s been kind, 🌧️ you\'ve been robbed. League luck always sums to zero.*\n\n';

  const coachLines = [...teamPoints.values()]
    .map((t) => ({ ...t, cr: coachRating(t.actual, t.optimum) }))
    .sort((a, b) => (b.cr?.rating ?? -1) - (a.cr?.rating ?? -1))
    .map((t) => {
      if (!t.cr) return `**${t.name}** — —`;
      const pct = (t.cr.rating * 100).toFixed(1);
      const bench = t.cr.bench > 0 ? ` (${t.cr.bench.toFixed(1)} pts on bench)` : ' (perfect lineup!)';
      return `**${t.name}** — ${pct}%${bench}`;
    });

  const topScorers = playerScores
    .sort((a, b) => b.points - a.points)
    .slice(0, 5)
    .map((p, i) => `**${i + 1}.** ${p.name} (${p.position}) — ${p.points.toFixed(1)} pts *(${p.teamName})*`);

  const txLines = await weekTransactionDigest(env);

  const embeds = [
    createEmbed({
      title: '🍀 Luck Report (All-Play)',
      description: allPlayLines.length > 0
        ? truncate(allPlayExplainer + allPlayLines.join('\n'), 4000)
        : 'Not enough data yet.',
      color: COLORS.teal,
      footer: 'Rule of thumb: past ±1.5 wins of luck you may officially complain',
    }),
    createEmbed({
      title: '🎓 Coach Ratings',
      description: truncate(coachLines.join('\n'), 4000) || 'No lineup data available.',
      color: COLORS.purple,
      footer: 'Actual points ÷ optimal lineup (per Fleaflicker)',
    }),
    createEmbed({
      title: '🌟 Top Scorers',
      description: topScorers.join('\n') || 'No player scores available.',
      color: COLORS.green,
    }),
  ];
  if (txLines.length > 0) {
    embeds.push(createEmbed({
      title: '🔄 The Week in Moves',
      description: truncate(txLines.join('\n'), 4000),
      color: COLORS.cyan,
    }));
  }

  await postChannelMessage(env, channelId, { embeds });
}

function collectSide(teamPoints, team, points) {
  if (!team || !points) return;
  const actual = points.total?.value?.value;
  const optimum = points.total?.optimum?.value;
  teamPoints.set(String(team.id), {
    name: team.name,
    actual: typeof actual === 'number' ? actual : null,
    optimum: typeof optimum === 'number' ? optimum : null,
  });
}

function collectPlayers(playerScores, box, game) {
  const starters = (box.lineups || [])
    .filter((g) => (g.group || '').toUpperCase() === 'START')
    .flatMap((g) => g.slots || []);
  for (const slot of starters) {
    for (const side of ['home', 'away']) {
      const lp = slot[side];
      if (!lp?.proPlayer) continue;
      const points = lp.viewingActualPoints?.value;
      if (typeof points !== 'number') continue;
      playerScores.push({
        name: lp.proPlayer.nameFull || 'Unknown',
        position: lp.proPlayer.position || '?',
        points,
        teamName: game[side]?.name || '?',
      });
    }
  }
}

// DCC all_play.py semantics: each team vs every other team that played that
// week. Both perspectives of each pair are counted, giving per-team records.
function allPlayForGames(games) {
  const scores = [];
  for (const g of games) {
    if (g.home) scores.push({ id: String(g.home.id), name: g.home.name, pts: g.homeScore?.score?.value ?? 0 });
    if (g.away) scores.push({ id: String(g.away.id), name: g.away.name, pts: g.awayScore?.score?.value ?? 0 });
  }
  const records = new Map();
  for (const t of scores) records.set(t.id, { name: t.name, w: 0, l: 0, t: 0 });
  for (const a of scores) {
    for (const b of scores) {
      if (a.id === b.id) continue;
      const rec = records.get(a.id);
      if (a.pts > b.pts) rec.w++;
      else if (a.pts < b.pts) rec.l++;
      else rec.t++;
    }
  }
  return records;
}

function allPlayPct(rec) {
  const total = rec.w + rec.l + rec.t;
  return total > 0 ? (rec.w + rec.t / 2) / total : 0;
}

// DCC coach_rating.py semantics: no rating when optimum is missing or zero;
// clamp >100% (payload inconsistency) rather than reporting the anomaly.
function coachRating(actual, optimum) {
  if (typeof actual !== 'number' || typeof optimum !== 'number' || optimum === 0) return null;
  const raw = actual / optimum;
  if (raw > 1) console.warn(`[Weekly] Coach rating anomaly: actual ${actual} > optimum ${optimum}`);
  return { rating: Math.min(raw, 1), bench: Math.max(0, optimum - actual) };
}

function fmtLuckWins(wins) {
  const rounded = Math.round(wins * 10) / 10;
  if (rounded === 0) return '±0.0 wins';
  return rounded > 0 ? `+${rounded.toFixed(1)} wins` : `−${Math.abs(rounded).toFixed(1)} wins`;
}

// Categorical badge (Fleaflicker's own luck writeup uses labeled tiers) —
// only meaningful swings get an emoji.
function luckBadge(wins) {
  if (wins >= 0.75) return ' 🍀';
  if (wins <= -0.75) return ' 🌧️';
  return '';
}

function fmtPts(v) {
  return typeof v === 'number' ? v.toFixed(1) : '0.0';
}

function gameLabel(g) {
  return `${g.home?.name || 'Home'} vs ${g.away?.name || 'Away'}`;
}

async function weekTransactionDigest(env) {
  try {
    const data = await fetchLeagueTransactions(env);
    const cutoff = Date.now() - 7 * 86400 * 1000;
    return (data.items || [])
      .filter((item) => Number(item.timeEpochMilli) >= cutoff)
      .slice(0, 8)
      .map((item) => {
        const tx = item.transaction || {};
        const line = formatSimpleTransaction(
          txKind(tx.type),
          tx.team?.name,
          tx.player?.proPlayer?.nameFull,
        );
        if (!line) return null; // trades are covered by the trade-alert cron
        return `• ${line} — *${formatTimestamp(Number(item.timeEpochMilli) / 1000)}*`;
      })
      .filter(Boolean);
  } catch (err) {
    console.error('[Weekly] Transaction digest failed:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------- preview

export async function postPreview(env, channelId, week, games) {
  const lines = games.map((g) => {
    const hn = g.home?.name || 'Home';
    const an = g.away?.name || 'Away';
    const hr = g.home?.recordOverall?.formatted;
    const ar = g.away?.recordOverall?.formatted;
    const hp = g.homeScore?.projected?.formatted;
    const ap = g.awayScore?.projected?.formatted;
    let line = `**${hn}**${hr ? ` (${hr})` : ''} vs **${an}**${ar ? ` (${ar})` : ''}`;
    if (hp && ap) line += `\n  *Proj: ${hp} — ${ap}*`;
    return line;
  });

  await postChannelMessage(env, channelId, {
    embeds: [createEmbed({
      title: `🔮 Week ${week} Preview`,
      description: truncate(lines.join('\n\n'), 4000) || 'No matchups found.',
      color: COLORS.blue,
      footer: 'Good luck out there',
    })],
  });
  console.log(`[Weekly] Posted week ${week} preview`);
}
