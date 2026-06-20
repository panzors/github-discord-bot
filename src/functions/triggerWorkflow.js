'use strict';

const { app } = require('@azure/functions');
const { parseRepoUrl, triggerWorkflowDispatch } = require('../github');

/**
 * HTTP-triggered function that triggers a GitHub Actions workflow_dispatch on
 * another repository. The target repository, workflow, and ref are taken
 * entirely from configuration (app settings):
 *
 *   - TARGET_GITHUB_TOKEN  GitHub token authorized to dispatch workflows.
 *   - TARGET_REPO_URL      Target repository, e.g. https://github.com/owner/repo
 *   - TARGET_WORKFLOW_FILE Workflow file name, e.g. ci.yml (or its workflow id).
 *   - TARGET_WORKFLOW_REF  Git ref (branch or tag) to run the workflow on.
 */
async function triggerWorkflow(request, context) {
  const token = process.env.TARGET_GITHUB_TOKEN;
  const repoUrl = process.env.TARGET_REPO_URL;
  const workflowFile = process.env.TARGET_WORKFLOW_FILE;
  const ref = process.env.TARGET_WORKFLOW_REF;

  try {
    const { owner, repo } = parseRepoUrl(repoUrl);

    await triggerWorkflowDispatch({ token, owner, repo, workflowFile, ref });

    const target = `${owner}/${repo} (${workflowFile} @ ${ref})`;
    context.log(`Dispatched workflow on ${target}.`);
    return {
      status: 202,
      jsonBody: { ok: true, dispatched: { owner, repo, workflow: workflowFile, ref } },
    };
  } catch (error) {
    context.error('Failed to dispatch workflow:', error.message);
    return {
      status: 500,
      jsonBody: { ok: false, error: error.message },
    };
  }
}

app.http('triggerWorkflow', {
  methods: ['POST'],
  authLevel: 'function',
  handler: triggerWorkflow,
});

module.exports = { triggerWorkflow };
