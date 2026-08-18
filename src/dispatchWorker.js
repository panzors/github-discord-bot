'use strict';

const { editOriginalInteractionResponse } = require('./discord');
const { parseRepoUrl, triggerWorkflowDispatch, listIssues, getLatestSuccessfulWorkflowRun, compareCommits } = require('./github');

/**
 * Triggers the GitHub workflow and then edits the original (deferred) Discord
 * interaction message with the result.
 *
 * The interaction handler kicks this off without awaiting it (fire-and-forget)
 * so it can acknowledge Discord within its 3s window. The interaction token is
 * valid for 15 minutes, which comfortably covers the dispatch. Note this is
 * best-effort: if the Function instance is recycled right after the ack, the
 * follow-up may not be delivered.
 *
 * @param {object} message - The dispatch payload.
 * @param {string} message.applicationId - Discord application id.
 * @param {string} message.token - Discord interaction token.
 * @param {string} message.branch - Git ref to run the workflow on.
 * @param {boolean} [message.fastMode] - The fast_mode workflow input.
 * @param {boolean} [message.recordVideo] - The record_video workflow input.
 * @param {object} context - The Azure Functions invocation context.
 */
async function handleDispatch(message, context) {
  const { applicationId, token, branch, fastMode, recordVideo } = message;

  try {
    const { owner, repo } = parseRepoUrl(process.env.TARGET_REPO_URL);
    const workflowFile = process.env.TARGET_WORKFLOW_FILE;

    await triggerWorkflowDispatch({
      token: process.env.TARGET_GITHUB_TOKEN,
      owner,
      repo,
      workflowFile,
      ref: branch,
      inputs: { fast_mode: fastMode, record_video: recordVideo },
    });

    context.log(`Dispatched ${workflowFile} on ${owner}/${repo}@${branch} (fast_mode=${fastMode}, record_video=${recordVideo})`);

    const flags = [];
    if (fastMode) flags.push('fast mode');
    if (recordVideo) flags.push('record video');
    const flagStr = flags.length ? ` (${flags.join(', ')})` : '';

    await editOriginalInteractionResponse({
      applicationId,
      token,
      payload: { content: `🚀 Running e2e on \`${owner}/${repo}\` @ \`${branch}\`${flagStr}.` },
    });
  } catch (error) {
    context.error('Failed to dispatch workflow from queue:', error.message);
    // Surface the failure back to the user in their deferred message. Swallow
    // any follow-up error so we don't crash the invocation (and retry endlessly)
    // just because the edit failed.
    try {
      await editOriginalInteractionResponse({
        applicationId,
        token,
        payload: { content: `❌ Failed to trigger e2e: ${error.message}` },
      });
    } catch (followUpError) {
      context.error('Failed to post failure follow-up to Discord:', followUpError.message);
    }
  }
}

/**
 * Fetches issues (opened or closed) from GitHub and edits the deferred Discord
 * interaction message with the results.
 *
 * @param {object} message
 * @param {string} message.applicationId
 * @param {string} message.token
 * @param {'open'|'closed'} message.state
 * @param {number} message.days
 * @param {object} context
 */
async function handleIssues(message, context) {
  const { applicationId, token, state, days } = message;

  try {
    const { owner, repo } = parseRepoUrl(process.env.TARGET_REPO_URL);
    const issues = await listIssues({
      token: process.env.TARGET_GITHUB_TOKEN,
      owner,
      repo,
      state,
      days,
    });

    const hours = days * 24;
    const timeLabel = hours === 24 ? 'last 24 hours' : `last ${hours} hours`;
    const verb = state === 'closed' ? 'closed' : 'opened';
    const repoUrl = `https://github.com/${owner}/${repo}`;

    let content;
    if (issues.length === 0) {
      content = `No issues ${verb} in the ${timeLabel} for [${owner}/${repo}](${repoUrl}).`;
    } else {
      const lines = issues.map(i => `• [#${i.number} ${i.title}](${i.html_url})`);
      content = `**${issues.length} issue${issues.length === 1 ? '' : 's'} ${verb} in the ${timeLabel}** — [${owner}/${repo}](${repoUrl}):\n${lines.join('\n')}`;
    }

    await editOriginalInteractionResponse({ applicationId, token, payload: { content } });
  } catch (error) {
    context.error('Failed to fetch issues:', error.message);
    try {
      await editOriginalInteractionResponse({
        applicationId,
        token,
        payload: { content: `❌ Failed to fetch issues: ${error.message}` },
      });
    } catch (followUpError) {
      context.error('Failed to post failure follow-up to Discord:', followUpError.message);
    }
  }
}

/**
 * Triggers the deploy workflow on the target repository and edits the original
 * Discord interaction message with the result.
 *
 * @param {object} message
 * @param {string} message.applicationId - Discord application id.
 * @param {string} message.token - Discord interaction token.
 * @param {object} context - The Azure Functions invocation context.
 */
async function handleDeploy(message, context) {
  const { applicationId, token } = message;

  if (!process.env.TARGET_REPO_URL || !process.env.TARGET_GITHUB_TOKEN) {
    try {
      await editOriginalInteractionResponse({
        applicationId,
        token,
        payload: { content: 'Nothing happened because no action has been configured.' },
      });
    } catch (error) {
      context.error('Failed to post unconfigured response to Discord:', error.message);
    }
    return;
  }

  try {
    const { owner, repo } = parseRepoUrl(process.env.TARGET_REPO_URL);
    const workflowFile = process.env.TARGET_DEPLOY_WORKFLOW_FILE || 'deploy.yml';

    await triggerWorkflowDispatch({
      token: process.env.TARGET_GITHUB_TOKEN,
      owner,
      repo,
      workflowFile,
      ref: 'main',
    });

    context.log(`Dispatched ${workflowFile} on ${owner}/${repo}@main`);

    await editOriginalInteractionResponse({
      applicationId,
      token,
      payload: { content: `🚀 Deploying \`${owner}/${repo}\` to production. Check [Actions](https://github.com/${owner}/${repo}/actions) for progress.` },
    });
  } catch (error) {
    context.error('Failed to dispatch deploy workflow:', error.message);
    try {
      await editOriginalInteractionResponse({
        applicationId,
        token,
        payload: { content: `❌ Failed to trigger deploy: ${error.message}` },
      });
    } catch (followUpError) {
      context.error('Failed to post failure follow-up to Discord:', followUpError.message);
    }
  }
}

/**
 * Triggers the smoke test live workflow on the target repository and edits the
 * original Discord interaction message with the result.
 *
 * @param {object} message
 * @param {string} message.applicationId - Discord application id.
 * @param {string} message.token - Discord interaction token.
 * @param {object} context - The Azure Functions invocation context.
 */
async function handleSmokeTestLive(message, context) {
  const { applicationId, token } = message;

  if (!process.env.TARGET_REPO_URL || !process.env.TARGET_GITHUB_TOKEN) {
    try {
      await editOriginalInteractionResponse({
        applicationId,
        token,
        payload: { content: 'Nothing happened because no action has been configured.' },
      });
    } catch (error) {
      context.error('Failed to post unconfigured response to Discord:', error.message);
    }
    return;
  }

  try {
    const { owner, repo } = parseRepoUrl(process.env.TARGET_REPO_URL);
    const workflowFile = process.env.TARGET_SMOKE_TEST_LIVE_WORKFLOW_FILE || 'smoke-test-live.yml';

    await triggerWorkflowDispatch({
      token: process.env.TARGET_GITHUB_TOKEN,
      owner,
      repo,
      workflowFile,
      ref: 'main',
    });

    context.log(`Dispatched ${workflowFile} on ${owner}/${repo}@main`);

    await editOriginalInteractionResponse({
      applicationId,
      token,
      payload: { content: `🔍 Running smoke tests on \`${owner}/${repo}\`. Check [Actions](https://github.com/${owner}/${repo}/actions) for progress.` },
    });
  } catch (error) {
    context.error('Failed to dispatch smoke test workflow:', error.message);
    try {
      await editOriginalInteractionResponse({
        applicationId,
        token,
        payload: { content: `❌ Failed to trigger smoke tests: ${error.message}` },
      });
    } catch (followUpError) {
      context.error('Failed to post failure follow-up to Discord:', followUpError.message);
    }
  }
}

/**
 * Fetches the latest successful deployment and diffs it against main branch.
 *
 * @param {object} message
 * @param {string} message.applicationId - Discord application id.
 * @param {string} message.token - Discord interaction token.
 * @param {object} context - The Azure Functions invocation context.
 */
async function handleDiffWithDeployed(message, context) {
  const { applicationId, token } = message;

  if (!process.env.TARGET_REPO_URL || !process.env.TARGET_GITHUB_TOKEN) {
    try {
      await editOriginalInteractionResponse({
        applicationId,
        token,
        payload: { content: 'Nothing happened because no action has been configured.' },
      });
    } catch (error) {
      context.error('Failed to post unconfigured response to Discord:', error.message);
    }
    return;
  }

  try {
    const { owner, repo } = parseRepoUrl(process.env.TARGET_REPO_URL);
    const deployWorkflowFile = process.env.TARGET_DEPLOY_WORKFLOW_FILE || 'deploy.yml';

    const latestRun = await getLatestSuccessfulWorkflowRun({
      token: process.env.TARGET_GITHUB_TOKEN,
      owner,
      repo,
      workflowFile: deployWorkflowFile,
    });

    if (!latestRun || !latestRun.head_commit) {
      await editOriginalInteractionResponse({
        applicationId,
        token,
        payload: { content: '❌ No successful deployment runs found.' },
      });
      return;
    }

    const deployedSha = latestRun.head_commit.sha;
    const mainSha = 'main';

    const commits = await compareCommits({
      token: process.env.TARGET_GITHUB_TOKEN,
      owner,
      repo,
      base: deployedSha,
      head: mainSha,
    });

    let content;
    if (commits.length === 0) {
      content = `✅ Deployed version is up to date with \`main\`.\n\n**Deployed commit:** [\`${deployedSha.substring(0, 7)}\`](https://github.com/${owner}/${repo}/commit/${deployedSha})\n**Deployed at:** ${latestRun.created_at}`;
    } else {
      const commitLines = commits.map(c => `• [\`${c.sha}\`](${c.html_url}) — ${c.message}`);
      content = `🚀 **${commits.length} commit${commits.length === 1 ? '' : 's'} ahead on \`main\`:**\n${commitLines.join('\n')}\n\n**Deployed commit:** [\`${deployedSha.substring(0, 7)}\`](https://github.com/${owner}/${repo}/commit/${deployedSha})\n**Deployed at:** ${latestRun.created_at}`;
    }

    await editOriginalInteractionResponse({ applicationId, token, payload: { content } });
  } catch (error) {
    context.error('Failed to diff with deployed:', error.message);
    try {
      await editOriginalInteractionResponse({
        applicationId,
        token,
        payload: { content: `❌ Failed to diff with deployed: ${error.message}` },
      });
    } catch (followUpError) {
      context.error('Failed to post failure follow-up to Discord:', followUpError.message);
    }
  }
}

module.exports = { handleDispatch, handleIssues, handleDeploy, handleSmokeTestLive, handleDiffWithDeployed };
