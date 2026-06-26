# github-discord-bot

A minimal **Discord bot** built as an **Azure Function** (Node.js). This is a
proof of concept: an HTTP-triggered function posts a "hello world" message to a
Discord channel via a [webhook](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks).

## How it works

- `src/functions/helloDiscord.js` — HTTP-triggered Azure Function (Node.js v4
  programming model). On request, it posts a message to the configured Discord
  webhook.
- `src/discord.js` — small helpers that POST a JSON payload to a Discord webhook
  and edit a deferred interaction reply via the follow-up webhook.
- `src/functions/triggerWorkflow.js` — HTTP-triggered function (`POST`) that
  triggers a GitHub Actions [`workflow_dispatch`](https://docs.github.com/en/actions/using-workflows/manually-running-a-workflow)
  on another repository. The target repo, workflow, and ref come entirely from
  configuration.
- `src/github.js` — small helper that dispatches a workflow via the GitHub REST API.
- `src/functions/discordInteractions.js` — inbound Discord
  [Interactions Endpoint](https://discord.com/developers/docs/interactions/receiving-and-responding).
  Handles a `/deploy` **slash command**: acks immediately with a private
  deferred response to beat Discord's 3s deadline, then fires off the workflow
  dispatch. See [`docs/SLASH_COMMANDS.md`](docs/SLASH_COMMANDS.md).
- `src/dispatchWorker.js` — `handleDispatch`: runs the GitHub `workflow_dispatch`
  and edits the deferred reply with the result, off the critical path of the
  inbound request (fire-and-forget, best-effort).
- `src/discordInteractions.js` — Ed25519 signature verification for incoming
  Discord requests (built-in `crypto`, no extra dependency).

The `helloDiscord` function responds to `GET` and `POST`. You can override the
default greeting with a `message` query parameter (GET) or a
`{ "message": "..." }` JSON body (POST).

### Triggering a workflow on another repository

`POST` to the `triggerWorkflow` function (with its function key). It reads the
target from app settings and sends a `workflow_dispatch` request:

```bash
curl -X POST "http://localhost:7071/api/triggerWorkflow"
```

On success it returns `202` with the dispatched target. The GitHub token needs
permission to run workflows on the target repo (a fine-grained PAT with
**Actions: read and write** on that repository, or a classic PAT with the
`workflow` scope).

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
  installed globally: `npm install -g azure-functions-core-tools@4 --unsafe-perm true`
- A Discord webhook URL — in Discord: **Server Settings → Integrations →
  Webhooks → New Webhook**, then copy the webhook URL.

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local settings from the example and add your webhook URL:

   ```bash
   cp local.settings.json.example local.settings.json
   ```

   Edit `local.settings.json` and set `DISCORD_WEBHOOK_URL`.

3. Start the function host:

   ```bash
   npm start
   ```

4. Trigger it (the host prints the exact URL, including the function key):

   ```bash
   curl "http://localhost:7071/api/helloDiscord"
   # or with a custom message:
   curl "http://localhost:7071/api/helloDiscord?message=Hi%20from%20curl"
   ```

   A message should appear in your Discord channel.

## Run tests

```bash
npm test
```

## Deploy to Azure

1. Create a Function App (Node.js, v4) in Azure — for example via the Azure CLI:

   ```bash
   az functionapp create \
     --resource-group <resource-group> \
     --consumption-plan-location <region> \
     --runtime node \
     --runtime-version 22 \
     --functions-version 4 \
     --name <app-name> \
     --storage-account <storage-account>
   ```

2. Set the webhook URL as an application setting (never commit secrets):

   ```bash
   az functionapp config appsettings set \
     --name <app-name> \
     --resource-group <resource-group> \
     --settings DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/your-id/your-token"
   ```

3. Publish:

   ```bash
   func azure functionapp publish <app-name>
   ```

After deploying, call the function's URL (with its function key) to post to Discord.

### Deploy with GitHub Actions

A manual-trigger workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml))
can deploy the function from the **Actions** tab. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the GitHub secrets and variables
you need to configure to deploy to your Azure subscription.

## Configuration

| Setting                | Description                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| `DISCORD_WEBHOOK_URL`  | The Discord webhook URL to post messages to.                                |
| `DISCORD_PUBLIC_KEY`   | Discord application public key; verifies slash-command requests.            |
| `TARGET_GITHUB_TOKEN`  | GitHub token authorized to dispatch workflows on the target repo.           |
| `TARGET_REPO_URL`      | Target repository, e.g. `https://github.com/owner/repo` (or `owner/repo`).  |
| `TARGET_WORKFLOW_FILE` | Workflow file name to trigger, e.g. `ci.yml` (or its numeric workflow id).  |
| `TARGET_WORKFLOW_REF`  | Git ref (branch or tag) the workflow runs on, e.g. `main`.                  |

`DISCORD_WEBHOOK_URL` is only needed for `helloDiscord`. The `TARGET_*` settings
are used by both `triggerWorkflow` and the `/deploy` slash command. The slash
command additionally needs `DISCORD_PUBLIC_KEY`.
