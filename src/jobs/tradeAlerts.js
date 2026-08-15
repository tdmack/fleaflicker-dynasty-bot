// Trade alerts — polls FetchTrades every 15 minutes and posts new trades to
// the trade channel. KV `trades:seen` stores the keys of the trades present
// in the LAST poll (a snapshot, not a capped log — a trade that leaves the
// API response never comes back, so nothing needs long-term retention).
// A key is `<tradeId>:<status>`, so a pending trade that later completes
// alerts a second time (as an executed trade).
// Completed trades optionally get a follow-up poll message when TRADE_POLLS=on;
// poll failures are best-effort and never retried.

import { fetchTrades as fetchFleaflickerTrades } from '../services/fleaflicker.js';
import { createEmbed, COLORS } from '../utils/formatters.js';
import { buildTradeField, buildTradePoll } from '../utils/trades.js';
import { postChannelMessage } from '../lib/discord.js';

const KV_KEY = 'trades:seen';

/**
 * @param {object} env
 * @param {object} [deps] — injectable fetch/post for tests; production omits
 *   this and uses the real Fleaflicker fetch and Discord post.
 */
export async function runTradeAlerts(env, {
  fetchTrades = fetchFleaflickerTrades,
  post = postChannelMessage,
} = {}) {
  const channelId = env.DISCORD_TRADE_CHANNEL_ID;
  if (!channelId) return; // feature off until the channel is configured

  let completed;
  let pending;
  try {
    [completed, pending] = await Promise.all([
      fetchTrades(env, 'completed'),
      fetchTrades(env, 'pending'),
    ]);
  } catch (err) {
    // Outage → skip this tick; never post partial data
    console.error('[TradeAlerts] Fleaflicker fetch failed:', err.message);
    return;
  }

  const current = [
    ...(completed.trades || []).map((t) => ({ trade: t, status: 'completed' })),
    ...(pending.trades || []).map((t) => ({ trade: t, status: 'pending' })),
  ].filter((e) => e.trade.id);

  const seenRaw = await env.BOT_KV.get(KV_KEY, 'json');

  // First run: seed without posting so we don't spam historical trades
  if (!Array.isArray(seenRaw)) {
    await env.BOT_KV.put(KV_KEY, JSON.stringify(current.map(keyOf)));
    console.log(`[TradeAlerts] Seeded ${current.length} existing trades, no alerts sent`);
    return;
  }

  const seen = new Set(seenRaw);
  const alerted = new Set(seenRaw); // keys we've successfully posted (or seeded)

  for (const entry of current) {
    if (seen.has(keyOf(entry))) continue;
    const isPending = entry.status === 'pending';
    const embed = createEmbed({
      title: isPending ? '🔔 New Trade Pending Review' : '✅ Trade Executed',
      color: isPending ? COLORS.orange : COLORS.gold,
      fields: [buildTradeField(entry.trade)],
      footer: 'Automated trade alert',
    });
    try {
      await post(env, channelId, { embeds: [embed] });
      alerted.add(keyOf(entry));
      if (!isPending && (env.TRADE_POLLS || '').trim().toLowerCase() === 'on') {
        try {
          const poll = buildTradePoll(entry.trade);
          if (poll) {
            await post(env, channelId, { poll });
          }
        } catch (err) {
          // Poll is garnish — the trade alert already stands. Never retry.
          console.error(`[TradeAlerts] Poll failed for trade ${entry.trade.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error(`[TradeAlerts] Failed to post trade ${entry.trade.id}:`, err.message);
      // not recorded — retried next tick
    }
  }

  // Store only keys still present in the current response (bounded by API
  // page size), keeping any that failed to post out so they retry.
  const currentKeys = new Set(current.map(keyOf));
  const next = [...currentKeys].filter((k) => alerted.has(k));
  await env.BOT_KV.put(KV_KEY, JSON.stringify(next));
}

function keyOf(entry) {
  return `${entry.trade.id}:${entry.status}`;
}
