import { fetchLeagueDraftBoard } from '../services/fleaflicker.js';
import { createEmbed, truncate, COLORS } from '../utils/formatters.js';
import { getOption } from '../lib/options.js';

const MAX_ROUNDS = 5;

export const definition = {
  name: 'draftboard',
  description: 'View the draft board (first 5 rounds shown)',
  options: [
    {
      type: 4, name: 'season', required: false,
      description: 'Season year (e.g. 2024) — defaults to most recent draft',
      min_value: 2010, max_value: 2099,
    },
  ],
};

export async function execute(interaction, env) {
  const season = getOption(interaction, 'season');

  const data = await fetchLeagueDraftBoard(env, season);

  const isPastDraft = Array.isArray(data.orderedSelections);
  const isFutureDraft = Array.isArray(data.rows);
  const draftSeason = data.season || season || 'Most Recent';

  // Past/completed draft — orderedSelections structure
  if (isPastDraft) {
    const selections = data.orderedSelections
      .filter((s) => (s.slot?.round ?? 0) <= MAX_ROUNDS)
      .sort((a, b) => (a.slot?.overall ?? 0) - (b.slot?.overall ?? 0));

    if (selections.length === 0) {
      return {
        embeds: [createEmbed({
          title: `📝 Draft Board — ${draftSeason}`,
          description: 'No draft picks found for this season.',
          color: COLORS.teal,
        })],
      };
    }

    // Group by round
    const byRound = {};
    for (const sel of selections) {
      const r = sel.slot?.round ?? '?';
      if (!byRound[r]) byRound[r] = [];
      byRound[r].push(sel);
    }

    const lines = [];
    for (const r of Object.keys(byRound).sort((a, b) => Number(a) - Number(b))) {
      lines.push(`**— Round ${r} —**`);
      for (const sel of byRound[r]) {
        const overall = sel.slot?.overall ?? '?';
        const teamName = sel.team?.name || '?';
        const playerName = sel.player?.proPlayer?.nameFull || '(Empty)';
        const pos = sel.player?.proPlayer?.position || '';
        const nflTeam = sel.player?.proPlayer?.proTeamAbbreviation || '';
        const posInfo = (pos || nflTeam) ? ` (${[pos, nflTeam].filter(Boolean).join(', ')})` : '';
        lines.push(`Pick ${overall} — **${teamName}**: ${playerName}${posInfo}`);
      }
    }

    const totalRounds = new Set(data.orderedSelections.map((s) => s.slot?.round)).size;
    const footer = totalRounds > MAX_ROUNDS
      ? `Rounds 1–${MAX_ROUNDS} of ${totalRounds} shown | Full board at fleaflicker.com`
      : `Rounds 1–${MAX_ROUNDS} shown | Full board at fleaflicker.com`;

    return {
      embeds: [createEmbed({
        title: `📝 Draft Board — ${draftSeason}`,
        description: truncate(lines.join('\n'), 4000),
        color: COLORS.teal,
        footer,
      })],
    };
  }

  // Future/in-progress draft — rows structure
  if (isFutureDraft) {
    if (data.rows.length === 0) {
      return {
        embeds: [createEmbed({
          title: `📝 Draft Board — ${draftSeason}`,
          description: 'The draft board will be available once the draft begins.',
          color: COLORS.teal,
        })],
      };
    }

    const lines = [];
    const displayRows = data.rows.slice(0, MAX_ROUNDS);
    for (const row of displayRows) {
      const roundNum = row.round || row.ordinal || '?';
      lines.push(`**— Round ${roundNum} —**`);
      const cells = [...(row.cells || row.picks || [])];
      cells.sort((a, b) => (a.slot?.slot ?? a.slot?.overall ?? 0) - (b.slot?.slot ?? b.slot?.overall ?? 0));
      for (const cell of cells) {
        lines.push(formatRowPick(roundNum, cell));
      }
    }

    const totalRounds = data.rows.length;
    const footer = totalRounds > MAX_ROUNDS
      ? `Rounds 1–${MAX_ROUNDS} of ${totalRounds} shown | Full board at fleaflicker.com`
      : `Rounds 1–${MAX_ROUNDS} shown | Full board at fleaflicker.com`;

    return {
      embeds: [createEmbed({
        title: `📝 Draft Board — ${draftSeason}`,
        description: truncate(lines.join('\n'), 4000),
        color: COLORS.teal,
        footer,
      })],
    };
  }

  // Neither structure found
  return {
    embeds: [createEmbed({
      title: '📝 Draft Board',
      description: 'No draft data found for this season.',
      color: COLORS.teal,
    })],
  };
}

function formatRowPick(roundNum, pick) {
  const slot = pick.slot?.overall ?? pick.overall ?? pick.pick ?? '?';
  const slotInRound = pick.slot?.slot ?? pick.slotNumber ?? slot;
  const playerName = pick.player?.proPlayer?.nameFull || pick.player?.nameFull || pick.player?.name || '(Empty)';
  const pos = pick.player?.proPlayer?.position || pick.player?.position || '';
  const nflTeam = pick.player?.proPlayer?.proTeamAbbreviation || pick.player?.nflTeam || '';
  const teamName = pick.owner?.name || pick.team?.name || '?';
  const isKeeper = pick.isKeeper ? ' 🔒' : '';
  const posInfo = (pos || nflTeam) ? ` (${[pos, nflTeam].filter(Boolean).join(', ')})` : '';
  return `**${roundNum}.${slotInRound}** — ${playerName}${posInfo} — *${teamName}*${isKeeper}`;
}
