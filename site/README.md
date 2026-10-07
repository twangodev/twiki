# Wisconsin site

SvelteKit course notes on Cloudflare Workers. Course content lives in Git
submodules under `../content/`.

## Development

Run from `site/`:

```sh
bun install --frozen-lockfile
bun run dev
```

Rendered worksheets need R and knitr; without them, source and interactive views
remain available. CI also preinstalls `car`. Worksheet package-install calls reuse
installed packages; missing dependencies must be installed before rendering.

## Checks

Install Chromium (`bunx playwright install chromium`) and Lychee **0.24.2** on
PATH, then run:

```sh
bun run check
bun run test
bun run build:all
bun run test:e2e
bun run test:publishing
```

`check` validates types, links, local targets, math, and Mermaid. `build:all`
builds both public and authenticated editions.

## Operations

- CI deploys `main`; Worker configuration is in `wrangler.jsonc`.
- Generated output and caches live in `build/`, including the local database.
  Use a separate checkout when building alongside a dev server.
- Analytics use the Worker relay to Rybbit; enable **First-Party Proxy** in Rybbit.
  Browser tests set `DISABLE_ANALYTICS=true` and keep events local.
