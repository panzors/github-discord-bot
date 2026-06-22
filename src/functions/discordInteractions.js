'use strict';

const { app } = require('@azure/functions');
const {
  InteractionType,
  InteractionResponseType,
  MessageFlags,
  verifyDiscordRequest,
} = require('../discordInteractions');
const { parseRepoUrl, triggerWorkflowDispatch } = require('../github');

// The slash command this endpoint handles. Must match the name registered with
// Discord (see scripts/register-commands.js).
const COMMAND_NAME = 'deploy';

/**
 * Discord Interactions Endpoint.
 *
 * Configure this function's URL as the "Interactions Endpoint URL" in the
 * Discord Developer Portal (General Information). It must be `anonymous` auth
 * because Discord does not send an Azure function key — requests are instead
 * authenticated by their Ed25519 signature.
 *
 * On the `/deploy` slash command it triggers the configured GitHub Actions
 * workflow_dispatch (same target config as the triggerWorkflow function).
 */
async function discordInteractions(request, context) {
  // Read the raw body once; signature verification needs the exact bytes.
  const rawBody = await request.text();
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');

  let isValid;
  try {
    isValid = verifyDiscordRequest({
      publicKey: process.env.DISCORD_PUBLIC_KEY,
      signature,
      timestamp,
      rawBody,
    });
  } catch (error) {
    context.error('Signature verification error:', error.message);
    return { status: 500, jsonBody: { error: error.message } };
  }

  // Discord verifies the endpoint by sending requests with bad signatures and
  // expecting a 401, so this rejection is required, not just defensive.
  if (!isValid) {
    return { status: 401, body: 'invalid request signature' };
  }

  const interaction = JSON.parse(rawBody);

  // Respond to Discord's PING health check.
  if (interaction.type === InteractionType.PING) {
    return { status: 200, jsonBody: { type: InteractionResponseType.PONG } };
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const commandName = interaction.data?.name;
    if (commandName !== COMMAND_NAME) {
      return {
        status: 200,
        jsonBody: {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: `Unknown command: \`${commandName}\`.`, flags: MessageFlags.EPHEMERAL },
        },
      };
    }

    try {
      const { owner, repo } = parseRepoUrl(process.env.TARGET_REPO_URL);
      const workflowFile = process.env.TARGET_WORKFLOW_FILE;
      const ref = process.env.TARGET_WORKFLOW_REF;

      await triggerWorkflowDispatch({
        token: process.env.TARGET_GITHUB_TOKEN,
        owner,
        repo,
        workflowFile,
        ref,
      });

      context.log(`Dispatched workflow ${workflowFile} on ${owner}/${repo} from slash command.`);
      return {
        status: 200,
        jsonBody: {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: `🚀 Triggered \`${workflowFile}\` on \`${owner}/${repo}\` (\`${ref}\`).` },
        },
      };
    } catch (error) {
      context.error('Failed to dispatch workflow from slash command:', error.message);
      return {
        status: 200,
        jsonBody: {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: `❌ Failed to trigger workflow: ${error.message}`, flags: MessageFlags.EPHEMERAL },
        },
      };
    }
  }

  return { status: 400, body: 'unhandled interaction type' };
}

app.http('discordInteractions', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'discord/interactions',
  handler: discordInteractions,
});

module.exports = { discordInteractions, COMMAND_NAME };
