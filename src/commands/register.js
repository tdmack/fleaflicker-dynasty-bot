import { getTeams, findTeams } from '../cache/teamCache.js';
import { getRegistrations, saveRegistrations } from '../lib/registrations.js';
import { sendDirectMessage, isDmBlockedError } from '../lib/discord.js';
import { createEmbed, COLORS } from '../utils/formatters.js';
import { getOption } from '../lib/options.js';

export const definition = {
  name: 'register',
  description: 'Link your Discord account to your Fleaflicker team for draft-turn DMs',
  options: [
    {
      type: 3, name: 'team', required: true,
      description: 'Your Fleaflicker team name (partial match OK)',
    },
  ],
};

export async function execute(interaction, env) {
  const query = getOption(interaction, 'team');
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) {
    return { embeds: [createEmbed({
      title: '❌ Registration failed',
      description: 'Could not identify your Discord user.',
      color: COLORS.red,
    })] };
  }

  const teams = await getTeams(env);
  const matches = findTeams(teams, query);

  if (matches.length === 0) {
    return { embeds: [createEmbed({
      title: '❓ No team matched',
      description: `No team matches **${query}**. League teams:\n${teams.map((t) => `• ${t.name}`).join('\n')}`,
      color: COLORS.orange,
    })] };
  }
  if (matches.length > 1) {
    return { embeds: [createEmbed({
      title: '❓ Multiple teams matched',
      description: `Be more specific — **${query}** matches:\n${matches.map((t) => `• ${t.name}`).join('\n')}`,
      color: COLORS.orange,
    })] };
  }

  const team = matches[0];
  const registrations = await getRegistrations(env);

  // One team per user: registering again moves you to the new team.
  for (const [teamId, reg] of Object.entries(registrations)) {
    if (reg.userId === userId && teamId !== team.id) delete registrations[teamId];
  }
  const takenBy = registrations[team.id]?.userId;
  const reassigned = takenBy && takenBy !== userId;
  registrations[team.id] = { userId, teamName: team.name, registeredAt: Date.now() };
  await saveRegistrations(env, registrations);

  // Surface blocked DMs now — at registration — not on draft night.
  let dmNote;
  try {
    await sendDirectMessage(env, userId, {
      content: `✅ You're registered as **${team.name}**. I'll DM you here when you're on the clock in a draft.`,
    });
    dmNote = '📬 Test DM sent — check your messages. You\'re all set.';
  } catch (err) {
    dmNote = isDmBlockedError(err)
      ? '⚠️ **I couldn\'t DM you.** Enable *Allow direct messages from server members* in this server\'s privacy settings, then run `/register` again. Until then you\'ll only get an @mention in the draft channel.'
      : `⚠️ Test DM failed (${err.message}). You'll still be @mentioned in the draft channel.`;
    console.error(`[Register] Test DM to ${userId} failed:`, err.message);
  }

  return { embeds: [createEmbed({
    title: '✅ Registered',
    description: `<@${userId}> ↔ **${team.name}**`
      + (reassigned ? `\n*(This team was previously linked to another user — replaced.)*` : '')
      + `\n\n${dmNote}`,
    color: COLORS.green,
    footer: 'Draft-turn alerts',
  })] };
}
