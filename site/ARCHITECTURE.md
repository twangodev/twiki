# SvelteKit site

`main` is the production branch. SvelteKit is the only site implementation;
there is no Quartz build or frozen migration baseline.

## Content pipeline

Course repositories live under `content/` as Git submodules. The build discovers
Markdown and allowed assets, renders notes, resolves wikilinks and transclusions,
and emits page data, navigation, tags, backlinks, and graph connections.

`prepare-static.ts` copies assets into the static tree and generates navigation
and unresolved-link diagnostics. Content links and anchors that cannot resolve
are reported as warnings; unexpected prerender errors still fail the build.
Files larger than 25 MiB fail the asset check.

## Interface

Svelte components provide navigation, the scrolling outline, search, previews,
and the expandable graph. The graph uses D3 force simulation and Pixi rendering.
Pagefind indexes prerendered articles. Mermaid renders diagrams, KaTeX handles
math, and Shiki highlights code. Ported Markdown utilities retain their original
license notices; they do not require a Quartz installation.

## Verification

Run from `site/`:

```sh
bun install --frozen-lockfile
bun run build:all
bun run check
bun test scripts
bun run test:e2e
```

Unit and browser tests cover the current site's behavior, not equivalence to an
old site snapshot. New courses, pages, and tags do not require baseline updates.

## Deployment

`.github/workflows/svelte.yml` builds and tests the site, then deploys successful
main-branch builds through the GitHub `production` environment. Deployment uses
the `CLOUDFLARE_API_TOKEN` secret and `CLOUDFLARE_ACCOUNT_ID` variable.

The Cloudflare adapter emits the Worker and prerendered assets. The deployment
artifact includes the adapter output and its generated server dependencies.
Wrangler deploys Worker `wisconsin` to `wisconsin.twango.dev`. Cloudflare Access
gates the hostname; workers.dev and preview URLs remain disabled.
