// Discord REST helpers — the Worker never holds a gateway connection.

const API = 'https://discord.com/api/v10';

async function discordFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

/**
 * Edit the original (deferred) interaction response.
 * Uses the application_id carried in the interaction itself — authoritative,
 * and immune to a mistyped DISCORD_APPLICATION_ID secret.
 */
export async function editOriginal(interaction, payload) {
  const url = `${API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
  const options = {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };

  // A very fast command can PATCH before Discord has registered the deferred
  // ACK, which 404s. Retry once after a short pause instead of stranding the
  // user on "thinking…".
  const first = await fetch(url, options);
  if (first.ok) return first;
  if (first.status === 404) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return discordFetch(url, options);
  }
  const body = await first.text().catch(() => '');
  throw new Error(`Discord API ${first.status}: ${body.slice(0, 300)}`);
}

/** Post a message to a channel using the bot token (crons use this). */
export async function postChannelMessage(env, channelId, payload) {
  const url = `${API}/channels/${channelId}/messages`;
  return discordFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${env.DISCORD_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
}

/**
 * DM a user over plain REST: open (or re-open) the DM channel, then post to
 * it. Discord returns the same channel for repeat opens; we cache the id in
 * KV anyway to make the steady state one API call.
 * Fails with code 50007 when the user blocks server-member DMs — check with
 * isDmBlockedError and fall back to an @mention in a channel.
 */
export async function sendDirectMessage(env, userId, payload) {
  const cacheKey = `dm:channel:${userId}`;
  let channelId = await env.BOT_KV.get(cacheKey);
  if (!channelId) {
    const res = await discordFetch(`${API}/users/@me/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
      },
      body: JSON.stringify({ recipient_id: userId }),
    });
    const channel = await res.json();
    channelId = channel.id;
    await env.BOT_KV.put(cacheKey, channelId, { expirationTtl: 30 * 86400 });
  }
  return postChannelMessage(env, channelId, payload);
}

/** True when a DM failed because the recipient's privacy settings block it. */
export function isDmBlockedError(err) {
  return /50007/.test(err?.message || '');
}
