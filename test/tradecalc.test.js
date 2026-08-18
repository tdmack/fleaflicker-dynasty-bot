import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTradecalcEmbed, definition } from '../src/commands/tradecalc.js';
import { assembleBlend } from '../src/services/blendedValues.js';

const FC = [
  { name: 'Josh Allen', position: 'QB', team: 'BUF', value: 10000 },
  { name: 'Breece Hall', position: 'RB', team: 'NYJ', value: 5000 },
  { name: 'Marvin Harrison Jr.', position: 'WR', team: 'ARI', value: 6000 },
  { name: 'Jaylen Warren', position: 'RB', team: 'PIT', value: 1500 },
  { name: 'Jaylen Wright', position: 'RB', team: 'MIA', value: 1400 },
  { name: '2026 2nd', position: 'PICK', team: '—', value: 2500 },
];
const DP = {
  players: [
    { name: 'Josh Allen', position: 'QB', team: 'BUF', value: 9000 },
    { name: 'Breece Hall', position: 'RB', team: 'NYJ', value: 4000 },
    { name: 'Marvin Harrison Jr', position: 'WR', team: 'ARI', value: 5500 },
  ],
  picks: [{ year: 2026, round: 2, hint: 'Mid', slot: null, value: 2250 }],
};

const blend = () => assembleBlend(FC, DP);

test('definition has required side1/side2 string options', () => {
  assert.equal(definition.name, 'tradecalc');
  assert.deepEqual(definition.options.map((o) => [o.name, o.type, o.required]), [
    ['side1', 3, true],
    ['side2', 3, true],
  ]);
});

test('happy path renders both sides, totals, and a verdict', () => {
  const embed = buildTradecalcEmbed(blend(), 'Breece Hall, 2026 2nd', 'Marvin Harrison Jr.', {});
  assert.equal(embed.title, '⚖️ Trade Calculator');
  const [side1, side2, summary] = embed.fields;
  assert.match(side1.name, /Side 1/);
  assert.match(side1.value, /Breece Hall \(RB, NYJ\)/);
  assert.match(side1.value, /2026 Mid 2nd/);
  assert.match(side1.value, /Adjusted total/);
  assert.match(side2.value, /Marvin Harrison Jr\. \(WR, ARI\)/);
  assert.match(summary.value, /Verdict/);
  assert.match(embed.footer.text, /FantasyCalc \+ DynastyProcess 50\/50/);
});

test('raw totals are shown alongside adjusted, with a why-adjust note', () => {
  const embed = buildTradecalcEmbed(blend(), 'Breece Hall, 2026 2nd', 'Marvin Harrison Jr.', {});
  const [side1, side2, summary] = embed.fields;
  // Raw total = sum of the displayed per-asset blended values.
  const hall = Math.round(((5000 / 10000 + 4000 / 9000) / 2) * 10000);
  const pick = Math.round(((2500 / 10000 + 2250 / 9000) / 2) * 10000);
  const rawRe = new RegExp(`Raw total: \\*\\*${(hall + pick).toLocaleString('en-US')}\\*\\*`);
  assert.match(side1.value, rawRe);
  assert.match(side2.value, /Raw total/);
  // Raw line comes before the adjusted line, and the note explains why.
  assert.ok(side1.value.indexOf('Raw total') < side1.value.indexOf('Adjusted total'));
  assert.match(summary.value, /Why adjust\?/);
});

test('a single-asset side shows equal raw and adjusted totals when it holds the top asset', () => {
  const embed = buildTradecalcEmbed(blend(), 'Josh Allen', 'Breece Hall', {});
  const [side1] = embed.fields;
  // Allen is t and v: adjustment is a no-op, so both totals match.
  const allen = 10000;
  assert.match(side1.value, new RegExp(`Raw total: \\*\\*${allen.toLocaleString('en-US')}\\*\\*`));
  assert.match(side1.value, new RegExp(`Adjusted total: \\*\\*${allen.toLocaleString('en-US')}\\*\\*`));
});

test('suffix-less input matches the suffixed player (harrison jr vs harrison)', () => {
  const embed = buildTradecalcEmbed(blend(), 'Marvin Harrison', 'Josh Allen', {});
  assert.match(embed.fields[0].value, /Marvin Harrison Jr\./);
});

test('unmatched player aborts with an error embed naming the token', () => {
  const embed = buildTradecalcEmbed(blend(), 'Breece Hall', 'Zzz Nobody', {});
  assert.equal(embed.title, '❌ Error');
  assert.match(embed.description, /Zzz Nobody/);
});

test('ambiguous partial aborts and lists candidates', () => {
  const embed = buildTradecalcEmbed(blend(), 'Jaylen W', 'Josh Allen', {});
  assert.equal(embed.title, '❌ Error');
  assert.match(embed.description, /Jaylen Warren/);
  assert.match(embed.description, /Jaylen Wright/);
});

test('empty side aborts', () => {
  const embed = buildTradecalcEmbed(blend(), '  ,  ', 'Josh Allen', {});
  assert.equal(embed.title, '❌ Error');
});

test('unknown pick aborts with the pick named', () => {
  const embed = buildTradecalcEmbed(blend(), '2031 5th', 'Josh Allen', {});
  assert.equal(embed.title, '❌ Error');
  assert.match(embed.description, /2031/);
});

test('more than 10 assets on a side aborts', () => {
  const eleven = Array(11).fill('Josh Allen').join(', ');
  const embed = buildTradecalcEmbed(blend(), eleven, 'Breece Hall', {});
  assert.equal(embed.title, '❌ Error');
  assert.match(embed.description, /max 10/);
});

test('single-source assets carry the dagger and footer explains it', () => {
  const fcOnly = assembleBlend(FC, null);
  const embed = buildTradecalcEmbed(fcOnly, 'Breece Hall', 'Marvin Harrison Jr.', {});
  assert.match(embed.fields[0].value, /†/);
  assert.match(embed.footer.text, /†/);
});

test('lopsided trade gets the red color and overpay wording', () => {
  const embed = buildTradecalcEmbed(blend(), 'Josh Allen', 'Jaylen Warren', {});
  assert.match(embed.fields[2].value, /Lopsided/);
  assert.match(embed.fields[2].value, /Side 1 overpays/);
});

test('hint fallback pick is marked ≈ and the footer explains it', () => {
  // 2028 is priced round-level only (Mid bucket); a Late request must
  // resolve via fallback, carry ≈, and keep the user's requested label.
  const fc2028 = [...FC, { name: '2028 2nd', position: 'PICK', team: '—', value: 1200 }];
  const embed = buildTradecalcEmbed(assembleBlend(fc2028, DP), '2028 Late 2nd', 'Josh Allen', {});
  assert.notEqual(embed.title, '❌ Error');
  assert.match(embed.fields[0].value, /2028 Late 2nd — \*\*[\d,]+\*\*[†]?≈/);
  assert.match(embed.footer.text, /≈/);
});
