# Deploying via GitHub Actions

This repository includes a workflow at
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) that deploys the
Azure Function to your Azure subscription.

## How it's triggered

The workflow runs **on manual trigger only** (`workflow_dispatch`). To deploy:

1. Go to the repository's **Actions** tab on GitHub.
2. Select **Deploy to Azure Functions** in the left sidebar.
3. Click **Run workflow**, choose the branch, and confirm.

It will not run on push, pull request, or any schedule — only when you start it.

## What the workflow does

1. Checks out the repo and sets up Node.js 22.
2. Installs dependencies (`npm ci`) and runs the tests (`npm test`).
3. Deploys to your Function App using
   [`Azure/functions-action`](https://github.com/Azure/functions-action).

## Prerequisites in Azure

Before the first deploy, create the Function App in your subscription (Node.js,
Functions v4). For example, with the Azure CLI:

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

## Required GitHub configuration

Add these under **Settings → Secrets and variables → Actions** in the repository.

### Secret

| Name                                | Type   | Where to get it |
| ----------------------------------- | ------ | --------------- |
| `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` | Secret | Azure Portal → your Function App → **Overview** → **Get publish profile** (downloads an XML file). Open it and paste the **entire XML contents** as the secret value. |

> The publish profile contains deployment credentials, so it must be a
> **secret**, never a variable, and never committed to the repo.

### Variable

| Name                     | Type     | Value |
| ------------------------ | -------- | ----- |
| `AZURE_FUNCTIONAPP_NAME` | Variable | The exact name of your Function App in Azure (the `<app-name>` from above). |

This is a non-sensitive **repository variable** (the "Variables" tab next to
"Secrets"), referenced in the workflow as `${{ vars.AZURE_FUNCTIONAPP_NAME }}`.

### Runtime app settings (configured in Azure, not GitHub)

The functions read their configuration from Function App **application settings**.
These are **not** GitHub secrets — set them on the Function App itself so they are
available at runtime.

| App setting            | Used by           | Description |
| ---------------------- | ----------------- | ----------- |
| `DISCORD_WEBHOOK_URL`  | `helloDiscord`    | The Discord webhook URL to post messages to. |
| `TARGET_GITHUB_TOKEN`  | `triggerWorkflow` | GitHub token authorized to dispatch workflows on the target repo. Use a fine-grained PAT with **Actions: read and write** on that repo, or a classic PAT with the `workflow` scope. |
| `TARGET_REPO_URL`      | `triggerWorkflow` | Target repository, e.g. `https://github.com/owner/repo` (or `owner/repo`). |
| `TARGET_WORKFLOW_FILE` | `triggerWorkflow` | Workflow file name to trigger, e.g. `ci.yml` (or its numeric workflow id). |
| `TARGET_WORKFLOW_REF`  | `triggerWorkflow` | Git ref (branch or tag) the workflow runs on, e.g. `main`. |

Set them with the Azure CLI:

```bash
az functionapp config appsettings set \
  --name <app-name> \
  --resource-group <resource-group> \
  --settings \
    DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/your-id/your-token" \
    TARGET_GITHUB_TOKEN="ghp_your_personal_access_token" \
    TARGET_REPO_URL="https://github.com/owner/repo" \
    TARGET_WORKFLOW_FILE="ci.yml" \
    TARGET_WORKFLOW_REF="main"
```

(You can also set them in the Azure Portal under **Settings → Environment
variables → App settings**.)

> `TARGET_GITHUB_TOKEN` is a credential — store it only as a Function App
> application setting (ideally backed by [Key Vault](https://learn.microsoft.com/azure/app-service/app-service-key-vault-references)),
> never in source control.

## Summary of what you need to add

- **GitHub secret:** `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`
- **GitHub variable:** `AZURE_FUNCTIONAPP_NAME`
- **Azure app settings:** `DISCORD_WEBHOOK_URL`, `TARGET_GITHUB_TOKEN`,
  `TARGET_REPO_URL`, `TARGET_WORKFLOW_FILE`, `TARGET_WORKFLOW_REF`

## Alternative: OIDC / service principal authentication

If you prefer not to use a publish profile, you can authenticate with a service
principal via OpenID Connect. Add `azure/login@v2` before the deploy step and
configure these secrets instead of the publish profile:

| Name                    | Description |
| ----------------------- | ----------- |
| `AZURE_CLIENT_ID`       | App registration (client) ID with a federated credential for this repo. |
| `AZURE_TENANT_ID`       | Your Azure AD tenant ID. |
| `AZURE_SUBSCRIPTION_ID` | The target subscription ID. |

With OIDC you also need `permissions: id-token: write` on the job and you omit
the `publish-profile` input on the deploy step. See
[Azure login with OIDC](https://github.com/Azure/login#login-with-openid-connect-oidc-recommended)
for details.
