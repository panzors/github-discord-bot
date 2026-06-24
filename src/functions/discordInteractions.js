'use strict';

const { app, output } = require('@azure/functions');
const {
  InteractionType,
  InteractionResponseType,
  MessageFlags,
  verifyDiscordRequest,
} = require('../discordInteractions');
const { parseRepoUrl, listBranches } = require('../github');
const { DISPATCH_QUEUE_NAME } = require('../dispatchWorker');

const COMMAND_NAME = 'rune2e';

const dispatchQueueOutput = output.storageQueue({
  queueName: DISPATCH_QUEUE_NAME,
  connection: 'AzureWebJobsStorage',
});

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

    // Hand the slow GitHub dispatch off to the queue worker, then immediately
    // acknowledge with a private "deferred" response so we beat Discord's 3s
    // deadline even when the dispatch (or a cold start of the worker) is slow.
    // The worker edits this message with the success/failure result.
    context.extraOutputs.set(dispatchQueueOutput, {
      applicationId: interaction.application_id,
      token: interaction.token,
      branch,
      fastMode,
      recordVideo,
    });

    context.log(`Queued e2e dispatch for branch ${branch} (fast_mode=${fastMode}, record_video=${recordVideo})`);

    return {
      status: 200,
      jsonBody: {
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: MessageFlags.EPHEMERAL },
      },
    };
  }

  return { status: 400, body: 'unhandled interaction type' };
}

app.http('discordInteractions', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'discord/interactions',
  extraOutputs: [dispatchQueueOutput],
  handler: discordInteractions,
});

module.exports = { discordInteractions, COMMAND_NAME, DISPATCH_QUEUE_NAME };
