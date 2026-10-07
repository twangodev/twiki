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
remain available. The current worksheets also use the preinstalled `car` package.
On Debian/Ubuntu, install the same dependencies as CI:

```sh
sudo apt-get install --no-install-recommends r-base-core r-cran-knitr r-cran-car
```

During rendering, unqualified `install.packages(...)` calls use installed packages
and fail clearly when a requested package is missing. Dependencies are provisioned
before building. Namespaced calls such as `utils::install.packages(...)` retain
normal R behavior; this policy does not intercept them.

Plot cache identities include resolved fonts, font bytes, and active Fontconfig
configuration. Rendering respects the configured fonts. If the font environment
cannot be verified, previews render normally without reusing cached previews.

See [build performance experiments](docs/build-performance.md) for the benchmark
runner, production baseline, and cache constraints.

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
