import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildValueEmbed } from '../src/commands/value.js';
import { assembleBlend } from '../src/services/blendedValues.js';

const FC = [
  { name: 'Josh Allen', position: 'QB', team: 'BUF', value: 10000, trend30Day: 140 },
  { name: 'Breece Hall', position: 'RB', team: 'NYJ', value: 5000, trend30Day: -220 },
  { name: 'Jaylen Warren', position: 'RB', team: 'PIT', value: 1500, trend30Day: 0 },
  { name: 'Jaylen Wright', position: 'RB', team: 'MIA', value: 1400, trend30Day: null },
  { name: '2026 1st', position: 'PICK', team: '—', value: 3000, trend30Day: null },
];
const DP = {
  players: [
    { name: 'Josh Allen', position: 'QB', team: 'BUF', value: 9000 },
    { name: 'Breece Hall', position: 'RB', team: 'NYJ', value: 4000 },
    { name: 'DP Only Guy', position: 'TE', team: 'FA', value: 8100 },
  ],
  picks: [{ year: 2026, round: 1, hint: 'Mid', slot: null, value: 2700 }],
};

const blend = () => assembleBlend(FC, DP);

test('bare query renders a top-20 board of players only, ranked by blended value', () => {
  const embed = buildValueEmbed(blend(), undefined, {});
  assert.match(embed.title, /Top 20/);
  assert.match(embed.description, /\*\*1\.\*\* Josh Allen/);
  assert.doesNotMatch(embed.description, /2026/); // no picks on the board
  assert.match(embed.footer.text, /FantasyCalc \+ DynastyProcess 50\/50/);
});

test('player card shows blended value, computed ranks, and FC trend', () => {
  const embed = buildValueEmbed(blend(), 'Breece Hall', {});
  assert.match(embed.title, /Breece Hall \(RB, NYJ\)/);
  const value = embed.fields.find((f) => f.name === 'Dynasty Value');
  const expected = Math.round(((5000 / 10000 + 4000 / 9000) / 2) * 10000);
  assert.match(value.value, new RegExp(`\\*\\*${expected.toLocaleString('en-US')}\\*\\*`));
  assert.match(value.value, /📉 -220 last 30d/);
  const overall = embed.fields.find((f) => f.name === 'Overall Rank');
  // Blended order: Allen 10000, DP Only Guy 9000 (single-source mean over
  // present sources), Hall 4722 → Hall is overall #3 but still RB1.
  assert.equal(overall.value, '#3');
  const pos = embed.fields.find((f) => f.name === 'Position Rank');
  assert.equal(pos.value, 'RB1');
});

test('single-source player carries the dagger and the footer explains it', () => {
  const embed = buildValueEmbed(blend(), 'DP Only Guy', {});
  const value = embed.fields.find((f) => f.name === 'Dynasty Value');
  assert.match(value.value, /†/);
  assert.match(embed.footer.text, /†/);
});

test('pick-label query resolves through the pick blend', () => {
  const embed = buildValueEmbed(blend(), '2026 1st', {});
  assert.match(embed.title, /2026 Mid 1st/);
  const expected = Math.round(((3000 / 10000 + 2700 / 9000) / 2) * 10000);
  const value = embed.fields.find((f) => f.name === 'Dynasty Value');
  assert.match(value.value, new RegExp(`\\*\\*${expected.toLocaleString('en-US')}\\*\\*`));
});

test('ambiguous query lists candidates; unknown query errors gently', () => {
  const multi = buildValueEmbed(blend(), 'Jaylen W', {});
  assert.match(multi.title, /Multiple Players Found/);
  assert.match(multi.description, /Jaylen Warren/);
  assert.match(multi.description, /Jaylen Wright/);
  const none = buildValueEmbed(blend(), 'Zzz Nobody', {});
  assert.match(none.description, /No player found matching/);
});
