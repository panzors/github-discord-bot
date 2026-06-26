'use strict';

/**
 * Registers (creates/updates) Discord slash commands for this application.
 *
 * Uses PUT (bulk overwrite) so removing a command from the array and re-running
 * this script automatically deregisters it from Discord.
 *
 * Run this once on initial deploy, and again whenever command definitions change.
 *
 * Required environment variables:
 *   DISCORD_APP_ID    Application ID (Developer Portal → General Information).
 *   DISCORD_BOT_TOKEN Bot token (Developer Portal → Bot).
 *
 * Optional:
 *   DISCORD_GUILD_ID  If set, registers commands to that guild (server) only.
 *                     Guild commands appear instantly — ideal for testing.
 *                     Without it, commands are registered globally (up to 1 hour
 *                     to propagate).
 *
 * Example:
 *   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... \
 *     node scripts/register-commands.js
 */

const APP_ID = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const commands = [
  {
    name: 'rune2e',
    description: 'Run the e2e test suite on a branch',
    type: 1, // CHAT_INPUT (slash command)
    options: [
      {
        type: 3, // STRING
        name: 'branch',
        description: 'Branch to run e2e on (default: main)',
        required: false,
        autocomplete: true,
      },
      {
        type: 5, // BOOLEAN
        name: 'fast_mode',
        description: 'Fast mode: 10 s timeout, no retries. Quick smoke-check signal.',
        required: false,
      },
      {
        type: 5, // BOOLEAN
        name: 'record_video',
        description: 'Record video for all test executions (default: failures only)',
        required: false,
      },
    ],
  },
  {
    name: 'issuesopened',
    description: 'List issues opened in the last N days (default: 1)',
    type: 1,
    options: [
      {
        type: 4, // INTEGER
        name: 'days',
        description: 'Number of days to look back (default: 1)',
        required: false,
        min_value: 1,
      },
    ],
  },
  {
    name: 'issuesclosed',
    description: 'List issues closed in the last N days (default: 1)',
    type: 1,
    options: [
      {
        type: 4, // INTEGER
        name: 'days',
        description: 'Number of days to look back (default: 1)',
        required: false,
        min_value: 1,
      },
    ],
  },
];

async function main() {
  if (!APP_ID || !BOT_TOKEN) {
    throw new Error('Set DISCORD_APP_ID and DISCORD_BOT_TOKEN environment variables.');
  }

  const url = GUILD_ID
    ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Command registration failed (${response.status}): ${text}`);
  }

  const scope = GUILD_ID ? `guild ${GUILD_ID}` : 'globally';
  const names = commands.map(c => `/${c.name}`).join(', ');
  console.log(`Registered ${names} ${scope}.`);
  console.log(text);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
