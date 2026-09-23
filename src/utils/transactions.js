// Shared transaction classification and line formatting — used by
// /transactions, /activity, the transaction feed, and the weekly recap digest
// so the surfaces can't drift apart.

// Keys that mark a type-less item as something other than a free-agent add
// (bidAmount is what separates a waiver claim from an instant add).
const NON_ADD_KEYS = ['tradeId', 'draftPick', 'draftedAtSlot', 'auctionDollarAmount', 'bidAmount'];

/**
 * The Fleaflicker type string for a transaction, e.g. "TRANSACTION_CLAIM".
 *
 * Fleaflicker omits `type` entirely on an instant free-agent pickup
 * (TRANSACTION_ADD is the first value of its type enum, and it appears to
 * leave out a default enum value — inferred, not documented). Offseason
 * pickups all go through waivers as TRANSACTION_CLAIM, so these only show up
 * once free agency opens in-season. A type-less item is treated as an ADD only
 * when it looks like one; anything else stays unknown (null) rather than being
 * silently mislabelled.
 */
export function resolveTxType(tx) {
  if (!tx) return null;
  if (tx.type) return tx.type;
  const hasPlayer = Boolean(tx.player?.proPlayer);
  const hasTeam = tx.team?.id != null;
  if (hasPlayer && hasTeam && !NON_ADD_KEYS.some((k) => k in tx)) return 'TRANSACTION_ADD';
  return null;
}

/** Classify a Fleaflicker transaction object. */
export function txKind(tx) {
  const t = (resolveTxType(tx) || '').toUpperCase();
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
