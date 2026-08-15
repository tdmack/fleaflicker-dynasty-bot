// Arm/disarm the DraftMonitor Durable Object (admin-only). Arm this when a
// draft opens; it disarms itself when the board fills or after 48 idle hours.

import { getDraftMonitor } from '../lib/draftMonitorClient.js';
import { getRegistrations } from '../lib/registrations.js';
import { getTeams } from '../cache/teamCache.js';
import { createEmbed, COLORS, formatTimestamp } from '../utils/formatters.js';
import { getOption } from '../lib/options.js';

export const definition = {
  name: 'draftalerts',
  description: 'Arm or disarm draft-turn alerts (commissioner only)',
  default_member_permissions: '32', // Manage Server
  options: [
    {
      type: 3, name: 'action', required: true,
      description: 'What to do',
      choices: [
        { name: 'on — start watching the draft board', value: 'on' },
        { name: 'off — stop watching', value: 'off' },
        { name: 'status — monitor state and registrations', value: 'status' },
      ],
    },
    {
      type: 4, name: 'reminder_minutes', required: false,
      description: 'Re-DM the on-the-clock manager after this many minutes (default 30)',
      min_value: 5, max_value: 720,
    },
  ],
};

export async function execute(interaction, env) {
  const action = getOption(interaction, 'action');
  const monitor = getDraftMonitor(env);

  if (action === 'on') {
    const reminderMinutes = getOption(interaction, 'reminder_minutes');
    const status = await monitor.start({ reminderMinutes });
    const channelId = env.DISCORD_DRAFT_CHANNEL_ID || env.DISCORD_TRADE_CHANNEL_ID;
    return { embeds: [createEmbed({
      title: '🟢 Draft alerts armed',
      description: `Polling the draft board every 20 seconds.`
        + `\n• Updates post to ${channelId ? `<#${channelId}>` : '**no channel — set DISCORD_DRAFT_CHANNEL_ID**'}`
        + `\n• On-the-clock reminder after **${status.reminderMinutes} min**`
        + `\n• Auto-disarms when the draft completes or after 48 idle hours`
        + `\n\nManagers get DMs only if they've run \`/register\`.`,
      color: COLORS.green,
    })] };
  }

  if (action === 'off') {
    await monitor.stop();
    return { embeds: [createEmbed({
      title: '🔴 Draft alerts disarmed',
      description: 'The draft board is no longer being watched.',
      color: COLORS.red,
    })] };
  }

  // status
  const status = await monitor.status();
  const registrations = await getRegistrations(env);
  let teamLines;
  try {
    const teams = await getTeams(env);
    teamLines = teams.map((t) => {
      const reg = registrations[t.id];
      return reg ? `✅ ${t.name} — <@${reg.userId}>` : `▫️ ${t.name} — *unregistered*`;
    });
  } catch {
    teamLines = Object.values(registrations).map((r) => `✅ ${r.teamName} — <@${r.userId}>`);
  }

  return { embeds: [createEmbed({
    title: '📋 Draft alerts status',
    description: [
      status.enabled ? '🟢 **Armed** — watching the draft board' : '🔴 **Disarmed**',
      status.enabled && status.armedAt ? `• Armed since ${formatTimestamp(status.armedAt / 1000)}` : null,
      status.lastPickDesc ? `• Last seen on the clock: ${status.lastPickDesc}` : null,
      `• Reminder after ${status.reminderMinutes} min`,
      '',
      '**Registrations** (`/register` to link):',
      ...teamLines,
    ].filter((l) => l !== null).join('\n'),
    color: status.enabled ? COLORS.green : COLORS.grey,
  })] };
}
