'use strict';

const { editOriginalInteractionResponse } = require('./discord');
const { parseRepoUrl, triggerWorkflowDispatch } = require('./github');

// Slow work (the GitHub dispatch) is handed to this queue so the HTTP handler
// can acknowledge Discord within its 3s window. The discordDispatchWorker
// function drains it and edits the deferred message with the result.
const DISPATCH_QUEUE_NAME = 'discord-dispatch';

/**
 * Drains a queued slash-command dispatch: triggers the GitHub workflow and then
 * edits the original (deferred) Discord interaction message with the result.
 *
 * Running out of band keeps the HTTP interaction handler within Discord's 3s
 * acknowledgement window. The interaction token is valid for 15 minutes, which
 * comfortably covers the dispatch plus any worker cold start.
 *
 * @param {object|string} queueItem - The queued payload (object, or JSON string).
 * @param {object} context - The Azure Functions invocation context.
 */
async function handleDispatch(queueItem, context) {
  const message = typeof queueItem === 'string' ? JSON.parse(queueItem) : queueItem;
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

module.exports = { handleDispatch, DISPATCH_QUEUE_NAME };
