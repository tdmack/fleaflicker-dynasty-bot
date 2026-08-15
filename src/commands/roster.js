import { fetchRoster } from '../services/fleaflicker.js';
import { createEmbed, COLORS } from '../utils/formatters.js';
import { isBlockedPositionLabel } from '../utils/positions.js';
import { getOption } from '../lib/options.js';
import { resolveTeam } from '../lib/resolveTeam.js';

export const definition = {
  name: 'roster',
  description: 'Starting lineup for a team (QB/RB/WR/TE/FLEX only)',
  options: [
    { type: 3, name: 'team', description: 'Team name (partial OK)', required: true, max_length: 100 },
  ],
};

export async function execute(interaction, env) {
  const query = getOption(interaction, 'team');
  const { team, error } = await resolveTeam(env, query);
  if (error) return error;

  const data = await fetchRoster(env, team.id);
  const groups = data.groups || [];

  // Starters live in groups where group.group === 'START'
  const starterSlots = groups
    .filter((g) => g.group === 'START')
    .flatMap((g) => g.slots || [])
    .filter((slot) => !isBlockedPositionLabel(slot.position?.label));

  if (starterSlots.length === 0) {
    return {
      embeds: [createEmbed({
        title: `👥 ${team.name} — Starters`,
        description: 'No starter slots found for this team.',
        color: COLORS.purple,
      })],
    };
  }

  const isEmpty = starterSlots.every((s) => !s.leaguePlayer);

  const lines = starterSlots.map((slot) => {
    const slotLabel = slot.position?.label || '?';
    if (!slot.leaguePlayer) return `**${slotLabel}** — *(Empty)*`;

    const pp = slot.leaguePlayer.proPlayer || {};
    const name = pp.nameFull || 'Unknown';
    const pos = pp.position || '?';
    const nflTeam = pp.proTeamAbbreviation || '—';
    const injury = pp.injury ? ` ⚠️ ${pp.injury.severity}` : '';
    return `**${slotLabel}** — ${name} (${pos}, ${nflTeam})${injury}`;
  });

  if (isEmpty) {
    lines.push('\n*Rosters will populate after the startup draft.*');
  }

  return {
    embeds: [createEmbed({
      title: `👥 ${team.name} — Starters`,
      description: lines.join('\n'),
      color: COLORS.purple,
    })],
  };
}
