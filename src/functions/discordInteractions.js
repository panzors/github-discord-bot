'use strict';

const { app } = require('@azure/functions');
const {
  InteractionType,
  InteractionResponseType,
  MessageFlags,
  verifyDiscordRequest,
} = require('../discordInteractions');
const { parseRepoUrl, triggerWorkflowDispatch, listBranches } = require('../github');

const COMMAND_NAME = 'rune2e';

async function discordInteractions(request, context) {
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

  if (!isValid) {
    return { status: 401, body: 'invalid request signature' };
  }

  const interaction = JSON.parse(rawBody);

  if (interaction.type === InteractionType.PING) {
    return { status: 200, jsonBody: { type: InteractionResponseType.PONG } };
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
    const focused = interaction.data?.options?.find(o => o.focused);
    const filter = focused?.value ?? '';

    try {
      const { owner, repo } = parseRepoUrl(process.env.TARGET_REPO_URL);
      const branches = await listBranches({
        token: process.env.TARGET_GITHUB_TOKEN,
        owner,
        repo,
        filter,
      });
      return {
        status: 200,
        jsonBody: {
          type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
          data: { choices: branches.map(b => ({ name: b, value: b })) },
        },
      };
    } catch (error) {
      context.error('Autocomplete branch fetch failed:', error.message);
      return {
        status: 200,
        jsonBody: {
          type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
          data: { choices: [] },
        },
      };
    }
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

    const options = interaction.data?.options ?? [];
    const branch = options.find(o => o.name === 'branch')?.value ?? 'main';
    const fastMode = options.find(o => o.name === 'fast_mode')?.value ?? false;
    const recordVideo = options.find(o => o.name === 'record_video')?.value ?? false;

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

      return {
        status: 200,
        jsonBody: {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: `🚀 Running e2e on \`${owner}/${repo}\` @ \`${branch}\`${flagStr}.` },
        },
      };
    } catch (error) {
      context.error('Failed to dispatch workflow from slash command:', error.message);
      return {
        status: 200,
        jsonBody: {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: `❌ Failed to trigger e2e: ${error.message}`, flags: MessageFlags.EPHEMERAL },
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
