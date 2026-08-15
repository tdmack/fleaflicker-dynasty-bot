// Draft-board parsing shared by /draftboard-adjacent features and the
// DraftMonitor poller. Fleaflicker serves two payload shapes:
//   - completed drafts:        data.orderedSelections (every entry has a player)
//   - future/in-progress:      data.rows -> cells, where empty cells are
//                              unmade picks and the current pick carries
//                              on_the_clock (JSON: onTheClock)
// The selections shape carries no empty-slot or draft-order info, so an
// in-progress draft served that way supports pick announcements but not
// on-the-clock detection — callers must handle currentPick === null.

/**
 * @returns {{
 *   shape: 'rows'|'selections'|'unknown',
 *   picksMade: Array<{round,slot,overall,teamId,teamName,playerName}>,
 *   currentPick: {round,slot,overall,teamId,teamName}|null,
 *   nextPick: {round,slot,overall,teamId,teamName}|null,
 *   complete: boolean|null,   // null = not determinable from this shape
 * }}
 */
export function parseDraftBoard(data) {
  if (Array.isArray(data?.rows) && data.rows.length > 0) {
    const cells = [];
    for (const row of data.rows) {
      const roundNum = row.round || row.ordinal || null;
      for (const cell of (row.cells || row.picks || [])) {
        cells.push({
          round: cell.slot?.round ?? roundNum,
          slot: cell.slot?.slot ?? null,
          overall: cell.slot?.overall ?? null,
          teamId: String(cell.team?.id ?? cell.owner?.id ?? ''),
          teamName: cell.team?.name || cell.owner?.name || '?',
          playerName: cell.player?.proPlayer?.nameFull || cell.player?.nameFull || null,
          onTheClock: cell.onTheClock === true,
        });
      }
    }
    cells.sort((a, b) => (a.overall ?? Infinity) - (b.overall ?? Infinity));
    const picksMade = cells.filter((c) => c.playerName);
    const unmade = cells.filter((c) => !c.playerName);
    // Trust the API's flag when present; otherwise the earliest unmade pick.
    const currentPick = unmade.find((c) => c.onTheClock) || unmade[0] || null;
    const nextPick = unmade.find((c) => c !== currentPick) || null;
    return { shape: 'rows', picksMade, currentPick, nextPick, complete: unmade.length === 0 };
  }

  if (Array.isArray(data?.orderedSelections)) {
    const picksMade = data.orderedSelections
      .filter((s) => s.player)
      .map((s) => ({
        round: s.slot?.round ?? null,
        slot: s.slot?.slot ?? null,
        overall: s.slot?.overall ?? null,
        teamId: String(s.team?.id ?? ''),
        teamName: s.team?.name || '?',
        playerName: s.player?.proPlayer?.nameFull || null,
      }))
      .sort((a, b) => (a.overall ?? Infinity) - (b.overall ?? Infinity));
    return { shape: 'selections', picksMade, currentPick: null, nextPick: null, complete: null };
  }

  return { shape: 'unknown', picksMade: [], currentPick: null, nextPick: null, complete: null };
}

/** "3.04"-style label, falling back to the overall pick number. */
export function pickLabel(pick) {
  if (pick?.round && pick?.slot) return `${pick.round}.${String(pick.slot).padStart(2, '0')}`;
  return `#${pick?.overall ?? '?'}`;
}
