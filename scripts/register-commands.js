'use strict';

/**
 * Registers (creates/updates) the Discord slash command for this application.
 *
 * Run this once, and again whenever the command definition changes.
 *
 * Required environment variables:
 *   DISCORD_APP_ID    Application ID (Developer Portal → General Information).
 *   DISCORD_BOT_TOKEN Bot token (Developer Portal → Bot).
 *
 * Optional:
 *   DISCORD_GUILD_ID  If set, registers the command to that guild (server) only.
 *                     Guild commands appear instantly — ideal for testing.
 *                     Without it, the command is registered globally (can take
 *                     up to an hour to propagate).
 *
 * Example:
 *   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... \
 *     node scripts/register-commands.js
 */

const APP_ID = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

// Keep this name in sync with COMMAND_NAME in src/functions/discordInteractions.js.
const command = {
  name: 'deploy',
  description: 'Trigger the configured GitHub Actions workflow',
  type: 1, // CHAT_INPUT (slash command)
};

async function main() {
  if (!APP_ID || !BOT_TOKEN) {
    throw new Error('Set DISCORD_APP_ID and DISCORD_BOT_TOKEN environment variables.');
  }

  const url = GUILD_ID
    ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Command registration failed (${response.status}): ${text}`);
  }

  const scope = GUILD_ID ? `guild ${GUILD_ID}` : 'globally';
  console.log(`Registered /${command.name} ${scope}.`);
  console.log(text);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
