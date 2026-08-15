// This league uses QB/RB/WR/TE/FLEX only — DEF and K never appear in any
// output, filter, or color map. Single source of truth for that rule.

const BLOCKED_POSITIONS = new Set(['DEF', 'DST', 'K', 'PK']);
const BLOCKED_LABEL_WORDS = ['DEFENSE', 'KICKER', 'D/ST'];

/** True for a player position value like 'K' or 'DEF'. */
export function isBlockedPosition(position) {
  return BLOCKED_POSITIONS.has((position || '').toUpperCase());
}

/** True for a roster/lineup slot label like 'K', 'D/ST', or 'Defense'. */
export function isBlockedPositionLabel(label) {
  const upper = (label || '').toUpperCase();
  if (BLOCKED_POSITIONS.has(upper)) return true;
  return BLOCKED_LABEL_WORDS.some((w) => upper.includes(w));
}
