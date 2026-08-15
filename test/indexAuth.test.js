// The Worker entry point's auth gate: an unsigned POST must be rejected before
// anything with a side effect runs — no command execution, no KV, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// src/index.js re-exports the DraftMonitor Durable Object, which imports
// 'cloudflare:workers' — a specifier only the Workers runtime provides. Stub it
// so the real entry point (not a copy of it) can be loaded here.
const hooks = `
  export function resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        url: 'data:text/javascript,export class DurableObject {}',
        shortCircuit: true,
        format: 'module',
      };
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`, import.meta.url);

const worker = (await import('../src/index.js')).default;

/**
 * env that throws the moment anything with a side effect is reached. Reading
 * DISCORD_PUBLIC_KEY is expected (that IS the auth check); touching the KV
 * binding or the bot token means the request got past the gate.
 */
const FORBIDDEN = ['BOT_KV', 'DISCORD_TOKEN', 'DRAFT_MONITOR'];
function trapEnv(overrides = {}) {
  return new Proxy({ ...overrides }, {
    get(target, prop) {
      if (FORBIDDEN.includes(prop)) {
        throw new Error(`env.${String(prop)} was touched on an unauthenticated request`);
      }
      return target[prop];
    },
  });
}

function trapCtx() {
  const scheduled = [];
  return { scheduled, waitUntil: (p) => scheduled.push(p) };
}

/** Runs fn with global fetch replaced by a tripwire. */
async function withNoNetwork(fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (...args) => {
    calls.push(args[0]);
    throw new Error('network access on an unauthenticated request');
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

const commandBody = JSON.stringify({
  type: 2, // APPLICATION_COMMAND
  guild_id: '1',
  member: { user: { id: '42' }, permissions: '8' },
  data: { name: 'standings', options: [] },
});

test('an unsigned POST is rejected 401 before any side effect', async () => {
  const ctx = trapCtx();
  let response;
  const fetchCalls = await withNoNetwork(async () => {
    const request = new Request('https://bot.example/', { method: 'POST', body: commandBody });
    response = await worker.fetch(request, trapEnv({ DISCORD_PUBLIC_KEY: 'a'.repeat(64) }), ctx);
  });

  assert.equal(response.status, 401);
  assert.equal(await response.text(), 'invalid request signature');
  // The real proof: no command was scheduled and nothing reached the network.
  assert.equal(ctx.scheduled.length, 0);
  assert.deepEqual(fetchCalls, []);
});

test('a POST with a well-formed but wrong signature is also rejected', async () => {
  const ctx = trapCtx();
  const request = new Request('https://bot.example/', {
    method: 'POST',
    body: commandBody,
    headers: {
      'x-signature-ed25519': 'ab'.repeat(64),
      'x-signature-timestamp': '1755100000',
    },
  });
  const response = await worker.fetch(request, trapEnv({ DISCORD_PUBLIC_KEY: 'ab'.repeat(32) }), ctx);
  assert.equal(response.status, 401);
  assert.equal(ctx.scheduled.length, 0);
});

test('a POST with no DISCORD_PUBLIC_KEY configured is rejected, not crashed', async () => {
  const ctx = trapCtx();
  const request = new Request('https://bot.example/', { method: 'POST', body: commandBody });
  const response = await worker.fetch(request, trapEnv(), ctx);
  assert.equal(response.status, 401);
  assert.equal(ctx.scheduled.length, 0);
});

test('GET returns the plain running banner without auth', async () => {
  const ctx = trapCtx();
  const request = new Request('https://bot.example/');
  const response = await worker.fetch(request, trapEnv(), ctx);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /is running/);
  assert.equal(ctx.scheduled.length, 0);
});
