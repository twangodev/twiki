---
title: Cloudflare deployment
---

# Cloudflare deployment

Add an explicit `cloudflare` object to your configuration. [[examples/cloudflare-config|Cloudflare configuration]] shows a public site with a custom domain.

Build and preview locally:

```sh
bunx twiki build --target cloudflare
bunx twiki preview
```

Preview uses local Workers, listens on `127.0.0.1:4173` by default and derives a matching local origin. It refuses remote mode. Additional Wrangler dev flags go after `--`.

Before the first upload, provision the Worker and custom domain through Cloudflare or Wrangler. Configure `workers_dev: false`, `preview_urls: false` and your custom domain route. Twiki's incremental deployer verifies that routing already matches; it does not silently create or retarget domains.

Provide `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` through your shell or CI environment. Keep the token out of configuration and source control. Then upload the existing build:

```sh
bunx twiki deploy
```

Twiki supplies generated Worker and asset paths. Consumer configuration supplies resource bindings, compatibility settings and variables. Rebuild after changing configuration. A public site needs no database or GitHub OAuth application; see [[guides/authentication|Authentication]] for private notes and [[guides/ci|CI deployment]] for automation.
