'use strict';

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

module.exports = { postToDiscord };
