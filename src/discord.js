'use strict';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

/**
 * Posts a message to a Discord webhook.
 *
 * @param {string} webhookUrl - The Discord webhook URL.
 * @param {object} payload - The message payload (e.g. { content, username, embeds }).
 * @returns {Promise<void>} Resolves when Discord accepts the message.
 * @throws {Error} If the webhook URL is missing or Discord returns a non-2xx response.
 */
async function postToDiscord(webhookUrl, payload) {
  if (!webhookUrl) {
    throw new Error('Missing Discord webhook URL. Set the DISCORD_WEBHOOK_URL setting.');
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Discord webhook returned ${response.status} ${response.statusText}: ${body}`);
  }
}

/**
 * Edits the original response of a deferred Discord interaction.
 *
 * After replying to an interaction with a deferred response, the bot has up to
 * 15 minutes to fill in the real content by PATCHing the `@original` message on
 * the interaction follow-up webhook. The interaction token authenticates the
 * call, so no bot token is required. The message keeps whatever visibility
 * (e.g. ephemeral) was set on the deferred response.
 *
 * @param {object} options
 * @param {string} options.applicationId - The Discord application id.
 * @param {string} options.token - The interaction token from the original interaction.
 * @param {object} options.payload - The message payload (e.g. { content }).
 * @param {string} [options.apiBase] - Override the Discord API base URL (for tests).
 * @returns {Promise<void>} Resolves when Discord accepts the edit.
 * @throws {Error} If required values are missing or Discord returns a non-2xx response.
 */
async function editOriginalInteractionResponse({ applicationId, token, payload, apiBase = DISCORD_API_BASE }) {
  if (!applicationId) {
    throw new Error('Missing Discord application id.');
  }
  if (!token) {
    throw new Error('Missing Discord interaction token.');
  }

  const url = `${apiBase}/webhooks/${applicationId}/${token}/messages/@original`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Discord interaction edit returned ${response.status} ${response.statusText}: ${body}`);
  }
}

module.exports = { postToDiscord, editOriginalInteractionResponse };
