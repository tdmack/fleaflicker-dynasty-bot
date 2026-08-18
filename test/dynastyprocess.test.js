import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, interpolateEcrValue, parseDpPlayers, parseDpPicks, dpCacheKey, getDpValues,
} from '../src/services/dynastyprocess.js';

test('parseCsv handles quoted fields with commas and escaped quotes', () => {
  const rows = parseCsv('"player","pos"\n"Smith, Jr.","RB"\n"O""Neal","WR"\n');
  assert.deepEqual(rows, [['player', 'pos'], ['Smith, Jr.', 'RB'], ['O"Neal', 'WR']]);
});

test('parseCsv handles CRLF and skips trailing blank line', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('interpolateEcrValue interpolates linearly and clamps at both ends', () => {
  const curve = [{ ecr: 1, value: 10000 }, { ecr: 3, value: 8000 }, { ecr: 5, value: 5000 }];
  assert.equal(interpolateEcrValue(curve, 2), 9000);
  assert.equal(interpolateEcrValue(curve, 4), 6500);
  assert.equal(interpolateEcrValue(curve, 0.5), 10000); // clamp low
  assert.equal(interpolateEcrValue(curve, 9), 5000);    // clamp high
  assert.equal(interpolateEcrValue([], 2), null);
});

const PLAYERS_CSV = [
  '"player","pos","team","age","draft_year","ecr_1qb","ecr_2qb","ecr_pos","value_1qb","value_2qb","scrape_date","fp_id"',
  '"Ja\'Marr Chase","WR","CIN",26.5,2021,1,6.4,1,10256,9034,"2026-08-14","19788"',
  '"Josh Allen","QB","BUF",30.2,2018,15,1,1,6000,10000,"2026-08-14","17298"',
  '"Some Kicker","K","DAL",30,2015,300,300,1,10,5,"2026-08-14","111"',
  '"No Value","WR","FA",22,2025,,,,,,"2026-08-14","222"',
].join('\n');

test('parseDpPlayers picks the 2qb columns, filters blocked positions and null values', () => {
  const { players, curve } = parseDpPlayers(PLAYERS_CSV, '2qb');
  assert.deepEqual(players.map((p) => p.name), ["Ja'Marr Chase", 'Josh Allen']);
  const allen = players.find((p) => p.name === 'Josh Allen');
  assert.equal(allen.value, 10000);
  assert.equal(allen.position, 'QB');
  assert.equal(allen.team, 'BUF');
  // curve sorted ascending by ecr: Allen (1) then Chase (6.4)
  assert.deepEqual(curve, [{ ecr: 1, value: 10000 }, { ecr: 6.4, value: 9034 }]);
});

test('parseDpPlayers 1qb mode uses value_1qb/ecr_1qb', () => {
  const { players } = parseDpPlayers(PLAYERS_CSV, '1qb');
  const chase = players.find((p) => p.name === "Ja'Marr Chase");
  assert.equal(chase.value, 10256);
});

const PICKS_CSV = [
  '"player","pos","ecr_1qb","ecr_2qb","ecr_high_1qb","ecr_high_2qb","ecr_low_1qb","ecr_low_2qb","scrape_date","pick"',
  '"2026 Pick 1.01","PICK",18.4,1,1,1,35,38,"2026-08-14",1',
  '"2027 1st","PICK",25,6.4,10,10,40,40,"2026-08-14",',
  '"garbage row","PICK",,,,,,,"2026-08-14",',
].join('\n');

test('parseDpPicks maps ECR through the player curve', () => {
  const curve = [{ ecr: 1, value: 10000 }, { ecr: 6.4, value: 9034 }];
  const picks = parseDpPicks(PICKS_CSV, '2qb', curve);
  assert.equal(picks.length, 2); // garbage row dropped (no parseable label)
  const slot = picks.find((p) => p.slot === 1);
  assert.deepEqual({ year: slot.year, round: slot.round, hint: slot.hint }, { year: 2026, round: 1, hint: 'Early' });
  assert.equal(slot.value, 10000); // ecr 1 → curve start
  const roundLevel = picks.find((p) => p.slot === null);
  assert.deepEqual(
    { year: roundLevel.year, round: roundLevel.round, hint: roundLevel.hint },
    { year: 2027, round: 1, hint: 'Mid' }
  );
  assert.equal(roundLevel.value, 9034); // ecr 6.4 → curve end
});

test('dpCacheKey varies with qb mode', () => {
  assert.equal(dpCacheKey({}), 'dynastyprocess:values:2qb');
  assert.equal(dpCacheKey({ FANTASYCALC_NUM_QBS: '1' }), 'dynastyprocess:values:1qb');
});

test('getDpValues fetches, caches, and serves from KV', async () => {
  const store = new Map();
  const env = {
    BOT_KV: {
      get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
      put: async (k, v) => { store.set(k, v); },
    },
  };
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async (url) => {
    fetches++;
    const body = String(url).includes('values-players') ? PLAYERS_CSV : PICKS_CSV;
    return new Response(body, { status: 200 });
  };
  try {
    const first = await getDpValues(env);
    assert.equal(fetches, 2);
    assert.equal(first.players.length, 2);
    assert.equal(first.picks.length, 2);
    const second = await getDpValues(env);
    assert.equal(fetches, 2); // served from KV
    assert.deepEqual(second, first);
  } finally {
    globalThis.fetch = realFetch;
  }
});
