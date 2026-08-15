// "Players to Monitor" — Thursday- and Sunday-morning lineup check
// (cron: 0 15 * * thu,sun — 11:00 ET during the season's daylight-time weeks).
// Thursday catches TNF starters before their early lock; Sunday covers the
// main slate. For every team's STARTING lineup it flags:
//   ▫️ empty starting slots (no player at all),
//   🚫 starters on their NFL bye week,
//   🔴/🟠/🟡 starters with an injury (OUT / DOUBTFUL / QUESTIONABLE).
// Posts nothing when every lineup is clean. Gated on the scoreboard: skips
// the offseason (no games) and finished weeks (all final).
//
// Note: Fleaflicker's injury payload misspells one field —
// `typeAbbreviaition` — read both spellings in case they ever fix it.

import { fetchLeagueScoreboard, fetchRoster } from '../services/fleaflicker.js';
import { getTeams } from '../cache/teamCache.js';
import { postChannelMessage } from '../lib/discord.js';
import { createEmbed, truncate, COLORS } from '../utils/formatters.js';
import { isBlockedPositionLabel } from '../utils/positions.js';

const SEVERITY_BADGE = {
  OUT: '🔴',
  DOUBTFUL: '🟠',
  QUESTIONABLE: '🟡',
};

export async function runPlayersToMonitor(env) {
  const channelId = env.DISCORD_RECAP_CHANNEL_ID || env.DISCORD_TRADE_CHANNEL_ID;
  if (!channelId) return;

  let scoreboard;
  try {
    scoreboard = await fetchLeagueScoreboard(env);
  } catch (err) {
    console.error('[PlayersToMonitor] Scoreboard fetch failed:', err.message);
    return;
  }
  const games = scoreboard.games || [];
  const week = Number(scoreboard.schedulePeriod?.value) || 0;
  if (!week || games.length === 0) return; // offseason
  if (games.every((g) => g.isFinalScore)) return; // week already wrapped

  let teams;
  try {
    teams = await getTeams(env);
  } catch (err) {
    console.error('[PlayersToMonitor] Team list unavailable:', err.message);
    return;
  }

  const rosters = await Promise.allSettled(teams.map((t) => fetchRoster(env, t.id)));
  const sections = [];
  rosters.forEach((res, i) => {
    if (res.status !== 'fulfilled') {
      console.error(`[PlayersToMonitor] Roster for ${teams[i].name} failed:`, res.reason?.message);
      return;
    }
    const flags = flagStarters(res.value, week);
    if (flags.length > 0) sections.push(`**${teams[i].name}**\n${flags.join('\n')}`);
  });

  if (sections.length === 0) {
    console.log(`[PlayersToMonitor] Week ${week}: all starting lineups clean`);
    return;
  }

  await postChannelMessage(env, channelId, {
    embeds: [createEmbed({
      title: `🚑 Week ${week} — Players to Monitor`,
      description: truncate(sections.join('\n\n'), 4000),
      color: COLORS.orange,
      footer: 'Starters who are hurt, on bye, or missing — check your lineup before kickoff',
    })],
  });
  console.log(`[PlayersToMonitor] Posted week ${week} alert for ${sections.length} team(s)`);
}

export function flagStarters(roster, week) {
  const flags = [];
  const startSlots = (roster.groups || [])
    .filter((g) => (g.group || '').toUpperCase() === 'START')
    .flatMap((g) => g.slots || []);

  for (const slot of startSlots) {
    const label = slot.position?.label || '?';
    if (isBlockedPositionLabel(label)) continue; // league rule: no K/DEF anywhere
    const pp = slot.leaguePlayer?.proPlayer;
    if (!pp) {
      flags.push(`▫️ **${label}** — empty starting slot`);
      continue;
    }
    if (Number(pp.nflByeWeek) === week) {
      flags.push(`🚫 **${label}** ${pp.nameFull} — on bye this week`);
      continue;
    }
    const injury = pp.injury;
    const severity = (injury?.severity || '').toUpperCase();
    if (injury && severity && SEVERITY_BADGE[severity]) {
      const type = injury.typeFull || injury.typeAbbreviaition || injury.typeAbbreviation || '';
      flags.push(`${SEVERITY_BADGE[severity]} **${label}** ${pp.nameFull} — ${severity.toLowerCase()}${type ? ` (${type})` : ''}`);
    }
  }
  return flags;
}
