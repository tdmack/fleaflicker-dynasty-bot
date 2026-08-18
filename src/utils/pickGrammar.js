// Rookie-pick label grammar shared by /tradecalc input, FantasyCalc pick
// entries ("2026 Pick 1.01", "2027 1st (Early)", "2026 1st"), and
// DynastyProcess pick rows. Canonical form is year + round +
// Early/Mid/Late hint; a bare round ("2026 2nd") means Mid, and slot
// forms (1.01-style) derive their hint from a 12-team league layout.

const ROUND_ORDINALS = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 };
const ORDINAL_BY_ROUND = ['', '1st', '2nd', '3rd', '4th', '5th'];
const HINTS = new Set(['early', 'mid', 'late']);

const TEAMS_PER_ROUND = 12;
const EARLY_LAST = 4;
const MID_LAST = 8;

/** 'Early' | 'Mid' | 'Late' for a within-round slot, or null out of range. */
export function hintForSlot(slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > TEAMS_PER_ROUND) return null;
  if (slot <= EARLY_LAST) return 'Early';
  if (slot <= MID_LAST) return 'Mid';
  return 'Late';
}

/**
 * Parse a pick label into { year, round, hint, slot } or null when the
 * string isn't a pick. slot is null unless the label used the 1.03 form.
 */
export function parsePickLabel(raw) {
  const text = String(raw ?? '').trim().toLowerCase().replace(/[()]/g, ' ');
  if (!text) return null;

  let year = null;
  let round = null;
  let hint = null;
  let slot = null;

  for (const token of text.split(/\s+/)) {
    if (year === null && /^(19|20)\d{2}$/.test(token)) { year = Number(token); continue; }
    if (round === null && ROUND_ORDINALS[token]) { round = ROUND_ORDINALS[token]; continue; }
    if (hint === null && HINTS.has(token)) { hint = token[0].toUpperCase() + token.slice(1); continue; }
    const slotMatch = round === null ? /^([1-5])\.(\d{1,2})$/.exec(token) : null;
    if (slotMatch) { round = Number(slotMatch[1]); slot = Number(slotMatch[2]); }
  }

  if (year === null || round === null) return null;
  if (slot !== null) {
    const slotHint = hintForSlot(slot);
    if (!slotHint) return null;
    hint = slotHint;
  }
  return { year, round, hint: hint ?? 'Mid', slot };
}

/** "2026 Mid 2nd" or "2026 Pick 1.03" for display. */
export function formatPickLabel({ year, round, hint, slot }) {
  if (slot !== null) return `${year} Pick ${round}.${String(slot).padStart(2, '0')}`;
  return `${year} ${hint} ${ORDINAL_BY_ROUND[round]}`;
}

/** Hint-level lookup key: "2026|2|Mid". */
export function pickHintKey({ year, round, hint }) {
  return `${year}|${round}|${hint}`;
}

/** Exact-slot lookup key: "2026|1.3". */
export function pickSlotKey({ year, round, slot }) {
  return `${year}|${round}.${slot}`;
}
