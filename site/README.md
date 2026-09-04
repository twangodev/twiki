# Wisconsin site

SvelteKit course notes, deployed to Cloudflare Workers at `wisconsin.twango.dev`.

## Development

Run from `site/`:

```sh
bun install --frozen-lockfile
bun run build:content
bun run dev:host
```

Course content is stored in Git submodules under `content/`. Rerun
`build:content` after changing notes.

## Checks

```sh
bun run build:all
bun run check
bun test scripts
bun run test:e2e
```

Browser tests require Chromium: `bunx playwright install chromium`.

## Deployment

`.github/workflows/svelte.yml` runs type checks, unit tests, and browser tests
in separate jobs. Once they pass, a final job builds and deploys `main`.
Build output stays on the runner; no artifacts are uploaded or downloaded.

The GitHub `production` environment supplies the `CLOUDFLARE_API_TOKEN` secret
and `CLOUDFLARE_ACCOUNT_ID` variable.

Cloudflare Access gates the site. workers.dev and preview URLs are disabled.
