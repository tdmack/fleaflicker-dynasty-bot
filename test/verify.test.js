// Ed25519 request verification — the bot's only authentication boundary.
// Signatures are produced with a real WebCrypto keypair so these tests exercise
// the same code path Discord does, not a mock of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDiscordRequest } from '../src/lib/verify.js';

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'Ed25519' }, true, ['sign', 'verify'],
);

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const PUBLIC_KEY_HEX = toHex(await crypto.subtle.exportKey('raw', publicKey));

async function sign(timestamp, body) {
  const sig = await crypto.subtle.sign(
    'Ed25519', privateKey, new TextEncoder().encode(timestamp + body),
  );
  return toHex(sig);
}

/** Minimal stand-in for the Request verifyDiscordRequest reads: headers.get(). */
function fakeRequest(headers) {
  const lower = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { headers: { get: (name) => lower.get(String(name).toLowerCase()) ?? null } };
}

const BODY = JSON.stringify({ type: 2, data: { name: 'standings' } });
const TIMESTAMP = '1755100000';

function signed(sig, { timestamp = TIMESTAMP } = {}) {
  return fakeRequest({
    'X-Signature-Ed25519': sig,
    'X-Signature-Timestamp': timestamp,
  });
}

/** Run fn with console.error captured; returns the collected messages. */
async function captureErrors(fn) {
  const messages = [];
  const original = console.error;
  console.error = (...args) => messages.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return messages;
}

test('a correctly signed request verifies', async () => {
  const sig = await sign(TIMESTAMP, BODY);
  assert.equal(await verifyDiscordRequest(signed(sig), BODY, PUBLIC_KEY_HEX), true);
});

test('a tampered body fails', async () => {
  const sig = await sign(TIMESTAMP, BODY);
  const tampered = JSON.stringify({ type: 2, data: { name: 'draftalerts' } });
  assert.equal(await verifyDiscordRequest(signed(sig), tampered, PUBLIC_KEY_HEX), false);
});

test('a replayed signature with a different timestamp fails', async () => {
  const sig = await sign(TIMESTAMP, BODY);
  const request = signed(sig, { timestamp: '1755109999' });
  assert.equal(await verifyDiscordRequest(request, BODY, PUBLIC_KEY_HEX), false);
});

test('a missing signature header fails', async () => {
  const request = fakeRequest({ 'X-Signature-Timestamp': TIMESTAMP });
  assert.equal(await verifyDiscordRequest(request, BODY, PUBLIC_KEY_HEX), false);
});

test('a missing timestamp header fails', async () => {
  const sig = await sign(TIMESTAMP, BODY);
  const request = fakeRequest({ 'X-Signature-Ed25519': sig });
  assert.equal(await verifyDiscordRequest(request, BODY, PUBLIC_KEY_HEX), false);
});

test('a non-hex signature fails without blaming the public key', async () => {
  const sig = 'z'.repeat(128);
  let result;
  const errors = await captureErrors(async () => {
    result = await verifyDiscordRequest(signed(sig), BODY, PUBLIC_KEY_HEX);
  });
  assert.equal(result, false);
  assert.equal(errors.filter((m) => m.includes('DISCORD_PUBLIC_KEY')).length, 0);
});

test('a truncated (odd-length) signature fails', async () => {
  const sig = await sign(TIMESTAMP, BODY);
  assert.equal(await verifyDiscordRequest(signed(sig.slice(0, 127)), BODY, PUBLIC_KEY_HEX), false);
  assert.equal(await verifyDiscordRequest(signed(sig.slice(0, 64)), BODY, PUBLIC_KEY_HEX), false);
});

test('an over-long signature fails', async () => {
  const sig = await sign(TIMESTAMP, BODY);
  assert.equal(await verifyDiscordRequest(signed(`${sig}ab`), BODY, PUBLIC_KEY_HEX), false);
});

test('a malformed public key fails closed with a config-specific error', async () => {
  const sig = await sign(TIMESTAMP, BODY);
  for (const badKey of ['not-a-key', PUBLIC_KEY_HEX.slice(0, 63), `${PUBLIC_KEY_HEX}ff`, 'q'.repeat(64)]) {
    let result;
    const errors = await captureErrors(async () => {
      result = await verifyDiscordRequest(signed(sig), BODY, badKey);
    });
    assert.equal(result, false, `expected false for key ${badKey}`);
    assert.ok(
      errors.some((m) => m.includes('DISCORD_PUBLIC_KEY is not 64 hex chars')),
      `expected the config-specific error for key ${badKey}, got ${JSON.stringify(errors)}`,
    );
  }
});

test('an empty public key fails without throwing', async () => {
  const sig = await sign(TIMESTAMP, BODY);
  assert.equal(await verifyDiscordRequest(signed(sig), BODY, ''), false);
  assert.equal(await verifyDiscordRequest(signed(sig), BODY, undefined), false);
});

test('a signature from a different keypair fails', async () => {
  const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const sig = toHex(await crypto.subtle.sign(
    'Ed25519', other.privateKey, new TextEncoder().encode(TIMESTAMP + BODY),
  ));
  assert.equal(await verifyDiscordRequest(signed(sig), BODY, PUBLIC_KEY_HEX), false);
});
