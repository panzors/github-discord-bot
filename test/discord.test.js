'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { postToDiscord, editOriginalInteractionResponse } = require('../src/discord');

test('throws when the webhook URL is missing', async () => {
  await assert.rejects(
    () => postToDiscord('', { content: 'hi' }),
    /Missing Discord webhook URL/
  );
});

test('posts the payload as JSON to the webhook', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 204, statusText: 'No Content' };
  };

  try {
    await postToDiscord('https://discord.com/api/webhooks/x/y', { content: 'hello' });
  } finally {
    global.fetch = originalFetch;
  }

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://discord.com/api/webhooks/x/y');
  assert.strictEqual(calls[0].options.method, 'POST');
  assert.strictEqual(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { content: 'hello' });
});

test('throws when Discord returns a non-2xx response', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    text: async () => 'bad payload',
  });

  try {
    await assert.rejects(
      () => postToDiscord('https://discord.com/api/webhooks/x/y', { content: 'hello' }),
      /Discord webhook returned 400 Bad Request: bad payload/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('editOriginalInteractionResponse requires application id and token', async () => {
  await assert.rejects(
    () => editOriginalInteractionResponse({ applicationId: '', token: 't', payload: {} }),
    /Missing Discord application id/
  );
  await assert.rejects(
    () => editOriginalInteractionResponse({ applicationId: 'app', token: '', payload: {} }),
    /Missing Discord interaction token/
  );
});

test('editOriginalInteractionResponse PATCHes the @original message', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, statusText: 'OK' };
  };

  try {
    await editOriginalInteractionResponse({
      applicationId: 'app123',
      token: 'tok456',
      payload: { content: 'done' },
      apiBase: 'https://discord.test/api/v10',
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(
    calls[0].url,
    'https://discord.test/api/v10/webhooks/app123/tok456/messages/@original'
  );
  assert.strictEqual(calls[0].options.method, 'PATCH');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { content: 'done' });
});

test('editOriginalInteractionResponse throws on a non-2xx response', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    text: async () => 'unknown webhook',
  });

  try {
    await assert.rejects(
      () => editOriginalInteractionResponse({ applicationId: 'app', token: 't', payload: {} }),
      /Discord interaction edit returned 404 Not Found: unknown webhook/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
