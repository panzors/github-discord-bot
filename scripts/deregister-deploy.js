'use strict';

/**
 * Deletes the /deploy slash command from Discord.
 *
 * Run this once after deploying the /rune2e command to remove /deploy
 * so it no longer appears in servers.
 *
 * Required environment variables:
 *   DISCORD_APP_ID    Application ID (Developer Portal → General Information).
 *   DISCORD_BOT_TOKEN Bot token (Developer Portal → Bot).
 *
 * Optional:
 *   DISCORD_GUILD_ID  If set, removes the guild-scoped command instead of the
 *                     global one. Use this if /deploy was originally registered
 *                     with a guild ID.
 *
 * Example:
 *   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... \
 *     node scripts/deregister-deploy.js
 */

const APP_ID = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const COMMAND_TO_REMOVE = 'deploy';

async function main() {
  if (!APP_ID || !BOT_TOKEN) {
    throw new Error('Set DISCORD_APP_ID and DISCORD_BOT_TOKEN environment variables.');
  }

  const base = GUILD_ID
    ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

  const headers = {
    Authorization: `Bot ${BOT_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const listResponse = await fetch(base, { headers });
  const listText = await listResponse.text();
  if (!listResponse.ok) {
    throw new Error(`Failed to list commands (${listResponse.status}): ${listText}`);
  }

  const allCommands = JSON.parse(listText);
  const target = allCommands.find(c => c.name === COMMAND_TO_REMOVE);

  if (!target) {
    console.log(`No /${COMMAND_TO_REMOVE} command found — nothing to remove.`);
    return;
  }

  const deleteResponse = await fetch(`${base}/${target.id}`, { method: 'DELETE', headers });
  if (!deleteResponse.ok) {
    const text = await deleteResponse.text().catch(() => '');
    throw new Error(`Failed to delete /${COMMAND_TO_REMOVE} (${deleteResponse.status}): ${text}`);
  }

  const scope = GUILD_ID ? `guild ${GUILD_ID}` : 'globally';
  console.log(`Deleted /${COMMAND_TO_REMOVE} ${scope}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
