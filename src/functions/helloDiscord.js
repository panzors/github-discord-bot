'use strict';

const { app } = require('@azure/functions');
const { postToDiscord } = require('../discord');

/**
 * HTTP-triggered function that posts a "hello world" message to a Discord
 * webhook. This is the proof-of-concept entry point for the bot.
 *
 * Trigger it with GET or POST. An optional `message` field (JSON body or query
 * string) overrides the default greeting.
 */
async function helloDiscord(request, context) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  let message = 'Hello world! 👋 This is a proof-of-concept post from an Azure Function.';
  try {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (body && typeof body.message === 'string' && body.message.trim()) {
        message = body.message;
      }
    } else {
      const queryMessage = request.query.get('message');
      if (queryMessage && queryMessage.trim()) {
        message = queryMessage;
      }
    }

    await postToDiscord(webhookUrl, {
      username: 'GitHub Discord Bot',
      content: message,
    });

    context.log('Posted message to Discord webhook.');
    return {
      status: 200,
      jsonBody: { ok: true, message },
    };
  } catch (error) {
    context.error('Failed to post to Discord webhook:', error.message);
    return {
      status: 500,
      jsonBody: { ok: false, error: error.message },
    };
  }
}

app.http('helloDiscord', {
  methods: ['GET', 'POST'],
  authLevel: 'function',
  handler: helloDiscord,
});

module.exports = { helloDiscord };
