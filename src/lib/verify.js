// Ed25519 signature verification for Discord interaction requests.
// Uses WebCrypto directly — no dependency needed on Workers.

// Ed25519: 64-byte signature, 32-byte public key — both hex-encoded. Anything
// else is malformed input, rejected before it reaches WebCrypto (hexToBytes
// would otherwise turn a bad character into NaN → 0 and hand the crypto layer
// silently wrong bytes).
const SIGNATURE_HEX = /^[0-9a-fA-F]{128}$/;
const PUBLIC_KEY_HEX = /^[0-9a-fA-F]{64}$/;

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function verifyDiscordRequest(request, bodyText, publicKeyHex) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  if (!signature || !timestamp || !publicKeyHex) return false;

  // Called out separately: a bad DISCORD_PUBLIC_KEY is the most common setup
  // mistake, and it otherwise presents as every interaction 401-ing with no
  // clue why.
  if (!PUBLIC_KEY_HEX.test(publicKeyHex)) {
    console.error('[Verify] DISCORD_PUBLIC_KEY is not 64 hex chars — check the value against the Developer Portal');
    return false;
  }
  if (!SIGNATURE_HEX.test(signature)) return false;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKeyHex),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + bodyText),
    );
  } catch (err) {
    console.error('[Verify] Signature check failed:', err.message);
    return false;
  }
}
