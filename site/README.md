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

## Checks

```sh
bun run build:all
bun run check
bun run test
bun run test:e2e
```

Browser tests require Chromium: `bunx playwright install chromium`.

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
