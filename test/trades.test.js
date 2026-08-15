import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTradePoll } from '../src/utils/trades.js';

const trade = (names) => ({
  teams: names.map((name) => ({ team: { name } })),
});

test('buildTradePoll builds a 48h poll with both teams plus Fair deal', () => {
  const poll = buildTradePoll(trade(['Alpha', 'Beta']));
  assert.equal(poll.question.text, 'Who won this trade?');
  assert.deepEqual(
    poll.answers.map((a) => a.poll_media.text),
    ['Alpha', 'Beta', 'Fair deal']
  );
  assert.equal(poll.duration, 48);
  assert.equal(poll.allow_multiselect, false);
});

test('long team names are truncated to Discord\'s 55-char answer limit', () => {
  const long = 'x'.repeat(80);
  const poll = buildTradePoll(trade([long, 'Beta']));
  assert.equal(poll.answers[0].poll_media.text.length, 55);
});

test('returns null without two identifiable teams', () => {
  assert.equal(buildTradePoll(trade(['Solo'])), null);
  assert.equal(buildTradePoll({ teams: [] }), null);
  assert.equal(buildTradePoll({}), null);
});

test('caps at Discord\'s 10-answer maximum', () => {
  const poll = buildTradePoll(trade(Array.from({ length: 12 }, (_, i) => `T${i}`)));
  assert.equal(poll.answers.length, 10);
  assert.equal(poll.answers.at(-1).poll_media.text, 'Fair deal');
});

test('3-team trades include all teams plus Fair deal', () => {
  const poll = buildTradePoll(trade(['A', 'B', 'C']));
  assert.deepEqual(poll.answers.map((a) => a.poll_media.text), ['A', 'B', 'C', 'Fair deal']);
});
