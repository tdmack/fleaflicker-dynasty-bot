// Generates a REAL Week-in-Review (and preview) from a completed historical
// week — the 2025 pre-reset season is still served under this league id — and
// posts it to the alert channel. Lets the weekly-post format be seen and
// tuned before the live season provides data.

import { fetchLeagueScoreboard } from '../services/fleaflicker.js';
import { createEmbed, COLORS } from '../utils/formatters.js';
import { postRecap, postPreview } from '../jobs/weekly.js';
import { getOption } from '../lib/options.js';

const DEFAULT_SEASON = 2025;

export const definition = {
  name: 'testweekly',
  description: 'Post a sample Week in Review to the alert channel using last season’s data',
  default_member_permissions: '32', // Manage Server — posts publicly to the alert channel
  options: [
    {
      type: 4, name: 'week', required: false,
      description: 'Which 2025 week to recap (default 1)',
      min_value: 1, max_value: 18,
    },
  ],
};

export async function execute(interaction, env) {
  const channelId = env.DISCORD_RECAP_CHANNEL_ID || env.DISCORD_TRADE_CHANNEL_ID;
  if (!channelId) {
    return { embeds: [createEmbed({
      title: '⚠️ No alert channel configured',
      description: 'Set `DISCORD_TRADE_CHANNEL_ID` in wrangler.toml and redeploy.',
      color: COLORS.orange,
    })] };
  }

  const week = getOption(interaction, 'week') || 1;
  const scoreboard = await fetchLeagueScoreboard(env, week, DEFAULT_SEASON);
  const games = scoreboard.games || [];

  if (games.length === 0 || !games.every((g) => g.isFinalScore)) {
    return { embeds: [createEmbed({
      title: `⚠️ ${DEFAULT_SEASON} week ${week} isn't fully final`,
      description: 'Pick a completed regular-season week.',
      color: COLORS.orange,
    })] };
  }

  await postRecap(env, channelId, DEFAULT_SEASON, week, scoreboard, DEFAULT_SEASON);

  // Also demo the preview format with the following week's matchups
  const next = await fetchLeagueScoreboard(env, week + 1, DEFAULT_SEASON);
  if ((next.games || []).length > 0) {
    await postPreview(env, channelId, week + 1, next.games);
  }

  return { embeds: [createEmbed({
    title: '✅ Sample weekly posts sent',
    description: `Posted the ${DEFAULT_SEASON} week ${week} recap (and week ${week + 1} preview) to <#${channelId}>.\n\n*Test-data caveats: luck compares week-${week} all-play against final ${DEFAULT_SEASON} records (live posts always use as-of-now standings), the preview shows no projections (historical weeks don't carry them), and the transaction digest reflects the current league's last 7 days.*`,
    color: COLORS.green,
  })] };
}
