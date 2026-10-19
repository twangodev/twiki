[Full documentation](https://twiki.twango.dev) · [Documentation source](../documentation/notes/index.md)

# Usage

An Obsidian-compatible Markdown publishing engine with wikilinks,
transclusions, search, file previews, and diagrams. Build a Cloudflare Worker
or export public pages for a static host.

Consumers keep their notes, a declarative config, and a pinned engine dependency.
Installed engine files remain read-only; generated state belongs to the consumer.

## Start a vault

```sh
bun add --dev --exact @twango/twiki
bunx twiki init
bunx twiki dev
```

Use Bun 1.4+ and Node 22.12+. Git discovery needs Git. R worksheets need an
installed R renderer and their declared packages; rendering does not download
missing packages. `check` also needs Lychee 0.24.2 and Playwright Chromium
(`bunx playwright install --with-deps chromium`).

`init` creates `twiki.config.json` without overwriting an existing file:

```json
{
  "version": 1,
  "contentDir": "notes",
  "discovery": "filesystem",
  "publication": "public",
  "site": {
    "name": "My notes",
    "title": "My notes",
    "url": "https://notes.example.com",
    "description": "Notes and reference material."
  }
}
```

Without config, the current directory is the vault and publication is private.
Hidden directories, including `.obsidian` and `.twiki`, are excluded.

## Commands

```sh
bunx twiki dev -- --port 5173
bunx twiki check
bunx twiki build --target cloudflare
bunx twiki preview
bunx twiki deploy
bunx twiki build --target static
```

`--project <directory>` selects a consumer root; `--config <file>` selects an
explicit JSON config. Dev and preview accept extra arguments after `--`.

Static export requires `publication: "public"`; a static host cannot protect
private files. `.twiki/output` aliases the public static tree or the complete
Cloudflare artifact. `deploy` uploads an existing Cloudflare build and requires
explicit Cloudflare configuration and credentials.

## Cloudflare

The optional `cloudflare` object accepts Worker resource settings. Your `vars`,
D1 bindings, R2 buckets, routes, account ID, and compatibility settings are
retained; Twiki supplies generated `main` and `assets` paths.

```json
{
  "version": 1,
  "contentDir": "notes",
  "publication": "public",
  "site": { "name": "My notes", "url": "https://notes.example.com" },
  "cloudflare": {
    "name": "my-notes",
    "compatibility_date": "2026-06-07",
    "compatibility_flags": ["nodejs_compat"],
    "workers_dev": true,
    "preview_urls": false,
    "routes": []
  }
}
```

Provide `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` through the environment,
never through committed configuration. GitHub authentication uses a `DB` D1
binding and owner/client settings in `vars`. Without `DB`, authentication is
disabled and private assets remain unavailable. Analytics is disabled by default;
configure `analytics: {"siteId": "…", "endpoint": "https://analytics.example.com/api"}`
to use your own endpoint.

## Environment variables

Twiki-specific runtime paths retain the `TWIKI_` prefix. Build controls and
Worker settings use generic names. Previous environment variable names are no
longer supported; update shell scripts, CI settings, and Cloudflare `vars` when
upgrading. Standard Cloudflare, GitHub OAuth, Better Auth, Node, and R names are
unchanged.

| Variable | Purpose / default |
| --- | --- |
| `PRERENDER_CONCURRENCY` | Prerender concurrency; default `1` |
| `HISTORY_WORKERS` | Git history workers, `1`–`48`; default available CPUs capped at `8` |
| `R_CACHE_ONLY` | `1` requires cached R previews |
| `R_REQUIRE_PROFILE` | `1` requires a verified R render profile |
| `R_RENDER_PROFILE_FILE` | R render profile path override |
| `APPLICATION_VERSION` | Internal SHA-256 application version for isolated builds |
| `TWIKI_CONTENT_REPO` | Root for automatic project discovery; distinct from the content-directory override |
| `TWIKI_APP_STATIC_DIR` | Internal static asset staging directory |
| `TWIKI_SKIP_CONTENT` | Internal `1` switch to skip content preparation |
| `TWIKI_PREPARED_CONTENT_KEY` | Internal prepared-content fingerprint |

Deployed Worker variables are separate from the build shell environment. Twiki
generates `ORIGIN`, `SITE_NAME`, `SITE_DESCRIPTION`, `AUTH_MODE`,
`DISABLE_ANALYTICS`, `ANALYTICS_SITE_ID`, and `ANALYTICS_ENDPOINT` from project
configuration. Explicit `cloudflare.vars` override generated values. `AUTH_MODE`
is `github` when a D1 binding named `DB` exists, otherwise `none`.

GitHub authentication also requires `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`BETTER_AUTH_SECRET` (at least 32 characters), and numeric `OWNER_GITHUB_ID`.
Store secrets using Cloudflare secrets. Build-shell values are not automatically
uploaded as Worker variables.

Existing generic controls retain their names: `BUILD_CACHE_KEY`, `ORIGIN`,
`DISABLE_ANALYTICS`, and `OWNER_GITHUB_ID`. Existing project and dependency paths retain their
`TWIKI_` names; Vite edition/export switches retain their `VITE_` names.

## Publication report

`bunx twiki exec -- tooling/publish.ts` lists files selected by the configured
publication policy. Add a content-relative file or folder path to inspect both
public and private decisions. Discovery matches the build, including plain
folders and declared Git submodules; normal draft and renderer filters still apply.

## Git and nested courses

```json
{
  "version": 1,
  "contentDir": "content",
  "discovery": "git",
  "publication": "policies"
}
```

Git discovery reads recursive tracked files and declared course submodules.
Twiki does not edit notes, commit submodules, or change Git pointers.

## CI and caches

```sh
bunx twiki prepare --json
bunx twiki exec -- tooling/cache.ts restore
bunx twiki build --target cloudflare
bunx twiki exec -- tooling/cache.ts save
```

The stable runtime is `<consumer>/.twiki/site`. Compiler, application, search, R,
and Wrangler caches belong there. Engine dependencies use the shipped frozen
lockfile in a separate consumer-owned `node_modules`; existing vault dependencies
cannot change the engine compiler. Repeated preparation reuses that installation.

`prepare --json` returns `projectRoot`, `workDir`, `outputDir`, and resolved
`TWIKI_*` environment paths. It does not serialize inherited credentials.
`exec` runs Bun arguments from that runtime, including cache tools, migrations,
and verification scripts.

The product-cache action uses bundled production products; its `transport` and
`namespace` inputs default to `bundle` and `production`. Group-by-group SDK
transport and benchmark namespaces are no longer supported. Product keys use
`twiki-products-v1-`; old keys cause a cold rebuild. Compiler archive `save` and
`restore` remain available because they cover compiler and R reuse separately.

The optional GitHub adapter is maintained in TypeScript under
`integrations/github-cache/src/`. Run `bun run integrations:build` after editing
it; the distributed Node entry point is generated JavaScript.

The package exports `@twango/twiki/actions/product-cache` for Node action bootstraps,
`@twango/twiki/cli` for locating the executable, and `@twango/twiki/runtime` for Bun scripts.

## Engine development

```sh
bun install --frozen-lockfile
bun run test
bun run check
bun cli/twiki.ts dev --project examples/vault
```

`site/` contains the SvelteKit engine and its focused tests. Runtime dependencies
are pinned exactly so consumers can compile without a sibling checkout. The
engine ships a matching frozen lockfile and installs its own dependencies into
`.twiki/site/node_modules` with lifecycle scripts disabled. Consumer dependency
versions do not affect the engine graph. Bun reuses its package cache; CI can
retain the runtime dependency directory for subsequent runs. The compatible
Svelte ESM printer (`esrap`) is pinned explicitly.

The stable Wrangler 4.149.0 toolchain uses its official pinned
`miniflare@5.20261006.1-alpha` implementation for local Workers. Twiki pins that
matching version rather than selecting an independent preview runtime.
