import { fetchPlayerListing } from '../services/fleaflicker.js';
import { createEmbed, errorEmbed, COLORS } from '../utils/formatters.js';
import { isBlockedPosition } from '../utils/positions.js';
import { getOption } from '../lib/options.js';

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'FLEX'];

export const definition = {
  name: 'freeagents',
  description: 'Top 10 free agents by season average points',
  options: [
    {
      type: 3, name: 'position', description: 'Filter by position', required: false,
      choices: VALID_POSITIONS.map((p) => ({ name: p, value: p })),
    },
  ],
};

export async function execute(interaction, env) {
  const position = getOption(interaction, 'position');

  if (position && !VALID_POSITIONS.includes(position.toUpperCase())) {
    return { embeds: [errorEmbed('Supported positions are **QB, RB, WR, TE, FLEX**.')] };
  }

  const params = {
    'filter.free_agent_only': true,
    sort: 'SORT_SEASON_AVERAGE',
  };
  if (position) {
    params['filter.position.eligibility'] = position.toUpperCase();
  }

  const data = await fetchPlayerListing(env, params);
  // Defensive: the unfiltered listing could include K/DEF, which this bot never shows
  // (see src/utils/positions.js)
  const players = (data.players || [])
    .filter((entry) => !isBlockedPosition(entry.proPlayer?.position))
    .slice(0, 10);

  if (players.length === 0) {
    return {
      embeds: [createEmbed({
        title: '📋 Free Agents',
        description: 'No free agents found.',
        color: COLORS.green,
      })],
    };
  }

  const lines = players.map((entry, i) => {
    const p = entry.proPlayer || {};
    const name = p.nameFull || 'Unknown';
    const pos = p.position || '?';
    const nflTeam = p.proTeamAbbreviation || '—';
    const avgPts = entry.seasonAverage?.formatted
      ?? entry.viewingActualPointsAverage?.formatted
      ?? '0.00';
    const injury = p.injury ? ` ⚠️ ${p.injury.severity}` : '';
    return `**${i + 1}.** ${name} (${pos}, ${nflTeam}) — ${avgPts} pts${injury}`;
  });

  const title = position
    ? `📋 Top ${players.length} Free Agents — ${position}`
    : `📋 Top ${players.length} Free Agents`;

  return {
    embeds: [createEmbed({
      title,
      description: lines.join('\n'),
      color: COLORS.green,
      footer: 'Sorted by season average',
    })],
  };
}
