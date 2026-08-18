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
- `src/functions/appInsightsAlert.js` — HTTP-triggered function (`POST`) that
  receives Application Insights alert webhooks and forwards them to Discord with
  formatted embeds including alert severity, timestamp, and resource information.
- `src/dispatchWorker.js` — handles background workflow triggers and deployment
  diffs:
  - `handleDispatch`: runs the GitHub `workflow_dispatch` and edits the deferred
    reply with the result, off the critical path (fire-and-forget, best-effort).
  - `handleDiffWithDeployed`: fetches the latest successful deployment and diffs
    it against the main branch, reporting deployed version and any commits ahead.
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

### Diffing deployed version

Use the `/diffwithdeployed` slash command to compare the latest successful deployment
against the main branch. It:

- Fetches the most recent successful run of the configured deploy workflow
- Shows the deployed commit hash and timestamp
- Lists any commits ahead on `main` that haven't been deployed yet
- Helps you quickly see what changes are pending deployment

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

2. Set the required application settings (never commit secrets):

   ```bash
   az functionapp config appsettings set \
     --name <app-name> \
     --resource-group <resource-group> \
     --settings \
       DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/your-id/your-token" \
       DISCORD_PUBLIC_KEY="<discord-public-key>" \
       TARGET_GITHUB_TOKEN="<github-token>" \
       TARGET_REPO_URL="https://github.com/owner/repo" \
       TARGET_WORKFLOW_FILE="ci.yml" \
       TARGET_WORKFLOW_REF="main" \
       TARGET_DEPLOY_WORKFLOW_FILE="deploy.yml"
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

### Required settings

| Setting              | Used by                    | Description                                                               |
| -------------------- | -------------------------- | ------------------------------------------------------------------------- |
| `DISCORD_WEBHOOK_URL` | `helloDiscord`             | Discord webhook URL for posting messages.                                 |
| `DISCORD_PUBLIC_KEY` | Slash commands             | Discord application public key; verifies request signatures.              |

### Workflow dispatch settings

These are required for the `/rune2e`, `/deploy`, `/runsmoketest`, `/issuesopened`, `/issuesclosed`, and `/diffwithdeployed` slash commands and the `triggerWorkflow` function:

| Setting                      | Description                                                                 |
| ---------------------------- | --------------------------------------------------------------------------- |
| `TARGET_GITHUB_TOKEN`        | GitHub token with **Actions: read and write** permission on target repo.   |
| `TARGET_REPO_URL`            | Target repository, e.g. `https://github.com/owner/repo` (or `owner/repo`).  |
| `TARGET_WORKFLOW_FILE`       | Workflow file name for `/rune2e`, e.g. `ci.yml` (or its numeric workflow id). |
| `TARGET_WORKFLOW_REF`        | Git ref (branch or tag) the workflow runs on, e.g. `main`.                  |
| `TARGET_DEPLOY_WORKFLOW_FILE` | *(Optional)* Workflow file name for `/deploy`; defaults to `deploy.yml`. If not set, `/deploy` responds "Nothing happened because no action has been configured." |
| `TARGET_SMOKE_TEST_LIVE_WORKFLOW_FILE` | *(Optional)* Workflow file name for `/runsmoketest`; defaults to `smoke-test-live.yml`. If not set, `/runsmoketest` responds "Nothing happened because no action has been configured." |

**Note:** If `TARGET_REPO_URL` or `TARGET_GITHUB_TOKEN` are not set, workflow dispatch commands respond with "Nothing happened because no action has been configured."
