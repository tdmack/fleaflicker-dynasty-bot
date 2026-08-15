import { getDynastyValues, valuesFooter } from '../services/fantasycalc.js';
import { createEmbed, positionColor, COLORS } from '../utils/formatters.js';
import { getOption } from '../lib/options.js';

export const definition = {
  name: 'value',
  description: 'Dynasty trade values (FantasyCalc)',
  options: [
    { type: 3, name: 'player', description: 'Player name (partial OK) — omit for the top-20 board', required: false },
  ],
};

function trendNote(trend) {
  if (trend === null || trend === undefined || trend === 0) return '';
  const arrow = trend > 0 ? '📈 +' : '📉 ';
  return ` (${arrow}${trend} last 30d)`;
}

export async function execute(interaction, env) {
  const query = getOption(interaction, 'player');
  const values = await getDynastyValues(env);

  if (values.length === 0) {
    return { embeds: [createEmbed({
      title: '💎 Dynasty Values',
      description: 'No value data available right now. Try again later.',
      color: COLORS.grey,
    })] };
  }

  // Bare /value — top-20 board
  if (!query) {
    const top = values.slice(0, 20);
    const lines = top.map((p, i) =>
      `**${i + 1}.** ${p.name} (${p.position}, ${p.team}) — **${p.value}**${trendNote(p.trend30Day)}`
    );
    return { embeds: [createEmbed({
      title: '💎 Dynasty Top 20 — Trade Values',
      description: lines.join('\n'),
      color: COLORS.indigo,
      footer: valuesFooter(env),
    })] };
  }

  // Player lookup — case-insensitive partial match
  const lower = query.trim().toLowerCase();
  const matches = values.filter((p) => p.name.toLowerCase().includes(lower));

  if (matches.length === 0) {
    return { embeds: [createEmbed({
      title: `💎 Value Lookup — ${query}`,
      description: `No player found matching **${query}**. Check spelling or try a partial name.`,
      color: COLORS.grey,
    })] };
  }

  if (matches.length > 1) {
    const list = matches.slice(0, 3).map((p, i) =>
      `${i + 1}. **${p.name}** (${p.position}, ${p.team}) — ${p.value}`
    ).join('\n');
    return { embeds: [createEmbed({
      title: `💎 Multiple Players Found — "${query}"`,
      description: `Found ${matches.length} players. Showing top 3:\n\n${list}\n\nTry a more specific name.`,
      color: COLORS.grey,
    })] };
  }

  const p = matches[0];
  const fields = [
    { name: 'Dynasty Value', value: `**${p.value}**${trendNote(p.trend30Day)}`, inline: false },
    { name: 'Overall Rank', value: p.overallRank ? `#${p.overallRank}` : '—', inline: true },
    { name: 'Position Rank', value: p.positionRank ? `${p.position}${p.positionRank}` : '—', inline: true },
  ];

  return { embeds: [createEmbed({
    title: `💎 ${p.name} (${p.position}, ${p.team})`,
    fields,
    color: positionColor(p.position),
    footer: valuesFooter(env),
  })] };
}
