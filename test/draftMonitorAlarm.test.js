// DraftMonitor alarm-loop lifetime guards. The regression these lock down: the
// staleness check used to live inside poll(), AFTER the Fleaflicker fetch, so a
// permanently failing fetch re-armed every 20s forever and could never
// self-disarm (and the 15-min cron supervisor kept healing it).
//
// poll() itself is stubbed per-test — what is under test here is alarm()'s
// re-arm/back-off/disarm decisions, which must hold whether poll() threw or not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const stub = 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }';
const hooks = `
  export function resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        url: 'data:text/javascript,${encodeURIComponent(stub)}',
        shortCircuit: true,
        format: 'module',
      };
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`, import.meta.url);

const { DraftMonitor } = await import('../src/do/draftMonitor.js');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function fakeStorage(initial) {
  const map = new Map(Object.entries(initial));
  let alarm = null;
  return {
    map,
    alarmAt: () => alarm,
    async get(key) {
      if (Array.isArray(key)) {
        return new Map(key.filter((k) => map.has(k)).map((k) => [k, map.get(k)]));
      }
      return map.get(key);
    },
    async put(keyOrEntries, value) {
      if (typeof keyOrEntries === 'object' && keyOrEntries !== null) {
        for (const [k, v] of Object.entries(keyOrEntries)) map.set(k, v);
      } else {
        map.set(keyOrEntries, value);
      }
    },
    async delete(key) { map.delete(key); },
    async setAlarm(at) { alarm = at; },
    async getAlarm() { return alarm; },
    async deleteAlarm() { alarm = null; },
  };
}

/** A monitor whose poll() is replaced by `poll` (throwing or not). */
function monitorWith(state, poll, env = {}) {
  const now = Date.now();
  const storage = fakeStorage({
    enabled: true,
    armedAt: now,
    lastChangeAt: now,
    consecutiveFailures: 0,
    ...state,
  });
  const monitor = new DraftMonitor({ storage }, env);
  monitor.poll = poll;
  return { monitor, storage };
}

const failingPoll = async () => { throw new Error('fleaflicker unreachable'); };
const okPoll = async () => {};

/** Milliseconds from now until the next scheduled alarm. */
const delay = (storage) => storage.alarmAt() - Date.now();

test('a healthy tick re-arms at the 20s poll interval', async () => {
  const { monitor, storage } = monitorWith({}, okPoll);
  await monitor.alarm();
  assert.equal(storage.map.get('enabled'), true);
  assert.ok(delay(storage) > 18000 && delay(storage) <= 20000, `got ${delay(storage)}ms`);
});

test('a permanently failing poll still disarms once the board goes stale', async () => {
  // The whole point: poll() never gets past its fetch, so the idle decision
  // cannot live in there.
  const now = Date.now();
  const { monitor, storage } = monitorWith(
    { armedAt: now - 50 * HOUR, lastChangeAt: now - 49 * HOUR },
    failingPoll,
  );

  await monitor.alarm();

  assert.equal(storage.map.get('enabled'), false);
  assert.equal(storage.alarmAt(), null, 'the alarm chain must be cleared, not re-armed');
});

test('an arming that outlives the 7-day ceiling disarms even while picks keep landing', async () => {
  const now = Date.now();
  const { monitor, storage } = monitorWith(
    { armedAt: now - 8 * DAY, lastChangeAt: now },
    okPoll,
  );

  await monitor.alarm();

  assert.equal(storage.map.get('enabled'), false);
  assert.equal(storage.alarmAt(), null);
});

test('an arming inside both windows keeps polling', async () => {
  const now = Date.now();
  const { monitor, storage } = monitorWith(
    { armedAt: now - 3 * DAY, lastChangeAt: now - 40 * HOUR },
    okPoll,
  );

  await monitor.alarm();

  assert.equal(storage.map.get('enabled'), true);
  assert.ok(storage.alarmAt() > now);
});

test('ten consecutive failures back the poll interval off to 5 minutes', async () => {
  const { monitor, storage } = monitorWith({}, failingPoll);

  for (let i = 1; i <= 9; i++) {
    await monitor.alarm();
    assert.equal(storage.map.get('consecutiveFailures'), i);
    assert.ok(delay(storage) <= 20000, `tick ${i} should still be a fast poll`);
  }

  await monitor.alarm();
  assert.equal(storage.map.get('consecutiveFailures'), 10);
  assert.ok(delay(storage) > 4 * 60 * 1000, `expected the 5m backoff, got ${delay(storage)}ms`);

  // ...and it stays backed off while the outage continues.
  await monitor.alarm();
  assert.ok(delay(storage) > 4 * 60 * 1000);
});

test('any successful poll resets the failure counter and the fast interval', async () => {
  const { monitor, storage } = monitorWith({ consecutiveFailures: 12 }, okPoll);

  await monitor.alarm();

  assert.equal(storage.map.get('consecutiveFailures'), 0);
  assert.ok(delay(storage) <= 20000, `expected the 20s interval back, got ${delay(storage)}ms`);
});

test('re-arming an already-armed monitor clears the failure backoff', async () => {
  const { monitor, storage } = monitorWith({ consecutiveFailures: 10 }, failingPoll);
  await storage.setAlarm(Date.now() + 5 * 60 * 1000); // mid-backoff

  const status = await monitor.start({});

  assert.equal(storage.map.get('consecutiveFailures'), 0);
  assert.ok(delay(storage) <= 20000, `expected the backed-off alarm pulled in, got ${delay(storage)}ms`);
  // Idempotent: the on-the-clock state is untouched.
  assert.equal(status.enabled, true);
});

test('re-arming preserves on-the-clock state and the existing fast alarm', async () => {
  const { monitor, storage } = monitorWith(
    { lastPickKey: '7:12', lastPickDesc: 'Team 7 (pick 1.12)', turnStartedAt: 123, reminded: true },
    okPoll,
  );
  await storage.setAlarm(Date.now() + 15000);
  const before = storage.alarmAt();

  await monitor.start({ reminderMinutes: 45 });

  assert.equal(storage.map.get('lastPickKey'), '7:12');
  assert.equal(storage.map.get('reminded'), true);
  assert.equal(storage.map.get('turnStartedAt'), 123);
  assert.equal(storage.map.get('reminderMinutes'), 45);
  assert.equal(storage.alarmAt(), before, 'a healthy alarm must not be rescheduled');
});

test('a disarmed monitor does nothing and never re-arms', async () => {
  let polled = false;
  const { monitor, storage } = monitorWith({ enabled: false }, async () => { polled = true; });

  await monitor.alarm();

  assert.equal(polled, false);
  assert.equal(storage.alarmAt(), null);
});

test('poll() disarming mid-tick (board complete) is not re-armed by alarm()', async () => {
  const { monitor, storage } = monitorWith({}, async function () {
    await this.ctx.storage.put('enabled', false);
  });
  monitor.poll = monitor.poll.bind(monitor);

  await monitor.alarm();

  assert.equal(storage.map.get('enabled'), false);
  assert.equal(storage.alarmAt(), null);
});
