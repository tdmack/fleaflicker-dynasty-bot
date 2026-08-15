// Generates a REAL Week-in-Review (and preview) from a completed historical
// week and posts it to the alert channel. Lets the weekly-post format be seen
// and tuned before the live season provides data.
//
// Uses the previous completed season, since the current one may have no final
// weeks yet. Leagues that didn't exist that far back will get the "isn't fully
// final" notice — there's nothing useful to render in that case anyway.

import { fetchLeagueScoreboard } from '../services/fleaflicker.js';
import { createEmbed, COLORS } from '../utils/formatters.js';
import { postRecap, postPreview } from '../jobs/weekly.js';
import { getOption } from '../lib/options.js';
import { nflSeasonYear } from '../lib/season.js';

/** The most recent season that is certain to be complete. */
function defaultSeason() {
  return nflSeasonYear() - 1;
}

export const definition = {
  name: 'testweekly',
  description: 'Post a sample Week in Review to the alert channel using last season’s data',
  default_member_permissions: '32', // Manage Server — posts publicly to the alert channel
  options: [
    {
      type: 4, name: 'week', required: false,
      description: "Which week of last season's schedule to recap (default 1)",
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
  const season = defaultSeason();
  const scoreboard = await fetchLeagueScoreboard(env, week, season);
  const games = scoreboard.games || [];

  if (games.length === 0 || !games.every((g) => g.isFinalScore)) {
    return { embeds: [createEmbed({
      title: `⚠️ ${season} week ${week} isn't fully final`,
      description: 'Pick a completed regular-season week.',
      color: COLORS.orange,
    })] };
  }

  await postRecap(env, channelId, season, week, scoreboard, season);

  // Also demo the preview format with the following week's matchups
  const next = await fetchLeagueScoreboard(env, week + 1, season);
  if ((next.games || []).length > 0) {
    await postPreview(env, channelId, week + 1, next.games);
  }

  return { embeds: [createEmbed({
    title: '✅ Sample weekly posts sent',
    description: `Posted the ${season} week ${week} recap (and week ${week + 1} preview) to <#${channelId}>.\n\n*Test-data caveats: luck compares week-${week} all-play against final ${season} records (live posts always use as-of-now standings), the preview shows no projections (historical weeks don't carry them), and the transaction digest reflects the current league's last 7 days.*`,
    color: COLORS.green,
  })] };
}
