'use strict';

const crypto = require('crypto');

// Discord interaction types and response types we care about.
// https://discord.com/developers/docs/interactions/receiving-and-responding
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
};

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
};

// Message flag to make a response visible only to the invoking user.
const MessageFlags = {
  EPHEMERAL: 64,
};

// DER SubjectPublicKeyInfo prefix for a 32-byte raw Ed25519 public key. Prepending
// this lets Node's crypto build a public key from the raw hex Discord provides.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function buildEd25519PublicKey(publicKeyHex) {
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

/**
 * Verifies an incoming Discord interaction request signature.
 *
 * Discord signs `timestamp + rawBody` with Ed25519. Verification must use the
 * exact raw request body (not re-serialized JSON).
 *
 * @param {object} options
 * @param {string} options.publicKey - The application's public key (hex), from the Discord Developer Portal.
 * @param {string} options.signature - The `X-Signature-Ed25519` header value.
 * @param {string} options.timestamp - The `X-Signature-Timestamp` header value.
 * @param {string} options.rawBody - The exact raw request body.
 * @returns {boolean} True if the signature is valid.
 * @throws {Error} If the public key is missing.
 */
function verifyDiscordRequest({ publicKey, signature, timestamp, rawBody }) {
  if (!publicKey) {
    throw new Error('Missing Discord public key. Set the DISCORD_PUBLIC_KEY setting.');
  }
  if (!signature || !timestamp) {
    return false;
  }

  try {
    return crypto.verify(
      null,
      Buffer.from(timestamp + rawBody),
      buildEd25519PublicKey(publicKey),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

module.exports = {
  InteractionType,
  InteractionResponseType,
  MessageFlags,
  verifyDiscordRequest,
};
