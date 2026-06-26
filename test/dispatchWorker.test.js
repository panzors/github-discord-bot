'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { handleDispatch } = require('../src/dispatchWorker');

function makeContext() {
  return {
    logs: [],
    errors: [],
    log(...args) { this.logs.push(args.join(' ')); },
    error(...args) { this.errors.push(args.join(' ')); },
  };
}

const ENV = {
  TARGET_REPO_URL: 'https://github.com/acme/widgets',
  TARGET_WORKFLOW_FILE: 'e2e.yml',
  TARGET_GITHUB_TOKEN: 'ghp_test',
};

function withEnv(fn) {
  const saved = {};
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(ENV)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
}

test('dispatches the workflow then edits the deferred message with success', async () => {
  await withEnv(async () => {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 204, statusText: 'No Content' };
    };

    const context = makeContext();
    try {
      await handleDispatch(
        { applicationId: 'app1', token: 'tok1', branch: 'release', fastMode: true, recordVideo: false },
        context
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.strictEqual(calls.length, 2);
    // First: GitHub workflow dispatch.
    assert.match(calls[0].url, /\/repos\/acme\/widgets\/actions\/workflows\/e2e\.yml\/dispatches$/);
    assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
      ref: 'release',
      inputs: { fast_mode: true, record_video: false },
    });
    // Second: edit the original interaction message.
    assert.strictEqual(
      calls[1].url,
      'https://discord.com/api/v10/webhooks/app1/tok1/messages/@original'
    );
    assert.strictEqual(calls[1].options.method, 'PATCH');
    const editBody = JSON.parse(calls[1].options.body);
    assert.match(editBody.content, /Running e2e on `acme\/widgets` @ `release` \(fast mode\)/);
    assert.strictEqual(context.errors.length, 0);
  });
});

test('omits unset workflow inputs', async () => {
  await withEnv(async () => {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 204, statusText: 'No Content' };
    };

    const context = makeContext();
    try {
      await handleDispatch(
        { applicationId: 'app2', token: 'tok2', branch: 'main' },
        context
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.strictEqual(calls.length, 2);
    // Unset booleans are dropped by JSON serialization, leaving empty inputs.
    assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
      ref: 'main',
      inputs: {},
    });
  });
});

test('edits the message with a failure when the dispatch fails', async () => {
  await withEnv(async () => {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/dispatches')) {
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => 'no workflow' };
      }
      return { ok: true, status: 200, statusText: 'OK' };
    };

    const context = makeContext();
    try {
      await handleDispatch(
        { applicationId: 'app3', token: 'tok3', branch: 'main' },
        context
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.strictEqual(calls.length, 2);
    const editBody = JSON.parse(calls[1].options.body);
    assert.match(editBody.content, /Failed to trigger e2e/);
    assert.strictEqual(context.errors.length, 1);
  });
});
