'use strict';

const { app } = require('@azure/functions');
const {
  InteractionType,
  InteractionResponseType,
  MessageFlags,
  verifyDiscordRequest,
} = require('../discordInteractions');
const { parseRepoUrl, listBranches } = require('../github');
const { handleDispatch, handleIssues } = require('../dispatchWorker');

const COMMAND_NAME = 'rune2e';
const ISSUES_OPENED_COMMAND = 'issuesopened';
const ISSUES_CLOSED_COMMAND = 'issuesclosed';

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
    const options = interaction.data?.options ?? [];

    if (commandName === ISSUES_OPENED_COMMAND || commandName === ISSUES_CLOSED_COMMAND) {
      const days = options.find(o => o.name === 'days')?.value ?? 1;
      const state = commandName === ISSUES_CLOSED_COMMAND ? 'closed' : 'open';
      const hours = days * 24;
      const timeLabel = hours === 24 ? 'last 24 hours' : `last ${hours} hours`;

      handleIssues(
        { applicationId: interaction.application_id, token: interaction.token, state, days },
        context
      ).catch(error => context.error('Background issues fetch failed:', error.message));

      context.log(`Acknowledged ${commandName} for days=${days}`);

      return {
        status: 200,
        jsonBody: {
          type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Fetching issues ${state === 'closed' ? 'closed' : 'opened'} in the ${timeLabel}…`,
            flags: MessageFlags.EPHEMERAL,
          },
        },
      };
    }

    if (commandName !== COMMAND_NAME) {
      return {
        status: 200,
        jsonBody: {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: `Unknown command: \`${commandName}\`.`, flags: MessageFlags.EPHEMERAL },
        },
      };
    }

    const branch = options.find(o => o.name === 'branch')?.value ?? 'main';
    const fastMode = options.find(o => o.name === 'fast_mode')?.value ?? false;
    const recordVideo = options.find(o => o.name === 'record_video')?.value ?? false;

    // Kick off the slow GitHub dispatch without awaiting it, then immediately
    // acknowledge with a private "deferred" response so we beat Discord's 3s
    // deadline even when the dispatch is slow. handleDispatch edits this message
    // with the success/failure result via the interaction follow-up webhook.
    //
    // This is best-effort: on Consumption the instance can be recycled right
    // after the response is sent, in which case the follow-up may not land.
    handleDispatch(
      {
        applicationId: interaction.application_id,
        token: interaction.token,
        branch,
        fastMode,
        recordVideo,
      },
      context
    ).catch(error => context.error('Background dispatch failed:', error.message));

    context.log(`Acknowledged e2e dispatch for branch ${branch} (fast_mode=${fastMode}, record_video=${recordVideo})`);

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
  handler: discordInteractions,
});

module.exports = { discordInteractions, COMMAND_NAME, ISSUES_OPENED_COMMAND, ISSUES_CLOSED_COMMAND };
