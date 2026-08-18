import { getBlendedAssets, normalizeName } from '../services/blendedValues.js';
import { valuesFooter } from '../services/fantasycalc.js';
import { createEmbed, positionColor, truncate, COLORS } from '../utils/formatters.js';
import { getOption } from '../lib/options.js';
import { parsePickLabel, formatPickLabel } from '../utils/pickGrammar.js';

// Discord caps embed titles at 256 chars. The `player` option is capped at 100
// by the definition below, but truncate defensively anyway — an over-long title
// makes Discord reject the edit and strands the user on "thinking…".
const TITLE_QUERY_MAX = 80;

export const definition = {
  name: 'value',
  description: 'Dynasty trade values — 50/50 FantasyCalc + DynastyProcess blend',
  options: [
    { type: 3, name: 'player', description: 'Player name (partial OK) or pick like "2026 2nd" — omit for the top-20 board', required: false, max_length: 100 },
  ],
};

function trendNote(trend) {
  if (trend === null || trend === undefined || trend === 0) return '';
  const arrow = trend > 0 ? '📈 +' : '📉 ';
  return ` (${arrow}${trend} last 30d)`;
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');

function blendFooter(blend, env, anySingle) {
  const parts = [`FantasyCalc + DynastyProcess 50/50 • ${valuesFooter(env).split(' • ')[1]}`];
  if (!blend.sourcesUp.fantasycalc) parts.push('FantasyCalc unavailable');
  if (!blend.sourcesUp.dynastyprocess) parts.push('DynastyProcess unavailable');
  if (anySingle) parts.push('† single-source value');
  return parts.join(' • ');
}

/** Pure embed builder — exported for tests; execute() wires the fetch. */
export function buildValueEmbed(blend, query, env) {
  // Bare /value — top-20 board (players only; picks live in /tradecalc but
  // remain queryable below).
  if (!query) {
    const top = blend.players.slice(0, 20);
    const anySingle = top.some((p) => p.sources.length < 2);
    const lines = top.map((p, i) => {
      const dagger = p.sources.length < 2 ? '†' : '';
      return `**${i + 1}.** ${p.name} (${p.position}, ${p.team}) — **${fmt(p.value)}**${dagger}${trendNote(p.trend30Day)}`;
    });
    return createEmbed({
      title: '💎 Dynasty Top 20 — Trade Values',
      description: lines.join('\n'),
      color: COLORS.indigo,
      footer: blendFooter(blend, env, anySingle),
    });
  }

  const safeQuery = truncate(query, TITLE_QUERY_MAX);

  // Pick lookup — "2026 2nd", "2027 Early 1st", "2026 Pick 1.03"…
  const parsedPick = parsePickLabel(query);
  if (parsedPick) {
    const pick = blend.resolvePick(parsedPick);
    if (!pick) {
      return createEmbed({
        title: `💎 Value Lookup — ${safeQuery}`,
        description: `No pick value found for **${query}**. Values cover the next few draft classes.`,
        color: COLORS.grey,
      });
    }
    const approx = pick.approx ? '≈' : '';
    const dagger = pick.sources.length < 2 ? '†' : '';
    const footerExtra = pick.approx ? ' • ≈ Early/Late not priced that far out; round value used' : '';
    return createEmbed({
      title: `💎 ${formatPickLabel(parsedPick)}`,
      fields: [
        { name: 'Dynasty Value', value: `**${fmt(pick.value)}**${dagger}${approx}`, inline: false },
      ],
      color: COLORS.indigo,
      footer: blendFooter(blend, env, dagger !== '') + footerExtra,
    });
  }

  // Player lookup — exact normalized match wins, else case-insensitive partial.
  const norm = normalizeName(query);
  const exact = blend.players.filter((p) => p.norm === norm);
  const lower = query.trim().toLowerCase();
  const matches = exact.length > 0 ? exact : blend.players.filter((p) => p.name.toLowerCase().includes(lower));

  if (matches.length === 0) {
    return createEmbed({
      title: `💎 Value Lookup — ${safeQuery}`,
      description: `No player found matching **${query}**. Check spelling or try a partial name.`,
      color: COLORS.grey,
    });
  }

  if (matches.length > 1) {
    const list = matches.slice(0, 3).map((p, i) =>
      `${i + 1}. **${p.name}** (${p.position}, ${p.team}) — ${fmt(p.value)}`
    ).join('\n');
    return createEmbed({
      title: `💎 Multiple Players Found — "${safeQuery}"`,
      description: `Found ${matches.length} players. Showing top 3:\n\n${list}\n\nTry a more specific name.`,
      color: COLORS.grey,
    });
  }

  const p = matches[0];
  const overallRank = blend.players.indexOf(p) + 1;
  const positionRank = blend.players.filter((x) => x.position === p.position).indexOf(p) + 1;
  const dagger = p.sources.length < 2 ? '†' : '';
  const fields = [
    { name: 'Dynasty Value', value: `**${fmt(p.value)}**${dagger}${trendNote(p.trend30Day)}`, inline: false },
    { name: 'Overall Rank', value: `#${overallRank}`, inline: true },
    { name: 'Position Rank', value: `${p.position}${positionRank}`, inline: true },
  ];

  return createEmbed({
    title: `💎 ${p.name} (${p.position}, ${p.team})`,
    fields,
    color: positionColor(p.position),
    footer: blendFooter(blend, env, dagger !== ''),
  });
}

export async function execute(interaction, env) {
  let blend;
  try {
    blend = await getBlendedAssets(env);
  } catch (err) {
    console.error('[value] value sources unavailable:', err);
    return { embeds: [createEmbed({
      title: '💎 Dynasty Values',
      description: 'No value data available right now. Try again later.',
      color: COLORS.grey,
    })] };
  }
  return { embeds: [buildValueEmbed(blend, getOption(interaction, 'player'), env)] };
}
