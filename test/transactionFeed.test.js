import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedKindsFor, txFeedKey, runTransactionFeed } from '../src/jobs/transactionFeed.js';

test('feedKindsFor maps modes to kinds', () => {
  assert.deepEqual(feedKindsFor('waivers'), ['claim']);
  assert.deepEqual(feedKindsFor('all'), ['claim', 'add', 'drop']);
  assert.equal(feedKindsFor('off'), null);
  assert.equal(feedKindsFor(''), null);
  assert.equal(feedKindsFor(undefined), null);
  assert.deepEqual(feedKindsFor('ALL'), ['claim', 'add', 'drop']); // case-insensitive
});

test('feedKindsFor returns a copy callers cannot mutate', () => {
  const kinds = feedKindsFor('all');
  kinds.push('bogus');
  assert.deepEqual(feedKindsFor('all'), ['claim', 'add', 'drop']);
});

test('feedKindsFor trims stray whitespace (e.g. a wrangler.toml " all ")', () => {
  assert.deepEqual(feedKindsFor(' all '), ['claim', 'add', 'drop']);
});

test('txFeedKey is stable and unique per item', () => {
  const item = {
    timeEpochMilli: '1755100000000',
    transaction: {
      type: 'TRANSACTION_CLAIM',
      team: { id: 1234, name: 'Team A' },
      player: { proPlayer: { id: 5678, nameFull: 'Some Player' } },
    },
  };
  assert.equal(txFeedKey(item), '1755100000000:TRANSACTION_CLAIM:1234:5678');
});

// Minimal fakes for the Worker env — enough to drive runTransactionFeed.
// Returns `deps` separately (rather than test seams on env) so tests exercise
// the real injectable-parameter wiring, including channelId plumbing.
function fakeEnv({ mode, items, seed }) {
  const kv = new Map();
  const key = `txfeed:seen:${(mode || '').trim().toLowerCase()}`;
  if (seed) kv.set(key, JSON.stringify(seed));
  const posts = [];
  const env = {
    TRANSACTION_FEED: mode,
    DISCORD_TRADE_CHANNEL_ID: '111',
    DISCORD_TOKEN: 't',
    BOT_KV: {
      get: async (k, type) => {
        const v = kv.get(k) ?? null;
        return type === 'json' && v !== null ? JSON.parse(v) : v;
      },
      put: async (k, v) => void kv.set(k, v),
    },
  };
  const deps = {
    fetchTransactions: async () => ({ items }),
    post: async (env2, channelId, payload) => void posts.push({ channelId, payload }),
  };
  return { env, deps, kv, posts, key };
}

function txItem(ts, type, playerId) {
  return {
    timeEpochMilli: String(ts),
    transaction: {
      type,
      team: { id: 1, name: 'Team A' },
      player: { proPlayer: { id: playerId, nameFull: `Player ${playerId}` } },
    },
  };
}
const claimItem = (ts, playerId) => txItem(ts, 'TRANSACTION_CLAIM', playerId);

test('first run seeds without posting', async () => {
  const { env, deps, kv, posts } = fakeEnv({ mode: 'all', items: [claimItem(1, 10)] });
  await runTransactionFeed(env, deps);
  assert.equal(posts.length, 0);
  assert.deepEqual(JSON.parse(kv.get('txfeed:seen:all')), [txFeedKey(claimItem(1, 10))]);
});

test('new items post once, then are remembered', async () => {
  const items = [claimItem(1, 10), claimItem(2, 20)];
  const { env, deps, posts } = fakeEnv({ mode: 'all', items, seed: [txFeedKey(items[0])] });
  await runTransactionFeed(env, deps);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].channelId, '111');
  assert.match(posts[0].payload.embeds[0].description, /Player 20/);
  assert.doesNotMatch(posts[0].payload.embeds[0].description, /Player 10/);
  // second run: nothing new
  posts.length = 0;
  await runTransactionFeed(env, deps);
  assert.equal(posts.length, 0);
});

test('a stray-whitespace mode normalizes to the same KV key as the trimmed mode', async () => {
  const items = [claimItem(1, 10), claimItem(2, 20)];
  // Seed under the *trimmed* key, as if a prior tick ran with a clean mode.
  const { env, deps, kv } = fakeEnv({ mode: ' all ', items, seed: [txFeedKey(items[0])] });
  assert.equal(kv.has('txfeed:seen:all'), true); // sanity: fakeEnv itself normalizes the seed key

  await runTransactionFeed(env, deps);

  // If runTransactionFeed used a differently-normalized key it would treat
  // this as a first run (re-seeding both items) instead of reading the
  // existing snapshot and posting only the new one.
  assert.deepEqual(JSON.parse(kv.get('txfeed:seen:all')), [txFeedKey(items[0]), txFeedKey(items[1])]);
  assert.equal(kv.has('txfeed:seen: all '), false);
});

test('mode off does nothing', async () => {
  const { env, deps, kv, posts } = fakeEnv({ mode: 'off', items: [claimItem(1, 10)] });
  await runTransactionFeed(env, deps);
  assert.equal(posts.length, 0);
  assert.equal(kv.size, 0);
});

test('post failure keeps fresh keys out of the snapshot for retry', async () => {
  const items = [claimItem(1, 10)];
  const { env, kv } = fakeEnv({ mode: 'all', items, seed: [] });

  await runTransactionFeed(env, {
    fetchTransactions: async () => ({ items }),
    post: async () => { throw new Error('discord down'); },
  });
  assert.deepEqual(JSON.parse(kv.get('txfeed:seen:all')), []);

  const posts = [];
  await runTransactionFeed(env, {
    fetchTransactions: async () => ({ items }),
    post: async (env2, channelId, payload) => void posts.push({ channelId, payload }),
  });
  assert.equal(posts.length, 1);
  assert.match(posts[0].payload.embeds[0].description, /Player 10/);
  assert.deepEqual(JSON.parse(kv.get('txfeed:seen:all')), [txFeedKey(items[0])]);
});

test('waivers mode filters out adds, drops, and trades end-to-end', async () => {
  const items = [
    claimItem(1, 10),
    txItem(2, 'TRANSACTION_WAIVER_ADD', 20),
    txItem(3, 'TRANSACTION_WAIVER_DROP', 30),
    txItem(4, 'TRANSACTION_TRADE', 40),
  ];
  const { env, deps, posts, kv } = fakeEnv({ mode: 'waivers', items, seed: [] });
  await runTransactionFeed(env, deps);
  assert.equal(posts.length, 1);
  const desc = posts[0].payload.embeds[0].description;
  assert.match(desc, /Player 10/);
  assert.doesNotMatch(desc, /Player 20/);
  assert.doesNotMatch(desc, /Player 30/);
  assert.doesNotMatch(desc, /Player 40/);
  assert.deepEqual(JSON.parse(kv.get('txfeed:seen:waivers')), [txFeedKey(items[0])]);
});

test('fetch failure skips the tick without posting or writing KV', async () => {
  const { env, kv, posts } = fakeEnv({ mode: 'all', items: [] });
  await runTransactionFeed(env, {
    fetchTransactions: async () => { throw new Error('fleaflicker down'); },
    post: async (env2, channelId, payload) => void posts.push({ channelId, payload }),
  });
  assert.equal(posts.length, 0);
  assert.equal(kv.size, 0);
});

test('chunks long transaction lists into multiple embeds under the discord limit', async () => {
  const items = Array.from({ length: 120 }, (_, i) =>
    claimItem(i + 1, `LongPlayerName_${i}_${'x'.repeat(30)}`)
  );
  const { env, deps, posts, kv } = fakeEnv({ mode: 'all', items, seed: [] });
  await runTransactionFeed(env, deps);

  assert.ok(posts.length > 1, `expected multiple embeds, got ${posts.length}`);
  for (const p of posts) {
    assert.ok(p.payload.embeds[0].description.length <= 3900);
    assert.equal(p.channelId, '111');
  }

  const combined = posts.map((p) => p.payload.embeds[0].description).join('\n');
  assert.match(combined, /LongPlayerName_0_/);
  assert.match(combined, /LongPlayerName_119_/);

  const savedKeys = JSON.parse(kv.get('txfeed:seen:all'));
  assert.equal(savedKeys.length, 120);
  for (const item of items) assert.ok(savedKeys.includes(txFeedKey(item)));
});
