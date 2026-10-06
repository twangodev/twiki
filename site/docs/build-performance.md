# Build performance experiments

The target is a Cloudflare deployment in under 30 seconds and fast development
startup. **The deployment target remains unachieved and unverified.** Work is
isolated on `perf/build-performance`; these changes have not been deployed.

## Corrected complete-corpus comparison

The original and optimized sites were compared with the same complete
1,647-page corpus, Node 25.9.0, Bun 1.4.0, and workstation. R is absent from both
build measurements, so worksheet previews use their documented fallback.

| Complete-corpus measurement                             |   Total | Public edition | Full edition |
| ------------------------------------------------------- | ------: | -------------: | -----------: |
| Original with warm parser cache, fresh generated output |  95.27s |              — |            — |
| Original warm repeat                                    |  94.44s |         33.93s |       59.43s |
| Optimized parser-priming build, mixed cache state       | 151.26s |        105.42s |       45.78s |
| Optimized matched repeat 1                              |  63.25s |         21.95s |       41.24s |
| Optimized matched repeat 2                              |  65.81s |         22.01s |       43.75s |

The first row is not a cold-cache measurement: all 1,647 parsed pages were
already cached. Two optimized warm repeats took **63.25–65.81s**,
**30.3–33.0% faster** than the single original warm measurement of 94.44s.
[Complete results](../benchmarks/complete-results.json) record matching host and
runtime metadata, cache conditions, and per-edition counts. All 1,647 pages hit
the parser cache in both editions of all warm measurements. These are one
original and two optimized Threadripper 9960X samples, not CI predictions or
remote deployment timings.

Optimized warm content pipelines took 5.76–5.86s public and 15.08–17.32s full;
link resolution took 0.75s and 1.78–1.96s, respectively. Complete source, metadata,
rendered text, and resolved resource URLs match the original.

The optimized priming build reparsed all 1,647 pages in its public stage after
helper changes invalidated the parser fingerprint: 79.98s parsing, 1.59s
resolution, and 88.85s for its content pipeline. Its full stage reused all parsed
pages, resolved links in 1.90s, and prepared content in 19.33s. Social cards were
already cached. This primes the parser and mixes cold/warm stages; it is not a
fully cold compiler-cache comparison.

Complete-corpus original dev startup measured 38.83s to Vite readiness and
52.73s to valid home-page HTML after the production build. Warm restarts measured
2.40–2.41s to readiness and 14.75–14.83s to HTML. Optimized startup after the
production build took 24.44s to readiness and 29.76s to HTML; warm restarts took
2.15–2.20s and 7.74–7.80s, respectively. Saved-output validation on warm restarts took
500–506ms; this does not measure a content edit.

An early worktree copied nested CS 759 assignment files without registering
their submodule. Git discovery consequently omitted 58 files, including 22
notes. Its 1,625-page experiments remain provisional: original warm 94.02s,
optimized warm 66.43–69.06s, and four-CPU-affinity restored build 67.47s. Four/eight
prerender workers took 76.19s/84.78s, so the default remains one. The fixture was
corrected before the complete-corpus comparison above.

## Production baseline

Five successful October 5–6, 2026 GitHub Actions runs establish the baseline.
Durations use step timestamps with one-second resolution; deployment starts
independently of the check and browser-test jobs.

| Production stage                | Median | Observed range |
| ------------------------------- | -----: | -------------: |
| Entire deployment job           |   445s |       431–575s |
| Recursive checkout              |    32s |         29–96s |
| Bun package-cache restore       |     5s |           4–5s |
| Compiler archive restore        |     3s |           3–4s |
| Compiler decrypt/extract        |    20s |         19–30s |
| R/knitr installation            |    17s |         14–34s |
| Locked dependency installation  |     4s |           4–7s |
| Public and authenticated builds |   236s |       225–246s |
| Compiler encrypt/save           |    36s |         35–39s |
| Remote D1 migrations            |     2s |           1–2s |
| Wrangler deployment             |    80s |        69–130s |

Runs: [37396634943](https://github.com/twangodev/wisconsin/actions/runs/37396634943),
[37358998002](https://github.com/twangodev/wisconsin/actions/runs/37358998002),
[37347350802](https://github.com/twangodev/wisconsin/actions/runs/37347350802),
[37255238239](https://github.com/twangodev/wisconsin/actions/runs/37255238239), and
[37252406647](https://github.com/twangodev/wisconsin/actions/runs/37252406647).

The latest run scanned 69,877 files and uploaded 4,222 changed assets; upload
alone took 45.18s. Its encrypted compiler archive was 485 MiB. Parser cache hits
were 1,646/1,647 in the public stage and 1,647/1,647 in the full stage; all 1,648
social cards were cached. CI still rebuilt 28 course catalogs and synced 34,248
full-edition assets into fresh output. Local warm runs reused 27 catalogs and
retained existing output. Cache state, R availability, runtimes, and hardware
all contribute to the comparison; CPU strength alone does not explain it.

The latest CI content pipelines took 30.99s/66.61s for public/full editions,
Vite reported 32.76s/about 63s, and search indexing took 5.48s/10.50s. Stage
measurements overlap and must not be summed; older CI lacked adapter subphase
timers. The deployment job now records actual Node version/available CPUs,
Bun version, and R/knitr versions before building.

## Adopted changes and experiments

Changes include indexed link resolution, direct icon imports, separated runtime
navigation/icon assets and stable application versions, edition-aware asset
output, moving the public build instead of copying it, current-entry compiler
cache selection, and deferred development imports. In the early fixture, SSR
transforms fell from 4,703 to 1,093 modules. Complete warm full-edition link
resolution fell from 14.49s to 1.78–1.96s.
[Complete-corpus microbenchmarks](../benchmarks/resolve-micro.json) checked exact
callback identity/order over 3.13 million elements and exact resolved URLs for
15,772 references. Preloaded traversal took 621–632ms versus 97–103ms; indexed
resolution took 75ms plus 8ms initialization versus 5,936ms. These isolate
algorithms and are not deployment timings.

Compiler cache persistence now follows deployment and tolerates optional-save
failures. This removes the observed 35–39s persistence wait from time until the
site is live while total job duration still includes it.

[Structural cache measurements](../benchmarks/cache-transport.json): selecting
current entries reduced gzip-6 output from 316.4 to 155.7 MiB and archive time
from 10.97s to 5.41s. Gzip-1 took 3.62s but produced 167.8 MiB. Retain level 6:
the extra 1.8s saving adds 7.8% transport bytes, and saving happens after deploy.
These single local compression trials mix available development/build manifests
and exclude encryption/network transport; they are not the final CI snapshot.
A final R-enabled production validation saved 21,114 selected entries as a
162.92 MiB encrypted archive in 6.79s, using the existing GPG format and a
disposable benchmark key. Remote cache upload/restore remain unmeasured.

A final-product cache exploration selected 23,144 files: 777.2 MiB raw,
107.5 MiB archived, 6.51s creation, and 2.06s extraction. **Whole-edition caching
is not implemented.** Its proxy selection needs an adapter-derived product
inventory, complete input fingerprints, validated output manifests, and current
static-asset reassembly before it can safely skip builds. Required binary assets
remain part of deployment. Final files alone cannot verify publication policy.

Development prewarms the Cloudflare emulator with shared initialization,
observed failures and retry, and protected prerender options; production retains
its existing initializer. Earlier incomplete-fixture warm startups took
2.00–2.16s to Vite readiness and 9.78–10.64s to valid home-page HTML before this
change. The maintained complete-fixture results are reported above.

## Validation and limitations

The final unit run passed 196 tests/2,064 assertions across 45 files in 18.53s
with isolated R
explicitly selected; formatting passed for 73 files. The final complete-corpus
production validation built successfully in 81.95s with R 4.5.0/knitr 1.50:
eight worksheets rendered and no R fallback was used. This followed publication
fixtures that reset generated output, so it is not the matched warm comparison.

`bun run check` passed: Svelte reported zero errors/warnings, Worker TypeScript
passed, and 15,607 links across 1,658 notes had zero target errors. Diagram checks
covered 1,650 notes, 66,653 math expressions, and 248 Mermaid diagrams with zero
errors. Real-site E2E passed 69 tests, skipped 10, and failed none in about 1.1
minutes; all three initial failures were resolved. Publication fixtures passed
all 10 browser tests across three builds (eight public, one files-only, one
revoked). Prewarming content integration passed in 29.86s, covering privacy,
revocation, private history, and recovery; an incremental edit took 632ms
without rewriting an unrelated page. Workflow guards and optional cache
persistence passed six focused tests/79 assertions.

Wrangler 4.100.0 `deploy --dry-run` passed locally, scanning 69,881 assets and
reporting a Worker of 8,909.27 KiB (1,639.83 KiB gzip). This performs no remote
deployment. Optimized remote CI and Cloudflare timings remain unmeasured.

[Complete page parity](../benchmarks/page-parity.json) preserves all source,
metadata, rendered text, and resource URLs across 1,647 pages; 1,644 are byte
identical. Three pages each contain one Shiki code block that differs between
original and fresh stage-one parse caches. Restoring just each original block
reconstructs the exact baseline PageDoc bytes. This isolates the differences
before link resolution; the highlighting cache variation remains unexplained.
Syntax-highlighting behavior was not changed.

[Complete unchanged-input asset control](../benchmarks/asset-stability.json)
compared 64,541 output files in each R-absent warm build. The later R-enabled
dry-run inventory has different output conditions, so these counts do not
establish direct Cloudflare size parity. All 616 immutable application
assets across both editions retain exactly the same paths and bytes, and all
non-Pagefind static paths/bytes match. Six Pagefind filter/metadata files were
added, six removed, and two entry records changed; the underlying cause remains
unexplained. The earlier title-edit experiment remains provisional because it
used the incomplete fixture. These inventories do not establish visual parity,
zero churn, or measured Wrangler upload savings.

## Reproduce and compare fairly

For CI measurement, the Svelte workflow now has an optional manual `performance`
boolean, defaulting to false. Selecting it runs only the performance job and
disables production deployment even when the selected ref is `main`. Once the
branch is available on GitHub, it can be selected in the workflow UI or with:

```sh
gh workflow run svelte.yml --ref perf/build-performance -f performance=true
```

The job reuses production checkout, runtime setup, dependency/compiler-cache
restoration, R installation, and frozen dependencies. It records runtime
diagnostics, then measures `ci-first` with fresh output and available restored
compiler data, followed by `ci-warm` with retained cache/output. Cache misses or
new compiler fingerprints can make the first build cold; build logs retain
actual hit counts. The second measurement does not model deployment on a fresh
runner. Each CI benchmark allows 1,200s for cold or mixed restores; the manual
job is capped at 45 minutes. The local runner's default remains 300s.
Whitelisted timing/runtime JSON appears in the job summary; generated
private content and raw benchmark logs are not uploaded as artifacts. This
manual path has been validated locally but has not been triggered remotely.
After measurements and their summary, the job optionally encrypts and persists
current compiler entries with the existing authenticated cache format. This
lets a subsequent dispatch restore updated parser fingerprints on a fresh
runner. Both persistence steps tolerate failures and add no deployment action;
GitHub retains its normal branch-scoped cache access rules.

From `site/`, install locked dependencies and run:

```sh
bun tooling/benchmark.ts build comparison-build
bun tooling/benchmark.ts dev comparison-dev
```

Ignored `build/benchmarks/<label>.json` and `.log` retain results and full output.
Use unique labels. Dev records Vite readiness and the first HTTP 200 containing
the expected home-page HTML, uses a fresh port, and terminates only its own
process group. Default timeout: 300s; override `BENCHMARK_TIMEOUT_SECONDS`.
The runner distinguishes actual Node from Bun's Node compatibility version;
older artifacts' `host.node` denotes compatibility, not the executable version.

Keep the complete recursively registered corpus and R availability equal across
comparisons; distinguish cold caches, warm caches, and fresh generated outputs.
Finish maintained-source edits before unchanged-asset comparisons because the
application version hashes tooling. Run builds serially per checkout.

CPU affinity can constrain a Linux comparison:

```sh
taskset -c 0-3 bun tooling/benchmark.ts build four-cpu-comparison
```

Choose allowed CPU IDs. Affinity does not match CPU speed, memory, disk, network,
or runner provisioning. [Standard GitHub Ubuntu runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
provide four CPUs for public repositories and two for private repositories.

CI currently pins neither Node nor Bun; the measured latest CI used Bun 1.4.2,
versus local 1.4.0. [Vite requires Node 20.19+ or 22.12+](https://vite.dev/guide/);
[Node 24 is active LTS](https://github.com/nodejs/Release/blob/main/README.md) as of
these experiments. A tested shared runtime policy through
[setup-node](https://github.com/actions/setup-node) and explicit Bun selection
would improve reproducibility; runtime migration is not part of this patch.
Retain [frozen-lockfile installs](https://bun.com/docs/pm/cli/install), complete
Git history, R fidelity, correct cold-cache fallback, and encrypted private
content because [base-branch caches are readable by fork PRs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).
[Cloudflare already deduplicates unchanged assets](https://developers.cloudflare.com/workers/static-assets/direct-upload/).
Remote deployment timing still needs direct validation.
