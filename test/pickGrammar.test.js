import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePickLabel, formatPickLabel, hintForSlot, pickHintKey, pickSlotKey } from '../src/utils/pickGrammar.js';

test('bare round defaults to Mid', () => {
  assert.deepEqual(parsePickLabel('2026 2nd'), { year: 2026, round: 2, hint: 'Mid', slot: null });
});

test('explicit hint forms parse', () => {
  assert.deepEqual(parsePickLabel('2026 Early 1st'), { year: 2026, round: 1, hint: 'Early', slot: null });
  assert.deepEqual(parsePickLabel('2027 1st (Late)'), { year: 2027, round: 1, hint: 'Late', slot: null });
  assert.deepEqual(parsePickLabel('2028 mid 3rd'), { year: 2028, round: 3, hint: 'Mid', slot: null });
});

test('slot forms parse and derive the hint', () => {
  assert.deepEqual(parsePickLabel('2026 Pick 1.03'), { year: 2026, round: 1, hint: 'Early', slot: 3 });
  assert.deepEqual(parsePickLabel('2026 1.07'), { year: 2026, round: 1, hint: 'Mid', slot: 7 });
  assert.deepEqual(parsePickLabel('2026 Pick 2.12'), { year: 2026, round: 2, hint: 'Late', slot: 12 });
});

test('non-pick strings return null', () => {
  assert.equal(parsePickLabel('Breece Hall'), null);
  assert.equal(parsePickLabel('2026'), null);          // year but no round
  assert.equal(parsePickLabel('2nd'), null);           // round but no year
  assert.equal(parsePickLabel(''), null);
  assert.equal(parsePickLabel(null), null);
});

test('out-of-range slot returns null', () => {
  assert.equal(parsePickLabel('2026 Pick 1.13'), null); // 12-team league
  assert.equal(parsePickLabel('2026 Pick 1.00'), null);
});

test('hintForSlot buckets 1-4/5-8/9-12', () => {
  assert.equal(hintForSlot(1), 'Early');
  assert.equal(hintForSlot(4), 'Early');
  assert.equal(hintForSlot(5), 'Mid');
  assert.equal(hintForSlot(8), 'Mid');
  assert.equal(hintForSlot(9), 'Late');
  assert.equal(hintForSlot(12), 'Late');
  assert.equal(hintForSlot(13), null);
});

test('formatPickLabel round-trips both forms', () => {
  assert.equal(formatPickLabel({ year: 2026, round: 2, hint: 'Mid', slot: null }), '2026 Mid 2nd');
  assert.equal(formatPickLabel({ year: 2026, round: 1, hint: 'Early', slot: 3 }), '2026 Pick 1.03');
});

test('keys are stable', () => {
  assert.equal(pickHintKey({ year: 2026, round: 2, hint: 'Mid', slot: null }), '2026|2|Mid');
  assert.equal(pickSlotKey({ year: 2026, round: 1, hint: 'Early', slot: 3 }), '2026|1.3');
});
