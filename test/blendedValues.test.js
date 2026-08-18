import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, assembleBlend, BLEND_SCALE } from '../src/services/blendedValues.js';
import { parsePickLabel } from '../src/utils/pickGrammar.js';

test('normalizeName strips punctuation and suffixes', () => {
  assert.equal(normalizeName("Ja'Marr Chase"), 'jamarr chase');
  assert.equal(normalizeName('Marvin Harrison Jr.'), 'marvin harrison');
  assert.equal(normalizeName('Kenneth Walker III'), 'kenneth walker');
  assert.equal(normalizeName('  A.J. Brown '), 'aj brown');
});

// FC raw list is what getDynastyValues returns: players + PICK entries mixed.
const FC = [
  { name: 'Josh Allen', position: 'QB', team: 'BUF', value: 10000, overallRank: 1, positionRank: 1, trend30Day: 0 },
  { name: 'Breece Hall', position: 'RB', team: 'NYJ', value: 5000, overallRank: 20, positionRank: 5, trend30Day: 0 },
  { name: 'FC Only Guy', position: 'WR', team: 'FA', value: 1000, overallRank: 200, positionRank: 90, trend30Day: 0 },
  { name: '2026 Pick 1.01', position: 'PICK', team: '—', value: 8000, overallRank: 5, positionRank: 1, trend30Day: 0 },
  { name: '2026 1st (Early)', position: 'PICK', team: '—', value: 7000, overallRank: 8, positionRank: 2, trend30Day: 0 },
  { name: '2026 2nd', position: 'PICK', team: '—', value: 2500, overallRank: 60, positionRank: 9, trend30Day: 0 },
];

const DP = {
  players: [
    { name: 'Josh Allen', position: 'QB', team: 'BUF', value: 9000 },
    { name: 'Breece Hall', position: 'RB', team: 'NYJ', value: 4000 },
    { name: 'DP Only Guy', position: 'TE', team: 'FA', value: 500 },
  ],
  picks: [
    { year: 2026, round: 1, hint: 'Early', slot: 1, value: 9000 },
    { year: 2026, round: 1, hint: 'Early', slot: 2, value: 8000 },
    { year: 2026, round: 2, hint: 'Mid', slot: null, value: 2250 },
  ],
};

test('players blend 50/50 after per-source max normalization', () => {
  const blend = assembleBlend(FC, DP);
  const allen = blend.players.find((p) => p.name === 'Josh Allen');
  // FC max 10000, DP max 9000 → both #1 → (1.0 + 1.0)/2 * 10000
  assert.equal(allen.value, BLEND_SCALE);
  assert.deepEqual(allen.sources, ['FantasyCalc', 'DynastyProcess']);
  const hall = blend.players.find((p) => p.name === 'Breece Hall');
  // (5000/10000 + 4000/9000)/2 * 10000 = (0.5 + 0.4444…)/2 * 10000 ≈ 4722
  assert.equal(hall.value, Math.round(((5000 / 10000 + 4000 / 9000) / 2) * BLEND_SCALE));
});

test('single-source players appear with one source listed', () => {
  const blend = assembleBlend(FC, DP);
  const fcOnly = blend.players.find((p) => p.name === 'FC Only Guy');
  assert.deepEqual(fcOnly.sources, ['FantasyCalc']);
  assert.equal(fcOnly.value, Math.round((1000 / 10000) * BLEND_SCALE));
  const dpOnly = blend.players.find((p) => p.name === 'DP Only Guy');
  assert.deepEqual(dpOnly.sources, ['DynastyProcess']);
});

test('players are sorted by blended value descending', () => {
  const blend = assembleBlend(FC, DP);
  const values = blend.players.map((p) => p.value);
  assert.deepEqual(values, [...values].sort((a, b) => b - a));
});

test('pick resolution prefers explicit hint entries over slot averages', () => {
  const blend = assembleBlend(FC, DP);
  const res = blend.resolvePick(parsePickLabel('2026 Early 1st'));
  // FC has explicit "2026 1st (Early)" = 7000 (preferred over slot avg 8000);
  // DP has only slots 1.01+1.02 → avg 8500.
  const expected = Math.round(((7000 / 10000 + 8500 / 9000) / 2) * BLEND_SCALE);
  assert.equal(res.value, expected);
  assert.deepEqual(res.sources, ['FantasyCalc', 'DynastyProcess']);
});

test('exact slot lookup wins when a source lists the slot', () => {
  const blend = assembleBlend(FC, DP);
  const res = blend.resolvePick(parsePickLabel('2026 Pick 1.01'));
  const expected = Math.round(((8000 / 10000 + 9000 / 9000) / 2) * BLEND_SCALE);
  assert.equal(res.value, expected);
});

test('slot request falls back to hint bucket when slot not listed', () => {
  const blend = assembleBlend(FC, DP);
  const res = blend.resolvePick(parsePickLabel('2026 Pick 1.02'));
  // FC: no 1.02 slot → Early bucket explicit 7000; DP: exact slot 8000.
  const expected = Math.round(((7000 / 10000 + 8000 / 9000) / 2) * BLEND_SCALE);
  assert.equal(res.value, expected);
});

test('unknown pick returns null', () => {
  const blend = assembleBlend(FC, DP);
  assert.equal(blend.resolvePick(parsePickLabel('2031 5th')), null);
});

test('one source down → everything single-source, sourcesUp reflects it', () => {
  const blend = assembleBlend(FC, null);
  assert.deepEqual(blend.sourcesUp, { fantasycalc: true, dynastyprocess: false });
  const allen = blend.players.find((p) => p.name === 'Josh Allen');
  assert.deepEqual(allen.sources, ['FantasyCalc']);
  assert.equal(allen.value, BLEND_SCALE);
  const pick = blend.resolvePick(parsePickLabel('2026 2nd'));
  assert.deepEqual(pick.sources, ['FantasyCalc']);
});
