// Fleaflicker Discord Bot v5 — Cloudflare Worker entry point.
//
// fetch:     Discord interactions endpoint (slash commands over HTTPS).
//            Every command is ACKed with a deferred response immediately,
//            then resolved in the background via ctx.waitUntil — no 3s limit.
// scheduled: cron jobs (trade alerts every 15 min; weekly posts daily).

import { verifyDiscordRequest } from './lib/verify.js';
import { editOriginal } from './lib/discord.js';
import { getOption } from './lib/options.js';
import { errorEmbed } from './utils/formatters.js';
import { commands } from './commands/index.js';
import { runTradeAlerts } from './jobs/tradeAlerts.js';
import { runTransactionFeed } from './jobs/transactionFeed.js';
import { runWeekly } from './jobs/weekly.js';
import { runPlayersToMonitor } from './jobs/playersToMonitor.js';
import { ensureDraftMonitorAlarm } from './lib/draftMonitorClient.js';

// Durable Object class must be exported from the Worker entry point.
export { DraftMonitor } from './do/draftMonitor.js';

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 };
const ResponseType = { PONG: 1, CHANNEL_MESSAGE: 4, DEFERRED_CHANNEL_MESSAGE: 5 };
const EPHEMERAL = 64;

// Per-user cooldown. Kept in isolate memory (like v4's process Map): a KV
// round-trip is slower than the 5s window is worth, KV's eventual consistency
// can't enforce it anyway, and a best-effort courtesy throttle doesn't need
// durable storage. Repeat requests usually hit a warm isolate at the same edge.
const COOLDOWN_MS = 5000;
const cooldowns = new Map();

function checkCooldown(userId) {
  const now = Date.now();
  const remaining = COOLDOWN_MS - (now - (cooldowns.get(userId) || 0));
  if (remaining > 0) return remaining;
  cooldowns.set(userId, now);
  if (cooldowns.size > 500) {
    for (const [id, at] of cooldowns) {
      if (now - at > COOLDOWN_MS) cooldowns.delete(id);
    }
  }
  return 0;
}

function json(payload) {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function runCommand(command, interaction, env) {
  let payload;
  try {
    payload = await command.execute(interaction, env);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error in /${interaction.data.name}:`, err.message);
    // Errors flagged `safe` (see services/fleaflicker.js) carry a message
    // written for users — show it instead of the generic fallback.
    payload = { embeds: [errorEmbed(err.safe ? err.message : 'Something went wrong. Please try again.')] };
  }
  try {
    await editOriginal(interaction, payload);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Failed to edit reply for /${interaction.data.name}:`, err.message);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Fleaflicker Dynasty Bot is running.', { status: 200 });
    }

    const bodyText = await request.text();
    const valid = await verifyDiscordRequest(request, bodyText, env.DISCORD_PUBLIC_KEY);
    if (!valid) {
      return new Response('invalid request signature', { status: 401 });
    }

    const interaction = JSON.parse(bodyText);

    if (interaction.type === InteractionType.PING) {
      return json({ type: ResponseType.PONG });
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const command = commands[interaction.data?.name];
      if (!command) {
        return json({
          type: ResponseType.CHANNEL_MESSAGE,
          data: { content: 'Unknown command.', flags: EPHEMERAL },
        });
      }

      // Rate limit: 5 seconds per user across all commands (best-effort)
      const userId = interaction.member?.user?.id || interaction.user?.id;
      if (userId) {
        const remaining = checkCooldown(userId);
        if (remaining > 0) {
          return json({
            type: ResponseType.CHANNEL_MESSAGE,
            data: {
              content: `Please wait **${Math.ceil(remaining / 1000)}s** before using another command.`,
              flags: EPHEMERAL,
            },
          });
        }
      }

      const isPublic = getOption(interaction, 'public') ?? false;
      ctx.waitUntil(runCommand(command, interaction, env));
      return json({
        type: ResponseType.DEFERRED_CHANNEL_MESSAGE,
        data: { flags: isPublic ? 0 : EPHEMERAL },
      });
    }

    return json({
      type: ResponseType.CHANNEL_MESSAGE,
      data: { content: 'Unsupported interaction.', flags: EPHEMERAL },
    });
  },

  async scheduled(event, env, ctx) {
    // These strings must match the [triggers] crons in wrangler.toml exactly —
    // an unknown cron logs instead of silently running the wrong job.
    if (event.cron === '*/15 * * * *') {
      // Sequential: both post to the trade channel, and a feed chunk landing
      // between a trade embed and its follow-up poll would orphan the poll.
      // runTradeAlerts can reject (its KV get/put calls aren't try/caught),
      // so run the feed either way rather than a plain .then().
      ctx.waitUntil(runTradeAlerts(env).then(() => runTransactionFeed(env), () => runTransactionFeed(env)));
      // Supervisor: heals the DraftMonitor's alarm chain if it died mid-draft
      // (no-op while disarmed).
      ctx.waitUntil(ensureDraftMonitorAlarm(env));
    } else if (event.cron === '0 13 * * *') {
      ctx.waitUntil(runWeekly(env));
    } else if (event.cron === '0 15 * * thu,sun') {
      ctx.waitUntil(runPlayersToMonitor(env));
    } else {
      console.error(`[Cron] Unknown cron "${event.cron}" — update the dispatch in src/index.js to match wrangler.toml`);
    }
  },
};
