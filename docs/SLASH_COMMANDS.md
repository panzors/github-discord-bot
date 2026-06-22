# Discord slash command → trigger a workflow

This sets up a Discord **slash command** (`/deploy`) that calls the Azure
Function, which in turn triggers a GitHub Actions `workflow_dispatch` on another
repository.

```
/deploy  ──▶  discordInteractions function  ──▶  GitHub workflow_dispatch
 (Discord)        (Azure Function)                  (target repo)
```

Unlike the outbound webhook (`helloDiscord`), this is **inbound**: Discord sends
signed requests to your function. The flow has three moving parts — a Discord
**application**, the **interactions endpoint** function, and a one-time
**command registration**.

## Pieces in this repo

- `src/functions/discordInteractions.js` — HTTP endpoint (`POST /api/discord/interactions`,
  `anonymous` auth). Verifies Discord's signature, answers the PING health check,
  and on `/deploy` dispatches the configured workflow.
- `src/discordInteractions.js` — Ed25519 signature verification (Node's built-in
  `crypto`, no extra dependency).
- `scripts/register-commands.js` — registers the `/deploy` command with Discord.

## 1. Create a Discord application

1. Go to the **Discord Developer Portal**: https://discord.com/developers/applications
2. **New Application** → name it.
3. From **General Information**, copy:
   - **Application ID** → used as `DISCORD_APP_ID` (for registration)
   - **Public Key** → used as `DISCORD_PUBLIC_KEY` (Azure app setting)
4. Go to **Bot** → **Reset Token** → copy the **bot token** → used as
   `DISCORD_BOT_TOKEN` (for registration).
5. Go to **OAuth2 → URL Generator**, tick the **`applications.commands`** scope,
   open the generated URL, and add the app to your server (guild).

## 2. Configure the Azure Function

The interactions function needs these **application settings** on the Function
App (in addition to the `TARGET_*` settings the workflow dispatch already uses):

| App setting          | Description |
| -------------------- | ----------- |
| `DISCORD_PUBLIC_KEY` | The application's **Public Key** from step 1. Used to verify request signatures. |
| `TARGET_GITHUB_TOKEN`  | GitHub token authorized to dispatch the workflow. |
| `TARGET_REPO_URL`      | Target repo, e.g. `https://github.com/owner/repo`. |
| `TARGET_WORKFLOW_FILE` | Workflow file to trigger, e.g. `ci.yml`. |
| `TARGET_WORKFLOW_REF`  | Branch/tag to run on, e.g. `main`. |

```bash
az functionapp config appsettings set \
  --name <app-name> \
  --resource-group <resource-group> \
  --settings DISCORD_PUBLIC_KEY="<public-key>"
```

Deploy the function (see [DEPLOYMENT.md](DEPLOYMENT.md)) so the endpoint is live.

## 3. Register the slash command

Run the registration script once. Use `DISCORD_GUILD_ID` (your server's ID) so
the command appears instantly while testing; omit it to register globally
(propagation can take up to an hour).

```bash
DISCORD_APP_ID="<application-id>" \
DISCORD_BOT_TOKEN="<bot-token>" \
DISCORD_GUILD_ID="<your-server-id>" \
  node scripts/register-commands.js
```

> To get your server ID, enable **Developer Mode** in Discord
> (User Settings → Advanced), then right-click the server → **Copy Server ID**.

## 4. Point Discord at your function

1. In the Developer Portal → your app → **General Information**, set
   **Interactions Endpoint URL** to your function URL:
   ```
   https://<your-app>.azurewebsites.net/api/discord/interactions
   ```
2. **Save Changes.** Discord immediately sends a signed `PING` (and some
   deliberately *bad* signatures) to verify the endpoint. It will only save if
   your function verifies signatures and returns the PONG — which it does.

If saving fails, the function isn't deployed, `DISCORD_PUBLIC_KEY` is wrong, or
the URL is incorrect.

## 5. Use it

In your server, type `/deploy`. The function triggers the configured workflow
and replies in-channel:

```
🚀 Triggered `ci.yml` on `owner/repo` (`main`).
```

## Notes & limitations

- **Auth model:** the endpoint is `anonymous` (no Azure function key) because
  Discord won't send one. Security comes from **Ed25519 signature verification** —
  do not remove that check.
- **3-second rule:** Discord expects a response within ~3 seconds. A single
  `workflow_dispatch` call is well within that. If you later add slow work,
  switch to a deferred response (type `5`) and follow up via the interaction
  webhook.
- **Fixed target:** like the `triggerWorkflow` function, the workflow and ref
  come from config. To let the command choose them, add command *options* in
  `register-commands.js` and read `interaction.data.options` in the handler.
- **Changing the command name:** keep `COMMAND_NAME` in
  `src/functions/discordInteractions.js` in sync with `name` in
  `scripts/register-commands.js`.
