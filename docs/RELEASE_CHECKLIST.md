# Release checklist

Run through this before publishing a GitHub Release. Publishing triggers the
[Azure deploy workflow](../.github/workflows/deploy.yml) automatically.

## 1. New slash commands

If any slash commands were added, renamed, or removed since the last release:

- [ ] Update `scripts/register-commands.js` with the new/changed command definitions
- [ ] Run `node scripts/register-commands.js` against production (with the real
      `DISCORD_APP_ID`, `DISCORD_BOT_TOKEN`, and optionally `DISCORD_GUILD_ID`)
      **before or immediately after** the deploy so Discord routes the commands
      to the new handler version
- [ ] Verify the commands appear in Discord (type `/` to confirm)
- [ ] Update `docs/SLASH_COMMANDS.md` to reflect any changes

> Guild-scoped registration is instant. Global registration can take up to
> 1 hour to propagate — register before the release tag if timing matters.

## 2. Environment / configuration changes

If new app settings were introduced:

- [ ] Add them to the Function App in Azure (`az functionapp config appsettings set …`)
- [ ] Document them in the **Runtime app settings** table in
      [`docs/DEPLOYMENT.md`](DEPLOYMENT.md)

## 3. Tests

- [ ] `npm test` passes locally on the release branch/tag

## 4. Release notes

- [ ] Use **Generate release notes** in the GitHub UI — categories are defined
      in [`.github/release.yml`](../.github/release.yml)
- [ ] Add a short summary of user-visible changes at the top

## 5. Publish

- [ ] Create and publish the GitHub Release
- [ ] Confirm the **Deploy to Azure Functions** workflow run starts and succeeds
      in the **Actions** tab
