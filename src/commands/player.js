import { fetchPlayerListing } from '../services/fleaflicker.js';
import { createEmbed, positionColor, truncate, COLORS } from '../utils/formatters.js';
import { getOption } from '../lib/options.js';

// Discord caps embed titles at 256 chars. The `name` option is capped at 100 by
// the definition below, but truncate defensively anyway — an over-long title
// makes Discord reject the edit and strands the user on "thinking…".
const TITLE_QUERY_MAX = 80;

export const definition = {
  name: 'player',
  description: 'Look up a player card with status, ownership, injury, and news',
  options: [
    { type: 3, name: 'name', description: 'Player name (partial OK)', required: true, max_length: 100 },
  ],
};

export async function execute(interaction, env) {
  const nameQuery = getOption(interaction, 'name');
  const safeQuery = truncate(nameQuery, TITLE_QUERY_MAX);

  const data = await fetchPlayerListing(env, { 'filter.query': nameQuery });
  const players = data.players || [];

  if (players.length === 0) {
    return {
      embeds: [createEmbed({
        title: `🔍 Player Lookup — ${safeQuery}`,
        description: `No player found matching **${nameQuery}**. Check spelling or try a partial name.`,
        color: COLORS.grey,
      })],
    };
  }

  // Multiple matches — show top 3
  if (players.length > 1) {
    const top3 = players.slice(0, 3);
    const list = top3.map((entry, i) => {
      const p = entry.proPlayer || {};
      const name = p.nameFull || 'Unknown';
      const pos = p.position || '?';
      const nflTeam = p.proTeamAbbreviation || '—';
      return `${i + 1}. **${name}** — ${pos}, ${nflTeam}`;
    }).join('\n');

    return {
      embeds: [createEmbed({
        title: `🔍 Multiple Players Found — "${safeQuery}"`,
        description: `Found ${players.length} players. Showing top 3:\n\n${list}\n\nTry a more specific name.`,
        color: COLORS.grey,
      })],
    };
  }

  // Single result — full player card
  const entry = players[0];
  const p = entry.proPlayer || {};
  const name = p.nameFull || 'Unknown';
  const pos = (p.position || '?').toUpperCase();
  const nflTeam = p.proTeamAbbreviation || '—';
  const avgPts = entry.seasonAverage?.formatted
    ?? entry.viewingActualPointsAverage?.formatted
    ?? '—';

  // Ownership
  const ownerTeam = entry.leaguePlayer?.owner?.name || entry.owner?.name;
  const ownership = ownerTeam ? `Owned by **${ownerTeam}**` : '**Free Agent**';

  // Injury
  const injury = p.injury;
  let injuryLine = '';
  if (injury) {
    injuryLine = `⚠️ **Injury:** ${injury.severity || ''}${injury.typeFull ? ` — ${injury.typeFull}` : ''}${injury.description ? `\n${injury.description}` : ''}`;
  }

  // News
  const newsItems = p.news || [];
  const latestNews = newsItems[0];
  let newsLine = '';
  if (latestNews) {
    const headline = latestNews.headline || latestNews.title || '';
    const analysis = latestNews.analysis || latestNews.summary || latestNews.body || '';
    newsLine = headline ? `📰 **${headline}**${analysis ? `\n${analysis}` : ''}` : '';
  }

  const fields = [
    { name: 'Position', value: pos, inline: true },
    { name: 'NFL Team', value: nflTeam, inline: true },
    { name: 'Season Avg', value: `${avgPts} pts`, inline: true },
    { name: 'Ownership', value: ownership, inline: false },
  ];

  if (injuryLine) fields.push({ name: 'Injury', value: injuryLine, inline: false });
  if (newsLine) fields.push({ name: 'Latest News', value: newsLine.slice(0, 1024), inline: false });

  return {
    embeds: [createEmbed({
      title: `🔍 ${name}`,
      color: positionColor(pos),
      fields,
      thumbnail: p.headshotUrl || null,
    })],
  };
}
