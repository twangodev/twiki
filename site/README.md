# Wisconsin site

SvelteKit course notes, deployed to Cloudflare Workers at `wisconsin.twango.dev`.

## Development

Run from `site/`:

```sh
bun install --frozen-lockfile
bun run dev:host
```

Course content is stored in Git submodules under `content/` and watched during development.

## Checks

```sh
bun run build:all
bun run check
bun run test
bun run test:e2e
```

Browser tests require Chromium: `bunx playwright install chromium`.
