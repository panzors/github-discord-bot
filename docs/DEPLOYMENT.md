# Deploying via GitHub Actions

This repository includes a workflow at
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) that deploys the
Azure Function to your Azure subscription.

Authentication uses **OpenID Connect (OIDC)** with an Azure service principal and
Azure RBAC — there are no long-lived deployment credentials stored in GitHub.

> **Why not a publish profile?** Publish-profile deployment relies on SCM
> **basic authentication**, which Azure now disables by default on new Function
> Apps (and many policies disable it org-wide). When basic auth is off, the
> publish profile stops working. OIDC + RBAC is the recommended replacement and
> does not depend on basic auth.

## How it's triggered

The workflow runs **on manual trigger only** (`workflow_dispatch`). To deploy:

1. Go to the repository's **Actions** tab on GitHub.
2. Select **Deploy to Azure Functions** in the left sidebar.
3. Click **Run workflow**, choose the branch, and confirm.

It will not run on push, pull request, or any schedule — only when you start it.

## What the workflow does

1. Checks out the repo and sets up Node.js 22.
2. Installs dependencies (`npm ci`) and runs the tests (`npm test`).
3. Logs in to Azure with [`azure/login`](https://github.com/Azure/login) using OIDC.
4. Deploys to your Function App using
   [`Azure/functions-action`](https://github.com/Azure/functions-action) over the
   authenticated Azure session.

## Sign in to Azure CLI first

All the `az` commands below (except the `az ad app` ones) need an active
**subscription** in your CLI session. If you skip this you'll see
`(MissingSubscription) The request did not have a subscription or a valid
tenant level resource provider.`

```bash
az login                           # or: az login --use-device-code
az account list --output table     # list subscriptions you can access
az account set --subscription "<SUBSCRIPTION_NAME_OR_ID>"
az account show                    # confirm a subscription is now active
```

If `az account list` is empty, you're signed into a tenant with no
subscription — log in to the correct directory with
`az login --tenant <TENANT_ID>` and set the subscription again.

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

## Set up OIDC (one time)

Create an app registration, give it permission to deploy, and add a federated
credential that trusts this repository's `production` environment.

```bash
# 1. Create the app registration and capture its client (app) id.
appId=$(az ad app create --display-name "github-discord-bot-deploy" --query appId -o tsv)

# 2. Create a service principal for the app.
az ad sp create --id "$appId"

# 3. Grant it Contributor on the Function App's resource group.
subId=$(az account show --query id -o tsv)
az role assignment create \
  --assignee "$appId" \
  --role Contributor \
  --scope "/subscriptions/$subId/resourceGroups/<resource-group>"

# 4. Add a federated credential trusting this repo's "production" environment.
#    The subject MUST match how the workflow runs. Because the deploy job sets
#    `environment: production`, the subject is the environment form below.
az ad app federated-credential create --id "$appId" --parameters '{
  "name": "github-deploy-production",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:panzors/github-discord-bot:environment:production",
  "audiences": ["api://AzureADTokenExchange"]
}'

# Print the values you need for GitHub secrets:
echo "AZURE_CLIENT_ID=$appId"
echo "AZURE_TENANT_ID=$(az account show --query tenantId -o tsv)"
echo "AZURE_SUBSCRIPTION_ID=$subId"
```

> The federated `subject` must match the workflow exactly. The deploy job
> declares `environment: production`, so GitHub's OIDC token subject is
> `repo:<owner>/<repo>:environment:production`. If you remove that
> `environment:` line, switch the subject to a branch form such as
> `repo:<owner>/<repo>:ref:refs/heads/main`.

## Required GitHub configuration

Add these under **Settings → Secrets and variables → Actions** in the repository.

### Secrets

| Name                    | Type   | Value |
| ----------------------- | ------ | ----- |
| `AZURE_CLIENT_ID`       | Secret | The app registration (client) ID from step 1 above. |
| `AZURE_TENANT_ID`       | Secret | Your Azure AD (Entra) tenant ID. |
| `AZURE_SUBSCRIPTION_ID` | Secret | The subscription ID containing the Function App. |

> These three values are not themselves sensitive, but storing them as secrets
> is the convention `azure/login` documents. No client secret or publish profile
> is stored — OIDC mints a short-lived token per run.

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
| `DISCORD_WEBHOOK_URL`  | `helloDiscord`        | The Discord webhook URL to post messages to. |
| `DISCORD_PUBLIC_KEY`   | `discordInteractions` | Discord application public key; verifies inbound slash-command requests. See [SLASH_COMMANDS.md](SLASH_COMMANDS.md). |
| `TARGET_GITHUB_TOKEN`  | `triggerWorkflow`, `discordInteractions` | GitHub token authorized to dispatch workflows on the target repo. Use a fine-grained PAT with **Actions: read and write** on that repo, or a classic PAT with the `workflow` scope. |
| `TARGET_REPO_URL`      | `triggerWorkflow`, `discordInteractions` | Target repository, e.g. `https://github.com/owner/repo` (or `owner/repo`). |
| `TARGET_WORKFLOW_FILE` | `triggerWorkflow`, `discordInteractions` | Workflow file name to trigger, e.g. `ci.yml` (or its numeric workflow id). |
| `TARGET_WORKFLOW_REF`  | `triggerWorkflow`, `discordInteractions` | Git ref (branch or tag) the workflow runs on, e.g. `main`. |

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

- **GitHub secrets:** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- **GitHub variable:** `AZURE_FUNCTIONAPP_NAME`
- **Azure app settings:** `DISCORD_WEBHOOK_URL`, `TARGET_GITHUB_TOKEN`,
  `TARGET_REPO_URL`, `TARGET_WORKFLOW_FILE`, `TARGET_WORKFLOW_REF`

## Alternative: service principal with a client secret

If you can't use OIDC, you can authenticate with a service principal **client
secret** instead. Create one and store the JSON as a single `AZURE_CREDENTIALS`
secret:

```bash
az ad sp create-for-rbac \
  --name "github-discord-bot-deploy" \
  --role Contributor \
  --scopes "/subscriptions/<sub-id>/resourceGroups/<resource-group>" \
  --json-auth
```

Then change the login step to use that secret (and you can drop the
`id-token: write` permission):

```yaml
      - name: Azure login (service principal)
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
```

This works without basic auth too, but it stores a long-lived credential in
GitHub, so OIDC is preferred where possible.
