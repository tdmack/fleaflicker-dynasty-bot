// Weekly recap gating: the KV posted-marker is what keeps the daily cron from
// re-posting a recap every day for the rest of the week. These drive the real
// runWeekly/postRecap through the injectable `deps` seam (same pattern as
// src/jobs/transactionFeed.js) — no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWeekly, postRecap } from '../src/jobs/weekly.js';

const SEASON = 2025;

function game(id, homeId, awayId, homeScore, awayScore) {
  return {
    id,
    isFinalScore: true,
    home: { id: homeId, name: `Team ${homeId}` },
    away: { id: awayId, name: `Team ${awayId}` },
    homeScore: { score: { value: homeScore } },
    awayScore: { score: { value: awayScore } },
  };
}

function scoreboardFor(week) {
  return {
    schedulePeriod: { value: week, season: SEASON },
    games: [game(`${week}-a`, 1, 2, 100 + week, 90), game(`${week}-b`, 3, 4, 80, 110)],
  };
}

const STANDINGS = {
  divisions: [{
    teams: [1, 2, 3, 4].map((id) => ({
      id,
      name: `Team ${id}`,
      recordOverall: { wins: 1, losses: 1, ties: 0, formatted: '1-1' },
      pointsFor: { formatted: '190.0' },
    })),
  }],
};

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    get: async (key, type) => {
      const v = store.get(key) ?? null;
      return type === 'json' && v !== null ? JSON.parse(v) : v;
    },
    put: async (key, value) => void store.set(key, value),
  };
}

/** A week that fetches fine but still has a game in progress (e.g. postponed). */
function partialScoreboardFor(week) {
  const sb = scoreboardFor(week);
  sb.games[1] = { ...sb.games[1], isFinalScore: false, isInProgress: true };
  return sb;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.currentWeek]
 * @param {object} [opts.kvSeed]
 * @param {number[]} [opts.failWeeks] historical weeks whose fetch should fail
 * @param {number[]} [opts.partialWeeks] historical weeks that fetch OK but aren't final
 */
function harness({ currentWeek = 2, kvSeed = {}, failWeeks = [], partialWeeks = [] } = {}) {
  const kv = fakeKv(kvSeed);
  const env = { DISCORD_RECAP_CHANNEL_ID: '999', BOT_KV: kv };
  const posts = [];
  const scoreboardFetches = [];
  const deps = {
    fetchScoreboard: async (_env, week) => {
      scoreboardFetches.push(week ?? currentWeek);
      if (failWeeks.includes(week)) throw new Error(`week ${week} unavailable`);
      if (partialWeeks.includes(week)) return partialScoreboardFor(week);
      return scoreboardFor(week ?? currentWeek);
    },
    fetchStandings: async () => STANDINGS,
    fetchBoxscore: async () => ({}),
    fetchTransactions: async () => ({ items: [] }),
    post: async (_env, channelId, payload) => void posts.push({ channelId, payload }),
  };
  return { env, kv, deps, posts, scoreboardFetches };
}

const titlesOf = (post) => post.payload.embeds.map((e) => e.title);

test('an existing posted-marker suppresses the recap entirely', async () => {
  const { env, deps, posts, scoreboardFetches } = harness({
    kvSeed: { [`weekly:recap:${SEASON}:2`]: 'posted' },
  });

  await runWeekly(env, deps);

  assert.equal(posts.length, 0);
  // Only the current-week scoreboard was fetched — the marker check short-
  // circuits before any historical fetch.
  assert.deepEqual(scoreboardFetches, [2]);
});

test('a successful recap writes the marker, and a second run posts nothing', async () => {
  const { env, kv, deps, posts } = harness();

  await runWeekly(env, deps);

  assert.equal(posts.length, 2, 'expected the scores/standings message and the metrics message');
  assert.deepEqual(titlesOf(posts[0]), ['📅 Week 2 in Review', '🏆 Standings']);
  assert.equal(kv.store.get(`weekly:recap:${SEASON}:2`), 'posted');

  posts.length = 0;
  await runWeekly(env, deps);
  assert.equal(posts.length, 0, 'the marker must stop the next daily tick');
});

test('the metrics message includes the luck report when every prior week loaded', async () => {
  const { env, deps, posts } = harness();
  await runWeekly(env, deps);
  assert.deepEqual(
    titlesOf(posts[1]),
    ['🍀 Luck Report (All-Play)', '🎓 Coach Ratings', '🌟 Top Scorers'],
  );
});

test('a failed prior week omits the luck report rather than publishing wrong all-play numbers', async () => {
  const { env, kv, deps, posts } = harness({ currentWeek: 3, failWeeks: [1] });

  await runWeekly(env, deps);

  assert.equal(posts.length, 2);
  const titles = titlesOf(posts[1]);
  assert.ok(!titles.includes('🍀 Luck Report (All-Play)'), `luck report should be omitted, got ${titles}`);
  assert.deepEqual(titles, ['🎓 Coach Ratings', '🌟 Top Scorers']);
  // The rest of the recap still posted and still deduped.
  assert.equal(kv.store.get(`weekly:recap:${SEASON}:3`), 'posted');
});

test('a prior week that fetches OK but is not fully final is neither counted nor cached', async () => {
  // The dangerous case: no fetch error to notice, so the luck report would
  // silently understate every team — and the partial scores would be frozen
  // in the TTL-less cache key forever.
  const { env, kv, deps, posts } = harness({ currentWeek: 3, partialWeeks: [2] });

  await runWeekly(env, deps);

  assert.equal(posts.length, 2);
  const titles = titlesOf(posts[1]);
  assert.ok(!titles.includes('🍀 Luck Report (All-Play)'), `luck report should be omitted, got ${titles}`);
  assert.equal(kv.store.has(`weekly:scoreboard:${SEASON}:2`), false, 'a partial week must not be cached');
  assert.ok(kv.store.has(`weekly:scoreboard:${SEASON}:1`), 'the fully-final week is still cached');
});

test('a prior week that comes back with no games is treated as incomplete', async () => {
  const kv = fakeKv();
  const env = { DISCORD_RECAP_CHANNEL_ID: '999', BOT_KV: kv };
  const posts = [];
  await runWeekly(env, {
    fetchScoreboard: async (_e, week) => (week === 1 ? { games: [] } : scoreboardFor(week ?? 2)),
    fetchStandings: async () => STANDINGS,
    fetchBoxscore: async () => ({}),
    fetchTransactions: async () => ({ items: [] }),
    post: async (_e, channelId, payload) => void posts.push({ channelId, payload }),
  });

  assert.ok(!titlesOf(posts[1]).includes('🍀 Luck Report (All-Play)'));
  assert.equal(kv.store.has(`weekly:scoreboard:${SEASON}:1`), false);
});

test('completed weeks are cached in KV and not refetched', async () => {
  const { env, kv, deps, scoreboardFetches } = harness({ currentWeek: 3 });

  await runWeekly(env, deps);

  assert.ok(kv.store.has(`weekly:scoreboard:${SEASON}:1`));
  assert.ok(kv.store.has(`weekly:scoreboard:${SEASON}:2`));
  assert.deepEqual(scoreboardFetches, [3, 1, 2]);

  // A later recap reads those weeks from KV: even with every historical fetch
  // failing, the luck report survives because nothing needs fetching.
  const posts = [];
  await postRecap(env, '999', SEASON, 3, scoreboardFor(3), undefined, {
    ...deps,
    fetchScoreboard: async (_e, week) => {
      if (week) throw new Error('should have been served from cache');
      return scoreboardFor(3);
    },
    post: async (_env, channelId, payload) => void posts.push({ channelId, payload }),
  });

  assert.ok(titlesOf(posts[1]).includes('🍀 Luck Report (All-Play)'));
});

test('historical scoreboards are fetched in capped batches, not one burst', async () => {
  const kv = fakeKv();
  const env = { DISCORD_RECAP_CHANNEL_ID: '999', BOT_KV: kv };
  let inFlight = 0;
  let peak = 0;
  const posts = [];
  const deps = {
    fetchScoreboard: async (_env, week) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return scoreboardFor(week ?? 14);
    },
    fetchStandings: async () => STANDINGS,
    fetchBoxscore: async () => ({}),
    fetchTransactions: async () => ({ items: [] }),
    post: async (_env, channelId, payload) => void posts.push({ channelId, payload }),
  };

  await runWeekly(env, deps);

  assert.equal(posts.length, 2);
  assert.ok(peak <= 4, `expected at most 4 concurrent scoreboard fetches, saw ${peak}`);
});
