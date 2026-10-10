---
title: CI deployment
---

# CI deployment

Run validation and builds on pull requests. Deploy only trusted commits on the production branch, after validation succeeds.

Set the GitHub Actions secret `CLOUDFLARE_API_TOKEN` and variable `CLOUDFLARE_ACCOUNT_ID`. Scope the token to the Worker and resources it needs. Restrict the production environment to your production branch.

The essential commands are:

```sh
bun install --frozen-lockfile
bunx twiki build --target cloudflare
bunx twiki deploy
```

Expose Cloudflare credentials only to the upload step. Keep deployments serialized so two uploads do not race. If static export runs in the same job, preserve the Cloudflare build first: both targets write generated state.

Twiki's own `ci.yml` demonstrates this pattern: tests build the documentation, the Cloudflare artifact transfers to a separate deployment job, and a final check compares the live content and application versions with the build descriptor. npm releases use a separate job and OIDC permissions within the same workflow.

[Twiki CI workflow](https://github.com/twangodev/twiki/blob/main/.github/workflows/ci.yml)

See [[guides/caching|Caching]] for reusable build state and [[guides/cloudflare|Cloudflare]] for initial routing setup.
