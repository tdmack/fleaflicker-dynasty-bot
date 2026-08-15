import { fetchLeagueActivity, fetchTrades } from '../services/fleaflicker.js';
import { createEmbed, truncate, formatTimestamp } from '../utils/formatters.js';
import { buildTradeTeamsMap, tradeUrl } from '../utils/trades.js';
import { txKind, formatSimpleTransaction } from '../utils/transactions.js';

export const definition = {
  name: 'activity',
  description: 'Recent league activity feed (trades, adds, drops, and more)',
  options: [],
};

export async function execute(interaction, env) {
  // Fetch activity and completed trades in parallel.
  // FetchTrades always includes both sides of a trade even when one team received nothing,
  // which the activity feed omits (no TRANSACTION_TRADE item is generated for a team
  // that receives nothing). We use this as a fallback to fill in missing teams.
  const [data, tradesData] = await Promise.all([
    fetchLeagueActivity(env),
    fetchTrades(env, 'completed'),
  ]);
  const rawItems = data.items || data.activities || [];

  // Build tradeId -> [teamName, ...] lookup from completed trades
  const tradeTeamsMap = buildTradeTeamsMap(tradesData);

  if (rawItems.length === 0) {
    return {
      embeds: [createEmbed({
        title: '📰 League Activity Feed',
        description: 'No recent activity found.',
        color: 0x5865f2,
      })],
    };
  }

  // Group trade-related items by tradeId into a single summary entry.
  // commishPowers items with a tradeId are redundant and skipped.
  const tradeGroups = new Map(); // tradeId -> { teams: Set, timeEpochMilli, isNew }
  const otherItems = [];

  for (const item of rawItems) {
    const tradeId = item.trade?.tradeId
      || (item.transaction?.type === 'TRANSACTION_TRADE' ? item.transaction?.tradeId : null);

    if (tradeId) {
      if (!tradeGroups.has(tradeId)) {
        tradeGroups.set(tradeId, {
          teams: new Set(),
          timeEpochMilli: item.timeEpochMilli,
          isNew: item.isNew || false,
        });
      }
      const group = tradeGroups.get(tradeId);
      if (item.transaction?.team?.name) group.teams.add(item.transaction.team.name);
      if (item.isNew) group.isNew = true;
      // Keep the most recent timestamp for the group
      if (Number(item.timeEpochMilli) > Number(group.timeEpochMilli)) {
        group.timeEpochMilli = item.timeEpochMilli;
      }
    } else if (!item.commishPowers?.tradeId) {
      // Skip commishPowers that refer to a trade (already captured in the group above)
      otherItems.push(item);
    }
  }

  // Supplement any trade groups that are missing teams (one side received nothing)
  // using the completed trades lookup
  for (const [tradeId, group] of tradeGroups.entries()) {
    if (group.teams.size < 2) {
      const known = tradeTeamsMap.get(String(tradeId));
      if (known) known.forEach((name) => group.teams.add(name));
    }
  }

  // Convert grouped trades into synthetic display items
  const tradeItems = Array.from(tradeGroups.entries()).map(([tradeId, group]) => ({
    _tradeGroup: true,
    teams: Array.from(group.teams),
    tradeUrl: tradeUrl(env, tradeId),
    timeEpochMilli: group.timeEpochMilli,
    isNew: group.isNew,
  }));

  // Merge, sort newest-first, slice to 10
  const items = [...tradeItems, ...otherItems]
    .sort((a, b) => Number(b.timeEpochMilli) - Number(a.timeEpochMilli))
    .slice(0, 10);

  const lines = items.map((item) => {
    const isNew = item.isNew ? ' 🆕' : '';
    const timestamp = formatTimestamp(Number(item.timeEpochMilli) / 1000);
    const description = formatActivityItem(item);
    return `• ${description}${isNew} — *${timestamp}*`;
  });

  return {
    embeds: [createEmbed({
      title: '📰 League Activity Feed',
      description: truncate(lines.join('\n'), 4000),
      color: 0x5865f2,
      footer: 'Most recent 10 items',
    })],
  };
}

function formatActivityItem(item) {
  // Grouped trade summary
  if (item._tradeGroup) {
    const teams = item.teams.join(' ↔ ');
    const label = `Trade: ${teams || 'Unknown teams'}`;
    return item.tradeUrl ? `🔀 [${label}](${item.tradeUrl})` : `🔀 ${label}`;
  }

  // commishPowers without a tradeId: commissioner settings change or other league action
  if (item.commishPowers) {
    const desc = item.commishPowers.description;
    const name = item.commishPowers.commish?.name || 'Commissioner';
    return `⚙️ ${desc || `${name} made a league change`}`;
  }

  // IR / taxi-squad slot moves — { player, team, removed?: true } where
  // removed means the player came OFF the slot (shapes verified against
  // captured FetchLeagueActivity payloads)
  if (item.reserveChange) {
    const { player, team, removed } = item.reserveChange;
    const name = player?.proPlayer?.nameFull || 'a player';
    const verb = removed ? 'activated' : 'placed';
    const prep = removed ? 'from' : 'on';
    return `🏥 **${team?.name || '?'}** ${verb} **${name}** ${prep} IR`;
  }
  if (item.taxiChange) {
    const { player, team, removed } = item.taxiChange;
    const name = player?.proPlayer?.nameFull || 'a player';
    const verb = removed ? 'promoted' : 'moved';
    const prep = removed ? 'from' : 'to';
    return `🚕 **${team?.name || '?'}** ${verb} **${name}** ${prep} the taxi squad`;
  }

  // transaction: add, drop, claim (non-trade)
  if (item.transaction) {
    const team = item.transaction.team?.name || '';
    const player = item.transaction.proPlayer?.nameFull
      || item.transaction.proPlayer?.name
      || item.transaction.player?.proPlayer?.nameFull
      || '';

    const line = formatSimpleTransaction(txKind(item.transaction.type), team, player);
    if (line) return line;
    return `🔄 [${item.transaction.type}]${team ? ` — **${team}**` : ''}`;
  }

  // Unknown item shape — show keys for debugging
  const keys = Object.keys(item).filter((k) => k !== 'timeEpochMilli' && k !== 'isNew');
  return `[${keys.join(', ') || 'unknown item'}]`;
}
