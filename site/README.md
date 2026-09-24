# Wisconsin site

SvelteKit course notes, deployed to Cloudflare Workers at `wisconsin.twango.dev`.

## Development

Run from `site/`:

Install R and knitr for build-time worksheet previews (Debian/Ubuntu):

```sh
sudo apt-get install --no-install-recommends r-base-core r-cran-knitr
```

The build knits `.Rmd` files into typeset reading views with results and plots.
Interactive mode loads R in the browser only when a reader runs a chunk.
Development can start without R/knitr; worksheets then open in Source mode with
Interactive available and Read disabled. Install the packages above and restart
the dev server to enable rendered reading views. Production builds require them.
Previews are cached against course files, the renderer, and R/package versions;
source or data changes invalidate them. `RSCRIPT` can select another Rscript executable.
R chunks run in a temporary copy of available course files, with the worksheet's
directory as their working directory. Missing packages or failed chunks fail the build
with the worksheet path. Add packages required by new worksheets to local and CI setup.

```sh
bun install --frozen-lockfile
bun run dev:host
```

Course content is stored in Git submodules under `content/` and watched during development.

Notes remain prerendered and readable without JavaScript. The file browser,
including worksheet reading views, requires JavaScript. File-browser URLs use one client-rendered HTML shell
per edition, loading the course catalog and selected previews as assets. The
Worker maps only exact catalog URLs to the shell; unknown paths return 404.
Public and authenticated readers receive their edition's shell and assets through
the existing access gate. File names enter the search index directly without
rendering a page for each file. Raw Markdown and compiled worksheet assets remain
available through the existing download and preview URLs.

## Checks

```sh
bun run build:all
bun run check
bun run test
bun run test:e2e
```

Browser tests require Chromium: `bunx playwright install chromium`.

`build:all` reports public, full, and total wall-clock time. File history runs in
up to eight course workers (bounded by available CPUs); override with
`WISCONSIN_HISTORY_WORKERS=16 bun run build:all`, or use `1` for a serial comparison.
Public file-browser assets and statics use `build/generated/public-files/` and
`build/generated/public-static/`, so public builds do not prune full-site assets.
The content manifests and SvelteKit build directory are still shared: use a
separate checkout when building alongside a dev server.

Production file-browser results are cached per course in
`build/generated/cache/course-files/`. Reuse requires matching tooling, course
HEAD, tracked file metadata, publication policy, note links, and intact output
files. Working-copy edits invalidate the course. Courses with R Markdown always
run the renderer's own runtime-aware cache checks. This course cache accelerates
local rebuilds; CI still restores the existing encrypted history/renderer cache,
then regenerates outputs. Removing generated outputs safely causes cache misses.

### Validate Math and Mermaid

Run `bun run check:diagrams` to check every Markdown file under `content/`, including untracked, non-ignored notes. To check one course or file, pass its path:

```sh
bun run check:diagrams ../content/fa26-cs577
```

The command checks math with KaTeX and parses and renders Mermaid in Chromium using the installed site versions. Failures include the source file, line, and column and produce a nonzero exit status. Install the browser once with `bunx playwright install chromium`. CI runs the check in the browser-tests job.

This validates recognized Markdown math and Mermaid blocks, not mathematical correctness or visual quality. Unclosed math delimiters can be interpreted as ordinary text by Markdown and need review.

Build output and caches live under `build/`, including SvelteKit output in
`build/.svelte-kit/`. Mark `site/build` as Excluded in your IDE to avoid indexing
generated files.

Wrangler local state, caches, and temporary files live in `build/.wrangler/`.
A `.wrangler` compatibility symlink redirects Wrangler's hardcoded paths there.
Dev and preview share the same local database; removing `build/` also removes
that local database. `wrangler.jsonc` remains the source configuration.

## Analytics

Production uses `@rybbit/js` through the Worker's `/api/analytics/` relay to avoid
cross-origin beacon failures. The relay allows only configuration, tracking and
identification for Rybbit site `4`, strips site credentials, and forwards browser
metadata and the visitor IP. Enable **First-Party Proxy** in Rybbit's site settings
under **Privacy & Security** so it trusts the forwarded IP.

GitHub usernames come from OAuth and refresh on sign-in; existing accounts need
to sign in again to populate the field. Tracking respects Rybbit's browser opt-out
flags. Run `bun test ./tests/browser-analytics.test.ts` for real-HTTP browser coverage.
