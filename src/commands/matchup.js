import { fetchLeagueScoreboard, fetchLeagueBoxscore } from '../services/fleaflicker.js';
import { createEmbed, COLORS } from '../utils/formatters.js';
import { isBlockedPositionLabel } from '../utils/positions.js';
import { getOption } from '../lib/options.js';
import { resolveTeam } from '../lib/resolveTeam.js';

export const definition = {
  name: 'matchup',
  description: "Full boxscore for a team's current matchup",
  options: [
    { type: 3, name: 'team', description: 'Team name (partial OK)', required: true },
  ],
};

export async function execute(interaction, env) {
  const query = getOption(interaction, 'team');
  const { team, error } = await resolveTeam(env, query);
  if (error) return error;

  // Step 1: Find the game from the scoreboard
  const scoreboardData = await fetchLeagueScoreboard(env);
  const games = scoreboardData.games || [];
  const week = scoreboardData.schedulePeriod?.value || '?';

  const game = games.find((g) => {
    const homeId = String(g.home?.id || '');
    const awayId = String(g.away?.id || '');
    return homeId === team.id || awayId === team.id;
  });

  if (!game) {
    return {
      embeds: [createEmbed({
        title: `📊 ${team.name} — Matchup`,
        description: 'No active matchup found for this team.',
        color: COLORS.darkBlue,
      })],
    };
  }

  const homeName = game.home?.name || 'Home';
  const awayName = game.away?.name || 'Away';
  const homeScore = game.homeScore?.score?.formatted ?? '0.00';
  const awayScore = game.awayScore?.score?.formatted ?? '0.00';
  const homeProj = game.homeScore?.projected?.formatted;
  const awayProj = game.awayScore?.projected?.formatted;
  const isHome = String(game.home?.id || '') === team.id;

  let statusLine = '';
  if (game.isFinalScore) statusLine = ' ✅ **FINAL**';
  else if (game.isInProgress) statusLine = ' 🔴 *In Progress*';

  let description = `**${homeName}** ${homeScore}${homeProj ? ` *(proj: ${homeProj})*` : ''} vs **${awayName}** ${awayScore}${awayProj ? ` *(proj: ${awayProj})*` : ''}${statusLine}\n\n`;

  // Step 2: Fetch the boxscore for player slot details
  const boxData = await fetchLeagueBoxscore(env, game.id);
  const queriedName = isHome ? homeName : awayName;
  const side = isHome ? 'home' : 'away';

  // Starters for the queried team from the lineups structure — each slot carries
  // both sides of the matchup as slot.home / slot.away. QB/RB/WR/TE/FLEX only.
  const starterSlots = (boxData.lineups || [])
    .filter((g) => (g.group || '').toUpperCase() === 'START')
    .flatMap((g) => g.slots || [])
    .filter((slot) => !isBlockedPositionLabel(slot.position?.label));

  const lines = [];
  for (const slot of starterSlots) {
    const player = slot[side];
    if (!player?.proPlayer) continue;
    const pp = player.proPlayer;
    const pts = player.viewingActualPoints?.value?.toFixed(2) ?? '0.00';
    const slotLabel = slot.position?.label || pp.position || '?';
    lines.push(`**${slotLabel}** ${pp.nameFull || 'Unknown'} (${pp.position || '?'}) — ${pts} pts`);
  }

  if (lines.length > 0) {
    description += `**${queriedName} Starters:**\n${lines.join('\n')}`;
  }

  // Points left on bench, when Fleaflicker's optimum is present
  const points = isHome ? boxData.pointsHome : boxData.pointsAway;
  const actual = points?.total?.value?.value;
  const optimum = points?.total?.optimum?.value;
  if (typeof actual === 'number' && typeof optimum === 'number' && optimum > actual) {
    description += `\n\n*Points left on bench: ${(optimum - actual).toFixed(1)}*`;
  }

  return {
    embeds: [createEmbed({
      title: `📊 ${homeName} vs ${awayName} — Week ${week}`,
      description,
      color: COLORS.darkBlue,
    })],
  };
}
