import { fetchLeagueStandings } from '../services/fleaflicker.js';
import { createEmbed, COLORS } from '../utils/formatters.js';

export const definition = {
  name: 'standings',
  description: 'Full league standings with W-L record, points, and streak',
  options: [],
};

export async function execute(interaction, env) {
  const data = await fetchLeagueStandings(env);
  const season = data.season || new Date().getFullYear();
  const divisions = data.divisions || [];

  let description = '';

  if (divisions.length > 0) {
    for (const div of divisions) {
      description += `**— ${div.name || 'Division'} —**\n`;
      (div.teams || []).forEach((t, i) => {
        description += formatTeamLine(i + 1, t);
      });
      description += '\n';
    }
  } else {
    description = 'No standings data available.';
  }

  return {
    embeds: [createEmbed({
      title: '🏆 League Standings',
      description: description.trim(),
      color: COLORS.gold,
      footer: `Season ${season}`,
    })],
  };
}

function formatTeamLine(rank, team) {
  const name = team.name || 'Unknown';
  const record = team.recordOverall?.formatted || '0-0';
  const pf = team.pointsFor?.formatted || '—';
  const pa = team.pointsAgainst?.formatted || '—';
  const streak = team.streak?.formatted ? ` | Streak: ${team.streak.formatted}` : '';
  return `**${rank}.** ${name} — ${record} | PF: ${pf} | PA: ${pa}${streak}\n`;
}
