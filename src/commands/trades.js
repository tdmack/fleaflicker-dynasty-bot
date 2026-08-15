import { fetchTrades } from '../services/fleaflicker.js';
import { createEmbed, COLORS } from '../utils/formatters.js';
import { buildTradeField } from '../utils/trades.js';
import { getOption } from '../lib/options.js';

export const definition = {
  name: 'trades',
  description: 'View recent completed trades or trades pending review',
  options: [
    {
      type: 3, name: 'filter', description: 'Trade status filter (defaults to completed)', required: false,
      choices: [
        { name: 'Completed', value: 'completed' },
        { name: 'Pending Review', value: 'pending' },
      ],
    },
  ],
};

export async function execute(interaction, env) {
  const filter = getOption(interaction, 'filter') || 'completed';

  const data = await fetchTrades(env, filter);
  const trades = (data.trades || []).slice(0, 5);
  const isPending = filter === 'pending';

  if (trades.length === 0) {
    const other = isPending ? 'completed' : 'pending';
    return {
      embeds: [createEmbed({
        title: isPending ? '🔀 Trades Pending Review' : '🔀 Recent Completed Trades',
        description: `No ${isPending ? 'pending' : 'completed'} trades found. Try \`/trades filter:${other}\` to check the other status.`,
        color: COLORS.gold,
      })],
    };
  }

  const fields = trades.map((trade, i) => buildTradeField(trade, i));

  return {
    embeds: [createEmbed({
      title: isPending ? '🔀 Trades Pending Review' : '🔀 Recent Completed Trades',
      description: `Showing ${trades.length} trade${trades.length > 1 ? 's' : ''}.`,
      color: COLORS.gold,
      fields,
      footer: 'Run /trades again to refresh',
    })],
  };
}
