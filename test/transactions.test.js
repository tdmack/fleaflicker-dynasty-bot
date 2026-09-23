import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTxType, txKind } from '../src/utils/transactions.js';
import { txFeedKey, runTransactionFeed } from '../src/jobs/transactionFeed.js';
import { formatActivityItem } from '../src/commands/activity.js';

// Shape of a live instant free-agent pickup: Fleaflicker sends no `type` key.
const typelessAdd = () => ({
  timeEpochMilli: '1789927190000',
  transaction: {
    player: { proPlayer: { id: 16246, nameFull: 'Najee Harris', position: 'RB' } },
    team: { id: 1001, name: 'Team A' },
  },
});

test('resolveTxType maps a type-less, add-shaped item to TRANSACTION_ADD', () => {
  assert.equal(resolveTxType(typelessAdd().transaction), 'TRANSACTION_ADD');
  assert.equal(txKind(typelessAdd().transaction), 'add');
});

test('resolveTxType passes an explicit type through unchanged', () => {
  for (const type of ['TRANSACTION_CLAIM', 'TRANSACTION_DROP', 'TRANSACTION_TRADE', 'TRANSACTION_ADD']) {
    assert.equal(resolveTxType({ ...typelessAdd().transaction, type }), type);
  }
  assert.equal(txKind({ type: 'TRANSACTION_CLAIM' }), 'claim');
  assert.equal(txKind({ type: 'TRANSACTION_DROP' }), 'drop');
  assert.equal(txKind({ type: 'TRANSACTION_TRADE' }), 'trade');
});

test('resolveTxType leaves type-less items that are not add-shaped unknown', () => {
  const base = typelessAdd().transaction;
  for (const key of ['tradeId', 'draftPick', 'draftedAtSlot', 'auctionDollarAmount', 'bidAmount']) {
    assert.equal(resolveTxType({ ...base, [key]: 1 }), null, key);
  }
  assert.equal(resolveTxType({ ...base, team: undefined }), null, 'no team');
  assert.equal(resolveTxType({ ...base, team: { name: 'No id' } }), null, 'team without id');
  assert.equal(resolveTxType({ ...base, player: {} }), null, 'no proPlayer');
  assert.equal(resolveTxType(undefined), null);
  assert.equal(txKind({ team: { id: 1 } }), 'other');
});

test('txFeedKey keys a type-less add as TRANSACTION_ADD', () => {
  assert.equal(txFeedKey(typelessAdd()), '1789927190000:TRANSACTION_ADD:1001:16246');
});

test('transaction feed announces a type-less free-agent add in "all" mode', async () => {
  const kv = new Map([['txfeed:seen:all', '[]']]);
  const env = {
    TRANSACTION_FEED: 'all',
    DISCORD_TRADE_CHANNEL_ID: 'chan',
    BOT_KV: {
      get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null),
      put: async (k, v) => { kv.set(k, v); },
    },
  };
  const posts = [];
  await runTransactionFeed(env, {
    fetchTransactions: async () => ({ items: [typelessAdd()] }),
    post: async (_env, _chan, body) => { posts.push(body); },
  });
  assert.equal(posts.length, 1);
  assert.match(posts[0].embeds[0].description, /\*\*Team A\*\* added \*\*Najee Harris\*\*/);
  assert.deepEqual(JSON.parse(kv.get('txfeed:seen:all')), ['1789927190000:TRANSACTION_ADD:1001:16246']);
});

test('/activity renders a type-less add as an add, not an unknown type', () => {
  assert.equal(formatActivityItem(typelessAdd()), '➕ **Team A** added **Najee Harris**');
});

test('/activity renders reserveChange with taxi as a taxi-squad move, not IR', () => {
  const change = (extra) => ({
    timeEpochMilli: '1778690470000',
    reserveChange: { player: { proPlayer: { nameFull: 'Some Rookie' } }, team: { id: 1, name: 'Team A' }, ...extra },
  });
  assert.equal(formatActivityItem(change({ taxi: true })), '🚕 **Team A** moved **Some Rookie** to the taxi squad');
  assert.equal(formatActivityItem(change({ taxi: true, removed: true })), '🚕 **Team A** promoted **Some Rookie** from the taxi squad');
  assert.equal(formatActivityItem(change({})), '🏥 **Team A** placed **Some Rookie** on IR');
  assert.equal(formatActivityItem(change({ removed: true })), '🏥 **Team A** activated **Some Rookie** from IR');
});
