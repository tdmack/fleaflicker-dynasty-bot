import { createEmbed, COLORS } from '../utils/formatters.js';
import { postChannelMessage } from '../lib/discord.js';

export const definition = {
  name: 'testalert',
  description: 'Post a test message to the alert channel (verifies the automated-post pipeline)',
  default_member_permissions: '32', // Manage Server — posts publicly to the alert channel
  options: [],
};

export async function execute(interaction, env) {
  const channelId = env.DISCORD_TRADE_CHANNEL_ID;
  if (!channelId) {
    return { embeds: [createEmbed({
      title: '⚠️ No alert channel configured',
      description: 'Set `DISCORD_TRADE_CHANNEL_ID` in wrangler.toml and redeploy.',
      color: COLORS.orange,
    })] };
  }

  await postChannelMessage(env, channelId, {
    embeds: [createEmbed({
      title: '✅ Test Alert',
      description: 'The automated-post pipeline works: this Worker can post to this channel using its bot token.\nTrade alerts and weekly posts will arrive here.',
      color: COLORS.green,
      footer: 'Requested via /testalert',
    })],
  });

  return { embeds: [createEmbed({
    title: '✅ Test alert sent',
    description: `Posted to <#${channelId}>. If you don't see it, check the bot's access to that channel.`,
    color: COLORS.green,
  })] };
}
