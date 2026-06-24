'use strict';

const { editOriginalInteractionResponse } = require('./discord');
const { parseRepoUrl, triggerWorkflowDispatch } = require('./github');

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

module.exports = { handleDispatch };
