import { fetchTeamPicks } from '../services/fleaflicker.js';
import { createEmbed, COLORS } from '../utils/formatters.js';
import { getOption } from '../lib/options.js';
import { resolveTeam } from '../lib/resolveTeam.js';

export const definition = {
  name: 'picks',
  description: 'Future draft pick assets for a team',
  options: [
    { type: 3, name: 'team', description: 'Team name (partial OK)', required: true },
  ],
};

export async function execute(interaction, env) {
  const query = getOption(interaction, 'team');
  const { team, error } = await resolveTeam(env, query, COLORS.orange);
  if (error) return error;

  const data = await fetchTeamPicks(env, team.id);
  // pick.lost === true means the pick was traded away from this team; exclude it
  const picks = (data.picks || []).filter((p) => !p.lost);

  if (picks.length === 0) {
    return {
      embeds: [createEmbed({
        title: `🎯 ${team.name} — Draft Pick Assets`,
        description: 'This team holds no future draft picks.',
        color: COLORS.orange,
      })],
    };
  }

  // Group by season year ascending
  const bySeason = {};
  for (const pick of picks) {
    const year = pick.season || '?';
    if (!bySeason[year]) bySeason[year] = [];
    bySeason[year].push(pick);
  }

  const sections = Object.keys(bySeason).sort().map((year) => {
    const lines = bySeason[year].map((pick) => {
      const round = pick.slot?.round || '?';
      const slot = pick.slot?.slot;
      const pickLabel = slot ? `Round ${round} (Pick ${slot})` : `Round ${round}`;
      const originalOwner = pick.originalOwner;
      const isTraded = originalOwner && pick.ownedBy?.id !== originalOwner.id;
      const tradeNote = isTraded ? ` — via ${originalOwner.name} 🔄` : '';
      return `  • ${pickLabel}${tradeNote}`;
    });
    return `**${year}**\n${lines.join('\n')}`;
  });

  return {
    embeds: [createEmbed({
      title: `🎯 ${team.name} — Draft Pick Assets`,
      description: sections.join('\n\n'),
      color: COLORS.orange,
    })],
  };
}
