import { fetchLeagueScoreboard } from '../services/fleaflicker.js';
import { createEmbed, errorEmbed, COLORS } from '../utils/formatters.js';
import { getOption } from '../lib/options.js';
import { seasonHasStarted } from '../lib/season.js';

export const definition = {
  name: 'score',
  description: 'Current week matchup scores',
  options: [
    { type: 3, name: 'team', description: 'Filter to one team (partial name OK)', required: false, max_length: 100 },
  ],
};

export async function execute(interaction, env) {
  const teamQuery = getOption(interaction, 'team');

  const data = await fetchLeagueScoreboard(env);
  const games = data.games || [];
  const week = data.schedulePeriod?.value || '?';

  if (games.length === 0) {
    return {
      embeds: [createEmbed({
        title: `🏈 Week ${week} Scores`,
        description: 'No active scoring period found.',
        color: COLORS.blue,
      })],
    };
  }

  let filtered = games;
  if (teamQuery) {
    const lower = teamQuery.toLowerCase();
    filtered = games.filter((g) =>
      (g.home?.name || '').toLowerCase().includes(lower) ||
      (g.away?.name || '').toLowerCase().includes(lower)
    );

    if (filtered.length === 0) {
      return {
        embeds: [errorEmbed(`No matchup found for **${teamQuery}**. Use \`/standings\` to see valid team names.`)],
      };
    }
  }

  // Pre-season: week 1 before September (NFL season starts in September)
  const isPreSeason = week === 1 && !seasonHasStarted();

  const lines = filtered.map((g) => {
    const homeName = g.home?.name || 'Team A';
    const awayName = g.away?.name || 'Team B';
    const homeScore = g.homeScore?.score?.formatted ?? '0.00';
    const awayScore = g.awayScore?.score?.formatted ?? '0.00';
    const homeProj = g.homeScore?.projected?.formatted;
    const awayProj = g.awayScore?.projected?.formatted;

    let status = '';
    if (g.isFinalScore) status = ' ✅ **FINAL**';
    else if (g.isInProgress) status = ' 🔴 *In Progress*';

    let line = `**${homeName}** ${homeScore} vs **${awayName}** ${awayScore}${status}`;
    if (!g.isFinalScore && homeProj && awayProj) {
      line += `\n  *Proj: ${homeName} ${homeProj} — ${awayName} ${awayProj}*`;
    }
    return line;
  });

  const title = isPreSeason ? `🏈 Pre-season — Week ${week}` : `🏈 Week ${week} Scores`;
  const footer = isPreSeason ? 'Off-season: no games have been played yet' : undefined;

  return {
    embeds: [createEmbed({ title, description: lines.join('\n\n'), color: COLORS.blue, footer })],
  };
}
