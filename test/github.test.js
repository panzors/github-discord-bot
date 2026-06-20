'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseRepoUrl, triggerWorkflowDispatch } = require('../src/github');

test('parseRepoUrl handles https URLs', () => {
  assert.deepStrictEqual(parseRepoUrl('https://github.com/owner/repo'), {
    owner: 'owner',
    repo: 'repo',
  });
});

test('parseRepoUrl strips a trailing .git and slash', () => {
  assert.deepStrictEqual(parseRepoUrl('https://github.com/owner/repo.git/'), {
    owner: 'owner',
    repo: 'repo',
  });
});

test('parseRepoUrl handles ssh remotes', () => {
  assert.deepStrictEqual(parseRepoUrl('git@github.com:owner/repo.git'), {
    owner: 'owner',
    repo: 'repo',
  });
});

test('parseRepoUrl handles owner/repo shorthand', () => {
  assert.deepStrictEqual(parseRepoUrl('owner/repo'), { owner: 'owner', repo: 'repo' });
});

test('parseRepoUrl throws when missing', () => {
  assert.throws(() => parseRepoUrl(''), /Missing target repository URL/);
});

test('triggerWorkflowDispatch throws without a token', async () => {
  await assert.rejects(
    () =>
      triggerWorkflowDispatch({
        token: '',
        owner: 'o',
        repo: 'r',
        workflowFile: 'ci.yml',
        ref: 'main',
      }),
    /Missing GitHub token/
  );
});

test('triggerWorkflowDispatch POSTs to the dispatches endpoint with auth', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 204, statusText: 'No Content' };
  };

  try {
    await triggerWorkflowDispatch({
      token: 'secret-token',
      owner: 'octocat',
      repo: 'hello-world',
      workflowFile: 'ci.yml',
      ref: 'main',
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(
    calls[0].url,
    'https://api.github.com/repos/octocat/hello-world/actions/workflows/ci.yml/dispatches'
  );
  assert.strictEqual(calls[0].options.method, 'POST');
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer secret-token');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { ref: 'main' });
});

test('triggerWorkflowDispatch surfaces a non-2xx response', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    text: async () => 'workflow not found',
  });

  try {
    await assert.rejects(
      () =>
        triggerWorkflowDispatch({
          token: 't',
          owner: 'o',
          repo: 'r',
          workflowFile: 'ci.yml',
          ref: 'main',
        }),
      /GitHub workflow dispatch returned 404 Not Found: workflow not found/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
