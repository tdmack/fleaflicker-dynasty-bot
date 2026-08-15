// Shared transaction classification and line formatting — used by
// /transactions, /activity, and the weekly recap digest so the three
// surfaces can't drift apart.

/** Classify a Fleaflicker transaction type string. */
export function txKind(type) {
  const t = (type || '').toUpperCase();
  if (t === 'TRANSACTION_TRADE') return 'trade';
  if (t.includes('CLAIM')) return 'claim';
  if (t.includes('_ADD')) return 'add';
  if (t.includes('_DROP')) return 'drop';
  if (t.includes('RESERVE') || t.includes('IR')) return 'ir';
  return 'other';
}

const KIND_FORMAT = {
  add:   (team, player) => `➕ **${team}** added${player ? ` **${player}**` : ''}`,
  drop:  (team, player) => `➖ **${team}** dropped${player ? ` **${player}**` : ''}`,
  claim: (team, player) => `📋 **${team}** claimed${player ? ` **${player}**` : ''}`,
  ir:    (team, player) => `🏥 **${team}** IR move${player ? `: **${player}**` : ''}`,
};

/**
 * Format a non-trade transaction as a display line, or null for kinds the
 * caller should handle itself (trades) or skip (unknown).
 */
export function formatSimpleTransaction(kind, team, player) {
  const fmt = KIND_FORMAT[kind];
  return fmt ? fmt(team || '?', player) : null;
}
