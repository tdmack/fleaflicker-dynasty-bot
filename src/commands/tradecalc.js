import { getBlendedAssets, normalizeName } from '../services/blendedValues.js';
import { valuesFooter } from '../services/fantasycalc.js';
import { createEmbed, errorEmbed, COLORS } from '../utils/formatters.js';
import { getOption } from '../lib/options.js';
import { parsePickLabel, formatPickLabel } from '../utils/pickGrammar.js';
import { evaluateTrade } from '../utils/tradeMath.js';

const MAX_ASSETS_PER_SIDE = 10;

export const definition = {
  name: 'tradecalc',
  description: 'Evaluate a dynasty trade — 50/50 FantasyCalc + DynastyProcess values',
  options: [
    { type: 3, name: 'side1', description: 'Side 1 assets, comma-separated (e.g. Breece Hall, 2026 2nd)', required: true, max_length: 400 },
    { type: 3, name: 'side2', description: 'Side 2 assets, comma-separated', required: true, max_length: 400 },
  ],
};

// Resolve one side's raw string → { assets: [{label, value, sources}], errors: [string] }.
// Any unresolved token is an error — a verdict over a partial package is
// worse than no verdict, so we never silently drop an asset.
function resolveSide(raw, blend, sideName) {
  const tokens = String(raw ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const errors = [];
  const assets = [];
  if (tokens.length === 0) {
    return { assets, errors: [`${sideName} has no assets.`] };
  }
  if (tokens.length > MAX_ASSETS_PER_SIDE) {
    return { assets, errors: [`${sideName} has too many assets (max ${MAX_ASSETS_PER_SIDE} per side).`] };
  }
  for (const token of tokens) {
    const parsedPick = parsePickLabel(token);
    if (parsedPick) {
      const pick = blend.resolvePick(parsedPick);
      if (!pick) errors.push(`No pick value found for **${token}**.`);
      else assets.push({ label: formatPickLabel(parsedPick), value: pick.value, sources: pick.sources, approx: pick.approx });
      continue;
    }
    const norm = normalizeName(token);
    const exact = blend.players.filter((p) => p.norm === norm);
    const lower = token.toLowerCase();
    const matches = exact.length > 0 ? exact : blend.players.filter((p) => p.name.toLowerCase().includes(lower));
    if (matches.length === 0) {
      errors.push(`No player matching **${token}** — check the spelling or use more of the name.`);
    } else if (matches.length > 1) {
      const shown = matches.slice(0, 3).map((m) => `${m.name} (${m.position})`).join(', ');
      errors.push(`**${token}** is ambiguous: ${shown}${matches.length > 3 ? ', …' : ''}`);
    } else {
      const m = matches[0];
      assets.push({ label: `${m.name} (${m.position}, ${m.team})`, value: m.value, sources: m.sources });
    }
  }
  return { assets, errors };
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');

function sideField(name, adjusted, total) {
  const lines = adjusted.map((a) => {
    const dagger = a.sources.length < 2 ? '†' : '';
    const approx = a.approx ? '≈' : '';
    return `• ${a.label} — **${fmt(a.value)}**${dagger}${approx}`;
  });
  lines.push(`Adjusted total: **${fmt(total)}**`);
  return { name, value: lines.join('\n'), inline: false };
}

const VERDICTS = {
  fair: { line: () => '⚖️ **Fair Deal** — within 5%', color: COLORS.green },
  slight: { line: (s) => `↔️ **Slight Edge — Side ${s}**`, color: COLORS.gold },
  lopsided: { line: (s) => `🚨 **Lopsided — Side ${s} overpays**`, color: COLORS.red },
};

/** Pure embed builder — exported for tests; execute() wires the fetch. */
export function buildTradecalcEmbed(blend, side1Raw, side2Raw, env) {
  const side1 = resolveSide(side1Raw, blend, 'Side 1');
  const side2 = resolveSide(side2Raw, blend, 'Side 2');
  const errors = [...side1.errors, ...side2.errors];
  if (errors.length > 0) {
    return errorEmbed(`Couldn't evaluate the trade:\n${errors.map((e) => `- ${e}`).join('\n')}`);
  }

  const r = evaluateTrade(side1.assets, side2.assets);
  const verdict = VERDICTS[r.verdict];
  // r.stronger is always set for slight/lopsided (delta ≠ 0 there); the
  // fallback only decorates the dead-even fair case, whose line ignores it.
  const strongerLabel = r.stronger ?? (r.totalA >= r.totalB ? 1 : 2);

  const summaryLines = [
    `Net: **${fmt(Math.abs(r.delta))}** adjusted (${(r.deltaPct * 100).toFixed(1)}%) toward Side ${r.totalA >= r.totalB ? 1 : 2}`,
    `Verdict: ${verdict.line(strongerLabel)}`,
  ];

  const anySingle = [...r.adjustedA, ...r.adjustedB].some((a) => a.sources.length < 2);
  const footerParts = [`FantasyCalc + DynastyProcess 50/50 • ${valuesFooter(env).split(' • ')[1]}`];
  if (!blend.sourcesUp.fantasycalc) footerParts.push('FantasyCalc unavailable');
  if (!blend.sourcesUp.dynastyprocess) footerParts.push('DynastyProcess unavailable');
  if (anySingle) footerParts.push('† single-source value');
  const anyApprox = [...r.adjustedA, ...r.adjustedB].some((a) => a.approx);
  if (anyApprox) footerParts.push('≈ Early/Late not priced that far out; round value used');

  return createEmbed({
    title: '⚖️ Trade Calculator',
    fields: [
      sideField('Side 1', r.adjustedA, r.totalA),
      sideField('Side 2', r.adjustedB, r.totalB),
      { name: 'Result', value: summaryLines.join('\n'), inline: false },
    ],
    color: verdict.color,
    footer: footerParts.join(' • '),
  });
}

export async function execute(interaction, env) {
  let blend;
  try {
    blend = await getBlendedAssets(env);
  } catch (err) {
    console.error('[tradecalc] value sources unavailable:', err);
    return { embeds: [errorEmbed('Value data unavailable right now — both sources are unreachable. Try again later.')] };
  }
  const embed = buildTradecalcEmbed(blend, getOption(interaction, 'side1'), getOption(interaction, 'side2'), env);
  return { embeds: [embed] };
}
