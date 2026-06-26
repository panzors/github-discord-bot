'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { verifyDiscordRequest } = require('../src/discordInteractions');

// Generate an Ed25519 keypair and produce the raw public key hex the way Discord
// exposes it, plus a signature over `timestamp + body`.
function makeSignedRequest(body, timestamp) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyHex = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('hex');
  const signature = crypto
    .sign(null, Buffer.from(timestamp + body), privateKey)
    .toString('hex');
  return { publicKeyHex, signature };
}

test('verifyDiscordRequest accepts a correctly signed request', () => {
  const body = JSON.stringify({ type: 1 });
  const timestamp = '1700000000';
  const { publicKeyHex, signature } = makeSignedRequest(body, timestamp);

  assert.strictEqual(
    verifyDiscordRequest({ publicKey: publicKeyHex, signature, timestamp, rawBody: body }),
    true
  );
});

test('verifyDiscordRequest rejects a tampered body', () => {
  const body = JSON.stringify({ type: 1 });
  const timestamp = '1700000000';
  const { publicKeyHex, signature } = makeSignedRequest(body, timestamp);

  assert.strictEqual(
    verifyDiscordRequest({
      publicKey: publicKeyHex,
      signature,
      timestamp,
      rawBody: JSON.stringify({ type: 2 }),
    }),
    false
  );
});

test('verifyDiscordRequest rejects a wrong signature', () => {
  const body = JSON.stringify({ type: 1 });
  const timestamp = '1700000000';
  const { publicKeyHex } = makeSignedRequest(body, timestamp);

  assert.strictEqual(
    verifyDiscordRequest({ publicKey: publicKeyHex, signature: 'ab'.repeat(32), timestamp, rawBody: body }),
    false
  );
});

test('verifyDiscordRequest returns false when headers are missing', () => {
  const { publicKeyHex } = makeSignedRequest('{}', '1');
  assert.strictEqual(
    verifyDiscordRequest({ publicKey: publicKeyHex, signature: '', timestamp: '', rawBody: '{}' }),
    false
  );
});

test('verifyDiscordRequest throws when the public key is missing', () => {
  assert.throws(
    () => verifyDiscordRequest({ publicKey: '', signature: 'aa', timestamp: '1', rawBody: '{}' }),
    /Missing Discord public key/
  );
});
