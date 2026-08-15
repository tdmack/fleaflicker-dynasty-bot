import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildValuesUrl, valuesCacheKey, valuesFooter } from '../src/services/fantasycalc.js';

test('buildValuesUrl defaults to superflex, 12 teams, 0.5 PPR', () => {
  assert.equal(
    buildValuesUrl({}),
    'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5'
  );
});

test('buildValuesUrl honors env overrides', () => {
  const env = { FANTASYCALC_NUM_QBS: '1', FANTASYCALC_NUM_TEAMS: '10', FANTASYCALC_PPR: '1' };
  assert.equal(
    buildValuesUrl(env),
    'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=10&ppr=1'
  );
});

test('empty-string vars fall back to defaults', () => {
  const env = { FANTASYCALC_NUM_QBS: '', FANTASYCALC_NUM_TEAMS: '', FANTASYCALC_PPR: '' };
  assert.equal(
    buildValuesUrl(env),
    'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5'
  );
});

test('valuesCacheKey varies with settings', () => {
  assert.equal(valuesCacheKey({}), 'fantasycalc:values:2:12:0.5');
  assert.equal(valuesCacheKey({ FANTASYCALC_NUM_QBS: '1' }), 'fantasycalc:values:1:12:0.5');
});

test('valuesFooter describes the settings', () => {
  assert.equal(valuesFooter({}), 'FantasyCalc • superflex, 12-team, 0.5 PPR');
  assert.equal(valuesFooter({ FANTASYCALC_NUM_QBS: '1' }), 'FantasyCalc • 1QB, 12-team, 0.5 PPR');
});

test('buildValuesUrl honors numeric zero PPR (standard scoring)', () => {
  assert.equal(
    buildValuesUrl({ FANTASYCALC_PPR: 0 }),
    'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0'
  );
});

test('buildValuesUrl falls back to default on non-numeric garbage', () => {
  assert.equal(
    buildValuesUrl({ FANTASYCALC_NUM_TEAMS: 'twelve' }),
    'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5'
  );
});

test('valuesCacheKey honors numeric zero PPR', () => {
  assert.equal(valuesCacheKey({ FANTASYCALC_PPR: 0 }), 'fantasycalc:values:2:12:0');
});
