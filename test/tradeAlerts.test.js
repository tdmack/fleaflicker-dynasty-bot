import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTradeAlerts } from '../src/jobs/tradeAlerts.js';

// Minimal fakes for the Worker env — enough to drive runTradeAlerts.
// Returns `deps` separately (rather than test seams on env) so tests exercise
// the real injectable-parameter wiring, including channelId plumbing.
function fakeEnv({ completed = [], pending = [], seed, polls } = {}) {
  const kv = new Map();
  if (seed) kv.set('trades:seen', JSON.stringify(seed));
  const posts = [];
  const env = {
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
  if (polls !== undefined) env.TRADE_POLLS = polls;
  const deps = {
    fetchTrades: async (env2, status) =>
      status === 'completed' ? { trades: completed } : { trades: pending },
    post: async (env2, channelId, payload) => void posts.push({ channelId, payload }),
  };
  return { env, deps, kv, posts };
}

// Two named teams so buildTradePoll can produce a poll for completed trades.
function trade(id) {
  return {
    id,
    description: `Trade ${id}`,
    proposedOn: '1755100000000',
    teams: [
      { team: { name: 'Team A' }, playersObtained: [], picksObtained: [] },
      { team: { name: 'Team B' }, playersObtained: [], picksObtained: [] },
    ],
  };
}

const seenKeys = (kv) => JSON.parse(kv.get('trades:seen'));

test('first run seeds without posting', async () => {
  const { env, deps, kv, posts } = fakeEnv({ completed: [trade(1)], pending: [trade(2)] });
  await runTradeAlerts(env, deps);
  assert.equal(posts.length, 0);
  assert.deepEqual(seenKeys(kv), ['1:completed', '2:pending']);
});

test('no channel configured does nothing', async () => {
  const { env, deps, kv, posts } = fakeEnv({ completed: [trade(1)] });
  delete env.DISCORD_TRADE_CHANNEL_ID;
  await runTradeAlerts(env, deps);
  assert.equal(posts.length, 0);
  assert.equal(kv.size, 0);
});

test('new completed trade posts once, then is remembered', async () => {
  const { env, deps, kv, posts } = fakeEnv({ completed: [trade(1)], seed: [] });
  await runTradeAlerts(env, deps);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].channelId, '111');
  assert.equal(posts[0].payload.embeds[0].title, '✅ Trade Executed');
  assert.deepEqual(seenKeys(kv), ['1:completed']);

  // second run: nothing new
  posts.length = 0;
  await runTradeAlerts(env, deps);
  assert.equal(posts.length, 0);
});

test('new pending trade posts a pending-review alert', async () => {
  const { env, deps, posts, kv } = fakeEnv({ pending: [trade(7)], seed: [] });
  await runTradeAlerts(env, deps);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.embeds[0].title, '🔔 New Trade Pending Review');
  assert.deepEqual(seenKeys(kv), ['7:pending']);
});

test('a pending trade that completes re-alerts as executed', async () => {
  // Prior tick saw trade 5 as pending; this tick Fleaflicker reports it completed.
  const { env, deps, kv, posts } = fakeEnv({ completed: [trade(5)], seed: ['5:pending'] });
  await runTradeAlerts(env, deps);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.embeds[0].title, '✅ Trade Executed');
  // The stale pending key drops out of the snapshot along with the alert.
  assert.deepEqual(seenKeys(kv), ['5:completed']);
});

test('failed post keeps the trade out of the snapshot for retry', async () => {
  const { env, kv } = fakeEnv({ completed: [trade(1)], seed: [] });
  const failingDeps = {
    fetchTrades: async () => ({ trades: [trade(1)] }),
    post: async () => { throw new Error('discord down'); },
  };
  await runTradeAlerts(env, failingDeps);
  assert.deepEqual(seenKeys(kv), []);

  // next tick with Discord back up: the alert goes out and is recorded
  const { deps, posts } = fakeEnv({ completed: [trade(1)] });
  await runTradeAlerts(env, { ...deps, post: async (e, c, payload) => void posts.push({ payload }) });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.embeds[0].title, '✅ Trade Executed');
  assert.deepEqual(seenKeys(kv), ['1:completed']);
});

test('fetch failure skips the tick without posting or writing KV', async () => {
  const { env, kv, posts } = fakeEnv({});
  await runTradeAlerts(env, {
    fetchTrades: async () => { throw new Error('fleaflicker down'); },
    post: async (e, c, payload) => void posts.push({ payload }),
  });
  assert.equal(posts.length, 0);
  assert.equal(kv.size, 0);
});

test('TRADE_POLLS on: no poll for a pending trade', async () => {
  const { env, deps, posts } = fakeEnv({ pending: [trade(3)], seed: [], polls: 'on' });
  await runTradeAlerts(env, deps);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.poll, undefined);
});

test('TRADE_POLLS off: no poll for a completed trade', async () => {
  const { env, deps, posts } = fakeEnv({ completed: [trade(3)], seed: [], polls: 'off' });
  await runTradeAlerts(env, deps);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.poll, undefined);
});

test('TRADE_POLLS unset: no poll for a completed trade', async () => {
  const { env, deps, posts } = fakeEnv({ completed: [trade(3)], seed: [] });
  await runTradeAlerts(env, deps);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.poll, undefined);
});

test('TRADE_POLLS on: completed trade posts embed then poll', async () => {
  const { env, deps, posts, kv } = fakeEnv({ completed: [trade(4)], seed: [], polls: 'on' });
  await runTradeAlerts(env, deps);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].payload.embeds[0].title, '✅ Trade Executed');
  assert.equal(posts[1].payload.poll.question.text, 'Who won this trade?');
  assert.equal(posts[1].channelId, '111');
  assert.deepEqual(seenKeys(kv), ['4:completed']);
});

test('poll post failure still records the trade — no duplicate next tick', async () => {
  const { env, deps, posts, kv } = fakeEnv({ completed: [trade(9)], seed: [], polls: 'on' });
  const pollFailingDeps = {
    ...deps,
    post: async (env2, channelId, payload) => {
      if (payload.poll) throw new Error('poll rejected');
      posts.push({ channelId, payload });
    },
  };
  await runTradeAlerts(env, pollFailingDeps);
  assert.equal(posts.length, 1); // embed went out, poll did not
  assert.deepEqual(seenKeys(kv), ['9:completed']); // trade recorded despite poll failure

  // next tick: no duplicate alert, and no poll retry (polls are best-effort)
  posts.length = 0;
  await runTradeAlerts(env, pollFailingDeps);
  assert.equal(posts.length, 0);
});
