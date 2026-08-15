import { fetchLeagueTransactions, fetchTrades } from '../services/fleaflicker.js';
import { createEmbed, COLORS, formatTimestamp } from '../utils/formatters.js';
import { buildTradeTeamsMap, tradeUrl } from '../utils/trades.js';
import { txKind, formatSimpleTransaction } from '../utils/transactions.js';
import { getOption } from '../lib/options.js';
import { resolveTeam } from '../lib/resolveTeam.js';

export const definition = {
  name: 'transactions',
  description: 'Recent waiver claims, adds, and drops',
  options: [
    { type: 3, name: 'team', description: 'Filter to a specific team (partial name OK)', required: false, max_length: 100 },
  ],
};

export async function execute(interaction, env) {
  const teamQuery = getOption(interaction, 'team');
  let teamId = null;
  let teamName = null;

  if (teamQuery) {
    const { team, error } = await resolveTeam(env, teamQuery);
    if (error) return error;
    teamId = team.id;
    teamName = team.name;
  }

  const [data, tradesData] = await Promise.all([
    fetchLeagueTransactions(env, teamId),
    fetchTrades(env, 'completed'),
  ]);
  const items = (data.items || []).slice(0, 10);

  if (items.length === 0) {
    return {
      embeds: [createEmbed({
        title: teamName ? `🔄 ${teamName} — Recent Transactions` : '🔄 Recent Transactions',
        description: 'No recent transactions found.',
        color: COLORS.cyan,
      })],
    };
  }

  // Build tradeId -> [teamName, ...] lookup so we can show the other party
  // even when one side received nothing (and has no TRANSACTION_TRADE item)
  const tradeTeamsMap = buildTradeTeamsMap(tradesData);

  const lines = items.map((item) => {
    const tx = item.transaction || {};
    const team = tx.team?.name || '?';
    const timestamp = formatTimestamp(Number(item.timeEpochMilli) / 1000);
    // Player lives at transaction.player.proPlayer.nameFull for adds/drops/claims
    const player = tx.player?.proPlayer?.nameFull || '';
    const kind = txKind(tx.type);

    if (kind === 'trade') {
      const pick = tx.draftPick;
      const url = tradeUrl(env, tx.tradeId);
      const tradeLink = url ? `([Trade #${tx.tradeId}](${url}))` : '';

      // Find the other party in the trade
      const allParties = url ? (tradeTeamsMap.get(String(tx.tradeId)) || []) : [];
      const otherTeam = allParties.find((n) => n !== team);
      const counterparty = otherTeam ? ` (w/ **${otherTeam}**)` : '';

      if (pick) {
        return `• 🔀 **${team}** received ${pick.season} Rd ${pick.round} Pick${counterparty} ${tradeLink} — *${timestamp}*`;
      }
      return `• 🔀 **${team}** received **${player || 'player'}**${counterparty} ${tradeLink} — *${timestamp}*`;
    }

    const line = formatSimpleTransaction(kind, team, player);
    if (line) return `• ${line} — *${timestamp}*`;
    return `• [${tx.type || 'unknown'}] **${team}** — *${timestamp}*`;
  });

  return {
    embeds: [createEmbed({
      title: teamName ? `🔄 ${teamName} — Recent Transactions` : '🔄 Recent Transactions',
      description: lines.join('\n'),
      color: COLORS.cyan,
      footer: 'Last 10 transactions',
    })],
  };
}
