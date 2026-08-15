import { fetchLeagueRules } from '../services/fleaflicker.js';
import { createEmbed, truncate, COLORS } from '../utils/formatters.js';
import { getOption } from '../lib/options.js';

// Exact starter slot labels this league uses — allowlist to avoid showing D/ST, IL, K, etc.
const ALLOWED_START_LABELS = new Set(['QB', 'RB', 'WR', 'RB/WR', 'TE', 'RB/WR/TE', 'QB/RB/WR/TE']);

// Scoring groups relevant to this league
const SHOW_SCORING_GROUPS = ['Passing', 'Rushing', 'Receiving', 'Misc'];

export const definition = {
  name: 'rules',
  description: 'League scoring and roster rules',
  options: [
    {
      type: 3, name: 'section', description: 'Which section to show', required: false,
      choices: [
        { name: 'Scoring', value: 'scoring' },
        { name: 'Roster', value: 'roster' },
      ],
    },
  ],
};

export async function execute(interaction, env) {
  const section = getOption(interaction, 'section') || 'both';
  const leagueId = env.FLEAFLICKER_LEAGUE_ID;

  const data = await fetchLeagueRules(env);

  const rosterText = section === 'scoring' ? '' : buildRosterSection(data);
  const scoringText = section === 'roster' ? '' : buildScoringSection(data);

  let description = '';
  if (rosterText) description += `**📋 Roster Slots**\n${rosterText}\n\n`;
  if (scoringText) description += `**🏈 Scoring Rules**\n${scoringText}`;

  if (!description.trim()) description = 'No rules data available.';

  const truncated = truncate(description.trim(), 3900);
  const finalDesc = truncated.endsWith('...')
    ? `${truncated}\n\n*[Full rules at fleaflicker.com/nfl/leagues/${leagueId}/rules]*`
    : truncated;

  return {
    embeds: [createEmbed({
      title: '📖 League Rules',
      description: finalDesc,
      color: COLORS.grey,
      url: `https://www.fleaflicker.com/nfl/leagues/${leagueId}/rules`,
    })],
  };
}

function buildRosterSection(data) {
  const rosterPositions = data.rosterPositions || [];
  if (rosterPositions.length === 0) return '_No roster slot data available._';

  const lines = rosterPositions
    .filter((pos) => {
      if (pos.group === 'INJURED' || pos.group === 'TAXI') return true;
      return pos.group === 'START' && ALLOWED_START_LABELS.has(pos.label || '');
    })
    .map((pos) => {
      const label = pos.label || '?';
      const count = pos.start || pos.max || 1;
      const groupNote = pos.group === 'INJURED' ? ' (IR)' : pos.group === 'TAXI' ? ' (Taxi)' : '';
      return `• ${label}${count > 1 ? ` ×${count}` : ''}${groupNote}`;
    });

  return lines.length > 0 ? lines.join('\n') : '_No eligible roster slots found._';
}

function buildScoringSection(data) {
  const groups = (data.groups || []).filter((g) => SHOW_SCORING_GROUPS.includes(g.label));
  if (groups.length === 0) return '_No scoring rule data available._';

  return groups
    .map((group) => {
      const rules = (group.scoringRules || []).map((rule) => `  • ${rule.description}`);
      return `**${group.label}**\n${rules.join('\n')}`;
    })
    .join('\n\n');
}
