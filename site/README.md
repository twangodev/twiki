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

## Authentication

All deployed content requires a GitHub session belonging to `OWNER_GITHUB_ID`.
The Worker checks authentication before serving any assets, including search and
graph data. The login page is standalone and does not load course bundles.

Before publishing this version:

1. Create D1 database `wisconsin` and replace the placeholder `database_id`
   in `wrangler.jsonc`. CI needs D1 edit permission to apply checked-in migrations.
2. Create a GitHub OAuth application with homepage `https://wisconsin.twango.dev`
   and callback `https://wisconsin.twango.dev/api/auth/callback/github`.
3. Keep `GITHUB_CLIENT_ID` in Wrangler's `vars`. Set Worker secrets using
   `bunx wrangler secret put` for `GITHUB_CLIENT_SECRET` and `BETTER_AUTH_SECRET`
   (at least 32 random characters). These are not GitHub Actions secrets.
4. Keep Cloudflare Access enabled until real sign-in, sign-out, and anonymous
   asset blocking have been verified. Removing Access is a separate operation.

For local auth testing, copy `.dev.vars.example` to `.dev.vars`, fill in a
separate development OAuth application's credentials, and use callback
`http://127.0.0.1:4173/api/auth/callback/github`. Run:

```sh
bunx wrangler d1 migrations apply wisconsin --local
bun run build:all
bun run preview
```

Vite development is for local content/UI work; it does not run the outer auth
Worker. Keep it on a trusted machine/network. Use `preview` to verify security.
Browser tests launch the actual Worker on port 4174 with an isolated local D1
database and test sessions. They need no real OAuth credentials and add no
production auth bypass.
