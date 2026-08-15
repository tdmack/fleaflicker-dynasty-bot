// Transaction feed — polls FetchLeagueTransactions on the 15-minute cron and
// posts new waiver claims / adds / drops, per the TRANSACTION_FEED var:
//   off (default) | waivers (claims only) | all (claims + adds + drops)
// Trades are excluded — tradeAlerts.js owns those. Same KV snapshot-dedup
// semantics as trades:seen (see the comment atop tradeAlerts.js), scoped per
// mode: switching TRANSACTION_FEED to a mode with no snapshot yet re-seeds
// silently, but switching BACK to a mode within its snapshot's 24h TTL finds
// the stale snapshot and posts interim activity as catch-up (self-correcting,
// rare).
// Unlike tradeAlerts' one-message-per-item, transactions are batched into
// chunked embeds — waiver day can produce a burst — with per-chunk retry
// granularity on post failure.
//
// KV writes: the snapshot is only written when it actually changes, which
// keeps a quiet league near zero writes against the free plan's 1,000/day.
// The write is also what refreshes the 24h TTL, so a mode that is enabled but
// sees zero transaction changes for 24h lets its key expire and re-seeds on
// the next tick. Seeding never posts, so a transaction that lands in the
// window between that expiry and the next tick (≤15 min) is absorbed into the
// new snapshot instead of being announced. That is rare and bounded — it takes
// a full day of silence followed by activity inside one cron gap — and the TTL
// is worth keeping because it garbage-collects the keys of dormant modes.

import { fetchLeagueTransactions } from '../services/fleaflicker.js';
import { createEmbed, COLORS, formatTimestamp, truncate } from '../utils/formatters.js';
import { txKind, formatSimpleTransaction } from '../utils/transactions.js';
import { postChannelMessage } from '../lib/discord.js';

const FEED_KINDS = { waivers: ['claim'], all: ['claim', 'add', 'drop'] };
const MAX_CHUNK_CHARS = 3900;
const KV_TTL_SECONDS = 86400;

/** Normalize a TRANSACTION_FEED value for both mode lookup and the KV key. */
function normalizeMode(mode) {
  return (mode || '').trim().toLowerCase();
}

/** Kinds to include for a TRANSACTION_FEED mode, or null when the feed is off. */
export function feedKindsFor(mode) {
  const m = normalizeMode(mode);
  const kinds = FEED_KINDS[m];
  if (kinds) return [...kinds]; // copy — callers must not mutate the module constant
  if (m && m !== 'off') {
    console.warn(
      `[TxFeed] Unknown TRANSACTION_FEED value "${mode}" — feed disabled. Use off | waivers | all.`
    );
  }
  return null;
}

/** Stable dedup key for a FetchLeagueTransactions item. */
export function txFeedKey(item) {
  const tx = item.transaction || {};
  const player = tx.player?.proPlayer?.id ?? tx.player?.proPlayer?.nameFull ?? '';
  return `${item.timeEpochMilli}:${tx.type}:${tx.team?.id ?? ''}:${player}`;
}

/**
 * @param {object} env
 * @param {object} [deps] — injectable fetch/post for tests; production omits
 *   this and uses the real Fleaflicker fetch and Discord post.
 */
export async function runTransactionFeed(env, {
  fetchTransactions = fetchLeagueTransactions,
  post = postChannelMessage,
} = {}) {
  const kinds = feedKindsFor(env.TRANSACTION_FEED);
  const channelId = env.DISCORD_TRADE_CHANNEL_ID;
  if (!kinds || !channelId) return; // feature off

  const kvKey = `txfeed:seen:${normalizeMode(env.TRANSACTION_FEED)}`;

  let data;
  try {
    data = await fetchTransactions(env);
  } catch (err) {
    console.error('[TxFeed] Fleaflicker fetch failed:', err.message);
    return; // outage → skip this tick
  }

  const relevant = (data.items || []).filter(
    (item) => kinds.includes(txKind(item.transaction?.type))
  );

  const seenRaw = await env.BOT_KV.get(kvKey, 'json');

  // First run (including the first tick after a mode change, since the key
  // is mode-scoped): seed without posting so we don't spam history.
  if (!Array.isArray(seenRaw)) {
    await env.BOT_KV.put(kvKey, JSON.stringify([...new Set(relevant.map(txFeedKey))]), {
      expirationTtl: KV_TTL_SECONDS,
    });
    console.log(`[TxFeed] Seeded ${relevant.length} existing transactions, no alerts sent`);
    return;
  }

  const seen = new Set(seenRaw);
  const fresh = relevant.filter((item) => !seen.has(txFeedKey(item)));

  const postedKeys = new Set();

  if (fresh.length > 0) {
    const entries = fresh.map((item) => {
      const tx = item.transaction || {};
      // FEED_KINDS only ever contains kinds with entries in KIND_FORMAT, so
      // formatSimpleTransaction can't return null for these items.
      const line = formatSimpleTransaction(
        txKind(tx.type), tx.team?.name, tx.player?.proPlayer?.nameFull || ''
      );
      // Cap a single line so one pathological name/timestamp can never alone
      // exceed a chunk and 400 the post (which would break the retry loop
      // on the very first chunk, every tick, forever).
      return {
        key: txFeedKey(item),
        line: truncate(`• ${line} — *${formatTimestamp(Number(item.timeEpochMilli) / 1000)}*`, MAX_CHUNK_CHARS),
      };
    });

    const chunks = chunkEntries(entries, MAX_CHUNK_CHARS);

    for (const chunk of chunks) {
      const embed = createEmbed({
        title: '🔄 Transaction Alert',
        description: chunk.map((e) => e.line).join('\n'),
        color: COLORS.cyan,
        footer: 'Automated transaction feed',
      });
      try {
        await post(env, channelId, { embeds: [embed] });
        for (const e of chunk) postedKeys.add(e.key);
      } catch (err) {
        console.error('[TxFeed] Failed to post:', err.message);
        break; // remaining chunks retry next tick
      }
    }
  }

  const next = [...new Set(relevant.map(txFeedKey))].filter(
    (k) => postedKeys.has(k) || seen.has(k)
  );

  // Skip the put when nothing changed — see the KV-write note in the header.
  const serialized = JSON.stringify(next);
  if (serialized !== JSON.stringify(seenRaw)) {
    await env.BOT_KV.put(kvKey, serialized, { expirationTtl: KV_TTL_SECONDS });
  }
}

/** Greedily pack entries into chunks whose joined lines stay <= maxChars. */
function chunkEntries(entries, maxChars) {
  const chunks = [];
  let current = [];
  let currentLen = 0;
  for (const entry of entries) {
    const joinedLen = current.length === 0 ? entry.line.length : currentLen + 1 + entry.line.length;
    if (current.length > 0 && joinedLen > maxChars) {
      chunks.push(current);
      current = [entry];
      currentLen = entry.line.length;
    } else {
      current.push(entry);
      currentLen = joinedLen;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
