import { getTeams, findTeams } from '../cache/teamCache.js';
import { createEmbed, errorEmbed, COLORS } from '../utils/formatters.js';

/**
 * Resolve a partial team-name query to exactly one team.
 * Returns { team } on success, or { error: <reply payload> } for 0/many matches.
 */
export async function resolveTeam(env, query, color = COLORS.grey) {
  const teams = await getTeams(env);
  const matches = findTeams(teams, query);

  if (matches.length === 0) {
    return {
      error: {
        embeds: [errorEmbed(`No team found matching **${query}**. Use \`/standings\` to see valid team names.`)],
      },
    };
  }
  if (matches.length > 1) {
    const list = matches.map((t) => `• ${t.name}`).join('\n');
    return {
      error: {
        embeds: [createEmbed({
          title: '🔎 Multiple Matches',
          description: `Found ${matches.length} teams matching **${query}**. Please be more specific:\n\n${list}`,
          color,
        })],
      },
    };
  }
  return { team: matches[0] };
}
